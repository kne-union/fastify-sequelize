const { expect } = require('chai');
const path = require('node:path');
const fs = require('fs-extra');
const fastify = require('fastify');
const plugin = require('../index');

const DB_PATH = path.resolve(__dirname, 'test.sqlite');
const TEMP_DIRS = [
  path.resolve(__dirname, 'tmp_models'),
  path.resolve(__dirname, 'tmp_conflict'),
  path.resolve(__dirname, 'tmp_alias_collision'),
  path.resolve(__dirname, 'tmp_sql')
];

async function cleanup() {
  await fs.remove(DB_PATH).catch(() => {});
  await fs.remove(path.resolve(__dirname, 'paranoid_test.sqlite')).catch(() => {});
  await fs.remove(path.resolve(__dirname, 'sql_track.sqlite')).catch(() => {});
  await fs.remove(path.resolve(__dirname, 'sql_fail.sqlite')).catch(() => {});
  for (const d of TEMP_DIRS) {
    await fs.remove(d).catch(() => {});
  }
}

// 创建包含 user 和 tenant-user 模型的临时目录
async function createModelsDir() {
  const dir = path.resolve(__dirname, 'tmp_models');
  await fs.ensureDir(dir);
  await fs.writeFile(path.join(dir, 'user.js'),
    `module.exports = ({ DataTypes }) => ({ model: { name: DataTypes.STRING } });`
  );
  await fs.writeFile(path.join(dir, 'tenant-user.js'),
    `module.exports = ({ DataTypes }) => ({ model: { name: DataTypes.STRING, tenantUserId: DataTypes.STRING } });`
  );
  return dir;
}

describe('@kne/fastify-sequelize', function () {
  before(cleanup);
  after(cleanup);

  describe('插件注册测试', function () {
    let app;

    afterEach(async function () {
      if (app) { await app.close(); app = null; }
    });

    it('should add sequelize decorator with default options', async function () {
      app = fastify();
      await app.register(plugin, { db: { dialect: 'sqlite', storage: DB_PATH } });
      await app.ready();
      expect(app.sequelize).to.exist;
      expect(app.sequelize.instance).to.exist;
      expect(app.sequelize.addModels).to.be.a('function');
      expect(app.sequelize.generateId).to.be.a('function');
      expect(app.sequelize.sync).to.be.a('function');
      expect(app.sequelize.syncPromise).to.be.instanceOf(Promise);
    });

    it('should register plugin with custom name and auto-load models', async function () {
      const modelsDir = await createModelsDir();
      app = fastify();
      await app.register(plugin, {
        db: { dialect: 'sqlite', storage: DB_PATH },
        name: 'customModels',
        modelsPath: './tests/tmp_models'
      });
      await app.ready();
      expect(app.sequelize.customModels).to.exist;
      expect(app.sequelize.customModels.user).to.exist;
    });

    it('should expose utils on sequelize decorator', async function () {
      app = fastify();
      await app.register(plugin, { db: { dialect: 'sqlite', storage: DB_PATH } });
      await app.ready();
      expect(app.sequelize.utils).to.exist;
      expect(app.sequelize.utils.buildWhereQuery).to.be.a('function');
      expect(app.sequelize.utils.buildPaginationQuery).to.be.a('function');
      expect(app.sequelize.utils.formatPaginationResult).to.be.a('function');
    });

    it('should expose Sequelize class reference', async function () {
      app = fastify();
      await app.register(plugin, { db: { dialect: 'sqlite', storage: DB_PATH } });
      await app.ready();
      expect(app.sequelize.Sequelize).to.exist;
    });
  });

  describe('核心功能测试', function () {
    let app;

    beforeEach(async function () {
      app = fastify();
      await app.register(plugin, { db: { dialect: 'sqlite', storage: DB_PATH } });
    });

    afterEach(async function () {
      if (app) { await app.close(); app = null; }
    });

    describe('generateId', function () {
      it('should generate unique IDs via snowflake algorithm', async function () {
        await app.ready();
        const id1 = app.sequelize.generateId();
        const id2 = app.sequelize.generateId();
        expect(id1).to.not.equal(id2);
        expect(id1.toString()).to.be.a('string');
      });
    });

    describe('addModels', function () {
      it('should load models from a directory', async function () {
        const modelsDir = await createModelsDir();
        await app.ready();
        const db = await app.sequelize.addModels(modelsDir);
        expect(db).to.exist;
        expect(db.user).to.exist;
        expect(db.tenantUser).to.exist;
      });

      it('should load model from a single file', async function () {
        const modelsDir = await createModelsDir();
        await app.ready();
        const db = await app.sequelize.addModels(path.join(modelsDir, 'user.js'));
        expect(db).to.exist;
        expect(db.user).to.exist;
      });

      it('should load model from a function', async function () {
        await app.ready();
        const db = await app.sequelize.addModels(({ DataTypes }) => ({
          name: 'Product',
          model: { title: DataTypes.STRING }
        }));
        expect(db).to.exist;
        expect(db.Product).to.exist;
      });

      it('should throw error when model name conflicts within same directory', async function () {
        const tmpDir = path.resolve(__dirname, 'tmp_conflict');
        await fs.ensureDir(tmpDir);
        await fs.writeFile(path.join(tmpDir, 'a.js'),
          `module.exports = ({ DataTypes }) => ({ name: 'Conflict', model: { a: DataTypes.STRING } });`
        );
        await fs.writeFile(path.join(tmpDir, 'b.js'),
          `module.exports = ({ DataTypes }) => ({ name: 'Conflict', model: { b: DataTypes.STRING } });`
        );
        await app.ready();
        try {
          await app.sequelize.addModels(tmpDir);
          expect.fail('should have thrown');
        } catch (err) {
          expect(err.message).to.include('模型定义冲突');
        } finally {
          await fs.remove(tmpDir);
        }
      });

      it('should add model prefix when modelPrefix option is provided', async function () {
        const modelsDir = await createModelsDir();
        await app.ready();
        const db = await app.sequelize.addModels(path.join(modelsDir, 'user.js'), {
          modelPrefix: 'Tenant'
        });
        expect(db.TenantUser).to.exist;
        expect(db.user).to.exist;
      });

      it('should not duplicate prefix when model name already starts with modelPrefix', async function () {
        await app.ready();
        const db = await app.sequelize.addModels(({ DataTypes }) => ({
          name: 'TenantUser',
          model: { title: DataTypes.STRING }
        }), { modelPrefix: 'Tenant' });
        expect(db.TenantUser).to.exist;
        expect(db.TenantTenantUser).to.not.exist;
      });

      it('should generate alias from prefixed model name via appendModelPrefixAlias', async function () {
        const modelsDir = await createModelsDir();
        await app.ready();
        const db = await app.sequelize.addModels(path.join(modelsDir, 'user.js'), {
          modelPrefix: 'Tenant'
        });
        expect(db.TenantUser).to.exist;
        expect(db.user).to.exist;
        expect(db.user).to.equal(db.TenantUser);
      });

      it('should not overwrite existing key when alias conflicts in appendModelPrefixAlias', async function () {
        const modelsDir = await createModelsDir();
        await app.ready();
        const db = await app.sequelize.addModels(modelsDir, { modelPrefix: 'Tenant' });
        expect(db.TenantUser).to.exist;
        expect(db.TenantTenantUser).to.exist;
        // 别名指向对应的前缀模型
        expect(db.user).to.equal(db.TenantUser);
        expect(db.tenantUser).to.equal(db.TenantTenantUser);
      });

      it('should set modelPrefix property on registered model', async function () {
        const modelsDir = await createModelsDir();
        await app.ready();
        const db = await app.sequelize.addModels(path.join(modelsDir, 'user.js'), {
          modelPrefix: 'Tenant'
        });
        expect(db.TenantUser.modelPrefix).to.equal('Tenant');
      });

      it('should not set modelPrefix when modelPrefix option is not provided', async function () {
        const modelsDir = await createModelsDir();
        await app.ready();
        const db = await app.sequelize.addModels(path.join(modelsDir, 'user.js'));
        expect(db.user.modelPrefix).to.not.be.ok;
      });

      // L57: modelPrefix === key 时跳过别名生成
      it('should skip key when modelPrefix equals key in appendModelPrefixAlias', async function () {
        await app.ready();
        const db = await app.sequelize.addModels(({ DataTypes }) => ({
          name: 'Tenant',
          model: { title: DataTypes.STRING }
        }), { modelPrefix: 'Tenant' });
        expect(db.Tenant).to.exist;
        // key 'Tenant' === modelPrefix 'Tenant'，不生成别名 tenant
        expect(db.tenant).to.not.exist;
      });

      // L63: 别名已存在于 result 中时跳过
      it('should skip alias when alias already exists in appendModelPrefixAlias', async function () {
        await app.ready();
        // 先注册一个无前缀的 'user' 模型，再注册 TenantUser
        // 由于 addModels 每次创建独立 db，改用临时目录让两个模型在同一 db 中
        const tmpDir = path.resolve(__dirname, 'tmp_alias_collision');
        await fs.ensureDir(tmpDir);
        await fs.writeFile(path.join(tmpDir, 'user.js'),
          `module.exports = ({ DataTypes }) => ({ name: 'User', model: { a: DataTypes.STRING } });`
        );
        await fs.writeFile(path.join(tmpDir, 'tenant-user.js'),
          `module.exports = ({ DataTypes }) => ({ name: 'Tenantuser', model: { b: DataTypes.STRING } });`
        );
        try {
          const db = await app.sequelize.addModels(tmpDir, { modelPrefix: 'Tenant' });
          expect(db.TenantUser).to.exist;
          expect(db.Tenantuser).to.exist;
          // 两个模型都会生成 alias 'user'，后处理的被跳过（L63）
          // 不依赖 Promise.all 顺序，仅验证 alias 存在且指向其中一个
          expect(db.user).to.exist;
          expect([db.TenantUser, db.Tenantuser]).to.include(db.user);
        } finally {
          await fs.remove(tmpDir);
        }
      });

      it('should use custom table prefix when prefix option is provided', async function () {
        const modelsDir = await createModelsDir();
        await app.ready();
        const db = await app.sequelize.addModels(path.join(modelsDir, 'user.js'), {
          prefix: 'app_'
        });
        expect(db.user).to.exist;
        expect(db.user.tableName).to.equal('app_user');
      });

      it('should auto generate snowflake ID on create', async function () {
        const modelsDir = await createModelsDir();
        await app.ready();
        const db = await app.sequelize.addModels(path.join(modelsDir, 'user.js'));
        await app.sequelize.sync();
        const user = await db.user.create({ name: 'test-user' });
        expect(user.id).to.exist;
        expect(user.id.toString()).to.be.a('string');
      });

      it('should preserve provided id on create and bulkCreate', async function () {
        const modelsDir = await createModelsDir();
        await app.ready();
        const db = await app.sequelize.addModels(path.join(modelsDir, 'user.js'));
        await app.sequelize.sync();
        const customId = 'custom-id-001';
        const user = await db.user.create({ id: customId, name: 'custom-user' });
        expect(user.id.toString()).to.equal(customId);
        const users = await db.user.bulkCreate([
          { id: 'bulk-1', name: 'u1' },
          { name: 'u2' }
        ]);
        expect(users[0].id.toString()).to.equal('bulk-1');
        expect(users[1].id).to.exist;
        expect(users[1].id.toString()).to.not.equal('bulk-1');
      });

      it('should auto generate snowflake IDs on bulkCreate', async function () {
        const modelsDir = await createModelsDir();
        await app.ready();
        const db = await app.sequelize.addModels(path.join(modelsDir, 'user.js'));
        await app.sequelize.sync();
        const users = await db.user.bulkCreate([
          { name: 'user1' }, { name: 'user2' }
        ]);
        expect(users).to.have.length(2);
        expect(users[0].id).to.not.equal(users[1].id);
      });
    });

    describe('sync', function () {
      it('should sync models to database', async function () {
        const modelsDir = await createModelsDir();
        await app.ready();
        const db = await app.sequelize.addModels(path.join(modelsDir, 'user.js'));
        await app.sequelize.sync();
        const users = await db.user.findAll();
        expect(users).to.be.an('array');
      });

      it('should resolve syncPromise after sync completes', async function () {
        const modelsDir = await createModelsDir();
        await app.ready();
        await app.sequelize.addModels(path.join(modelsDir, 'user.js'));
        await app.sequelize.sync();
        const result = await app.sequelize.syncPromise;
        expect(result).to.be.undefined;
      });

      it('should pass db with alias to associate when model has modelPrefix', async function () {
        await app.ready();
        let receivedDb = null;
        await app.sequelize.addModels(({ DataTypes }) => ({
          name: 'Order',
          model: { title: DataTypes.STRING },
          associate(db) { receivedDb = db; }
        }), { modelPrefix: 'Tenant' });
        await app.sequelize.sync();
        expect(receivedDb).to.exist;
        expect(receivedDb.TenantOrder).to.exist;
        expect(receivedDb.order).to.exist;
        expect(receivedDb.order).to.equal(receivedDb.TenantOrder);
      });

      it('should execute SQL scripts from sqlPath during sync', async function () {
        const tmpSqlDir = path.resolve(__dirname, 'tmp_sql');
        await fs.ensureDir(tmpSqlDir);
        await fs.writeFile(
          path.join(tmpSqlDir, '001_create_test_table.sql'),
          'CREATE TABLE IF NOT EXISTS _sync_test (id INTEGER PRIMARY KEY, name TEXT);'
        );
        await fs.writeFile(path.join(tmpSqlDir, 'ignore-me.txt'), 'ignored');

        const sqlApp = fastify();
        await sqlApp.register(plugin, {
          db: { dialect: 'sqlite', storage: DB_PATH },
          sqlPath: './tests/tmp_sql'
        });
        const modelsDir = await createModelsDir();
        await sqlApp.ready();
        await sqlApp.sequelize.addModels(path.join(modelsDir, 'user.js'));
        await sqlApp.sequelize.sync();

        const [rows] = await sqlApp.sequelize.instance.query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='_sync_test'"
        );
        expect(rows).to.have.length(1);
        expect(rows[0].name).to.equal('_sync_test');
        await sqlApp.close();
        await fs.remove(tmpSqlDir);
      });

      it('should track SQL migrations and skip already executed scripts', async function () {
        const tmpSqlDir = path.resolve(__dirname, 'tmp_sql');
        await fs.ensureDir(tmpSqlDir);
        // SQLite 单次 query 通常只执行首条语句，故拆成两个文件
        await fs.writeFile(
          path.join(tmpSqlDir, '001_create_counter.sql'),
          'CREATE TABLE IF NOT EXISTS _sql_counter (id INTEGER PRIMARY KEY, n INTEGER DEFAULT 0);'
        );
        await fs.writeFile(
          path.join(tmpSqlDir, '002_insert_counter.sql'),
          'INSERT INTO _sql_counter (id, n) VALUES (1, 1);'
        );

        const sqlDb = path.resolve(__dirname, 'sql_track.sqlite');
        await fs.remove(sqlDb).catch(() => {});
        const sqlApp = fastify();
        await sqlApp.register(plugin, {
          db: { dialect: 'sqlite', storage: sqlDb },
          sqlPath: './tests/tmp_sql'
        });
        await sqlApp.ready();
        await sqlApp.sequelize.addModels(({ DataTypes }) => ({
          name: 'TrackModel',
          model: { title: DataTypes.STRING }
        }));
        await sqlApp.sequelize.sync();
        await sqlApp.sequelize.sync();

        const [rows] = await sqlApp.sequelize.instance.query('SELECT n FROM _sql_counter WHERE id = 1');
        expect(rows).to.have.length(1);
        expect(rows[0].n).to.equal(1);

        const [migrations] = await sqlApp.sequelize.instance.query(
          'SELECT name FROM _fs_sql_migrations ORDER BY name'
        );
        expect(migrations.map(row => row.name)).to.deep.equal([
          '001_create_counter.sql',
          '002_insert_counter.sql'
        ]);
        await sqlApp.close();
        await fs.remove(tmpSqlDir);
        await fs.remove(sqlDb);
      });

      it('should throw when sqlFailFast is true and SQL script fails', async function () {
        const tmpSqlDir = path.resolve(__dirname, 'tmp_sql');
        await fs.ensureDir(tmpSqlDir);
        await fs.writeFile(path.join(tmpSqlDir, '001_bad.sql'), 'THIS IS NOT VALID SQL;');

        const sqlDb = path.resolve(__dirname, 'sql_fail.sqlite');
        await fs.remove(sqlDb).catch(() => {});
        const sqlApp = fastify();
        await sqlApp.register(plugin, {
          db: { dialect: 'sqlite', storage: sqlDb },
          sqlPath: './tests/tmp_sql',
          sqlFailFast: true
        });
        await sqlApp.ready();
        try {
          await sqlApp.sequelize.sync();
          expect.fail('should have thrown');
        } catch (err) {
          expect(err).to.exist;
        } finally {
          await sqlApp.close();
          await fs.remove(tmpSqlDir);
          await fs.remove(sqlDb);
        }
      });
    });
  });

  describe('生命周期测试', function () {
    it('should close sequelize connection on fastify close', async function () {
      const app = fastify();
      await app.register(plugin, { db: { dialect: 'sqlite', storage: DB_PATH } });
      await app.ready();
      await app.sequelize.instance.authenticate();
      await app.close();
      let closed = false;
      try {
        await app.sequelize.instance.query('SELECT 1');
      } catch (err) {
        closed = true;
        expect(err).to.exist;
      }
      expect(closed).to.equal(true);
    });
  });

  describe('参数优先级测试', function () {
    let app;

    afterEach(async function () {
      if (app) { await app.close(); app = null; }
    });

    it('should use addModels options prefix over global config prefix', async function () {
      const modelsDir = await createModelsDir();
      app = fastify();
      await app.register(plugin, {
        db: { dialect: 'sqlite', storage: DB_PATH },
        prefix: 'global_'
      });
      await app.ready();
      const db = await app.sequelize.addModels(path.join(modelsDir, 'user.js'), {
        prefix: 'override_'
      });
      expect(db.user.tableName).to.equal('override_user');
    });

    it('should fallback to global config prefix when addModels prefix is not provided', async function () {
      const modelsDir = await createModelsDir();
      app = fastify();
      await app.register(plugin, {
        db: { dialect: 'sqlite', storage: DB_PATH },
        prefix: 'global_'
      });
      await app.ready();
      const db = await app.sequelize.addModels(path.join(modelsDir, 'user.js'));
      expect(db.user.tableName).to.equal('global_user');
    });
  });

  describe('边界情况测试', function () {
    let app;

    afterEach(async function () {
      if (app) { await app.close(); app = null; }
    });

    it('should return empty db when modelsPath does not exist', async function () {
      app = fastify();
      await app.register(plugin, { db: { dialect: 'sqlite', storage: DB_PATH } });
      await app.ready();
      const db = await app.sequelize.addModels('/nonexistent/path');
      expect(db).to.deep.equal({});
    });

    it('should not load models when modelsPath is not configured', async function () {
      app = fastify();
      await app.register(plugin, {
        db: { dialect: 'sqlite', storage: DB_PATH },
        modelsPath: null
      });
      await app.ready();
      expect(app.sequelize.models).to.not.be.ok;
    });

    it('should throw error when module returns no model name and no targetName', async function () {
      app = fastify();
      await app.register(plugin, { db: { dialect: 'sqlite', storage: DB_PATH } });
      await app.ready();
      try {
        await app.sequelize.addModels(() => ({ model: {} }));
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.include('modelName');
      }
    });

    it('should handle paranoid mode with soft delete', async function () {
      const paranoidDbPath = path.resolve(__dirname, 'paranoid_test.sqlite');
      const modelsDir = await createModelsDir();
      app = fastify();
      await app.register(plugin, {
        db: { dialect: 'sqlite', storage: paranoidDbPath }
      });
      await app.ready();
      const db = await app.sequelize.addModels(path.join(modelsDir, 'user.js'));
      await app.sequelize.sync();
      const user = await db.user.create({ name: 'to-delete' });
      await user.destroy();
      const allUsers = await db.user.findAll();
      expect(allUsers).to.have.length(0);
      const includingDeleted = await db.user.findAll({ paranoid: false });
      expect(includingDeleted).to.have.length(1);
      await app.close();
      app = null;
      await fs.remove(paranoidDbPath);
    });

    // L71: modelPrefix 为假值时直接返回原 db（appendModelPrefixAlias 的 falsy 分支）
    it('should return db directly when modelPrefix is not provided in addModels', async function () {
      const modelsDir = await createModelsDir();
      app = fastify();
      await app.register(plugin, { db: { dialect: 'sqlite', storage: DB_PATH } });
      await app.ready();
      const db = await app.sequelize.addModels(path.join(modelsDir, 'user.js'));
      // 无 modelPrefix 时返回的 db 对象与内部 db 是同一个引用
      expect(db.user).to.exist;
      expect(db.TenantUser).to.not.exist;
    });
  });

  describe('多连接 / 租户连接池', function () {
    const secondaryDb = path.resolve(__dirname, 'secondary.sqlite');
    const tenantADb = path.resolve(__dirname, 'tenant_a.sqlite');
    const tenantBDb = path.resolve(__dirname, 'tenant_b.sqlite');
    const tenantCDb = path.resolve(__dirname, 'tenant_c.sqlite');
    let app;

    beforeEach(async function () {
      await fs.remove(secondaryDb).catch(() => {});
      await fs.remove(tenantADb).catch(() => {});
      await fs.remove(tenantBDb).catch(() => {});
      await fs.remove(tenantCDb).catch(() => {});
    });

    afterEach(async function () {
      if (app) {
        await app.close();
        app = null;
      }
      await fs.remove(secondaryDb).catch(() => {});
      await fs.remove(tenantADb).catch(() => {});
      await fs.remove(tenantBDb).catch(() => {});
      await fs.remove(tenantCDb).catch(() => {});
    });

    it('should keep default instance when connections are not configured', async function () {
      app = fastify();
      await app.register(plugin, {
        db: { dialect: 'sqlite', storage: DB_PATH },
        sqlPath: false
      });
      await app.ready();
      const db = app.sequelize;
      expect(db.instance).to.exist;
      expect(db.transaction).to.be.a('function');
      expect(db.connection).to.be.a('function');
      expect(db.listConnections()).to.deep.equal(['default']);
      try {
        db.connection('default');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.include('default database');
      }
    });

    it('should register static named connections and isolate data', async function () {
      const modelsDir = await createModelsDir();
      const mainDb = path.resolve(__dirname, 'multi_main.sqlite');
      await fs.remove(mainDb).catch(() => {});
      app = fastify();
      await app.register(plugin, {
        db: { dialect: 'sqlite', storage: mainDb },
        sqlPath: false,
        modelsPath: null,
        connections: {
          analytics: {
            db: { dialect: 'sqlite', storage: secondaryDb },
            sqlPath: false,
            modelsPath: null
          }
        }
      });
      await app.ready();

      const db = app.sequelize;
      expect(db.listConnections()).to.include.members(['default', 'analytics']);
      const analytics = db.connection('analytics');
      expect(analytics.instance).to.not.equal(db.instance);
      expect(db.getConnection).to.equal(db.connection);

      const defaultDb = await db.addModels(path.join(modelsDir, 'user.js'));
      const analyticsDb = await analytics.addModels(path.join(modelsDir, 'user.js'));
      await db.sync();
      await analytics.sync();

      await defaultDb.user.create({ name: 'default-user' });
      await analyticsDb.user.create({ name: 'analytics-user' });

      const defaultUsers = await defaultDb.user.findAll();
      const analyticsUsers = await analyticsDb.user.findAll();
      expect(defaultUsers).to.have.length(1);
      expect(defaultUsers[0].name).to.equal('default-user');
      expect(analyticsUsers).to.have.length(1);
      expect(analyticsUsers[0].name).to.equal('analytics-user');
      await fs.remove(mainDb).catch(() => {});
    });

    it('should support connection().addModels without touching default models bag', async function () {
      const modelsDir = await createModelsDir();
      app = fastify();
      await app.register(plugin, {
        db: { dialect: 'sqlite', storage: DB_PATH },
        sqlPath: false,
        modelsPath: null,
        connections: {
          analytics: {
            db: { dialect: 'sqlite', storage: secondaryDb },
            sqlPath: false,
            modelsPath: null
          }
        }
      });
      await app.ready();

      const analytics = app.sequelize.connection('analytics');
      const analyticsDb = await analytics.addModels(path.join(modelsDir, 'user.js'));
      await analytics.sync();
      expect(analyticsDb.user).to.exist;
      expect(app.sequelize.models).to.not.be.ok;
    });

    it('should run transaction on default db and named connection', async function () {
      const modelsDir = await createModelsDir();
      const mainDb = path.resolve(__dirname, 'tx_main.sqlite');
      await fs.remove(mainDb).catch(() => {});
      app = fastify();
      await app.register(plugin, {
        db: { dialect: 'sqlite', storage: mainDb },
        sqlPath: false,
        modelsPath: null,
        connections: {
          analytics: {
            db: { dialect: 'sqlite', storage: secondaryDb },
            sqlPath: false,
            modelsPath: null
          }
        }
      });
      await app.ready();

      const db = app.sequelize;
      const defaultModels = await db.addModels(path.join(modelsDir, 'user.js'));
      await db.sync();
      const created = await db.transaction(async t => {
        return defaultModels.user.create({ name: 'tx-user' }, { transaction: t });
      });
      expect(created.name).to.equal('tx-user');

      const analytics = db.connection('analytics');
      const analyticsModels = await analytics.addModels(path.join(modelsDir, 'user.js'));
      await analytics.sync();
      const eventUser = await analytics.transaction(async t => {
        return analyticsModels.user.create({ name: 'analytics-tx' }, { transaction: t });
      });
      expect(eventUser.name).to.equal('analytics-tx');
      await fs.remove(mainDb).catch(() => {});
    });

    it('should create tenant via forTenant then access with connection(tenant:id)', async function () {
      const modelsDir = await createModelsDir();
      app = fastify();
      await app.register(plugin, {
        db: { dialect: 'sqlite', storage: DB_PATH },
        sqlPath: false,
        modelsPath: null,
        getTenantDb: async tenantId => ({
          db: {
            dialect: 'sqlite',
            storage: tenantId === 'a' ? tenantADb : tenantBDb
          },
          sqlPath: false,
          modelsPath: null
        })
      });
      await app.ready();

      const tenantA1 = await app.sequelize.forTenant('a');
      const tenantA2 = app.sequelize.connection('tenant:a');
      expect(tenantA1.instance).to.equal(tenantA2.instance);
      expect(app.sequelize.listConnections()).to.include('tenant:a');

      const db = await tenantA1.addModels(path.join(modelsDir, 'user.js'));
      await tenantA1.sync();
      await db.user.create({ name: 'tenant-a-user' });

      const tenantB = await app.sequelize.forTenant('b');
      const dbB = await tenantB.addModels(path.join(modelsDir, 'user.js'));
      await tenantB.sync();
      const usersB = await dbB.user.findAll();
      expect(usersB).to.have.length(0);
    });

    it('should throw when forTenant is used without getTenantDb', async function () {
      app = fastify();
      await app.register(plugin, {
        db: { dialect: 'sqlite', storage: DB_PATH },
        sqlPath: false
      });
      await app.ready();
      try {
        await app.sequelize.forTenant('x');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.include('getTenantDb');
      }
    });

    it('should evict least-recently-used tenant when maxInstances is reached', async function () {
      const modelsDir = await createModelsDir();
      const storages = { a: tenantADb, b: tenantBDb, c: tenantCDb };
      app = fastify();
      await app.register(plugin, {
        db: { dialect: 'sqlite', storage: DB_PATH },
        sqlPath: false,
        modelsPath: null,
        tenantPool: { maxInstances: 2, idleTimeoutMs: 0 },
        getTenantDb: async tenantId => ({
          db: { dialect: 'sqlite', storage: storages[tenantId] },
          sqlPath: false,
          modelsPath: null
        })
      });
      await app.ready();

      await app.sequelize.forTenant('a');
      await app.sequelize.forTenant('b');
      expect(app.sequelize.listConnections()).to.include.members(['tenant:a', 'tenant:b']);

      await app.sequelize.forTenant('c');
      const keys = app.sequelize.listConnections();
      expect(keys).to.include('tenant:c');
      expect(keys.filter(k => k.startsWith('tenant:'))).to.have.length(2);
      expect(keys).to.not.include('tenant:a');
    });

    it('should syncAll without changing default sync scope when called separately', async function () {
      const modelsDir = await createModelsDir();
      app = fastify();
      await app.register(plugin, {
        db: { dialect: 'sqlite', storage: DB_PATH },
        sqlPath: false,
        modelsPath: null,
        connections: {
          analytics: {
            db: { dialect: 'sqlite', storage: secondaryDb },
            sqlPath: false,
            modelsPath: null
          }
        }
      });
      await app.ready();
      await app.sequelize.addModels(path.join(modelsDir, 'user.js'));
      await app.sequelize.addModels(path.join(modelsDir, 'user.js'), { connection: 'analytics' });
      await app.sequelize.syncAll();

      const defaultTables = await app.sequelize.instance.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='t_user'"
      );
      const analyticsTables = await app.sequelize.connection('analytics').instance.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='t_user'"
      );
      expect(defaultTables[0]).to.have.length(1);
      expect(analyticsTables[0]).to.have.length(1);
    });

    it('should throw for unknown connection name', async function () {
      app = fastify();
      await app.register(plugin, {
        db: { dialect: 'sqlite', storage: DB_PATH },
        sqlPath: false
      });
      await app.ready();
      try {
        app.sequelize.connection('missing');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.include('Unknown connection');
      }
    });

    it('should hint forTenant when connection(tenant:id) before create', async function () {
      app = fastify();
      await app.register(plugin, {
        db: { dialect: 'sqlite', storage: DB_PATH },
        sqlPath: false,
        getTenantDb: async () => ({ db: { dialect: 'sqlite', storage: tenantADb }, sqlPath: false })
      });
      await app.ready();
      try {
        app.sequelize.connection('tenant:a');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.include('forTenant');
      }
    });

    it('should reject connections.default as reserved', async function () {
      app = fastify();
      try {
        await app.register(plugin, {
          db: { dialect: 'sqlite', storage: DB_PATH },
          sqlPath: false,
          connections: {
            default: { db: { dialect: 'sqlite', storage: secondaryDb } }
          }
        });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.include('reserved');
      }
    });

    it('should support options.connection on addModels and sync', async function () {
      const modelsDir = await createModelsDir();
      app = fastify();
      await app.register(plugin, {
        db: { dialect: 'sqlite', storage: DB_PATH },
        sqlPath: false,
        modelsPath: null,
        connections: {
          analytics: {
            db: { dialect: 'sqlite', storage: secondaryDb },
            sqlPath: false,
            modelsPath: null
          }
        }
      });
      await app.ready();
      const analyticsDb = await app.sequelize.addModels(path.join(modelsDir, 'user.js'), {
        connection: 'analytics'
      });
      await app.sequelize.sync({ connection: 'analytics' });
      await analyticsDb.user.create({ name: 'via-options' });
      const rows = await analyticsDb.user.findAll();
      expect(rows).to.have.length(1);
    });
  });

  describe('SQL 迁移选项', function () {
    let app;

    afterEach(async function () {
      if (app) {
        await app.close();
        app = null;
      }
      await fs.remove(path.resolve(__dirname, 'tmp_sql')).catch(() => {});
      await fs.remove(path.resolve(__dirname, 'sql_opt.sqlite')).catch(() => {});
    });

    it('should re-run SQL every sync when sqlTrackMigrations is false', async function () {
      const tmpSqlDir = path.resolve(__dirname, 'tmp_sql');
      const sqlDb = path.resolve(__dirname, 'sql_opt.sqlite');
      await fs.ensureDir(tmpSqlDir);
      await fs.writeFile(
        path.join(tmpSqlDir, '001_counter.sql'),
        'CREATE TABLE IF NOT EXISTS _re_counter (id INTEGER PRIMARY KEY, n INTEGER DEFAULT 0);'
      );
      await fs.writeFile(
        path.join(tmpSqlDir, '002_bump.sql'),
        'INSERT INTO _re_counter (id, n) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET n = n + 1;'
      );

      app = fastify();
      await app.register(plugin, {
        db: { dialect: 'sqlite', storage: sqlDb },
        sqlPath: './tests/tmp_sql',
        sqlTrackMigrations: false,
        modelsPath: null
      });
      await app.ready();
      await app.sequelize.sync();
      await app.sequelize.sync();

      const [rows] = await app.sequelize.instance.query('SELECT n FROM _re_counter WHERE id = 1');
      expect(rows[0].n).to.equal(2);
    });

    it('should continue when sqlFailFast is false', async function () {
      const tmpSqlDir = path.resolve(__dirname, 'tmp_sql');
      const sqlDb = path.resolve(__dirname, 'sql_opt.sqlite');
      await fs.remove(sqlDb).catch(() => {});
      await fs.ensureDir(tmpSqlDir);
      await fs.writeFile(path.join(tmpSqlDir, '001_bad.sql'), 'NOT VALID SQL;');
      await fs.writeFile(
        path.join(tmpSqlDir, '002_ok.sql'),
        'CREATE TABLE IF NOT EXISTS _ok_after_fail (id INTEGER PRIMARY KEY);'
      );

      app = fastify();
      await app.register(plugin, {
        db: { dialect: 'sqlite', storage: sqlDb },
        sqlPath: './tests/tmp_sql',
        sqlFailFast: false,
        sqlTrackMigrations: false,
        modelsPath: null
      });
      await app.ready();
      await app.sequelize.sync();

      const [rows] = await app.sequelize.instance.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='_ok_after_fail'"
      );
      expect(rows).to.have.length(1);
    });
  });
});
