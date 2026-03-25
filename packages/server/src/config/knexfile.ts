import type { Knex } from 'knex';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const isCompiledJs = __filename.endsWith('.js');

const config: Knex.Config = {
  client: 'pg',
  connection: process.env['DATABASE_URL'],
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
