/* eslint-disable */
// migrate-mongo config. CommonJS because the migrate-mongo CLI loads it
// with require(), not import.

require('dotenv').config();

const url = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/digirx';
// Pull the database name out of the URI; migrate-mongo requires it
// separately for its changelog collection.
const dbName = (() => {
  try {
    const u = new URL(url);
    const path = (u.pathname || '/digirx').slice(1).split('?')[0];
    return path || 'digirx';
  } catch {
    return 'digirx';
  }
})();

module.exports = {
  mongodb: {
    url,
    databaseName: dbName,
    options: {},
  },
  migrationsDir: 'migrations',
  changelogCollectionName: 'migrate_changelog',
  lockCollectionName: 'migrate_lock',
  lockTtl: 0, // no lock TTL — long-running migrations should hold the lock
  migrationFileExtension: '.js',
  useFileHash: false,
  moduleSystem: 'commonjs',
};
