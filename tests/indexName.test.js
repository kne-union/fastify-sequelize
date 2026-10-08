const { expect } = require('chai');
const fastify = require('fastify');
const plugin = require('../index');
const { shortenIdentifier, resolveIndexes, PG_MAX_IDENTIFIER_LENGTH } = require('../libs/utils/indexName');

// Lets Sequelize build a postgres dialect without the pg driver or a live connection.
const fakePg = { types: { setTypeParser() {}, getTypeParser() {} } };

const folderTagModel = ({ DataTypes }) => ({
  name: 'fileManagerFolderTag',
  model: {
    tenantId: DataTypes.STRING,
    type: DataTypes.STRING,
    code: DataTypes.STRING,
    language: DataTypes.STRING
  },
  options: {
    indexes: [
      { unique: true, fields: ['tenant_id', 'type', 'code', 'language'] },
      { name: 'idx_folder_tag_code', fields: ['code'] }
    ]
  }
});

describe('index name normalization', function () {
  describe('shortenIdentifier', function () {
    it('should keep names within the postgres limit', function () {
      const name = 'a'.repeat(PG_MAX_IDENTIFIER_LENGTH);
      expect(shortenIdentifier(name)).to.equal(name);
    });

    it('should shorten long names to a stable 63-char name', function () {
      const name = 't_talent_saas_file_manager_folder_tag_tenant_id_type_code_language';
      const shortened = shortenIdentifier(name);
      expect(shortened).to.have.lengthOf(PG_MAX_IDENTIFIER_LENGTH);
      expect(shortened).to.equal(shortenIdentifier(name));
      expect(shortened).to.match(/^t_talent_saas_file_manager_folder_tag_tenant_id_type_cod_[0-9a-f]{6}$/);
    });

    it('should keep shortened names distinct for different long names', function () {
      const a = shortenIdentifier(`${'x'.repeat(60)}_alpha`);
      const b = shortenIdentifier(`${'x'.repeat(60)}_beta`);
      expect(a).to.not.equal(b);
    });
  });

  describe('resolveIndexes', function () {
    it('should return the same index objects when nothing changes', function () {
      const indexes = [{ fields: ['code'] }, { name: 'idx_code', fields: ['code'] }];
      const result = resolveIndexes({ indexes, tableName: 't_tag', prefix: 't_', forcePrefix: false, dialect: 'sqlite' });
      expect(result[0]).to.equal(indexes[0]);
      expect(result[1]).to.equal(indexes[1]);
    });

    it('should prefix explicit names only under forcePrefix', function () {
      const indexes = [
        { name: 'idx_code', fields: ['code'] },
        { name: 't_app_idx_type', fields: ['type'] }
      ];
      const result = resolveIndexes({ indexes, tableName: 't_app_tag', prefix: 't_app_', forcePrefix: true, dialect: 'sqlite' });
      expect(result.map(i => i.name)).to.deep.equal(['t_app_idx_code', 't_app_idx_type']);
    });

    it('should not shorten names outside postgres', function () {
      const indexes = [{ fields: ['tenant_id', 'type', 'code', 'language'] }];
      const result = resolveIndexes({
        indexes,
        tableName: 't_talent_saas_file_manager_folder_tag',
        prefix: 't_talent_saas_',
        forcePrefix: true,
        dialect: 'sqlite'
      });
      expect(result[0]).to.equal(indexes[0]);
    });
  });

  describe('addModels', function () {
    let app;

    afterEach(async function () {
      if (app) {
        await app.close();
        app = null;
      }
    });

    it('should give postgres models index names that fit the identifier limit', async function () {
      app = fastify();
      await app.register(plugin, {
        db: { dialect: 'postgres', dialectModule: fakePg },
        prefix: 't_talent_saas_',
        forcePrefix: true
      });
      await app.ready();
      const db = await app.sequelize.addModels(folderTagModel);
      const names = db.fileManagerFolderTag._indexes.map(i => i.name);
      expect(names[0]).to.match(/^t_talent_saas_file_manager_folder_tag_tenant_id_type_cod_[0-9a-f]{6}$/);
      expect(names[1]).to.equal('t_talent_saas_idx_folder_tag_code');
      names.forEach(name => expect(name.length).to.be.at.most(PG_MAX_IDENTIFIER_LENGTH));
    });

    it('should keep index names unchanged without forcePrefix on sqlite', async function () {
      app = fastify();
      await app.register(plugin, {
        db: { dialect: 'sqlite', storage: ':memory:' },
        prefix: 't_talent_saas_',
        forcePrefix: false
      });
      await app.ready();
      const db = await app.sequelize.addModels(folderTagModel);
      expect(db.fileManagerFolderTag._indexes.map(i => i.name)).to.deep.equal(['t_talent_saas_file_manager_folder_tag_tenant_id_type_code_language', 'idx_folder_tag_code']);
    });
  });
});
