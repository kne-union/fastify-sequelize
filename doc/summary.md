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
