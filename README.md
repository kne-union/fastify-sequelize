
# fastify-sequelize


### 描述

用于封装sequelize调用


### 安装

```shell
npm i --save @kne/fastify-sequelize
```


### 概述

fastify连接sequelize的插件

```js
// ./models/user.js

module.exports = (sequelize, DataTypes) => {
  return sequelize.define('User', {
    name: DataTypes.STRING
  });
};

//server.js
const sqliteStorage = './database.db';

fastify.register(require('@kne/fastify-sequelize'), {
  db: {
    // 数据库连接配置
    storage: sqliteStorage
  },
  // models目录地址
  modelsPath: path.resolve('./models'), modelsGlobOptions: {
    syncOptions: {
      //同步数据库配置
    }
  }
});

fastify.register(async function(instance, opts, done) {
  instance.models.addModels(path.resolve('./models'));
  await instance.models.User.create({ name: 'Jane' });
});
```


### 示例

#### 示例代码



### API

| 属性名 | 说明 | 类型 | 默认值 |
|-----|----|----|-----|
|     |    |    |     |

