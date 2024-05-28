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
  glob: {},
  syncOptions: {},
  name: 'models'
};

module.exports = fp(
  async (fastify, options) => {
    const config = merge({}, defaultConfig, options);
    const sequelize = new Sequelize(config.db);
    const addModels = async (modelsPath, options) => {
      const db = {};
      const { name, pattern, syncOptions, ...globOptions } = merge(
        {},
        {
          ignore: 'node_modules/**',
          pattern: '**/*.js'
        },
        config.glob,
        options,
        { cwd: modelsPath }
      );
      const files = await glob(pattern, globOptions);
      files
        .map(file => {
          const model = require(path.join(modelsPath, file))(sequelize, Sequelize.DataTypes);
          db[model.name] = model;
          return model;
        })
        .forEach(model => {
          if (model.associate) model.associate(db);
        });
      return db;
    };
    fastify.decorate('sequelize', {
      addModels,
      Sequelize,
      [config.name || defaultConfig.name]: config.modelsPath && (await addModels(path.join(process.cwd(), config.modelsPath))),
      instance: sequelize,
      sync: async options => {
        await sequelize.sync(Object.assign({}, config.syncOptions, options));
        console.log('models were synchronized successfully.');
      }
    });
  },
  {
    name: 'fastify-sequelize'
  }
);
