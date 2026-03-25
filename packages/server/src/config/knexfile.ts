import type { Knex } from 'knex';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const isCompiledJs = __filename.endsWith('.js');

const isProduction = process.env['NODE_ENV'] === 'production';

const config: Knex.Config = {
  client: 'pg',
  connection: {
    connectionString: process.env['DATABASE_URL'],
    ssl: isProduction ? { rejectUnauthorized: false } : false,
  },
  migrations: {
    directory: path.resolve(__dirname, '../migrations'),
    extension: isCompiledJs ? 'js' : 'ts',
    loadExtensions: isCompiledJs ? ['.js'] : ['.ts'],
  },
  pool: {
    min: 2,
    max: 10,
  },
};

export default config;
