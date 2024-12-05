const fp = require('fastify-plugin');
const Sequelize = require('sequelize');
const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const merge = require('lodash/merge');
const camelCase = require('lodash/camelCase');
const snakeCase = require('lodash/snakeCase');
const { Snowflake } = require('nodejs-snowflake');

const defaultConfig = {
  db: {
    dialect: 'sqlite',
    username: null,
    password: null
  },
  snowflake: {
    instance_id: 1,
    custom_epoch: new Date('2024-01-01').getTime()
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
    const { getUniqueID } = new Snowflake(config.snowflake);
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
        options
      );
      const stat = typeof modelsPath === 'string' && (await fs.promises.stat(modelsPath).catch(() => {}));

      await (async () => {
        const registerDB = (module, targetName) => {
          const { name, model, associate, options } = module({
            sequelize,
            DataTypes: Sequelize.DataTypes,
            fastify,
            options: config
          });
          const modelName = name || targetName;

          if (!modelName) {
            throw new Error('未能正确获取到modelName');
          }
          db[modelName] = sequelize.define(
            modelName,
            Object.assign(
              {},
              {
                id: {
                  type: Sequelize.DataTypes.BIGINT,
                  primaryKey: true,
                  set() {
                    return getUniqueID();
                  }
                }
              },
              model
            ),
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
        };

        if (stat && stat.isDirectory()) {
          const files = await glob(pattern, Object.assign({}, globOptions, { cwd: modelsPath }));
          files.forEach(file => {
            registerDB(require(path.join(modelsPath, file)), camelCase(path.basename(file, path.extname(file))));
          });
          return;
        }
        if (stat && stat.isFile()) {
          registerDB(require(modelsPath), camelCase(path.basename(modelsPath, path.extname(modelsPath))));
          return;
        }

        if (typeof modelsPath === 'function') {
          registerDB(modelsPath);
          return;
        }

        console.warn('未发现任何models模块,ags:' + modelsPath);
      })();
      modelList.push(db);
      return db;
    };
    const stat = config.modelsPath && (await fs.promises.stat(path.join(process.cwd(), config.modelsPath)).catch(() => {}));

    fastify.decorate('sequelize', {
      addModels,
      Sequelize,
      [config.name || defaultConfig.name]: stat && stat.isDirectory() && (await addModels(path.join(process.cwd(), config.modelsPath))),
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
