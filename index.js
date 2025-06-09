const fp = require('fastify-plugin');
const { Sequelize, DataTypes } = require('sequelize');
const fs = require('node:fs');
const path = require('node:path');
const { glob } = require('glob');
const { merge, camelCase, snakeCase } = require('lodash');
const { Snowflake } = require('nodejs-snowflake');

const defaultConfig = {
  db: {
    dialect: 'sqlite', username: null, password: null
  }, snowflake: {
    instance_id: 1, custom_epoch: new Date('2024-01-01').getTime()
  }, modelsPath: './models', prefix: 't_', glob: {}, syncOptions: {}, name: 'models'
};

const sequelize = fp(async (fastify, options) => {
  const config = merge({}, defaultConfig, options);
  const snowflake = new Snowflake(config.snowflake);
  const sequelize = new Sequelize(config.db);
  const modelList = [];

  const definePrimaryType = (name, props) => {
    return Object.assign({}, {
      type: DataTypes.BIGINT, get() {
        const value = this.getDataValue(name);
        return value && value.toString();
      }
    }, props);
  };

  const addModels = async (modelsPath, options) => {
    const db = {}, addModelsOptions = Object.assign({}, config, options);
    const { name, pattern, syncOptions, ...globOptions } = merge({}, {
      ignore: 'node_modules/**', pattern: '**/*.js'
    }, config.glob, options);
    const stat = typeof modelsPath === 'string' && (await fs.promises.stat(modelsPath).catch(() => {
    }));

    await (async () => {
      const registerDB = (module, targetName) => {
        const { name, model, associate, options } = module({
          sequelize, DataTypes, definePrimaryType, fastify, options: addModelsOptions
        });
        const modelName = name || targetName;

        if (!modelName) {
          throw new Error('未能正确获取到modelName');
        }
        db[modelName] = sequelize.define(modelName, Object.assign({}, {
          id: definePrimaryType('id', { primaryKey: true })
        }, model), Object.assign({
          paranoid: true,
          tableName: (addModelsOptions.prefix || config.prefix || 't_') + snakeCase(modelName),
          underscored: true
        }, options));
        db[modelName].beforeCreate(info => {
          info.id = snowflake.getUniqueID();
          return info;
        });
        db[modelName].beforeBulkCreate(infos => {
          infos.forEach(info => {
            info.id = snowflake.getUniqueID();
          });
          return infos;
        });
        db[modelName].associate = associate;
      };

      if (stat && stat.isDirectory()) {
        const files = await glob(pattern, Object.assign({}, globOptions, { cwd: modelsPath }));

        await Promise.all(files.map(async file => {
          const { default: module } = await import(`file://${path.resolve(modelsPath, file)}`);
          registerDB(module, camelCase(path.basename(file, path.extname(file))));
        }));
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
  const stat = config.modelsPath && (await fs.promises.stat(path.join(process.cwd(), config.modelsPath)).catch(() => {
  }));

  let syncPromiseResolve;
  const syncPromise = new Promise((resolve) => {
    syncPromiseResolve = resolve;
  });

  fastify.decorate('sequelize', {
    addModels,
    Sequelize,
    [config.name || defaultConfig.name]: stat && stat.isDirectory() && (await addModels(path.join(process.cwd(), config.modelsPath), config)),
    instance: sequelize,
    generateId: () => snowflake.getUniqueID(),
    syncPromise,
    sync: async options => {
      modelList.forEach(db => {
        Object.values(db).forEach(model => {
          if (model.associate) model.associate(db, fastify, options);
        });
      });
      await sequelize.sync(Object.assign({}, config.syncOptions, options));
      console.log('models were synchronized successfully.');
      syncPromiseResolve();
    }
  });
}, {
  name: 'fastify-sequelize'
});

module.exports = sequelize;
