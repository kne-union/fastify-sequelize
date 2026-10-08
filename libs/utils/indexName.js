const crypto = require('node:crypto');
const { Utils } = require('sequelize');

// Postgres truncates identifiers beyond 63 bytes, while Sequelize sync compares the untruncated
// name and recreates the index on every start ("relation ... already exists").
const PG_MAX_IDENTIFIER_LENGTH = 63;
const HASH_LENGTH = 6;

const shortenIdentifier = (name, maxLength = PG_MAX_IDENTIFIER_LENGTH) => {
  if (name.length <= maxLength) {
    return name;
  }
  const hash = crypto.createHash('sha1').update(name).digest('hex').slice(0, HASH_LENGTH);
  return `${name.slice(0, maxLength - HASH_LENGTH - 1)}_${hash}`;
};

/**
 * Index names are schema-global in postgres / sqlite. Under forcePrefix, explicit names get the
 * table prefix so plugins sharing a database (or renamed tables) do not collide.
 */
const resolveIndexes = ({ indexes, tableName, prefix, forcePrefix, dialect }) => {
  if (!Array.isArray(indexes)) {
    return indexes;
  }
  return indexes.map(index => {
    const hasExplicitName = typeof index.name === 'string' && index.name !== '';
    if (!hasExplicitName && !Array.isArray(index.fields)) {
      return index;
    }
    const baseName = hasExplicitName ? index.name : Utils.nameIndex(Object.assign({}, index), tableName).name;
    let name = baseName;
    if (hasExplicitName && forcePrefix && prefix && !name.startsWith(prefix)) {
      name = `${prefix}${name}`;
    }
    if (dialect === 'postgres') {
      name = shortenIdentifier(name);
    }
    return name === baseName ? index : Object.assign({}, index, { name });
  });
};

module.exports = {
  PG_MAX_IDENTIFIER_LENGTH,
  shortenIdentifier,
  resolveIndexes
};
