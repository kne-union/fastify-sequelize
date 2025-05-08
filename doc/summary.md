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
    this.model.belongsTo(db.User, { 
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
