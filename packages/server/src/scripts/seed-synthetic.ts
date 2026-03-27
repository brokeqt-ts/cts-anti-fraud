/**
 * Synthetic data seed script for CTS Anti-Fraud.
 *
 * Usage:
 *   npx tsx packages/server/src/scripts/seed-synthetic.ts
 *
 * Requires DATABASE_URL in .env or environment.
 * Safe to run multiple times — uses ON CONFLICT to skip duplicates.
 */

import dotenv from 'dotenv';
import path from 'node:path';
import pg from 'pg';
import crypto from 'node:crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

let pool: pg.Pool;

function initPool(): pg.Pool {
  const DATABASE_URL = process.env['DATABASE_URL'];
  if (!DATABASE_URL) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  const isProduction = process.env['NODE_ENV'] === 'production';
  return new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: isProduction ? { rejectUnauthorized: false } : false,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rng(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[rng(0, arr.length - 1)]!;
}

function googleId(): string {
  // Real Google Ads CIDs are 10-digit numbers stored without dashes
  // (dashes are display formatting only). Must match ^\d{7,13}$ filter.
  return String(rng(1000000000, 9999999999));
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Data pools ───────────────────────────────────────────────────────────────

const VERTICALS = ['gambling', 'nutra', 'crypto', 'dating', 'sweepstakes', 'ecom'];
const ACCOUNT_TYPES = ['farm', 'bought', 'agency', 'unknown'];
const COUNTRIES = ['US', 'DE', 'GB', 'BR', 'IN', 'UA', 'PL', 'TR', 'ID', 'VN'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'BRL', 'UAH'];
const BAN_REASONS = [
  'Circumventing systems', 'Misleading content', 'Malicious software',
  'Unacceptable business practices', 'Suspicious payment activity',
  'Policy violation: healthcare', 'Policy violation: gambling',
  'Coordinated deceptive practices',
];
const CAMPAIGN_NAMES = [
  'PMax — Nutra US', 'Search — Gambling DE', 'DemandGen — Crypto BR',
  'PMax — Dating UA', 'Search — Sweeps PL', 'PMax — Ecom TR',
  'Search — Nutra GB', 'DemandGen — Gambling US', 'PMax — Crypto VN',
  'Search — Dating ID',
];
const DOMAIN_NAMES = [
  // Fake domains (for account linking)
  'slim-health-now.com', 'lucky-wins-today.com', 'crypto-profit-hub.io',
  'meet-singles-fast.com', 'prize-zone-24.com', 'best-deals-shop.store',
  'vita-boost-pro.com', 'spin-fortune-777.com', 'token-gains-daily.io',
  'love-match-app.com', 'mega-sweep-win.com', 'gadget-deals-hq.store',
  // Real domains for content analysis testing
  'example.com', 'wikipedia.org', 'github.com',
];
const HEADLINES = [
  'Get Results Fast', 'Limited Time Offer', 'Try It Free Today',
  'Trusted by Millions', 'Start Winning Now', 'Exclusive Deal Inside',
  'Transform Your Life', 'Join 10M+ Users', 'Save Big Today',
];
const DESCRIPTIONS = [
  'Discover the secret that thousands are using right now.',
  'Don\'t miss out on this incredible opportunity.',
  'Clinically proven results in just 30 days.',
  'Sign up now and get a bonus reward instantly.',
  'The #1 rated solution for your needs.',
];
const PROXY_PROVIDERS = ['Bright Data', 'Oxylabs', 'Smartproxy', 'IPRoyal', '922proxy'];
const BANKS = ['Revolut', 'Wise', 'N26', 'PrivatBank', 'Monobank', 'Chase', 'Barclays'];

// ─── Seed functions ───────────────────────────────────────────────────────────

async function seedDomains(): Promise<string[]> {
  console.log('[seed] Seeding domains...');
  const ids: string[] = [];
  for (const domain of DOMAIN_NAMES) {
    const res = await pool.query(
      `INSERT INTO domains (domain_name, registrar, domain_age_days, whois_privacy, ssl_type,
        hosting_ip, dns_provider, content_quality_score, pagespeed_score, has_google_analytics, has_gtm)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (domain_name) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [
        domain,
        pick(['Namecheap', 'GoDaddy', 'Cloudflare', 'Porkbun']),
        rng(5, 800),
        Math.random() > 0.3,
        pick(['lets_encrypt', 'paid', 'none']),
        `${rng(1, 255)}.${rng(1, 255)}.${rng(1, 255)}.${rng(1, 255)}`,
        pick(['cloudflare', 'direct', 'other']),
        rng(20, 95),
        rng(30, 99),
        Math.random() > 0.5,
        Math.random() > 0.6,
      ],
    );
    ids.push(res.rows[0].id);
  }
  console.log(`  ${ids.length} domains`);
  return ids;
}

async function seedProxiesAndProfiles(): Promise<{
  proxyIds: string[];
  profileIds: string[];
  paymentIds: string[];
}> {
  console.log('[seed] Seeding proxies, profiles, payment methods...');
  const proxyIds: string[] = [];
  const profileIds: string[] = [];
  const paymentIds: string[] = [];

  for (let i = 0; i < 8; i++) {
    const res = await pool.query(
      `INSERT INTO proxies (proxy_type, provider, geo, rotation_type, ip_address)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        pick(['residential', 'mobile', 'datacenter', 'isp']),
        pick(PROXY_PROVIDERS),
        pick(COUNTRIES),
        pick(['sticky', 'rotating']),
        `${rng(1, 255)}.${rng(1, 255)}.${rng(1, 255)}.${rng(1, 255)}`,
      ],
    );
    proxyIds.push(res.rows[0].id);
  }

  for (let i = 0; i < 10; i++) {
    const res = await pool.query(
      `INSERT INTO antidetect_profiles (browser_type, profile_external_id, fingerprint_hash)
       VALUES ($1, $2, $3) RETURNING id`,
      [
        pick(['adspower', 'dolphin', 'octo', 'multilogin', 'gologin']),
        `profile-${crypto.randomBytes(4).toString('hex')}`,
        crypto.randomBytes(16).toString('hex'),
      ],
    );
    profileIds.push(res.rows[0].id);
  }

  for (let i = 0; i < 6; i++) {
    const res = await pool.query(
      `INSERT INTO payment_methods (bin, card_type, provider_bank, country, spend_limit)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        `${rng(400000, 559999)}`,
        pick(['debit', 'credit', 'prepaid', 'virtual']),
        pick(BANKS),
        pick(COUNTRIES),
        rng(500, 10000),
      ],
    );
    paymentIds.push(res.rows[0].id);
  }

  console.log(`  ${proxyIds.length} proxies, ${profileIds.length} profiles, ${paymentIds.length} payment methods`);
  return { proxyIds, profileIds, paymentIds };
}

async function seedAccounts(
  domainIds: string[],
  proxyIds: string[],
  profileIds: string[],
  paymentIds: string[],
): Promise<{ accountIds: string[]; googleIds: string[] }> {
  console.log('[seed] Seeding accounts...');

  // Get admin user
  const adminRes = await pool.query(`SELECT id FROM users WHERE email = 'admin@cts.local'`);
  const adminId = adminRes.rows[0]?.id;

  const accountIds: string[] = [];
  const googleIds: string[] = [];

  const statuses: Array<{ status: string; count: number }> = [
    { status: 'active', count: 8 },
    { status: 'suspended', count: 3 },
    { status: 'banned', count: 4 },
    { status: 'under_review', count: 1 },
  ];

  for (const { status, count } of statuses) {
    for (let i = 0; i < count; i++) {
      const gId = googleId();
      const vertical = pick(VERTICALS);
      const country = pick(COUNTRIES);
      const currency = pick(CURRENCIES);
      const ageDays = rng(3, 365);
      const spend = status === 'banned' ? rng(50, 5000) : rng(0, 15000);

      const res = await pool.query(
        `INSERT INTO accounts (
           google_account_id, display_name, country, account_age_days, status,
           total_spend, payment_bin, payment_bank, payment_card_country,
           currency, account_type, offer_vertical, offer_vertical_source,
           campaign_count, domain_count, user_id, first_seen_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT (google_account_id) DO UPDATE SET updated_at = now()
         RETURNING id`,
        [
          gId,
          `Account ${gId}`,
          country,
          ageDays,
          status,
          spend,
          `${rng(400000, 559999)}`,
          pick(BANKS),
          country,
          currency,
          pick(ACCOUNT_TYPES),
          vertical,
          'auto',
          rng(1, 5),
          rng(1, 3),
          adminId,
          daysAgo(ageDays),
        ],
      );
      accountIds.push(res.rows[0].id);
      googleIds.push(gId);

      // Link consumables
      await pool.query(
        `INSERT INTO account_consumables (account_id, proxy_id, antidetect_profile_id, payment_method_id)
         VALUES ($1, $2, $3, $4)`,
        [res.rows[0].id, pick(proxyIds), pick(profileIds), pick(paymentIds)],
      );
    }
  }

  console.log(`  ${accountIds.length} accounts (8 active, 3 suspended, 4 banned, 1 under_review)`);
  return { accountIds, googleIds };
}

async function seedCampaignsAndAds(
  googleIds: string[],
): Promise<{ campaignPairs: Array<{ googleId: string; campaignId: string }> }> {
  console.log('[seed] Seeding campaigns, ad groups, ads, keywords...');

  const campaignPairs: Array<{ googleId: string; campaignId: string }> = [];
  let totalCampaigns = 0;
  let totalAds = 0;
  let totalKeywords = 0;

  for (const gId of googleIds) {
    const numCampaigns = rng(1, 4);
    for (let c = 0; c < numCampaigns; c++) {
      const campId = `${rng(10000000000, 99999999999)}`;
      const campName = pick(CAMPAIGN_NAMES);

      await pool.query(
        `INSERT INTO campaigns (account_google_id, campaign_id, campaign_name, campaign_type, status, budget_micros, currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING`,
        [gId, campId, campName, rng(2, 10), rng(2, 4), rng(5000000, 100000000), pick(CURRENCIES)],
      );
      campaignPairs.push({ googleId: gId, campaignId: campId });
      totalCampaigns++;

      // Ad group
      const agId = `${rng(100000000000, 999999999999)}`;
      await pool.query(
        `INSERT INTO ad_groups (account_google_id, campaign_id, ad_group_id, ad_group_name, status)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [gId, campId, agId, `AdGroup ${c + 1}`, rng(2, 3)],
      );

      // Ads
      for (let a = 0; a < rng(1, 3); a++) {
        const adId = `${rng(100000000000, 999999999999)}`;
        await pool.query(
          `INSERT INTO ads (account_google_id, campaign_id, ad_group_id, ad_id, headlines, descriptions, final_urls, ad_type, review_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
          [
            gId, campId, agId, adId,
            JSON.stringify([pick(HEADLINES), pick(HEADLINES), pick(HEADLINES)]),
            JSON.stringify([pick(DESCRIPTIONS), pick(DESCRIPTIONS)]),
            JSON.stringify([`https://${pick(DOMAIN_NAMES)}/lp${rng(1, 5)}`]),
            'responsive_search',
            pick(['approved', 'approved', 'approved', 'under_review', 'disapproved']),
          ],
        );
        totalAds++;
      }

      // Keywords
      const kwTexts = ['buy now', 'best deal', 'free trial', 'sign up', 'discount', 'official site',
        'how to win', 'top rated', 'reviews 2026', 'near me'];
      for (let k = 0; k < rng(3, 7); k++) {
        const kwId = `${rng(10000000, 99999999)}`;
        await pool.query(
          `INSERT INTO keywords (account_google_id, campaign_id, ad_group_id, keyword_id, keyword_text,
            match_type, quality_score, impressions, clicks, cost_micros, ctr, conversions)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT DO NOTHING`,
          [
            gId, campId, agId, kwId, pick(kwTexts),
            rng(2, 6),
            rng(3, 10),
            rng(100, 50000),
            rng(10, 3000),
            rng(1000000, 50000000),
            (Math.random() * 0.08 + 0.01).toFixed(6),
            rng(0, 100),
          ],
        );
        totalKeywords++;
      }
    }
  }

  console.log(`  ${totalCampaigns} campaigns, ${totalAds} ads, ${totalKeywords} keywords`);
  return { campaignPairs };
}

async function seedDailyStats(
  campaignPairs: Array<{ googleId: string; campaignId: string }>,
): Promise<void> {
  console.log('[seed] Seeding keyword_daily_stats (30 days)...');
  let count = 0;

  for (const { googleId: gId, campaignId: campId } of campaignPairs) {
    for (let day = 0; day < 30; day++) {
      const date = dateStr(daysAgo(day));
      const ctr = (Math.random() * 0.06 + 0.01).toFixed(6);
      const cpc = (Math.random() * 3 + 0.2).toFixed(2);
      const clicks = rng(5, 500);
      const impressions = rng(500, 20000);

      const metrics = [
        { name: 'stats.ctr', value: ctr },
        { name: 'stats.average_cpc', value: cpc },
        { name: 'stats.clicks', value: String(clicks) },
        { name: 'stats.impressions', value: String(impressions) },
      ];

      for (const m of metrics) {
        await pool.query(
          `INSERT INTO keyword_daily_stats (account_google_id, keyword_id, campaign_id, date, metric_name, metric_value)
           VALUES ($1, NULL, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [gId, campId, date, m.name, m.value],
        );
        count++;
      }
    }
  }

  console.log(`  ${count} daily stat records`);
}

async function seedCreativeSnapshots(
  campaignPairs: Array<{ googleId: string; campaignId: string }>,
): Promise<void> {
  console.log('[seed] Seeding creative_snapshots (with decay patterns)...');
  let count = 0;

  // Pick 3-4 campaigns to show decay
  const decayCampaigns = campaignPairs.slice(0, Math.min(4, campaignPairs.length));

  for (const { googleId: gId, campaignId: campId } of campaignPairs) {
    const isDecaying = decayCampaigns.some(dc => dc.campaignId === campId);
    const baseCtr = Math.random() * 0.04 + 0.02; // 2-6% baseline

    for (let day = 0; day < 21; day++) {
      const date = dateStr(daysAgo(day));
      let ctr: number;

      if (isDecaying && day < 5) {
        // Last 5 days: decayed CTR (drop 20-40%)
        ctr = baseCtr * (0.6 + Math.random() * 0.2);
      } else {
        // Baseline: normal CTR with small variance
        ctr = baseCtr * (0.9 + Math.random() * 0.2);
      }

      const impressions = rng(500, 15000);
      const clicks = Math.round(impressions * ctr);
      const cpc = rng(200000, 3000000); // micros

      await pool.query(
        `INSERT INTO creative_snapshots (account_google_id, campaign_id, campaign_name, snapshot_date,
          impressions, clicks, ctr, cpc, conversions, cost_micros)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
        [
          gId, campId, pick(CAMPAIGN_NAMES), date,
          impressions, clicks, ctr.toFixed(6), (cpc / 1000000).toFixed(2),
          rng(0, 20), BigInt(impressions) * BigInt(cpc) / BigInt(1000),
        ],
      );
      count++;
    }
  }

  console.log(`  ${count} creative snapshots (${decayCampaigns.length} campaigns with decay pattern)`);
}

async function seedBanLogs(
  accountIds: string[],
  googleIds: string[],
  domainIds: string[],
): Promise<void> {
  console.log('[seed] Seeding ban_logs...');
  let count = 0;

  // Banned accounts (indices 11-14 in our array)
  const bannedIndices = [11, 12, 13, 14];
  for (const idx of bannedIndices) {
    if (idx >= accountIds.length) continue;
    const bannedDaysAgo = rng(1, 60);

    await pool.query(
      `INSERT INTO ban_logs (account_id, account_google_id, domain_id, is_banned, banned_at,
        ban_reason, ban_target, lifetime_hours, lifetime_spend, offer_vertical,
        domain, source, campaign_type)
       VALUES ($1, $2, $3, true, $4, $5, 'account', $6, $7, $8, $9, $10, $11)`,
      [
        accountIds[idx], googleIds[idx], pick(domainIds),
        daysAgo(bannedDaysAgo),
        pick(BAN_REASONS),
        rng(24, 2000),
        rng(50, 5000),
        pick(VERTICALS),
        pick(DOMAIN_NAMES),
        pick(['auto', 'manual']),
        pick(['pmax', 'search', 'demand_gen']),
      ],
    );
    count++;
  }

  // Some historical bans that got resolved
  for (let i = 0; i < 3; i++) {
    const idx = rng(0, 7); // active accounts
    const bannedDays = rng(30, 120);
    await pool.query(
      `INSERT INTO ban_logs (account_id, account_google_id, domain_id, is_banned, banned_at,
        ban_reason, ban_target, lifetime_hours, lifetime_spend, offer_vertical,
        domain, source, resolved_at)
       VALUES ($1, $2, $3, false, $4, $5, 'account', $6, $7, $8, $9, 'auto', $10)`,
      [
        accountIds[idx], googleIds[idx], pick(domainIds),
        daysAgo(bannedDays),
        pick(BAN_REASONS),
        rng(100, 3000),
        rng(200, 8000),
        pick(VERTICALS),
        pick(DOMAIN_NAMES),
        daysAgo(bannedDays - rng(1, 5)),
      ],
    );
    count++;
  }

  console.log(`  ${count} ban logs`);
}

async function seedRiskVerdicts(googleIds: string[]): Promise<void> {
  console.log('[seed] Seeding risk_verdicts...');
  let count = 0;

  for (const gId of googleIds) {
    const riskScore = rng(10, 95);
    const factors = [];
    if (riskScore > 70) factors.push('high_spend_velocity', 'shared_bin');
    if (riskScore > 50) factors.push('young_account', 'risky_vertical');
    if (riskScore > 30) factors.push('low_quality_domain');

    await pool.query(
      `INSERT INTO risk_verdicts (account_google_id, verdict_data)
       VALUES ($1, $2)`,
      [
        gId,
        JSON.stringify({
          risk_score: riskScore,
          level: riskScore > 70 ? 'high' : riskScore > 40 ? 'medium' : 'low',
          factors,
          rules_triggered: factors.length,
          assessed_at: new Date().toISOString(),
        }),
      ],
    );
    count++;
  }

  console.log(`  ${count} risk verdicts`);
}

async function seedAiPredictionsAndFeedback(googleIds: string[]): Promise<void> {
  console.log('[seed] Seeding ai_model_predictions + ai_feedback...');

  const adminRes = await pool.query(`SELECT id FROM users WHERE email = 'admin@cts.local'`);
  const adminId = adminRes.rows[0]?.id;

  let predCount = 0;
  let feedbackCount = 0;

  const models = ['claude', 'gemini', 'openai'];

  for (const gId of googleIds) {
    for (const model of models) {
      const banProb = Math.random();
      const riskLevel = banProb > 0.7 ? 'high' : banProb > 0.4 ? 'medium' : 'low';
      const isBanned = banProb > 0.65;

      const res = await pool.query(
        `INSERT INTO ai_model_predictions (
           account_google_id, model_id, strategy, predicted_ban_prob,
           predicted_risk_level, predicted_lifetime_days, analysis_type,
           latency_ms, tokens_used, cost_usd,
           actual_outcome, actual_outcome_at, ban_prediction_correct
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'account', $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          gId, model, 'default',
          banProb.toFixed(4),
          riskLevel,
          rng(7, 365),
          rng(800, 5000),
          rng(500, 4000),
          (Math.random() * 0.05).toFixed(6),
          isBanned ? 'banned' : Math.random() > 0.3 ? 'survived' : null,
          isBanned ? daysAgo(rng(1, 30)) : null,
          isBanned ? (banProb > 0.5 ? true : false) : null,
        ],
      );
      predCount++;

      // Feedback on some predictions (60% chance)
      if (adminId && Math.random() > 0.4) {
        await pool.query(
          `INSERT INTO ai_feedback (prediction_id, user_id, rating, feedback_type, comment)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [
            res.rows[0].id,
            adminId,
            pick([-1, 0, 1, 1, 1]), // bias towards positive
            'rating',
            Math.random() > 0.7 ? pick(['Accurate prediction', 'Missed early signals', 'Good analysis']) : null,
          ],
        );
        feedbackCount++;
      }
    }
  }

  console.log(`  ${predCount} predictions, ${feedbackCount} feedback entries`);
}

async function seedNotifications(): Promise<void> {
  console.log('[seed] Seeding notifications...');

  const adminRes = await pool.query(`SELECT id FROM users WHERE email = 'admin@cts.local'`);
  const adminId = adminRes.rows[0]?.id;
  if (!adminId) return;

  const notifications = [
    { type: 'ban_detected', title: 'Ban detected: 456-789-1234', severity: 'critical', read: true },
    { type: 'ban_detected', title: 'Ban detected: 321-654-9876', severity: 'critical', read: false },
    { type: 'risk_elevated', title: 'Risk elevated: 111-222-3333 (85/100)', severity: 'warning', read: true },
    { type: 'creative_decay', title: 'Creative decay: PMax — Nutra US (-28% CTR)', severity: 'warning', read: false },
    { type: 'creative_decay', title: 'Creative decay: Search — Gambling DE (-35% CTR)', severity: 'critical', read: false },
    { type: 'ban_resolved', title: 'Ban resolved: 555-666-7777 (appeal approved)', severity: 'success', read: true },
    { type: 'account_connected', title: 'New account connected: 999-888-7777', severity: 'info', read: true },
    { type: 'system', title: 'System: Materialized views refreshed', severity: 'info', read: true },
    { type: 'system', title: 'System: ML batch prediction completed (16 accounts)', severity: 'info', read: false },
  ];

  for (const n of notifications) {
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, severity, is_read, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [adminId, n.type, n.title, n.severity, n.read, daysAgo(rng(0, 14))],
    );
  }

  console.log(`  ${notifications.length} notifications`);
}

async function seedCtsSites(): Promise<void> {
  console.log('[seed] Seeding cts_sites...');
  const sites = [
    { domain: 'lucky-wins-today.com', externalId: 'cts-001' },
    { domain: 'slim-health-now.com', externalId: 'cts-002' },
    { domain: 'crypto-profit-hub.io', externalId: 'cts-003' },
    { domain: 'meet-singles-fast.com', externalId: 'cts-004' },
    { domain: 'best-deals-shop.store', externalId: 'cts-005' },
  ];

  for (const s of sites) {
    await pool.query(
      `INSERT INTO cts_sites (domain, external_cts_id) VALUES ($1, $2)
       ON CONFLICT (domain) WHERE domain IS NOT NULL DO UPDATE SET external_cts_id = $2`,
      [s.domain, s.externalId],
    );
  }

  console.log(`  ${sites.length} CTS sites`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function runSeed(externalPool?: pg.Pool): Promise<void> {
  pool = externalPool ?? initPool();

  console.log('=== CTS Anti-Fraud Synthetic Data Seed ===\n');

  try {
    await pool.query('SELECT 1');
    console.log('[seed] Connected to database\n');
  } catch (err) {
    console.error('Cannot connect to database:', err instanceof Error ? err.message : err);
    throw err;
  }

  const domainIds = await seedDomains();
  const { proxyIds, profileIds, paymentIds } = await seedProxiesAndProfiles();
  const { accountIds, googleIds } = await seedAccounts(domainIds, proxyIds, profileIds, paymentIds);
  const { campaignPairs } = await seedCampaignsAndAds(googleIds);
  await seedDailyStats(campaignPairs);
  await seedCreativeSnapshots(campaignPairs);
  await seedBanLogs(accountIds, googleIds, domainIds);
  await seedRiskVerdicts(googleIds);
  await seedAiPredictionsAndFeedback(googleIds);
  await seedNotifications();
  await seedCtsSites();

  console.log('\n=== Seed complete! ===');

  if (!externalPool) {
    await pool!.end();
  }
}

// Direct execution
const isDirectRun = process.argv[1]?.includes('seed-synthetic');
if (isDirectRun) {
  runSeed().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
