const fp = require('fastify-plugin');
const { Sequelize, DataTypes } = require('sequelize');
const fs = require('fs-extra');
const path = require('node:path');
const { glob } = require('glob');
const { merge, camelCase, snakeCase, upperFirst, lowerFirst } = require('lodash');
const { Snowflake } = require('nodejs-snowflake');
const { buildWhereQuery, buildPaginationQuery, formatPaginationResult } = require('./libs/utils/buildWhereQuery');

const SQL_MIGRATIONS_TABLE = '_fs_sql_migrations';
const DEFAULT_CONNECTION = 'default';

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
  sqlPath: './sql',
  // 默认开启迁移记账，避免 sync 重复执行全部 .sql
  sqlTrackMigrations: true,
  // 默认 SQL 失败即抛出；设为 false 可恢复旧版吞错行为
  sqlFailFast: true,
  prefix: 't_',
  glob: {},
  syncOptions: {},
  name: 'models',
  // 静态命名连接：{ [name]: dbConfig | { db, modelsPath, sqlPath, ... } }
  connections: {},
  // 动态租户：async (tenantId) => dbConfig | { db, ... }
  getTenantDb: null,
  tenantPool: {
    maxInstances: 50,
    idleTimeoutMs: 5 * 60 * 1000
  }
};

const loadModelModule = filePath => {
  const mod = require(path.resolve(filePath));
  return typeof mod === 'function' ? mod : mod?.default;
};

const normalizeConnectionConfig = value => {
  if (value && typeof value === 'object' && value.db) {
    return value;
  }
  return { db: value };
};

const sequelizePlugin = fp(
  async (fastify, options) => {
    const config = merge({}, defaultConfig, options);
    const snowflake = new Snowflake(config.snowflake);
    const log = fastify.log || console;
    const registry = new Map();

    const escapeRegExp = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const appendModelPrefixAlias = (db, modelPrefix) => {
      if (modelPrefix) {
        const result = Object.assign({}, db);
        Object.keys(result).forEach(key => {
          const value = result[key];
          if (modelPrefix === key) {
            return;
          }

          const alias = lowerFirst(key.replace(new RegExp(`^${escapeRegExp(modelPrefix)}`), ''));

          if (result[alias]) {
            return;
          }

          result[alias] = value;
        });
        return result;
      }

      return db;
    };

    const createContext = async (overrides = {}, registryKey = DEFAULT_CONNECTION) => {
      const ctxConfig = merge({}, config, overrides);
      const sequelize = new Sequelize(ctxConfig.db);
      const modelList = [];
      const modelsKey = ctxConfig.name || defaultConfig.name;

      let syncPromiseResolve;
      const syncPromise = new Promise(resolve => {
        syncPromiseResolve = resolve;
      });

      const definePrimaryType = (name, props) => {
        return Object.assign(
          {},
          {
            type: ctxConfig.db?.dialect === 'sqlite' ? DataTypes.STRING : DataTypes.BIGINT,
            get() {
              const value = this.getDataValue(name);
              return value && value.toString();
            }
          },
          props
        );
      };

      const ensureSqlMigrationsTable = async () => {
        const timestampType = ctxConfig.db?.dialect === 'postgres' ? 'TIMESTAMP' : 'DATETIME';
        await sequelize.query(
          `CREATE TABLE IF NOT EXISTS ${SQL_MIGRATIONS_TABLE} (
          name VARCHAR(255) PRIMARY KEY,
          executed_at ${timestampType} NOT NULL
        )`
        );
      };

      const getExecutedSqlNames = async () => {
        const [rows] = await sequelize.query(`SELECT name FROM ${SQL_MIGRATIONS_TABLE}`);
        return new Set((rows || []).map(row => row.name));
      };

      const markSqlExecuted = async name => {
        await sequelize.query(`INSERT INTO ${SQL_MIGRATIONS_TABLE} (name, executed_at) VALUES (:name, :executedAt)`, {
          replacements: { name, executedAt: new Date().toISOString() }
        });
      };

      const runSqlScripts = async () => {
        if (ctxConfig.runSqlOnSync === false || ctxConfig.sqlPath === false || ctxConfig.sqlPath == null) {
          return;
        }

        const sqlDir = path.join(process.cwd(), ctxConfig.sqlPath);
        if (!(await fs.exists(sqlDir))) {
          return;
        }

        log.info({ connection: registryKey }, '-----------开始执行sql数据库更新脚本-----------');
        const names = (await fs.readdir(sqlDir)).filter(name => name.endsWith('.sql')).sort();

        let executed = new Set();
        if (ctxConfig.sqlTrackMigrations !== false) {
          await ensureSqlMigrationsTable();
          executed = await getExecutedSqlNames();
        }

        for (const name of names) {
          if (executed.has(name)) {
            continue;
          }

          const filePath = path.join(sqlDir, name);
          try {
            const sql = await fs.readFile(filePath, 'utf-8');
            log.info({ connection: registryKey, file: name }, '运行sql');
            await sequelize.query(sql);
            if (ctxConfig.sqlTrackMigrations !== false) {
              await markSqlExecuted(name);
            }
          } catch (e) {
            log.error(e, `---------- sql error:${filePath} --------------`);
            if (ctxConfig.sqlFailFast !== false) {
              throw e;
            }
          }
        }
        log.info({ connection: registryKey }, '-----------完成执行sql数据库更新脚本-----------');
      };

      const addModels = async (modelsPath, addOptions = {}) => {
        const { connection: _ignored, ...options } = addOptions;
        const db = {};
        const addModelsOptions = Object.assign({}, ctxConfig, options);
        const { name, pattern, syncOptions, ...globOptions } = merge(
          {},
          {
            ignore: 'node_modules/**',
            pattern: '**/*.js'
          },
          ctxConfig.glob,
          options
        );
        const stat = typeof modelsPath === 'string' && (await fs.promises.stat(modelsPath).catch(() => {}));

        const registerDB = (module, targetName) => {
          const { name, model, associate, options: modelOptions } = module({
            sequelize,
            DataTypes,
            definePrimaryType,
            fastify,
            options: addModelsOptions
          });
          const originModelName = name || targetName;
          const modelName = addModelsOptions.modelPrefix
            ? originModelName.indexOf(addModelsOptions.modelPrefix) === 0
              ? originModelName
              : `${addModelsOptions.modelPrefix}${upperFirst(originModelName)}`
            : originModelName;
          if (!modelName) {
            throw new Error('未能正确获取到modelName');
          }

          if (db[modelName]) {
            throw new Error(`${modelName} 模型定义冲突`);
          }

          db[modelName] = sequelize.define(
            modelName,
            Object.assign(
              {},
              {
                id: definePrimaryType('id', { primaryKey: true })
              },
              model
            ),
            Object.assign(
              {
                paranoid: true,
                tableName: (addModelsOptions.prefix || ctxConfig.prefix || 't_') + snakeCase(modelName),
                underscored: true
              },
              modelOptions
            )
          );
          db[modelName].beforeCreate(info => {
            if (info.id == null) {
              info.id = snowflake.getUniqueID();
            }
            return info;
          });
          db[modelName].beforeBulkCreate(infos => {
            infos.forEach(info => {
              if (info.id == null) {
                info.id = snowflake.getUniqueID();
              }
            });
            return infos;
          });
          db[modelName].associate = associate;
          db[modelName].modelPrefix = addModelsOptions.modelPrefix;
        };

        if (stat && stat.isDirectory()) {
          const files = await glob(pattern, Object.assign({}, globOptions, { cwd: modelsPath }));

          for (const file of files.sort()) {
            registerDB(loadModelModule(path.join(modelsPath, file)), camelCase(path.basename(file, path.extname(file))));
          }
        } else if (stat && stat.isFile()) {
          registerDB(loadModelModule(modelsPath), camelCase(path.basename(modelsPath, path.extname(modelsPath))));
        } else if (typeof modelsPath === 'function') {
          registerDB(modelsPath);
        } else {
          log.warn('未发现任何models模块,args:' + modelsPath);
        }

        modelList.push(db);
        return appendModelPrefixAlias(db, addModelsOptions.modelPrefix);
      };

      const sync = async (syncOptions = {}) => {
        const { connection: _ignored, ...options } = syncOptions;
        modelList.forEach(db => {
          Object.values(db).forEach(model => {
            if (model.associate) model.associate(appendModelPrefixAlias(db, model.modelPrefix), fastify, options);
          });
        });
        await runSqlScripts();
        await sequelize.sync(Object.assign({}, ctxConfig.syncOptions, options));
        log.info({ connection: registryKey }, 'models were synchronized successfully.');
        syncPromiseResolve();
      };

      let autoModels;
      if (ctxConfig.modelsPath) {
        const modelsFullPath = path.isAbsolute(ctxConfig.modelsPath)
          ? ctxConfig.modelsPath
          : path.join(process.cwd(), ctxConfig.modelsPath);
        const modelsStat = await fs.promises.stat(modelsFullPath).catch(() => {});
        if (modelsStat && modelsStat.isDirectory()) {
          autoModels = await addModels(modelsFullPath, ctxConfig);
        }
      }

      const ctx = {
        key: registryKey,
        config: ctxConfig,
        instance: sequelize,
        modelList,
        addModels,
        sync,
        syncPromise,
        generateId: () => snowflake.getUniqueID(),
        lastUsed: Date.now(),
        isTenant: String(registryKey).startsWith('tenant:'),
        touch() {
          ctx.lastUsed = Date.now();
        },
        async close() {
          await sequelize.close();
        }
      };

      if (autoModels) {
        ctx[modelsKey] = autoModels;
        ctx.models = autoModels;
      }

      return ctx;
    };

    const toPublicConnection = ctx => {
      const modelsKey = ctx.config.name || defaultConfig.name;
      const publicConn = {
        name: ctx.key,
        instance: ctx.instance,
        addModels: (...args) => {
          ctx.touch();
          return ctx.addModels(...args);
        },
        sync: (...args) => {
          ctx.touch();
          return ctx.sync(...args);
        },
        transaction: (...args) => {
          ctx.touch();
          return ctx.instance.transaction(...args);
        },
        syncPromise: ctx.syncPromise,
        generateId: ctx.generateId,
        Sequelize,
        utils: {
          buildWhereQuery,
          buildPaginationQuery,
          formatPaginationResult
        }
      };
      if (ctx[modelsKey]) {
        publicConn[modelsKey] = ctx[modelsKey];
        publicConn.models = ctx[modelsKey];
      }
      return publicConn;
    };

    const resolveContext = connectionName => {
      const key = connectionName == null || connectionName === '' ? DEFAULT_CONNECTION : connectionName;
      const ctx = registry.get(key);
      if (!ctx) {
        throw new Error(`Unknown connection: ${key}`);
      }
      ctx.touch();
      return ctx;
    };

    const evictIdleTenants = async () => {
      const idleTimeoutMs = config.tenantPool?.idleTimeoutMs;
      if (!idleTimeoutMs) {
        return;
      }
      const now = Date.now();
      for (const [key, ctx] of [...registry.entries()]) {
        if (!ctx.isTenant) {
          continue;
        }
        if (now - ctx.lastUsed > idleTimeoutMs) {
          await ctx.close().catch(err => log.error(err, `failed to close idle tenant connection ${key}`));
          registry.delete(key);
        }
      }
    };

    const evictTenantIfNeeded = async () => {
      await evictIdleTenants();
      const maxInstances = config.tenantPool?.maxInstances ?? 50;
      const tenants = [...registry.entries()].filter(([, ctx]) => ctx.isTenant);
      while (tenants.length >= maxInstances) {
        tenants.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
        const [key, ctx] = tenants.shift();
        await ctx.close().catch(err => log.error(err, `failed to evict tenant connection ${key}`));
        registry.delete(key);
      }
    };

    const defaultCtx = await createContext({}, DEFAULT_CONNECTION);
    registry.set(DEFAULT_CONNECTION, defaultCtx);

    for (const [name, value] of Object.entries(config.connections || {})) {
      if (name === DEFAULT_CONNECTION) {
        throw new Error(`connections["${DEFAULT_CONNECTION}"] is reserved`);
      }
      if (registry.has(name)) {
        throw new Error(`Duplicate connection name: ${name}`);
      }
      const ctx = await createContext(normalizeConnectionConfig(value), name);
      registry.set(name, ctx);
    }

    // 其它库唯一入口；getConnection 为别名。fastify.sequelize 本身始终是默认库。
    const connection = name => {
      if (name == null || name === '' || name === DEFAULT_CONNECTION) {
        throw new Error(
          'Use fastify.sequelize for the default database; connection(name) is only for other databases'
        );
      }
      try {
        return toPublicConnection(resolveContext(name));
      } catch (err) {
        if (String(name).startsWith('tenant:') && typeof config.getTenantDb === 'function') {
          throw new Error(
            `${err.message}. Create the tenant connection first with forTenant('${String(name).slice(7)}'), then use connection('${name}')`
          );
        }
        throw err;
      }
    };

    const forTenant = async tenantId => {
      if (typeof config.getTenantDb !== 'function') {
        throw new Error('getTenantDb is not configured');
      }
      if (tenantId == null || tenantId === '') {
        throw new Error('tenantId is required');
      }

      const key = `tenant:${tenantId}`;
      if (registry.has(key)) {
        return toPublicConnection(resolveContext(key));
      }

      await evictTenantIfNeeded();
      const dbOrConfig = await config.getTenantDb(tenantId);
      if (!dbOrConfig) {
        throw new Error(`getTenantDb returned empty config for tenant: ${tenantId}`);
      }
      const ctx = await createContext(normalizeConnectionConfig(dbOrConfig), key);
      registry.set(key, ctx);
      return toPublicConnection(ctx);
    };

    const listConnections = () => [...registry.keys()];

    const syncAll = async (syncOptions = {}) => {
      const { connection: _ignored, ...options } = syncOptions;
      for (const ctx of registry.values()) {
        await ctx.sync(options);
      }
    };

    const modelsKey = config.name || defaultConfig.name;
    // facade === 默认库；历史 API 语义不变，其它库只能 connection(name)
    const facade = {
      addModels: async (modelsPath, addOptions = {}) => {
        const { connection: connectionName, ...rest } = addOptions;
        if (connectionName) {
          return resolveContext(connectionName).addModels(modelsPath, rest);
        }
        return defaultCtx.addModels(modelsPath, rest);
      },
      Sequelize,
      utils: {
        buildWhereQuery,
        buildPaginationQuery,
        formatPaginationResult
      },
      instance: defaultCtx.instance,
      generateId: () => snowflake.getUniqueID(),
      syncPromise: defaultCtx.syncPromise,
      sync: async (syncOptions = {}) => {
        const { connection: connectionName, ...rest } = syncOptions;
        if (connectionName) {
          return resolveContext(connectionName).sync(rest);
        }
        return defaultCtx.sync(rest);
      },
      transaction: (...args) => defaultCtx.instance.transaction(...args),
      connection,
      getConnection: connection,
      forTenant,
      listConnections,
      syncAll
    };

    if (defaultCtx[modelsKey]) {
      facade[modelsKey] = defaultCtx[modelsKey];
    }

    fastify.decorate('sequelize', facade);

    fastify.addHook('onClose', async () => {
      for (const [key, ctx] of registry.entries()) {
        await ctx.close().catch(err => log.error(err, `failed to close connection ${key}`));
      }
      registry.clear();
    });
  },
  {
    name: 'fastify-sequelize'
  }
);

module.exports = sequelizePlugin;
