const fp = require('fastify-plugin');
const Sequelize = require('sequelize');
const path = require('path');
const { glob } = require('glob');
const merge = require('lodash/merge');
const camelCase = require('lodash/camelCase');
const snakeCase = require('lodash/snakeCase');

const defaultConfig = {
  db: {
    dialect: 'sqlite',
    username: null,
    password: null
  },
  modelsPath: './models',
  prefix: 't_',
  glob: {},
  syncOptions: {},
  name: 'models'
};

module.exports = fp(
  async (fastify, options) => {
    const config = merge({}, defaultConfig, options);
    const sequelize = new Sequelize(config.db);
    const modelList = [];
    const addModels = async (modelsPath, options) => {
      const db = {},
        addModelsOptions = Object.assign({}, options);
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
      files.map(file => {
        const { name, model, associate, options } = require(path.join(modelsPath, file))({
          sequelize,
          DataTypes: Sequelize.DataTypes,
          fastify,
          options: config
        });

        const modelName = name || camelCase(path.basename(file, path.extname(file)));
        db[modelName] = sequelize.define(
          modelName,
          model,
          Object.assign(
            {
              paranoid: true,
              tableName: (addModelsOptions.prefix || config.prefix || 't_') + snakeCase(modelName),
              underscored: true
            },
            options
          )
        );
        db[modelName].associate = associate;
        return db[modelName];
      });
      modelList.push(db);
      return db;
    };
    fastify.decorate('sequelize', {
      addModels,
      Sequelize,
      [config.name || defaultConfig.name]: config.modelsPath && (await addModels(path.join(process.cwd(), config.modelsPath))),
      instance: sequelize,
      sync: async options => {
        modelList.forEach(db => {
          Object.values(db).forEach(model => {
            if (model.associate) model.associate(db, fastify, options);
          });
        });
        await sequelize.sync(Object.assign({}, config.syncOptions, options));
        console.log('models were synchronized successfully.');
      }
    });
  },
  {
    name: 'fastify-sequelize'
  }
);
