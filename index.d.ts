import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type {
  DataTypes,
  Model,
  ModelStatic,
  Options as SequelizeOptions,
  Sequelize,
  SyncOptions,
  Transaction
} from 'sequelize';

export type ModelsBag = Record<string, ModelStatic<Model>>;

export type FieldMap = string[] | Record<string, string | true>;

export interface OrFieldConfig {
  fields: string[];
  mode?: 'fuzzy' | 'exact';
  caseInsensitive?: boolean;
}

export interface BuildWhereQueryOptions {
  exact?: string[];
  like?: string[];
  in?: string[];
  ne?: string[];
  gt?: FieldMap;
  gte?: FieldMap;
  lt?: FieldMap;
  lte?: FieldMap;
  range?: FieldMap;
  defaults?: Record<string, unknown>;
  orFields?: Record<string, string | OrFieldConfig>;
  timeRange?: Record<string, unknown>;
  caseInsensitive?: boolean;
}

export interface BuildPaginationQueryParams {
  filter?: Record<string, unknown>;
  options?: BuildWhereQueryOptions;
  /** 每页条数，默认 20，范围 1–1000；非法抛错 */
  perPage?: number | string;
  /** 当前页码，默认 1，须 ≥ 1；非法抛错 */
  currentPage?: number | string;
  order?: Array<[string, string] | string[]>;
  queryOptions?: Record<string, unknown>;
}

export interface PaginationResult<T = unknown> {
  pageData: T[];
  totalCount: number;
}

export interface SequelizeUtils {
  buildWhereQuery: (filter?: Record<string, unknown>, options?: BuildWhereQueryOptions) => Record<string | symbol, unknown>;
  buildPaginationQuery: (params: BuildPaginationQueryParams) => Record<string, unknown>;
  formatPaginationResult: <T = unknown>(result: { rows: T[]; count: number }) => PaginationResult<T>;
}

export interface SnowflakeConfig {
  instance_id?: number;
  custom_epoch?: number;
}

export interface ConnectionOverrides {
  db?: SequelizeOptions;
  modelsPath?: string | null;
  sqlPath?: string | false | null;
  sqlTrackMigrations?: boolean;
  sqlFailFast?: boolean;
  runSqlOnSync?: boolean;
  prefix?: string;
  modelPrefix?: string;
  name?: string;
  glob?: Record<string, unknown>;
  syncOptions?: SyncOptions;
  [key: string]: unknown;
}

/** 静态连接配置：直接传 Sequelize options，或带 db 的完整覆盖项 */
export type ConnectionInput = SequelizeOptions | ConnectionOverrides;

export interface TenantPoolOptions {
  maxInstances?: number;
  /** 设为 0 关闭空闲回收 */
  idleTimeoutMs?: number;
}

export interface FastifySequelizeOptions {
  db?: SequelizeOptions;
  snowflake?: SnowflakeConfig;
  modelsPath?: string | null;
  sqlPath?: string | false | null;
  sqlTrackMigrations?: boolean;
  sqlFailFast?: boolean;
  runSqlOnSync?: boolean;
  prefix?: string;
  modelPrefix?: string;
  /** 默认库模型挂载名，默认 `models` */
  name?: string;
  glob?: Record<string, unknown>;
  syncOptions?: SyncOptions;
  connections?: Record<string, ConnectionInput>;
  getTenantDb?: (tenantId: string) => ConnectionInput | Promise<ConnectionInput | null | undefined>;
  tenantPool?: TenantPoolOptions;
}

export interface AddModelsOptions {
  modelPrefix?: string;
  prefix?: string;
  /** 指定命名连接；推荐改用 connection(name).addModels */
  connection?: string;
  pattern?: string;
  ignore?: string | string[];
  [key: string]: unknown;
}

export interface SyncMethodOptions extends SyncOptions {
  /** 指定命名连接；推荐改用 connection(name).sync */
  connection?: string;
}

export type ModelDefinitionFactory = (ctx: {
  sequelize: Sequelize;
  DataTypes: typeof DataTypes;
  definePrimaryType: (name: string, props?: Record<string, unknown>) => Record<string, unknown>;
  fastify: FastifyInstance;
  options: Record<string, unknown>;
}) => {
  name?: string;
  model: Record<string, unknown>;
  associate?: (db: ModelsBag, fastify: FastifyInstance, options?: SyncMethodOptions) => void;
  options?: Record<string, unknown>;
};

export type ModelsPathInput = string | ModelDefinitionFactory;

export interface SequelizeConnection {
  name: string;
  instance: Sequelize;
  Sequelize: typeof Sequelize;
  utils: SequelizeUtils;
  models?: ModelsBag;
  addModels: (modelsPath: ModelsPathInput, options?: AddModelsOptions) => Promise<ModelsBag>;
  sync: (options?: SyncOptions) => Promise<void>;
  transaction: Sequelize['transaction'];
  syncPromise: Promise<void>;
  generateId: () => string | bigint | number;
  /** 当 name 配置不为 models 时，模型也可能挂在该动态键上 */
  [key: string]: unknown;
}

/**
 * `fastify.sequelize` —— 始终表示默认库。
 * 其它库请使用 connection(name) / forTenant(id)。
 */
export interface FastifySequelizeNamespace {
  instance: Sequelize;
  Sequelize: typeof Sequelize;
  utils: SequelizeUtils;
  /** 默认库自动加载的模型（modelsPath 有效且 name 为默认值时） */
  models?: ModelsBag;
  addModels: (modelsPath: ModelsPathInput, options?: AddModelsOptions) => Promise<ModelsBag>;
  sync: (options?: SyncMethodOptions) => Promise<void>;
  syncAll: (options?: SyncOptions) => Promise<void>;
  syncPromise: Promise<void>;
  transaction: Sequelize['transaction'];
  generateId: () => string | bigint | number;
  /** 获取其它库；不可传 default */
  connection: (name: string) => SequelizeConnection;
  /** connection 的别名 */
  getConnection: (name: string) => SequelizeConnection;
  forTenant: (tenantId: string) => Promise<SequelizeConnection>;
  listConnections: () => string[];
  /** 当 options.name 自定义时，模型挂在该键上 */
  [key: string]: unknown;
}

declare module 'fastify' {
  interface FastifyInstance {
    sequelize: FastifySequelizeNamespace;
  }
}

declare const fastifySequelize: FastifyPluginAsync<FastifySequelizeOptions>;

export default fastifySequelize;
export { fastifySequelize };
