本文为 API 参考（选项表与方法签名）。上手示例与约定见 **概述（summary）**。

### 插件注册选项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `db` | Object | `{ dialect: 'sqlite', username: null, password: null }` | Sequelize 数据库连接配置，完整参数参见 [Sequelize 文档](https://sequelize.org/api/v6/class/src/sequelize.js~sequelize#instance-constructor-constructor) |
| `db.dialect` | string | `'sqlite'` | 数据库类型：`sqlite` / `mysql` / `postgres` / `mssql` |
| `db.storage` | string | - | SQLite 文件路径（仅 dialect 为 sqlite 时） |
| `db.host` | string | - | 数据库主机地址 |
| `db.port` | number | - | 数据库端口 |
| `db.database` | string | - | 数据库名称 |
| `db.username` | string | `null` | 数据库用户名 |
| `db.password` | string | `null` | 数据库密码 |
| `snowflake` | Object | `{ instance_id: 1, custom_epoch: 1704067200000 }` | Snowflake ID 生成器配置 |
| `snowflake.instance_id` | number | `1` | 分布式实例编号（0-1023），多实例部署时需唯一 |
| `snowflake.custom_epoch` | number | `1704067200000` | 基准时间戳（2024-01-01），用于 ID 计算 |
| `modelsPath` | string | `'./models'` | 模型文件目录路径（相对于 `process.cwd()`），插件注册时自动加载 |
| `sqlPath` | string | `'./sql'` | SQL 脚本目录路径，`sync` 时自动执行其中的 `.sql` 文件（按文件名升序；已执行过的不会重复跑） |
| `sqlTrackMigrations` | boolean | `true` | 是否用 `_fs_sql_migrations` 表记录已执行脚本；`false` 则每次 sync 全量执行 |
| `sqlFailFast` | boolean | `true` | SQL 脚本失败是否抛出；`false` 仅记录错误并继续 |
| `runSqlOnSync` | boolean | `true` | 设为 `false` 可跳过 SQL 脚本执行 |
| `prefix` | string | `'t_'` | 数据库表名前缀，最终表名为 `{prefix}{snake_case_modelName}` |
| `modelPrefix` | string | - | 模型名前缀，注册模型时自动添加到模型名前，并生成去除前缀的别名 |
| `name` | string | `'models'` | 在 `fastify.sequelize` 上的属性名，自动加载的模型挂载于此 |
| `glob` | Object | `{}` | 传递给 `glob` 库的文件匹配选项 |
| `syncOptions` | Object | `{}` | Sequelize `sync` 默认选项，与 `sync()` 参数合并 |
| `connections` | Object | `{}` | 静态命名连接。值为 `db` 配置，或 `{ db, modelsPath, sqlPath, ... }`；键名不能为 `default` |
| `getTenantDb` | Function | `null` | `async (tenantId) => dbConfig \| { db, ... }`，配置后才启用 `forTenant` |
| `tenantPool.maxInstances` | number | `50` | 动态租户连接上限，超出时按 LRU 关闭最久未用的租户连接 |
| `tenantPool.idleTimeoutMs` | number | `300000` | 租户空闲超过该时间后，在下次 `forTenant` 时回收；设为 `0` 关闭空闲回收 |

### `fastify.sequelize` 装饰器

| 属性/方法 | 类型 | 说明 |
|-----------|------|------|
| `addModels(modelsPath, options?)` | Async Function | 添加模型，返回模型集合对象 `db`；`options.connection` 可指定命名连接 |
| `instance` | Sequelize | **默认连接**的 Sequelize 实例（兼容旧用法） |
| `Sequelize` | Object | Sequelize 类引用 |
| `generateId()` | Function | 生成 Snowflake 唯一 ID，返回字符串 |
| `sync(options?)` | Async Function | 默认同步**默认连接**；传 `options.connection` 时只同步该连接（兼容；推荐 `connection(name).sync()`） |
| `transaction(fn)` | Function | 默认库事务，等价 `instance.transaction` |
| `syncAll(options?)` | Async Function | 同步 registry 中全部连接（含静态连接与当前缓存的租户连接） |
| `syncPromise` | Promise | 默认连接 sync 完成后 resolve 的 Promise |
| `connection(name)` | Function | **获取其它库的唯一入口**；不可传 `default`（默认库就是 `fastify.sequelize`） |
| `getConnection(name)` | Function | `connection` 的别名 |
| `forTenant(tenantId)` | Async Function | 创建/复用租户连接的糖；之后可用 `connection('tenant:' + id)` |
| `listConnections()` | Function | 返回当前 registry 中的连接名列表 |
| `utils` | Object | 查询工具函数集合 |
| `utils.buildWhereQuery` | Function | 构建 Sequelize WHERE 条件 |
| `utils.buildPaginationQuery` | Function | 构建分页查询选项 |
| `utils.formatPaginationResult` | Function | 格式化分页结果 |
| `[config.name]` | Object | 默认连接自动加载的模型集合（仅 `modelsPath` 为有效目录时存在） |

### 多连接（约定）

- `fastify.sequelize` **始终是默认库**；其它库只用 `connection(name)`（不可传 `default`）。
- 未配置 `connections` / `getTenantDb` 时与单连接行为一致。
- 完整示例见概述；下方为返回值与方法说明。

### `addModels(modelsPath, options)`

动态添加模型，支持三种输入方式。

#### modelsPath 参数

| 类型 | 说明 |
|------|------|
| string（目录路径） | 扫描目录下所有 `.js` 文件，使用 `require` 加载 |
| string（文件路径） | 加载单个模型文件，使用 `require` 加载 |
| Function | 直接传入模型定义函数 |

#### options 参数

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `modelPrefix` | string | - | 模型名前缀，为模型名添加前缀并生成别名 |
| `prefix` | string | 全局 `prefix` | 表名前缀，覆盖全局配置 |
| `connection` | string | - | 指定命名连接（非 default）；推荐改用 `connection(name).addModels` |
| `pattern` | string | `'**/*.js'` | glob 文件匹配模式（仅目录加载时生效） |
| `ignore` | string | `'node_modules/**'` | glob 忽略模式（仅目录加载时生效） |

#### modelPrefix 行为

| 场景 | 模型名 | modelPrefix | 注册后 key | 别名 |
|------|--------|-------------|-----------|------|
| 新前缀 | `User` | `Tenant` | `TenantUser` | `user` |
| 已含前缀 | `TenantUser` | `Tenant` | `TenantUser`（不重复添加） | `user` |
| 前缀等于 key | `Tenant` | `Tenant` | `Tenant`（跳过别名生成） | - |
| 别名冲突 | 两个模型生成相同别名 | - | 均注册 | 先注册者保留别名，后者跳过 |

#### 返回值

返回 `db` 对象，key 为模型名（含前缀），value 为 Sequelize Model。若设置了 `modelPrefix`，还会包含去掉前缀的 `lowerFirst` 别名。

### `sync(options)`

默认同步**默认连接**上已注册的模型。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `options` | Object | `{}` | Sequelize `sync` 选项，与全局 `syncOptions` 合并 |
| `options.connection` | string | - | 若指定，则只同步该命名连接（兼容写法） |

#### sync 执行流程（单个连接）

1. 遍历该连接已注册模型，调用 `associate(db, fastify, options)` 建立关联
2. 扫描 `sqlPath` 目录，按文件名升序执行尚未记账的 `.sql` 文件（非 `.sql` 跳过；默认写入 `_fs_sql_migrations`）
3. 调用 `sequelize.sync()` 同步表结构
4. resolve 该连接的 `syncPromise`

#### 相关方法

| 方法 | 说明 |
|------|------|
| `sync()` | 只同步默认库 |
| `connection(name).sync()` | 同步指定命名连接 |
| `syncAll(options?)` | 同步 registry 中当前全部连接 |

### `transaction(fn)` / `connection(name).transaction(fn)`

薄封装对应连接的 `instance.transaction`。事务与 models 必须来自同一连接。

### `connection(name)` 返回值

| 属性/方法 | 说明 |
|-----------|------|
| `name` | 连接名（如 `analytics`、`tenant:acme`） |
| `instance` | 该连接的 Sequelize 实例 |
| `models` / `[config.name]` | 自动加载的模型集合（若有） |
| `addModels` / `sync` / `transaction` | 仅作用于该连接 |
| `syncPromise` / `generateId` | 同默认库语义 |
| `Sequelize` / `utils` | 与全局相同的引用 |

### `forTenant(tenantId)`

| 条件 | 行为 |
|------|------|
| 未配置 `getTenantDb` | 抛错 |
| `tenantId` 为空 | 抛错 |
| 已缓存 | 返回已有连接并刷新 LRU |
| 新建 | 调用 `getTenantDb`，创建上下文；键名为 `tenant:{id}` |

之后可用 `connection('tenant:' + tenantId)` 取回；若尚未 `forTenant`，对该键调用 `connection` 会抛出提示性错误。

### 模型定义函数

模型文件导出一个函数，接收参数对象，返回模型定义。

#### 接收参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `sequelize` | Sequelize | Sequelize 实例 |
| `DataTypes` | Object | Sequelize 数据类型 |
| `definePrimaryType` | Function | 定义主键类型的辅助函数（SQLite 用 STRING，其他用 BIGINT，getter 返回字符串） |
| `fastify` | Object | Fastify 实例 |
| `options` | Object | 合并后的配置项（全局配置 + addModels 选项） |

#### 返回值

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 否 | 模型名称，未提供时从文件名推导（camelCase） |
| `model` | Object | 是 | 字段定义，自动注入 `id` 主键 |
| `associate` | Function | 否 | 关联函数，`sync` 时调用，参数为 `(db, fastify, options)` |
| `options` | Object | 否 | Sequelize define 选项，覆盖默认值 |

#### 模型默认配置

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `id` | Snowflake STRING/BIGINT 主键 | 自动注入；仅当 `id` 为空时由 `beforeCreate` / `beforeBulkCreate` 生成 |
| `paranoid` | `true` | 启用软删除 |
| `underscored` | `true` | 字段名使用下划线风格 |
| `tableName` | `{prefix}{snake_case(modelName)}` | 自动生成表名 |

### `buildWhereQuery(filter, options)`

根据过滤条件和配置构建 Sequelize WHERE 查询对象。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `filter` | Object | `{}` | 前端传入的过滤条件 |
| `options` | Object | `{}` | 字段配置 |

#### options 参数

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `exact` | string[] | `[]` | 精确匹配字段列表，忽略 `undefined`/`null`/空字符串；值为数组时自动 `Op.in` |
| `like` | string[] | `[]` | 模糊匹配字段列表，生成 `%value%` 的 LIKE 条件 |
| `in` | string[] | `[]` | 显式 `Op.in`；单值会包成数组 |
| `ne` | string[] | `[]` | 标量 → `Op.ne`；数组 → `Op.notIn` |
| `gt` / `gte` / `lt` / `lte` | string[] \| Object | `[]` | 比较运算。数组时 filterKey=列名；对象时 `{ filterKey: columnName }`，可合并到同一列 |
| `range` | string[] \| Object | `{}` | 数值区间。`filter[field]={ min, max }`（或 `gte`/`lte`）→ `between` / 单边 |
| `defaults` | Object | `{}` | 默认条件，始终合并到查询中 |
| `orFields` | Object | `{}` | 多字段 OR 查询配置 |
| `timeRange` | Object | `{}` | 时间范围查询字段配置 |
| `caseInsensitive` | boolean | `false` | 全局大小写不敏感，使用 `Op.iLike`（仅 PostgreSQL） |

#### orFields 配置

| 写法 | 类型 | 说明 |
|------|------|------|
| 简写 | `string` | `keyword: 'name'` 等价于 `{ fields: ['name'], mode: 'fuzzy' }` |
| 完整 | `Object` | 见下表 |

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `fields` | string[] | - | 参与 OR 的字段列表 |
| `mode` | string | `'fuzzy'` | `'fuzzy'` 模糊匹配 / `'exact'` 精确匹配 |
| `caseInsensitive` | boolean | 全局设置 | 字段级别覆盖全局 `caseInsensitive` |

多个 `orFields` 条目之间用 `AND` 连接（每个条目内部是 `OR`）。

#### timeRange 配置

| filter 中的值 | 生成的操作符 | 说明 |
|---------------|-------------|------|
| `{ startTime, endTime }` | `Op.between` | 范围查询 |
| `{ startTime }` | `Op.gte` | 大于等于 |
| `{ endTime }` | `Op.lte` | 小于等于 |

#### range 配置

| 写法 | 说明 |
|------|------|
| `['age']` / `{ age: true }` | `filter.age = { min, max }`（或 `gte`/`lte`）作用在列 `age` |
| `{ priceRange: 'price' }` | `filter.priceRange` 作用在列 `price` |

| filter 区间值 | 生成的操作符 |
|---------------|-------------|
| `{ min, max }` 或 `{ gte, lte }` 双边 | `Op.between` |
| 仅 `min` / `gte` | `Op.gte` |
| 仅 `max` / `lte` | `Op.lte` |

#### range / 比较示例

```javascript
buildWhereQuery(
  {
    status: ['open', 'closed'],
    type: 'main',
    amountMin: 100,
    amountMax: 500,
    age: { min: 18, max: 60 }
  },
  {
    in: ['status'],
    ne: ['type'], // 若 filter.type 有值则 type != ...
    gte: { amountMin: 'amount' },
    lte: { amountMax: 'amount' },
    range: ['age']
  }
);
```

### `buildPaginationQuery(params)`

一步构建分页查询选项，内部调用 `buildWhereQuery`。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `params.filter` | Object | `{}` | 过滤条件，传给 `buildWhereQuery` |
| `params.options` | Object | `{}` | `buildWhereQuery` 配置 |
| `params.perPage` | number | `20` | 每页条数，须为 **1–1000** 的整数；非法则抛错 |
| `params.currentPage` | number | `1` | 当前页码，须为 **≥ 1** 的整数；非法则抛错 |
| `params.order` | Array | `[['createdAt', 'DESC']]` | 排序配置 |
| `params.queryOptions` | Object | `{}` | 额外 Sequelize 查询选项（如 `include`），展开合并到结果 |

#### 返回值

| 属性 | 类型 | 说明 |
|------|------|------|
| `where` | Object | `buildWhereQuery` 构建的 WHERE 条件 |
| `limit` | number | 等于校验后的 `perPage` |
| `offset` | number | `(currentPage - 1) * perPage` |
| `order` | Array | 排序配置 |
| `...queryOptions` | - | 展开 `queryOptions` 中的属性 |

非法 `perPage` / `currentPage`（非整数、越界、`NaN` 等）会抛出 `Error`。

### `formatPaginationResult(result)`

格式化 `findAndCountAll` 返回值。

| 参数 | 类型 | 说明 |
|------|------|------|
| `result.rows` | Array | 数据行 |
| `result.count` | number | 总条数 |

#### 返回值

| 属性 | 类型 | 说明 |
|------|------|------|
| `pageData` | Array | 数据行列表 |
| `totalCount` | number | 总条数 |

### TypeScript

包内附带 `index.d.ts`：

- 插件选项：`FastifySequelizeOptions`
- 默认库命名空间：`FastifySequelizeNamespace`（即 `fastify.sequelize`）
- 其它库：`SequelizeConnection`（`connection(name)` / `forTenant` 返回值）
- 查询工具：`BuildWhereQueryOptions` 等

并通过 `declare module 'fastify'` 增强 `FastifyInstance.sequelize`，注册插件后即可获得补全。
