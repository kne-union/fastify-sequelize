const { expect } = require('chai');
const { Op } = require('sequelize');
const { buildWhereQuery, buildPaginationQuery, formatPaginationResult } = require('../libs/utils/buildWhereQuery');

describe('@kne/fastify-sequelize', function () {
  describe('buildWhereQuery', function () {
    describe('精确匹配 (exact)', function () {
      it('should match specified fields when filter has values', function () {
        const result = buildWhereQuery({ status: 'active', language: 'zh' }, { exact: ['status', 'language'] });
        expect(result).to.deep.equal({ status: 'active', language: 'zh' });
      });

      it('should ignore undefined / null / empty string values', function () {
        const result = buildWhereQuery({ a: undefined, b: null, c: '', d: 'valid' }, { exact: ['a', 'b', 'c', 'd'] });
        expect(result).to.deep.equal({ d: 'valid' });
      });

      it('should not add condition when filter key is missing', function () {
        const result = buildWhereQuery({}, { exact: ['status'] });
        expect(result).to.deep.equal({});
      });

      it('should treat numeric 0 as a valid exact value', function () {
        const result = buildWhereQuery({ count: 0 }, { exact: ['count'] });
        expect(result).to.deep.equal({ count: 0 });
      });

      it('should treat boolean false as a valid exact value', function () {
        const result = buildWhereQuery({ active: false }, { exact: ['active'] });
        expect(result).to.deep.equal({ active: false });
      });
    });

    describe('模糊匹配 (like)', function () {
      it('should generate like condition when filter has value', function () {
        const result = buildWhereQuery({ name: '面试' }, { like: ['name'] });
        expect(result).to.deep.equal({ name: { [Op.like]: '%面试%' } });
      });

      it('should not generate like condition when value is empty string', function () {
        const result = buildWhereQuery({ name: '' }, { like: ['name'] });
        expect(result).to.deep.equal({});
      });

      it('should support multiple like fields simultaneously', function () {
        const result = buildWhereQuery({ name: '张', email: 'test' }, { like: ['name', 'email'] });
        expect(result).to.deep.equal({
          name: { [Op.like]: '%张%' },
          email: { [Op.like]: '%test%' }
        });
      });

      it('should escape LIKE wildcards in filter values', function () {
        const result = buildWhereQuery({ name: '100%_off' }, { like: ['name'] });
        expect(result).to.deep.equal({ name: { [Op.like]: '%100\\%\\_off%' } });
      });
    });

    describe('精确匹配数组 (Op.in)', function () {
      it('should convert array exact values to Op.in', function () {
        const result = buildWhereQuery({ status: ['open', 'closed'] }, { exact: ['status'] });
        expect(result).to.deep.equal({ status: { [Op.in]: ['open', 'closed'] } });
      });
    });

    describe('显式 in / ne', function () {
      it('should build Op.in from in option with array value', function () {
        const result = buildWhereQuery({ status: ['open', 'closed'] }, { in: ['status'] });
        expect(result).to.deep.equal({ status: { [Op.in]: ['open', 'closed'] } });
      });

      it('should wrap single in value as array', function () {
        const result = buildWhereQuery({ status: 'open' }, { in: ['status'] });
        expect(result).to.deep.equal({ status: { [Op.in]: ['open'] } });
      });

      it('should build Op.ne for scalar ne values', function () {
        const result = buildWhereQuery({ status: 'deleted' }, { ne: ['status'] });
        expect(result).to.deep.equal({ status: { [Op.ne]: 'deleted' } });
      });

      it('should build Op.notIn for array ne values', function () {
        const result = buildWhereQuery({ status: ['deleted', 'archived'] }, { ne: ['status'] });
        expect(result).to.deep.equal({ status: { [Op.notIn]: ['deleted', 'archived'] } });
      });

      it('should treat numeric 0 as valid for ne', function () {
        const result = buildWhereQuery({ count: 0 }, { ne: ['count'] });
        expect(result).to.deep.equal({ count: { [Op.ne]: 0 } });
      });
    });

    describe('比较运算 gt / gte / lt / lte', function () {
      it('should build comparison ops when filter key equals field', function () {
        const result = buildWhereQuery(
          { score: 80, amount: 100 },
          { gt: ['score'], gte: ['amount'] }
        );
        expect(result).to.deep.equal({
          score: { [Op.gt]: 80 },
          amount: { [Op.gte]: 100 }
        });
      });

      it('should support filterKey to column mapping object', function () {
        const result = buildWhereQuery(
          { amountMin: 100, amountMax: 500 },
          { gte: { amountMin: 'amount' }, lte: { amountMax: 'amount' } }
        );
        expect(result.amount).to.deep.equal({ [Op.gte]: 100, [Op.lte]: 500 });
      });

      it('should support lt and gt mapping together', function () {
        const result = buildWhereQuery(
          { minAge: 18, maxAge: 60 },
          { gt: { minAge: 'age' }, lt: { maxAge: 'age' } }
        );
        expect(result.age).to.deep.equal({ [Op.gt]: 18, [Op.lt]: 60 });
      });
    });

    describe('数值区间 (range)', function () {
      it('should generate between when both min and max provided', function () {
        const result = buildWhereQuery({ age: { min: 18, max: 60 } }, { range: { age: true } });
        expect(result).to.deep.equal({ age: { [Op.between]: [18, 60] } });
      });

      it('should accept gte/lte aliases inside range object', function () {
        const result = buildWhereQuery({ price: { gte: 10, lte: 99 } }, { range: ['price'] });
        expect(result).to.deep.equal({ price: { [Op.between]: [10, 99] } });
      });

      it('should generate gte when only min provided', function () {
        const result = buildWhereQuery({ age: { min: 18 } }, { range: { age: true } });
        expect(result).to.deep.equal({ age: { [Op.gte]: 18 } });
      });

      it('should generate lte when only max provided', function () {
        const result = buildWhereQuery({ age: { max: 60 } }, { range: { age: true } });
        expect(result).to.deep.equal({ age: { [Op.lte]: 60 } });
      });

      it('should support mapping filter key to column in range', function () {
        const result = buildWhereQuery(
          { priceRange: { min: 1, max: 9 } },
          { range: { priceRange: 'price' } }
        );
        expect(result).to.deep.equal({ price: { [Op.between]: [1, 9] } });
      });

      it('should allow min 0 as a valid range bound', function () {
        const result = buildWhereQuery({ amount: { min: 0, max: 10 } }, { range: ['amount'] });
        expect(result).to.deep.equal({ amount: { [Op.between]: [0, 10] } });
      });

      it('should ignore empty or non-object range filter values', function () {
        expect(buildWhereQuery({ age: null }, { range: ['age'] })).to.deep.equal({});
        expect(buildWhereQuery({ age: 'x' }, { range: ['age'] })).to.deep.equal({});
        expect(buildWhereQuery({ age: {} }, { range: ['age'] })).to.deep.equal({});
      });
    });

    describe('in / ne / 比较边界', function () {
      it('should ignore empty in and ne values', function () {
        expect(buildWhereQuery({ status: '' }, { in: ['status'], ne: ['status'] })).to.deep.equal({});
        expect(buildWhereQuery({}, { in: ['status'], ne: ['type'] })).to.deep.equal({});
      });

      it('should combine in/ne/range/exact in one query', function () {
        const result = buildWhereQuery(
          {
            status: ['open'],
            type: 'draft',
            age: { min: 18, max: 30 },
            language: 'zh'
          },
          {
            in: ['status'],
            ne: ['type'],
            range: ['age'],
            exact: ['language']
          }
        );
        expect(result.status).to.deep.equal({ [Op.in]: ['open'] });
        expect(result.type).to.deep.equal({ [Op.ne]: 'draft' });
        expect(result.age).to.deep.equal({ [Op.between]: [18, 30] });
        expect(result.language).to.equal('zh');
      });
    });

    describe('默认条件 (defaults)', function () {
      it('should merge defaults into query', function () {
        const result = buildWhereQuery({}, { defaults: { type: 'main', status: 1 } });
        expect(result).to.deep.equal({ type: 'main', status: 1 });
      });

      it('should override defaults when filter hits the same field', function () {
        const result = buildWhereQuery({ status: 2 }, { exact: ['status'], defaults: { status: 1, type: 'main' } });
        expect(result).to.deep.equal({ status: 2, type: 'main' });
      });
    });

    describe('多字段 OR 查询 (orFields)', function () {
      it('should generate fuzzy OR conditions when mode is fuzzy', function () {
        const result = buildWhereQuery({ keyword: '张' }, {
          orFields: { keyword: { fields: ['name', 'email', 'phone'], mode: 'fuzzy' } }
        });
        expect(result).to.deep.equal({
          [Op.or]: [
            { name: { [Op.like]: '%张%' } },
            { email: { [Op.like]: '%张%' } },
            { phone: { [Op.like]: '%张%' } }
          ]
        });
      });

      it('should generate exact OR conditions when mode is exact', function () {
        const result = buildWhereQuery({ status: 'active' }, {
          orFields: { status: { fields: ['status', 'reviewStatus'], mode: 'exact' } }
        });
        expect(result).to.deep.equal({
          [Op.or]: [
            { status: 'active' },
            { reviewStatus: 'active' }
          ]
        });
      });

      it('should support shorthand string form for orFields', function () {
        const result = buildWhereQuery({ keyword: '张' }, {
          orFields: { keyword: 'name' }
        });
        expect(result).to.deep.equal({
          [Op.or]: [{ name: { [Op.like]: '%张%' } }]
        });
      });

      it('should default to fuzzy mode when mode is not specified', function () {
        const result = buildWhereQuery({ keyword: '张' }, {
          orFields: { keyword: { fields: ['name'] } }
        });
        expect(result).to.deep.equal({
          [Op.or]: [{ name: { [Op.like]: '%张%' } }]
        });
      });

      it('should not generate OR condition when filter value is empty', function () {
        const result = buildWhereQuery({ keyword: '' }, {
          orFields: { keyword: { fields: ['name'], mode: 'fuzzy' } }
        });
        expect(result).to.deep.equal({});
      });

      it('should combine multiple orFields entries with AND when more than one', function () {
        const result = buildWhereQuery({ keyword: '张', status: 'active' }, {
          orFields: {
            keyword: { fields: ['name', 'email'], mode: 'fuzzy' },
            status: { fields: ['status', 'reviewStatus'], mode: 'exact' }
          }
        });
        expect(result[Op.and]).to.exist;
        expect(result[Op.and]).to.have.length(2);
        expect(result[Op.and][0]).to.deep.equal({
          [Op.or]: [{ name: { [Op.like]: '%张%' } }, { email: { [Op.like]: '%张%' } }]
        });
        expect(result[Op.and][1]).to.deep.equal({
          [Op.or]: [{ status: 'active' }, { reviewStatus: 'active' }]
        });
      });

      it('should use single Op.or when only one orFields entry', function () {
        const result = buildWhereQuery({ keyword: '张' }, {
          orFields: { keyword: { fields: ['name'], mode: 'fuzzy' } }
        });
        expect(result[Op.or]).to.exist;
        expect(result[Op.and]).to.be.undefined;
      });
    });

    describe('时间范围查询 (timeRange)', function () {
      it('should generate between condition when both startTime and endTime provided', function () {
        const result = buildWhereQuery(
          { createdAt: { startTime: '2024-01-01', endTime: '2024-12-31' } },
          { timeRange: { createdAt: true } }
        );
        expect(result.createdAt[Op.between]).to.exist;
        expect(result.createdAt[Op.between].map(d => d.toISOString())).to.deep.equal([
          new Date('2024-01-01').toISOString(),
          new Date('2024-12-31').toISOString()
        ]);
      });

      it('should generate gte condition when only startTime provided', function () {
        const result = buildWhereQuery(
          { createdAt: { startTime: '2024-06-01' } },
          { timeRange: { createdAt: true } }
        );
        expect(result.createdAt[Op.gte]).to.exist;
        expect(result.createdAt[Op.gte].toISOString()).to.equal(new Date('2024-06-01').toISOString());
      });

      it('should generate lte condition when only endTime provided', function () {
        const result = buildWhereQuery(
          { createdAt: { endTime: '2024-12-31' } },
          { timeRange: { createdAt: true } }
        );
        expect(result.createdAt[Op.lte]).to.exist;
        expect(result.createdAt[Op.lte].toISOString()).to.equal(new Date('2024-12-31').toISOString());
      });

      it('should not generate condition when filter has no matching time field', function () {
        const result = buildWhereQuery({}, { timeRange: { createdAt: true } });
        expect(result).to.deep.equal({});
      });
    });

    describe('大小写不敏感 (caseInsensitive)', function () {
      it('should use iLike when global caseInsensitive is true', function () {
        const result = buildWhereQuery({ name: 'test' }, { like: ['name'], caseInsensitive: true });
        expect(result).to.deep.equal({ name: { [Op.iLike]: '%test%' } });
      });

      it('should use like when global caseInsensitive is false', function () {
        const result = buildWhereQuery({ name: 'test' }, { like: ['name'], caseInsensitive: false });
        expect(result).to.deep.equal({ name: { [Op.like]: '%test%' } });
      });

      it('should override global caseInsensitive with field-level setting in orFields', function () {
        const result = buildWhereQuery({ keyword: 'test' }, {
          caseInsensitive: false,
          orFields: { keyword: { fields: ['name'], caseInsensitive: true } }
        });
        expect(result).to.deep.equal({
          [Op.or]: [{ name: { [Op.iLike]: '%test%' } }]
        });
      });

      it('should override global true with field-level false in orFields', function () {
        const result = buildWhereQuery({ keyword: 'test' }, {
          caseInsensitive: true,
          orFields: { keyword: { fields: ['name'], caseInsensitive: false } }
        });
        expect(result).to.deep.equal({
          [Op.or]: [{ name: { [Op.like]: '%test%' } }]
        });
      });
    });

    describe('组合查询', function () {
      it('should combine exact + like + defaults + orFields + timeRange correctly', function () {
        const result = buildWhereQuery(
          {
            status: 'open',
            name: '项目',
            keyword: '搜索',
            createdAt: { startTime: '2024-01-01', endTime: '2024-12-31' }
          },
          {
            defaults: { type: 'main' },
            exact: ['status'],
            like: ['name'],
            orFields: { keyword: { fields: ['name', 'description'], mode: 'fuzzy' } },
            timeRange: { createdAt: true }
          }
        );
        expect(result.type).to.equal('main');
        expect(result.status).to.equal('open');
        expect(result.name).to.deep.equal({ [Op.like]: '%项目%' });
        expect(result[Op.or]).to.exist;
        expect(result.createdAt[Op.between]).to.exist;
      });
    });

    describe('边界情况', function () {
      it('should return empty object when filter and options are empty', function () {
        const result = buildWhereQuery({}, {});
        expect(result).to.deep.equal({});
      });

      it('should use default options when options is not provided', function () {
        const result = buildWhereQuery({ name: 'test' });
        expect(result).to.deep.equal({});
      });
    });
  });

  describe('buildPaginationQuery', function () {
    it('should use default values when no custom params provided', function () {
      const result = buildPaginationQuery({ filter: {}, options: {} });
      expect(result.where).to.deep.equal({});
      expect(result.limit).to.equal(20);
      expect(result.offset).to.equal(0);
      expect(result.order).to.deep.equal([['createdAt', 'DESC']]);
    });

    it('should calculate offset correctly when custom perPage and currentPage provided', function () {
      const result = buildPaginationQuery({ filter: {}, options: {}, perPage: 10, currentPage: 3 });
      expect(result.limit).to.equal(10);
      expect(result.offset).to.equal(20);
    });

    it('should accept perPage at max 1000', function () {
      const result = buildPaginationQuery({ filter: {}, options: {}, perPage: 1000, currentPage: 1 });
      expect(result.limit).to.equal(1000);
      expect(result.offset).to.equal(0);
    });

    it('should accept numeric strings for page params', function () {
      const result = buildPaginationQuery({ filter: {}, options: {}, perPage: '15', currentPage: '2' });
      expect(result.limit).to.equal(15);
      expect(result.offset).to.equal(15);
    });

    it('should throw when perPage is below 1', function () {
      expect(() => buildPaginationQuery({ filter: {}, options: {}, perPage: 0 })).to.throw(/perPage/);
      expect(() => buildPaginationQuery({ filter: {}, options: {}, perPage: -1 })).to.throw(/perPage/);
    });

    it('should throw when perPage exceeds 1000', function () {
      expect(() => buildPaginationQuery({ filter: {}, options: {}, perPage: 1001 })).to.throw(/1000/);
    });

    it('should throw when currentPage is below 1', function () {
      expect(() => buildPaginationQuery({ filter: {}, options: {}, currentPage: 0 })).to.throw(/currentPage/);
      expect(() => buildPaginationQuery({ filter: {}, options: {}, currentPage: -2 })).to.throw(/currentPage/);
    });

    it('should throw when page params are not integers', function () {
      expect(() => buildPaginationQuery({ filter: {}, options: {}, perPage: 10.5 })).to.throw(/perPage/);
      expect(() => buildPaginationQuery({ filter: {}, options: {}, currentPage: 'abc' })).to.throw(/currentPage/);
      expect(() => buildPaginationQuery({ filter: {}, options: {}, perPage: NaN })).to.throw(/perPage/);
    });

    it('should use custom order when provided', function () {
      const result = buildPaginationQuery({ filter: {}, options: {}, order: [['id', 'ASC']] });
      expect(result.order).to.deep.equal([['id', 'ASC']]);
    });

    it('should include where conditions from buildWhereQuery', function () {
      const result = buildPaginationQuery({
        filter: { status: 'active', name: 'test' },
        options: { exact: ['status'], like: ['name'] }
      });
      expect(result.where.status).to.equal('active');
      expect(result.where.name).to.deep.equal({ [Op.like]: '%test%' });
    });

    it('should pass through in/ne/range options into where', function () {
      const result = buildPaginationQuery({
        filter: {
          status: ['open'],
          type: 'x',
          age: { min: 1, max: 2 }
        },
        options: { in: ['status'], ne: ['type'], range: ['age'] },
        perPage: 5,
        currentPage: 2
      });
      expect(result.where.status).to.deep.equal({ [Op.in]: ['open'] });
      expect(result.where.type).to.deep.equal({ [Op.ne]: 'x' });
      expect(result.where.age).to.deep.equal({ [Op.between]: [1, 2] });
      expect(result.limit).to.equal(5);
      expect(result.offset).to.equal(5);
    });

    it('should merge queryOptions into result', function () {
      const include = [{ model: {} }];
      const result = buildPaginationQuery({
        filter: {},
        options: {},
        queryOptions: { include }
      });
      expect(result.include).to.deep.equal(include);
    });
  });

  describe('formatPaginationResult', function () {
    it('should map rows to pageData and count to totalCount', function () {
      const rows = [{ id: 1 }, { id: 2 }];
      const result = formatPaginationResult({ rows, count: 100 });
      expect(result).to.deep.equal({ pageData: rows, totalCount: 100 });
    });

    it('should handle empty list', function () {
      const result = formatPaginationResult({ rows: [], count: 0 });
      expect(result).to.deep.equal({ pageData: [], totalCount: 0 });
    });
  });
});
