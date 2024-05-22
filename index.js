const fp = require('fastify-plugin');
const Sequelize = require('sequelize');
const path = require('path');
const { glob } = require('glob');
const merge = require('lodash/merge');

const defaultConfig = {
  db: {
    dialect: 'sqlite',
    username: null,
    password: null
  },
  modelsPath: './models',
  modelsGlobOptions: {
    syncOptions: {}
  },
  name: 'models'
};

module.exports = fp(
  async (fastify, options) => {
    const config = merge({}, defaultConfig, options);
    const sequelize = new Sequelize(config.db);
    const db = {};
    const addModels = async (modelsPath, options) => {
      const { pattern, syncOptions, ...modelsGlobOptions } = merge(
        {},
        {
          ignore: 'node_modules/**',
          pattern: '**/*.js'
        },
        config.modelsGlobOptions,
        options,
        { cwd: modelsPath }
      );
      const files = await glob(pattern, modelsGlobOptions);
      files
        .map(file => {
          const model = require(path.join(modelsPath, file))(sequelize, Sequelize.DataTypes);
          db[model.name] = model;
          return model;
        })
        .forEach(model => {
          if (model.associate) model.associate(db);
        });
      await sequelize.sync(syncOptions);
      console.log('models were synchronized successfully.');
    };

    config.modelsPath && (await addModels(path.join(process.cwd(), config.modelsPath)));

    sequelize.addModels = addModels;
    fastify.decorate(config.name || defaultConfig.name, db);
    fastify.decorate('sequelize', sequelize);
    fastify.decorate('Sequelize', Sequelize);
  },
  {
    name: 'fastify-sequelize'
  }
);
