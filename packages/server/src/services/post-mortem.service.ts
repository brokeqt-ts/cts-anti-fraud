import type pg from 'pg';

interface PostMortemFactor {
  severity: 'critical' | 'warning' | 'info';
  text: string;
}

interface PostMortemData {
  lifetime_hours: number | null;
  total_spend: number | null;
  total_spend_formatted: string | null;
  domain: string | null;
  domain_age_days: number | null;
  domain_safe_score: number | null;
  spend_velocity_status: string;
  keywords_count: number;
  top_keyword: string | null;
  top_keyword_clicks: number | null;
  campaigns_count: number;
  bidding_strategy: string | null;
  notifications_count_before_ban: number;
  had_warnings: boolean;
  connected_banned_accounts: number;
  connected_accounts: Array<{
    google_id: string;
    domain: string | null;
    is_banned: boolean;
    link_type: string;
  }>;
  ban_reason: string | null;
  ban_target: string | null;
  offer_vertical: string | null;
  similar_bans_count: number;
  account_type: string | null;
  payment_bin: string | null;
  factors: PostMortemFactor[];
  recommendations: string[];
  generated_at: string;
}

/**
 * Generates a fact-based post-mortem for a ban log entry.
 * No AI — pure data aggregation and rule-based factor identification.
 */
export async function generatePostMortem(
  pool: pg.Pool,
  banLogId: string,
): Promise<PostMortemData | null> {
  // Get ban log
  const banResult = await pool.query(
    `SELECT * FROM ban_logs WHERE id = $1`,
    [banLogId],
  );
  const ban = banResult.rows[0];
  if (!ban) return null;

  const accountGoogleId = ban['account_google_id'] as string | null;
  const lifetimeHours = ban['lifetime_hours'] as number | null;
  const lifetimeSpend = ban['lifetime_spend'] != null ? Number(ban['lifetime_spend']) : null;
  const banReason = ban['ban_reason'] as string | null;
  const banTarget = ban['ban_target'] as string | null;
  const banDomain = ban['domain'] as string | null;
  const offerVertical = ban['offer_vertical'] as string | null;

  // Get account info
  const accountResult = accountGoogleId
    ? await pool.query(`SELECT * FROM accounts WHERE google_account_id = $1`, [accountGoogleId])
    : { rows: [] };
  const account = accountResult.rows[0];
  const accountType = (account?.['account_type'] ?? null) as string | null;
  const paymentBin = (account?.['payment_bin'] ?? null) as string | null;

  // Get domain info
  let domainAgeDays: number | null = null;
  let domainSafeScore: number | null = null;
  const domainToCheck = banDomain ?? (accountGoogleId ? await getAccountDomain(pool, accountGoogleId) : null);

  if (domainToCheck) {
    const domainResult = await pool.query(
      `SELECT domain_age_days, safe_page_quality_score FROM domains WHERE domain_name = $1`,
      [domainToCheck],
    );
    if (domainResult.rows[0]) {
      domainAgeDays = domainResult.rows[0]['domain_age_days'] as number | null;
      domainSafeScore = domainResult.rows[0]['safe_page_quality_score'] as number | null;
    }
  }

  // Count keywords and find top keyword
  let keywordsCount = 0;
  let topKeyword: string | null = null;
  let topKeywordClicks: number | null = null;
  if (accountGoogleId) {
    const kwResult = await pool.query(
      `SELECT keyword_text, clicks FROM keywords WHERE account_google_id = $1 ORDER BY clicks DESC NULLS LAST LIMIT 1`,
      [accountGoogleId],
    );
    topKeyword = kwResult.rows[0]?.['keyword_text'] as string | null;
    topKeywordClicks = kwResult.rows[0]?.['clicks'] != null ? Number(kwResult.rows[0]['clicks']) : null;
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM keywords WHERE account_google_id = $1`,
      [accountGoogleId],
    );
    keywordsCount = Number(countResult.rows[0]?.['cnt'] ?? 0);
  }

  // Count campaigns and get bidding strategy
  let campaignsCount = 0;
  let biddingStrategy: string | null = null;
  if (accountGoogleId) {
    const campResult = await pool.query(
      `SELECT COUNT(DISTINCT campaign_id)::int AS cnt FROM campaigns WHERE account_google_id = $1`,
      [accountGoogleId],
    );
    campaignsCount = Number(campResult.rows[0]?.['cnt'] ?? 0);
    const bidResult = await pool.query(
      `SELECT bidding_strategy_type FROM campaigns WHERE account_google_id = $1 AND bidding_strategy_type IS NOT NULL LIMIT 1`,
      [accountGoogleId],
    );
    const bidType = bidResult.rows[0]?.['bidding_strategy_type'];
    if (bidType != null) {
      const bidLabels: Record<string, string> = { '2': 'Manual CPC', '3': 'Manual CPM', '6': 'Target CPA', '9': 'Maximize Conversions', '10': 'Maximize Conversion Value', '11': 'Target ROAS', '12': 'Maximize Clicks', '14': 'Target Impression Share' };
      biddingStrategy = bidLabels[String(bidType)] ?? `type ${bidType}`;
    }
  }

  // Notifications count before ban
  let notificationsCount = 0;
  let hadWarnings = false;
  if (accountGoogleId) {
    const notifResult = await pool.query(
      `SELECT COUNT(*)::int AS cnt,
              COUNT(*) FILTER (WHERE notification_type ILIKE '%warning%' OR notification_type ILIKE '%policy%') AS warnings
       FROM notification_details
       WHERE account_google_id = $1`,
      [accountGoogleId],
    );
    notificationsCount = Number(notifResult.rows[0]?.['cnt'] ?? 0);
    hadWarnings = Number(notifResult.rows[0]?.['warnings'] ?? 0) > 0;
  }

  // Connected accounts (via domain) — get list with ban status
  let connectedBannedAccounts = 0;
  const connectedAccounts: Array<{ google_id: string; domain: string | null; is_banned: boolean; link_type: string }> = [];
  if (accountGoogleId && domainToCheck) {
    const connResult = await pool.query(`
      WITH domain_accounts AS (
        SELECT DISTINCT a.account_google_id
        FROM ads a,
        LATERAL (SELECT jsonb_array_elements_text(a.final_urls) AS url
                 WHERE a.final_urls IS NOT NULL AND jsonb_typeof(a.final_urls) = 'array') u
        WHERE regexp_replace(regexp_replace(u.url, '^https?://', ''), '/.*$', '') = $1::text
          AND a.account_google_id != $2::text
      )
      SELECT da.account_google_id,
             EXISTS(SELECT 1 FROM ban_logs bl WHERE bl.account_google_id = da.account_google_id) AS is_banned
      FROM domain_accounts da
      LIMIT 10
    `, [domainToCheck, accountGoogleId]);
    for (const row of connResult.rows) {
      const isBanned = row['is_banned'] as boolean;
      if (isBanned) connectedBannedAccounts++;
      connectedAccounts.push({
        google_id: row['account_google_id'] as string,
        domain: domainToCheck,
        is_banned: isBanned,
        link_type: 'domain',
      });
    }
  }

  // Similar bans (same vertical or domain)
  let similarBansCount = 0;
  if (offerVertical || domainToCheck) {
    const simResult = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM ban_logs
       WHERE id != $1
         AND (($2::text IS NOT NULL AND offer_vertical = $2::text)
           OR ($3::text IS NOT NULL AND domain ILIKE '%' || $3::text || '%'))`,
      [banLogId, offerVertical, domainToCheck],
    );
    similarBansCount = Number(simResult.rows[0]?.['cnt'] ?? 0);
  }

  // Spend velocity status
  let spendVelocityStatus = 'unknown';
  if (accountGoogleId) {
    const velResult = await pool.query(`
      WITH daily AS (
        SELECT date, SUM(metric_value)::numeric AS spend
        FROM keyword_daily_stats
        WHERE account_google_id = $1 AND metric_name = 'stats.cost'
        GROUP BY date ORDER BY date DESC LIMIT 3
      )
      SELECT * FROM daily
    `, [accountGoogleId]);

    if (velResult.rows.length >= 2) {
      const latest = Number(velResult.rows[0]?.['spend'] ?? 0);
      const prev = Number(velResult.rows[1]?.['spend'] ?? 0);
      if (prev > 0) {
        const pct = ((latest - prev) / prev) * 100;
        spendVelocityStatus = pct > 50 ? 'critical' : pct > 20 ? 'elevated' : 'normal';
      }
    }
  }

  // Build factors with severity
  const factors: PostMortemFactor[] = [];

  if (domainSafeScore != null && domainSafeScore < 40) {
    factors.push({ severity: 'critical', text: `Низкий Safe Page Score домена (${domainSafeScore}/100)` });
  }
  if (lifetimeHours != null && lifetimeHours < 4) {
    factors.push({ severity: 'critical', text: `Очень короткий lifetime аккаунта (${lifetimeHours}ч) — возможный мгновенный бан` });
  } else if (lifetimeHours != null && lifetimeHours < 24) {
    factors.push({ severity: 'critical', text: `Короткий lifetime аккаунта (${lifetimeHours}ч)` });
  }
  if (connectedBannedAccounts > 0) {
    factors.push({ severity: 'critical', text: `${connectedBannedAccounts} связанных аккаунтов забанены на том же домене` });
  }
  if (domainAgeDays != null && domainAgeDays < 30) {
    factors.push({ severity: 'warning', text: `Молодой домен (${domainAgeDays} дней)` });
  }
  if (banReason && banReason.includes('UNACCEPTABLE_BUSINESS_PRACTICES')) {
    factors.push({ severity: 'warning', text: `Причина бана: UNACCEPTABLE_BUSINESS_PRACTICES — обычно связано с контентом сайта или офером` });
  } else if (banReason) {
    factors.push({ severity: 'warning', text: `Причина бана: ${banReason}` });
  }
  if (hadWarnings) {
    factors.push({ severity: 'warning', text: `Обнаружены policy warnings до бана` });
  }
  if (spendVelocityStatus === 'critical') {
    factors.push({ severity: 'warning', text: `Скорость расходов была critical на момент бана` });
  } else if (spendVelocityStatus === 'elevated') {
    factors.push({ severity: 'info', text: `Скорость расходов была elevated на момент бана` });
  }
  if (notificationsCount > 0) {
    factors.push({ severity: 'info', text: `${notificationsCount} уведомлений до бана — проверить содержание` });
  }
  if (biddingStrategy && biddingStrategy !== 'Manual CPC') {
    factors.push({ severity: 'info', text: `Bidding strategy: ${biddingStrategy} — агрессивная для нового аккаунта` });
  }
  if (lifetimeSpend != null && lifetimeSpend < 5) {
    factors.push({ severity: 'info', text: `Очень низкий расход до бана ($${lifetimeSpend.toFixed(2)})` });
  }
  if (keywordsCount === 0) {
    factors.push({ severity: 'info', text: `Не найдено ключевых слов — возможно бан до запуска` });
  }
  if (similarBansCount > 2) {
    factors.push({ severity: 'info', text: `${similarBansCount} похожих банов на той же вертикали/домене` });
  }

  // Build recommendations
  const recommendations: string[] = [];

  if (domainSafeScore != null && domainSafeScore < 70) {
    recommendations.push('Повысить Safe Page Score домена до 70+ (добавить контент, блог, about page)');
  }
  if (biddingStrategy && biddingStrategy !== 'Manual CPC' && lifetimeHours != null && lifetimeHours < 48) {
    recommendations.push('Использовать Manual CPC вместо автоматических стратегий на новых аккаунтах');
  }
  if (lifetimeHours != null && lifetimeHours < 24) {
    recommendations.push('Увеличить прогрев аккаунта до 7+ дней перед агрессивным скейлом');
  }
  if (domainAgeDays != null && domainAgeDays < 30) {
    recommendations.push('Использовать домены старше 30 дней для рекламных кампаний');
  }
  if (connectedBannedAccounts > 0) {
    recommendations.push('Не использовать один домен на нескольких аккаунтах — создавать уникальные лендинги');
  }
  if (spendVelocityStatus === 'critical' || spendVelocityStatus === 'elevated') {
    recommendations.push('Плавно увеличивать бюджет — не более 20% в день на новых аккаунтах');
  }
  if (recommendations.length === 0) {
    recommendations.push('Проанализировать ban_reason и контент лендинга для выявления конкретной причины');
  }

  // Format spend
  const currency = (account?.['currency'] as string) ?? 'USD';
  const currSymbols: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', UAH: '₴', RUB: '₽', PLN: 'zł', TRY: '₺', BRL: 'R$' };
  const totalSpendFormatted = lifetimeSpend != null
    ? `${currSymbols[currency] ?? currency + ' '}${lifetimeSpend.toFixed(2)}`
    : null;

  const postMortem: PostMortemData = {
    generated_at: new Date().toISOString(),
    lifetime_hours: lifetimeHours,
    total_spend: lifetimeSpend,
    total_spend_formatted: totalSpendFormatted,
    domain: domainToCheck,
    domain_age_days: domainAgeDays,
    domain_safe_score: domainSafeScore,
    spend_velocity_status: spendVelocityStatus,
    keywords_count: keywordsCount,
    top_keyword: topKeyword,
    top_keyword_clicks: topKeywordClicks,
    campaigns_count: campaignsCount,
    bidding_strategy: biddingStrategy,
    notifications_count_before_ban: notificationsCount,
    had_warnings: hadWarnings,
    connected_banned_accounts: connectedBannedAccounts,
    connected_accounts: connectedAccounts,
    ban_reason: banReason,
    ban_target: banTarget,
    offer_vertical: offerVertical,
    similar_bans_count: similarBansCount,
    account_type: accountType,
    payment_bin: paymentBin,
    factors,
    recommendations,
  };

  // Save to ban_logs
  await pool.query(
    `UPDATE ban_logs SET post_mortem = $1, post_mortem_generated_at = NOW() WHERE id = $2`,
    [JSON.stringify(postMortem), banLogId],
  );

  return postMortem;
}

async function getAccountDomain(pool: pg.Pool, accountGoogleId: string): Promise<string | null> {
  const result = await pool.query(`
    SELECT regexp_replace(regexp_replace(url, '^https?://', ''), '/.*$', '') AS domain
    FROM ads,
    LATERAL (SELECT jsonb_array_elements_text(final_urls) AS url
             WHERE final_urls IS NOT NULL AND jsonb_typeof(final_urls) = 'array') u
    WHERE account_google_id = $1
    LIMIT 1
  `, [accountGoogleId]);
  return (result.rows[0]?.['domain'] as string) ?? null;
}
