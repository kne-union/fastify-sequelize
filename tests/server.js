const fastify = require('fastify')({
  logger: true
});

const path = require('path');

const sqliteStorage = path.resolve('./database.sqlite');

fastify.register(require('../index'), {
  db: {
    storage: sqliteStorage
  }, modelsGlobOptions: {
    syncOptions: {}
  }
});

fastify.register(async (fastify, opts, done)=> {
  await fastify.sequelize.addModels(path.resolve('./models'));
  await fastify.sequelize.sync();
});

fastify.listen({ port: 3000 }, (err, address) => {
  if (err) throw err;
  // Server is now listening on ${address}
});
