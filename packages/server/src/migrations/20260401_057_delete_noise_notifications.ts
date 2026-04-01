import type { Knex } from 'knex';

/**
 * Migration 057: Delete Google Ads UI noise notifications that were stored
 * before the blacklist filter was added.
 *
 * Matches notification_type, label, OR title against known noise patterns.
 */
export async function up(knex: Knex): Promise<void> {
  const result = await knex.raw(`
    DELETE FROM notification_details
    WHERE
      notification_type IN (
        'L2_MENU_EXPAND_COLLAPSE',
        'HALO_SCOPING_FEATURE',
        'PARENT_CHILD_REPORT_PROMO',
        'AWN_DS_FORECASTING_INGREDIENTS',
        'CREATIVE_BRIEF_AIMAX',
        'CREATIVE_BRIEF',
        'DATA_MANAGER_LAUNCH_IN_SA360',
        'DM_IN_SA360_CONVERSIONS',
        'ASSET_SUGGESTIONS_PROMO',
        'CONVERSION_TRACKING_PROMO',
        'SMART_CAMPAIGN_PROMO',
        'RECOMMENDATION_PROMO',
        'PERFORMANCE_INSIGHTS_PROMO',
        'AUDIENCE_SIGNAL_PROMO',
        'BROAD_MATCH_PROMO',
        'VALUE_BASED_BIDDING_PROMO',
        'INSIGHTS_PAGE_PROMO',
        'EXPERIMENTS_PROMO',
        'AUTO_APPLY_PROMO',
        'SEARCH_THEMES_PROMO',
        'DEMAND_GEN_PROMO',
        'PMAX_PROMO',
        'BRAND_RESTRICTIONS_PROMO',
        'OPTIMIZATION_SCORE_PROMO',
        'GOOGLE_ANALYTICS_LINK_PROMO'
      )
      OR label IN (
        'L2_MENU_EXPAND_COLLAPSE',
        'HALO_SCOPING_FEATURE',
        'PARENT_CHILD_REPORT_PROMO',
        'AWN_DS_FORECASTING_INGREDIENTS',
        'CREATIVE_BRIEF_AIMAX',
        'CREATIVE_BRIEF',
        'DATA_MANAGER_LAUNCH_IN_SA360',
        'DM_IN_SA360_CONVERSIONS'
      )
      OR title IN (
        'L2_MENU_EXPAND_COLLAPSE',
        'HALO_SCOPING_FEATURE',
        'PARENT_CHILD_REPORT_PROMO',
        'AWN_DS_FORECASTING_INGREDIENTS',
        'CREATIVE_BRIEF_AIMAX',
        'CREATIVE_BRIEF',
        'DATA_MANAGER_LAUNCH_IN_SA360',
        'DM_IN_SA360_CONVERSIONS'
      )
      OR notification_type LIKE '%_PROMO'
      OR title LIKE '%EXPAND_COLLAPSE%'
      OR title LIKE '%HALO_%'
      OR title LIKE '%CREATIVE_BRIEF%'
      OR title LIKE '%FORECASTING%'
      OR title LIKE '%DATA_MANAGER%'
      OR title LIKE '%DM_IN_SA360%'
      OR title LIKE '%SCOPING_FEATURE%'
  `);

  console.log(`[migration-057] Deleted ${result.rowCount ?? 0} noise notifications`);
}

export async function down(_knex: Knex): Promise<void> {
  // Cannot restore deleted rows
}
