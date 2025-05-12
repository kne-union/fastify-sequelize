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