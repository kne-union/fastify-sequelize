const { Op } = require('sequelize');

const defaultOptions = {
  exact: [],
  like: [],
  in: [],
  ne: [],
  gt: [],
  gte: [],
  lt: [],
  lte: [],
  range: {},
  defaults: {},
  orFields: {},
  timeRange: {},
  caseInsensitive: false
};

const escapeLikeValue = value => String(value).replace(/[\\%_]/g, '\\$&');

const hasFilterValue = value => value !== undefined && value !== null && value !== '';

const buildLikeCondition = (value, likeOp) => ({
  [likeOp]: `%${escapeLikeValue(value)}%`
});

const buildExactCondition = value => {
  if (Array.isArray(value)) {
    return { [Op.in]: value };
  }
  return value;
};

/** string[] → { field: field }；Object → { filterKey: columnName }（值为 true 时列名=filterKey） */
const normalizeFieldMap = config => {
  if (!config) {
    return {};
  }
  if (Array.isArray(config)) {
    return Object.fromEntries(config.map(key => [key, key]));
  }
  const result = {};
  Object.entries(config).forEach(([key, value]) => {
    result[key] = value === true ? key : value;
  });
  return result;
};

const assignOp = (whereQuery, field, op, value) => {
  const prev = whereQuery[field];
  if (prev && typeof prev === 'object' && !Array.isArray(prev)) {
    whereQuery[field] = Object.assign({}, prev, { [op]: value });
  } else {
    whereQuery[field] = { [op]: value };
  }
};

const applyComparisonOps = (whereQuery, filter, fieldMap, op) => {
  Object.entries(fieldMap).forEach(([filterKey, field]) => {
    if (hasFilterValue(filter?.[filterKey])) {
      assignOp(whereQuery, field, op, filter[filterKey]);
    }
  });
};

const buildWhereQuery = (filter, options = {}) => {
  const opts = Object.assign({}, defaultOptions, options);
  const whereQuery = { ...opts.defaults };
  const caseInsensitive = opts.caseInsensitive;
  const likeOp = caseInsensitive ? Op.iLike : Op.like;

  // 精确匹配（数组自动转为 Op.in）
  opts.exact.forEach(key => {
    if (hasFilterValue(filter?.[key])) {
      whereQuery[key] = buildExactCondition(filter[key]);
    }
  });

  // 显式 IN（单值也会包成数组）
  opts.in.forEach(key => {
    if (hasFilterValue(filter?.[key])) {
      const value = filter[key];
      whereQuery[key] = { [Op.in]: Array.isArray(value) ? value : [value] };
    }
  });

  // 不等于 / NOT IN
  opts.ne.forEach(key => {
    if (hasFilterValue(filter?.[key])) {
      const value = filter[key];
      whereQuery[key] = Array.isArray(value) ? { [Op.notIn]: value } : { [Op.ne]: value };
    }
  });

  // 比较：gt / gte / lt / lte（支持 string[] 或 { filterKey: column }）
  applyComparisonOps(whereQuery, filter, normalizeFieldMap(opts.gt), Op.gt);
  applyComparisonOps(whereQuery, filter, normalizeFieldMap(opts.gte), Op.gte);
  applyComparisonOps(whereQuery, filter, normalizeFieldMap(opts.lt), Op.lt);
  applyComparisonOps(whereQuery, filter, normalizeFieldMap(opts.lte), Op.lte);

  // 模糊匹配（转义 % / _ / \，避免用户输入扩大匹配）
  opts.like.forEach(key => {
    if (filter?.[key]) {
      whereQuery[key] = buildLikeCondition(filter[key], likeOp);
    }
  });

  // 多字段 OR 查询（支持精确和模糊模式）
  // 收集所有 OR 组，多个 OR 组之间用 AND 连接
  const orConditions = [];
  Object.entries(opts.orFields).forEach(([filterKey, fieldConfig]) => {
    if (hasFilterValue(filter?.[filterKey])) {
      const {
        fields,
        mode = 'fuzzy',
        caseInsensitive: fieldCaseInsensitive
      } = typeof fieldConfig === 'string' ? { fields: [fieldConfig], mode: 'fuzzy' } : fieldConfig;
      const fieldLikeOp =
        fieldCaseInsensitive !== undefined ? (fieldCaseInsensitive ? Op.iLike : Op.like) : likeOp;

      orConditions.push(
        fields.map(field => {
          if (mode === 'exact') {
            return { [field]: buildExactCondition(filter[filterKey]) };
          }
          return { [field]: buildLikeCondition(filter[filterKey], fieldLikeOp) };
        })
      );
    }
  });

  if (orConditions.length === 1) {
    whereQuery[Op.or] = orConditions[0];
  } else if (orConditions.length > 1) {
    whereQuery[Op.and] = orConditions.map(group => ({ [Op.or]: group }));
  }

  // 时间范围查询
  Object.entries(opts.timeRange).forEach(([field]) => {
    if (filter?.[field]) {
      const { startTime, endTime } = filter[field];
      if (startTime && endTime) {
        whereQuery[field] = { [Op.between]: [new Date(startTime), new Date(endTime)] };
      } else if (startTime) {
        whereQuery[field] = { [Op.gte]: new Date(startTime) };
      } else if (endTime) {
        whereQuery[field] = { [Op.lte]: new Date(endTime) };
      }
    }
  });

  // 数值区间：filter[field] = { min, max }（也接受 gte/lte 别名）
  Object.entries(normalizeFieldMap(opts.range)).forEach(([filterKey, field]) => {
    const rangeValue = filter?.[filterKey];
    if (!rangeValue || typeof rangeValue !== 'object' || Array.isArray(rangeValue)) {
      return;
    }
    const min = rangeValue.min ?? rangeValue.gte;
    const max = rangeValue.max ?? rangeValue.lte;
    if (hasFilterValue(min) && hasFilterValue(max)) {
      whereQuery[field] = { [Op.between]: [min, max] };
    } else if (hasFilterValue(min)) {
      assignOp(whereQuery, field, Op.gte, min);
    } else if (hasFilterValue(max)) {
      assignOp(whereQuery, field, Op.lte, max);
    }
  });

  return whereQuery;
};

const MAX_PER_PAGE = 1000;

const parsePositiveInt = (value, name) => {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`Invalid ${name}: expected an integer, got ${JSON.stringify(value)}`);
  }
  return n;
};

/**
 * 构建分页查询选项
 * @param {Object} params - 查询参数
 * @param {Object} params.filter - 过滤条件
 * @param {Object} params.options - buildWhereQuery 配置
 * @param {string[]} params.options.exact - 精确匹配字段（默认 []）
 * @param {string[]} params.options.like - 模糊匹配字段（默认 []）
 * @param {string[]} params.options.in - IN 匹配字段（默认 []）
 * @param {string[]} params.options.ne - 不等于 / NOT IN 字段（默认 []）
 * @param {string[]|Object} params.options.gt - 大于（默认 []）
 * @param {string[]|Object} params.options.gte - 大于等于（默认 []）
 * @param {string[]|Object} params.options.lt - 小于（默认 []）
 * @param {string[]|Object} params.options.lte - 小于等于（默认 []）
 * @param {string[]|Object} params.options.range - 数值区间字段（默认 {}）
 * @param {Object} params.options.defaults - 默认值（默认 {}）
 * @param {Object} params.options.orFields - OR 查询配置（默认 {}）
 * @param {Object} params.options.timeRange - 时间范围配置（默认 {}）
 * @param {boolean} params.options.caseInsensitive - 大小写不敏感（默认 false）
 * @param {number} params.perPage - 每页条数（默认 20，范围 1–1000）
 * @param {number} params.currentPage - 当前页码（默认 1，须 ≥ 1）
 * @param {Array} params.order - 排序配置（默认 [['createdAt', 'DESC']]）
 * @param {Object} [params.queryOptions] - 额外 Sequelize 查询选项（如 include）
 * @returns {Object} Sequelize 查询选项，包含 where / limit / offset / order
 */
const buildPaginationQuery = ({
  filter,
  options = {},
  perPage = 20,
  currentPage = 1,
  order = [['createdAt', 'DESC']],
  queryOptions = {}
}) => {
  const where = buildWhereQuery(filter, options);
  const limit = parsePositiveInt(perPage, 'perPage');
  const page = parsePositiveInt(currentPage, 'currentPage');

  if (limit < 1 || limit > MAX_PER_PAGE) {
    throw new Error(`Invalid perPage: must be between 1 and ${MAX_PER_PAGE}, got ${limit}`);
  }
  if (page < 1) {
    throw new Error(`Invalid currentPage: must be >= 1, got ${page}`);
  }

  const offset = (page - 1) * limit;

  return {
    where,
    limit,
    offset,
    order,
    ...queryOptions
  };
};

/**
 * 格式化分页查询结果
 * @param {Object} result - Sequelize findAndCountAll 返回值
 * @param {Array} result.rows - 数据行
 * @param {number} result.count - 总条数
 * @returns {{ pageData: Array, totalCount: number }}
 */
const formatPaginationResult = ({ rows, count }) => {
  return {
    pageData: rows,
    totalCount: count
  };
};

module.exports = {
  buildWhereQuery,
  buildPaginationQuery,
  formatPaginationResult,
  escapeLikeValue,
  MAX_PER_PAGE
};
