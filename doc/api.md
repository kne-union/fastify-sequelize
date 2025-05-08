#### 配置选项

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