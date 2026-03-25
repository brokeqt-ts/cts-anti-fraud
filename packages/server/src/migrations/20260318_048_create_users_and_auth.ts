import type { Knex } from 'knex';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';

const BCRYPT_COST = 12;

export async function up(knex: Knex): Promise<void> {
  // 1. Create users table
  const hasUsers = await knex.schema.hasTable('users');
  if (!hasUsers) {
    await knex.schema.createTable('users', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('name').notNullable();
      table.text('email').notNullable().unique();
      table.text('password_hash').notNullable();
      table.text('role').notNullable().defaultTo('buyer');
      table.text('api_key').unique();
      table.text('api_key_scope').notNullable().defaultTo('collect_only');
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamp('last_login_at', { useTz: true });
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    await knex.raw(`
      CREATE TRIGGER update_users_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
    `);
  }

  // 2. Create refresh_tokens table
  const hasRefreshTokens = await knex.schema.hasTable('refresh_tokens');
  if (!hasRefreshTokens) {
    await knex.schema.createTable('refresh_tokens', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.text('token_hash').notNullable().unique();
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    // token_hash UNIQUE constraint already creates an index — no separate index needed
    await knex.raw('CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id)');
    await knex.raw('CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at)');
  }

  // 3. Add user_id to accounts
  const hasAccountsUserId = await knex.schema.hasColumn('accounts', 'user_id');
  if (!hasAccountsUserId) {
    await knex.schema.alterTable('accounts', (table) => {
      table.uuid('user_id').references('id').inTable('users');
    });
    await knex.raw('CREATE INDEX idx_accounts_user_id ON accounts(user_id)');
  }

  // 4. Add user_id to raw_payloads
  const hasRawPayloadsUserId = await knex.schema.hasColumn('raw_payloads', 'user_id');
  if (!hasRawPayloadsUserId) {
    await knex.schema.alterTable('raw_payloads', (table) => {
      table.uuid('user_id').references('id').inTable('users');
    });
    await knex.raw('CREATE INDEX idx_raw_payloads_user_id ON raw_payloads(user_id)');
  }

  // 5. Seed admin user
  if (!process.env['ADMIN_PASSWORD']) {
    console.warn('WARNING: ADMIN_PASSWORD not set — using default "changeme". Change immediately in production!');
  }
  const adminPassword = process.env['ADMIN_PASSWORD'] || 'changeme';
  const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_COST);
  const apiKey = 'cts_' + crypto.randomBytes(32).toString('hex');

  const existing = await knex('users').where('email', 'admin@cts.local').first();
  if (!existing) {
    const [admin] = await knex('users')
      .insert({
        name: 'Admin',
        email: 'admin@cts.local',
        password_hash: passwordHash,
        role: 'admin',
        api_key: apiKey,
        api_key_scope: 'full',
      })
      .returning('id');

    const adminId = (admin as { id: string }).id;

    // 6. Bind existing accounts and raw_payloads to admin
    await knex('accounts').whereNull('user_id').update({ user_id: adminId });
    await knex('raw_payloads').whereNull('user_id').update({ user_id: adminId });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Remove user_id from raw_payloads
  const hasRawPayloadsUserId = await knex.schema.hasColumn('raw_payloads', 'user_id');
  if (hasRawPayloadsUserId) {
    await knex.raw('DROP INDEX IF EXISTS idx_raw_payloads_user_id');
    await knex.schema.alterTable('raw_payloads', (table) => {
      table.dropColumn('user_id');
    });
  }

  // Remove user_id from accounts
  const hasAccountsUserId = await knex.schema.hasColumn('accounts', 'user_id');
  if (hasAccountsUserId) {
    await knex.raw('DROP INDEX IF EXISTS idx_accounts_user_id');
    await knex.schema.alterTable('accounts', (table) => {
      table.dropColumn('user_id');
    });
  }

  // Drop refresh_tokens
  await knex.schema.dropTableIfExists('refresh_tokens');

  // Drop users
  await knex.raw('DROP TRIGGER IF EXISTS update_users_updated_at ON users');
  await knex.schema.dropTableIfExists('users');
}
