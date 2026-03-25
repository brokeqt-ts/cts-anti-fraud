import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Extend browser_type enum with all known antidetect browsers
  // Original enum (migration 006): adspower, dolphin, octo, multilogin, gologin, other
  const newBrowserTypes = [
    'octium',
    'incogniton',
    'undetectable',
    'morelogin',
    'vmlogin',
    'kameleo',
    'indigo',
    'ghost',
    'lalicat',
    'maskfog',
    'hubstudio',
    'ixbrowser',
    'antbrowser',
    'smartproxy',
    'clonbrowser',
    'sessionbox',
    'vision',
    'identory',
    'unknown',
  ];
  for (const val of newBrowserTypes) {
    await knex.raw(`ALTER TYPE browser_type ADD VALUE IF NOT EXISTS '${val}'`);
  }

  // Add profile_name column for human-readable name from extension auto-detection
  await knex.schema.alterTable('antidetect_profiles', (table) => {
    table.string('profile_name');
  });

  // UNIQUE constraint on (browser_type, profile_name) for upsert
  await knex.raw(`
    CREATE UNIQUE INDEX idx_antidetect_profiles_browser_profile
    ON antidetect_profiles (browser_type, profile_name)
    WHERE profile_name IS NOT NULL
  `);

  // UNIQUE constraint on account_consumables to prevent duplicate linkages
  await knex.raw(`
    CREATE UNIQUE INDEX idx_account_consumables_account_profile
    ON account_consumables (account_id, antidetect_profile_id)
    WHERE antidetect_profile_id IS NOT NULL AND unlinked_at IS NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_account_consumables_account_profile');
  await knex.raw('DROP INDEX IF EXISTS idx_antidetect_profiles_browser_profile');
  await knex.schema.alterTable('antidetect_profiles', (table) => {
    table.dropColumn('profile_name');
  });
}
