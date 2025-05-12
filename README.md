
# fastify-sequelize


### 描述

Fastify与Sequelize的深度集成插件，支持自动模型加载和分布式ID生成


### 安装

```shell
npm i --save @kne/fastify-sequelize
```


### 概述

#### 核心功能概述

1. **ORM 集成**  
   - 无缝集成 Sequelize ORM 到 Fastify 框架
   - 支持多种数据库（SQLite/MySQL/PostgreSQL等）

2. **自动化模型管理**  
   - 自动扫描指定目录下的模型文件
   - 支持动态添加模型
   - 自动处理模型关联关系

3. **分布式ID生成**  
   - 内置雪花算法ID生成器
   - 可配置的基准时间和实例ID

#### 详细配置说明

##### 数据库连接配置

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| dialect | string | 是 | 'sqlite' | 数据库类型 |
| database | string | 否 | null | 数据库名称 |
| username | string | 否 | null | 数据库用户名 |
| password | string | 否 | null | 数据库密码 |
| host | string | 否 | 'localhost' | 数据库地址 |
| port | number | 否 | 数据库默认端口 | 连接端口 |

##### 高级配置选项

```javascript
{
  // 雪花ID生成配置
  snowflake: {
    instance_id: 1,             // 分布式ID实例编号（0-1023）
    custom_epoch: 1672531200000 // 基准时间戳(2024-01-01)
  },
  
  // 数据库同步配置
  syncOptions: {                
    force: false,               // 强制同步（会删除原有表结构）
    alter: true                 // 安全模式自动修改表结构
  },
  
  // 模型加载配置
  modelsPath: './models',       // 模型文件存放路径
  prefix: 't_',                 // 数据库表名前缀
  name: 'models'               // Fastify实例上的挂载名称
}
```

#### 模型定义规范

##### 基础模型示例
```javascript
// models/user.js
module.exports = ({ DataTypes }) => ({
  name: 'User',
  model: {
    username: {
      type: DataTypes.STRING(32),
      allowNull: false,
      unique: true
    },
    age: {
      type: DataTypes.INTEGER,
      defaultValue: 18
    }
  },
  options: {
    timestamps: true  // 启用时间戳
  }
});
```

##### 关联模型示例
```javascript
// models/post.js
module.exports = ({ DataTypes }) => ({
  name: 'Post',
  model: {
    title: DataTypes.STRING,
    content: DataTypes.TEXT
  },
  associate(db) {
     db.Post.belongsTo(db.User, { 
      foreignKey: 'authorId',
      as: 'author'
    });
  }
});
```

#### 最佳实践建议

1. **开发环境配置**
```javascript
fastify.register(fastifySequelize, {
  db: {
    dialect: 'sqlite',
    storage: './dev.db'
  },
  syncOptions: {
    alter: true  // 开发时自动同步表结构
  }
});
```

2. **生产环境配置**
```javascript
fastify.register(fastifySequelize, {
  db: {
    dialect: 'mysql',
    host: 'db.prod.com',
    database: 'prod_db',
    username: 'admin',
    password: 'securePassword123'
  },
  syncOptions: {
    alter: false  // 生产环境禁用自动修改
  }
});
```

3. **迁移策略**
   - 开发阶段可使用 `force: true` 快速重置数据库
   - 生产环境建议使用 Sequelize 迁移工具
   - 重要变更应通过手动迁移脚本执行

> 注意：雪花ID的基准时间建议设置为项目启动日期，instance_id 在分布式环境中需要确保唯一


### 示例

#### 示例代码



### API

### 配置选项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `db.dialect` | string | `'sqlite'` | 数据库类型 (mysql/postgres/sqlite等) |
| `db.username` | string | `null` | 数据库用户名 |
| `db.password` | string | `null` | 数据库密码 |
| `snowflake.instance_id` | number | `1` | 雪花ID生成器实例ID |
| `snowflake.custom_epoch` | number | `2024-01-01时间戳` | 雪花ID基准时间 |
| `modelsPath` | string | `'./models'` | 模型文件存放路径 |
| `prefix` | string | `'t_'` | 数据库表名前缀 |
| `name` | string | `'models'` | 在fastify实例上的挂载名称 |

### 实例属性/方法

| 属性/方法 | 类型 | 描述 |
|----------|------|------|
| `addModels` | Function | 用于添加 Sequelize 模型的函数 |
| `Sequelize` | Object | Sequelize 库的引用 |
| `[config.name]` | Object | 动态命名的模型集合，当 `config.modelsPath` 是目录时加载的模型 |
| `instance` | Sequelize | Sequelize 实例的引用 |
| `generateId` | Function | 生成唯一 ID 的函数（使用 snowflake 算法） |
| `sync` | Async Function | 同步所有模型到数据库的方法 |

#### `sync` 方法详情

| 参数 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `options` | Object | `{}` | Sequelize 同步选项，会与 `config.syncOptions` 合并 |
