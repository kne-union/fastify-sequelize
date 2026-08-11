`@kne/fastify-sequelize` 将 Sequelize 接入 Fastify：自动模型加载、Snowflake ID、查询工具、可选多连接与租户池。完整参数表见 **API** 页。

### 主要特性

| 特性 | 说明 |
|------|------|
| ORM 集成 | SQLite / MySQL / PostgreSQL / MSSQL |
| 自动模型加载 | 目录 / 单文件 / 函数，统一 `require` |
| 分布式 ID | 未传 `id` 时 Snowflake 自动生成 |
| SQL 迁移 | `sqlPath` 按名升序；默认 `_fs_sql_migrations` 防重复 |
| 查询工具 | `buildWhereQuery` / 分页；非法分页参数抛错 |
| 多连接 | `connection(name)`；`fastify.sequelize` 始终为默认库 |
| 租户池 | `forTenant` + LRU / 空闲回收 |
| TypeScript | 发布 `index.d.ts`，增强 `FastifyInstance.sequelize` |

### 安装

```shell
npm i --save @kne/fastify-sequelize fastify sequelize
```

Peer：`fastify`（>=5）、`sequelize`（>=6 \<7）。要求 Node.js >=18。

---

### 快速开始

```javascript
const fastify = require('fastify')();
const fastifySequelize = require('@kne/fastify-sequelize');

fastify.register(fastifySequelize, {
  db: { dialect: 'sqlite', storage: './database.sqlite' },
  modelsPath: './models',
  prefix: 't_'
});

fastify.post('/users', async (request) => {
  const { user } = fastify.sequelize.models;
  return user.create({ name: request.body.name });
});

await fastify.ready();
await fastify.sequelize.sync();
fastify.listen({ port: 3000 });
```

### 核心约定

- `const db = fastify.sequelize` **永远是默认库**，历史用法不变。
- 其它库只能 `db.connection('name')`；`connection('default')` 会抛错。
- 事务与 models 必须来自同一连接，勿跨库混用。

---

### 配置示例

常用字段示意（完整默认值见 API）：

```javascript
fastify.register(fastifySequelize, {
  db: {
    dialect: 'mysql',
    database: 'myapp',
    username: 'root',
    password: 'password',
    host: 'localhost',
    port: 3306
  },
  snowflake: {
    instance_id: 1,
    custom_epoch: new Date('2024-01-01').getTime()
  },
  modelsPath: './models',
  sqlPath: './sql',
  prefix: 't_',
  name: 'models',
  syncOptions: { alter: false },
  sqlTrackMigrations: true,
  sqlFailFast: true
});
```

---

### 模型定义

```javascript
// models/user.js —— 不要手写 id；主键由框架注入
module.exports = ({ DataTypes, options }) => ({
  name: 'User',
  model: {
    username: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    status: { type: DataTypes.INTEGER, defaultValue: 1 }
  },
  options: { paranoid: true, underscored: true }
});
```

带关联：

```javascript
// models/post.js
module.exports = ({ DataTypes, options }) => ({
  name: 'Post',
  model: {
    title: { type: DataTypes.STRING(200), allowNull: false },
    content: { type: DataTypes.TEXT }
  },
  associate(db, fastify, syncOptions) {
    db.Post.belongsTo(db.User, { foreignKey: 'userId', as: 'author' });
  }
});
```

### 动态加载与 modelPrefix

```javascript
await fastify.sequelize.addModels('/abs/path/to/models');
await fastify.sequelize.addModels('/abs/path/to/models/user.js');
await fastify.sequelize.addModels(({ DataTypes }) => ({
  name: 'DynamicModel',
  model: { name: DataTypes.STRING }
}));

await fastify.sequelize.addModels('./models', { modelPrefix: 'Tenant' });
// name: 'User' → db.TenantUser，别名 db.user
```

### 雪花 ID

```javascript
const id = fastify.sequelize.generateId();
const user = await db.User.create({ name: 'john' }); // 未传 id 时自动生成
```

---

### 同步与 SQL

```javascript
await fastify.sequelize.sync();
await fastify.sequelize.sync({ alter: true });
await fastify.sequelize.syncPromise;
```

单连接 `sync` 流程：`associate` → 执行 `sqlPath` 下未记账的 `.sql`（按文件名升序）→ `sequelize.sync()` → resolve `syncPromise`。

```javascript
// SQL 记账（默认开启）
fastify.register(fastifySequelize, {
  sqlPath: './sql',
  sqlTrackMigrations: true, // _fs_sql_migrations
  sqlFailFast: true,
  runSqlOnSync: true
});
// 建议每个 .sql 只含一条语句
```

---

### 查询与分页

```javascript
const { buildWhereQuery, buildPaginationQuery, formatPaginationResult } =
  fastify.sequelize.utils;

const where = buildWhereQuery(filter, {
  defaults: { type: 'main' },
  exact: ['status'],
  like: ['name'],
  in: ['tags'],
  ne: ['type'],
  gte: { amountMin: 'amount' },
  lte: { amountMax: 'amount' },
  range: ['age'],
  orFields: {
    keyword: { fields: ['name', 'email', 'phone'], mode: 'fuzzy' }
  },
  timeRange: { createdAt: true }
  // caseInsensitive: true 仅 PostgreSQL（Op.iLike）
});

const queryOptions = buildPaginationQuery({
  filter,
  options: { exact: ['status'], like: ['name'] },
  perPage: 20,       // 1–1000 整数，非法抛错
  currentPage: 1,    // ≥ 1 整数，非法抛错
  order: [['createdAt', 'DESC']]
});

return formatPaginationResult(await db.Post.findAndCountAll(queryOptions));
// → { pageData, totalCount }
```

### CRUD 与事务

```javascript
const db = fastify.sequelize;

await db.models.user.findAll({ where: { status: 1 } });
await db.models.user.create({ name: 'john' });
await db.models.user.update({ status: 0 }, { where: { id: userId } });
await db.models.user.destroy({ where: { id: userId } }); // 软删
await db.models.user.destroy({ where: { id: userId }, force: true });

await db.transaction(async (t) => {
  const user = await db.models.user.create({ name: 'john' }, { transaction: t });
  await db.models.profile.create({ userId: user.id }, { transaction: t });
  return user;
});
```

---

### 多连接与租户

```javascript
fastify.register(fastifySequelize, {
  db: { dialect: 'sqlite', storage: './main.sqlite' },
  modelsPath: './models',
  connections: {
    analytics: {
      db: { dialect: 'sqlite', storage: './analytics.sqlite' },
      sqlPath: false
    }
  },
  getTenantDb: async (tenantId) => ({
    db: {
      dialect: 'mysql',
      database: `tenant_${tenantId}`,
      host: 'db.example.com',
      username: 'app',
      password: 'secret'
    },
    sqlPath: false
  }),
  tenantPool: { maxInstances: 50, idleTimeoutMs: 300000 }
});

const db = fastify.sequelize;
const analytics = db.connection('analytics');
await analytics.sync();
await analytics.transaction(async (t) => {
  await analytics.models.event.create({ type: 'click' }, { transaction: t });
});

const tenant = await db.forTenant(request.headers['x-tenant-id']);
// 之后：db.connection('tenant:' + id)
await tenant.models.order.findAll();

db.listConnections();
await db.syncAll(); // 同步 registry 全部；db.sync() 只同步默认库
```

`connection(name)` 与默认库同构：`instance` / `models` / `addModels` / `sync` / `transaction` / `generateId` / `utils`。

---

### 模型编写规范

1. **不要**在 `model` 里手写 `id` 主键（框架注入 Snowflake）。
2. **不要**手写关联外键字段，交给 `belongsTo` / `hasMany`。
3. 导出函数签名带上 `options`：`({ DataTypes, options }) => ...`。
4. `associate(db, fastify, options)` 在 `sync` 时调用。
5. Service 用 camelCase 访问：`models.user`，不是 `models.User`（无 `modelPrefix` 时）。
6. `paranoid` 下唯一索引加 `where: { deleted_at: null }`。
7. 需要跨包关联时用 `options` 注入 getter，勿硬编码模型。
8. 可选：预留 `options: DataTypes.JSONB` 扩展字段。

完整示例：

```javascript
module.exports = ({ DataTypes, options }) => ({
  name: 'Message',
  model: {
    content: { type: DataTypes.TEXT, allowNull: false },
    options: { type: DataTypes.JSONB, comment: '扩展字段' }
  },
  options: {
    paranoid: true,
    underscored: true,
    indexes: [
      {
        fields: ['conversationId', 'userId'],
        unique: true,
        where: { deleted_at: null }
      }
    ]
  },
  associate(db) {
    db.Message.belongsTo(db.User, { foreignKey: 'userId' });
  }
});
```

---

### 注意事项

- 生产慎用 `sync({ force: true })` / 随意 `alter`。
- 跨库无分布式事务；租户 ID 须由业务鉴权。
- `caseInsensitive` / `Op.iLike` 仅 PostgreSQL。
- 字段级 API 与类型定义见 **API** 页。
