import type { Pool } from 'pg';
import { env } from '../config/env.js';
import { sendMessage, sendMessageWithKeyboard, escapeHtml, formatCid } from './telegram-bot.service.js';

// ─── Types ───────────────────────────────────────────────────────────────────

type CommandHandler = (chatId: string, args: string, pool: Pool) => Promise<void>;

interface InlineKeyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function getUserByChatId(pool: Pool, chatId: string): Promise<{ id: string; name: string; role: string } | null> {
  // Retry once on failure (handles stale connections after idle timeout)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await pool.query(
        `SELECT id, name, role FROM users WHERE telegram_chat_id = $1 AND is_active = true`,
        [chatId],
      );
      return (result.rows[0] as { id: string; name: string; role: string } | undefined) ?? null;
    } catch (err) {
      if (attempt === 0) {
        console.warn(`[telegram-cmd] getUserByChatId retry after error:`, err instanceof Error ? err.message : err);
        continue;
      }
      throw err;
    }
  }
  return null;
}

async function requireAuth(chatId: string, pool: Pool): Promise<{ id: string; name: string; role: string } | null> {
  try {
    const user = await getUserByChatId(pool, chatId);
    if (!user) {
      console.warn(`[telegram-cmd] requireAuth: no user found for chatId=${chatId}`);
      await sendMessage(chatId, '🔒 Telegram не привязан. Привяжите аккаунт в настройках Dashboard.');
      return null;
    }
    return user;
  } catch (err) {
    console.error(`[telegram-cmd] requireAuth DB error for chatId=${chatId}:`, err instanceof Error ? err.message : err);
    await sendMessage(chatId, '⚠️ Ошибка подключения к базе данных. Попробуйте ещё раз.');
    return null;
  }
}

// ─── Pending feedback comments (chatId → predictionId) ──────────────────────

const pendingComments = new Map<string, string>();

// ─── Command handlers ────────────────────────────────────────────────────────

const commands: Record<string, CommandHandler> = {};

// /help
// ─── Main menu (grouped) ─────────────────────────────────────────────────────

const MAIN_MENU_KEYBOARD: InlineKeyboard = {
  inline_keyboard: [
    [
      { text: '📊 Обзор', callback_data: 'menu:overview' },
      { text: '🚨 Баны и риски', callback_data: 'menu:bans' },
    ],
    [
      { text: '📈 Аналитика', callback_data: 'menu:analytics' },
      { text: '🤖 AI / ML', callback_data: 'menu:ai' },
    ],
  ],
};

const BACK_TO_MENU_ROW = [{ text: '← Главное меню', callback_data: 'menu:main' }];

/** Build a navigation row: [← Parent section] [← Главное меню] */
function navRow(parentMenu: string, parentLabel: string): Array<{ text: string; callback_data: string }[]> {
  return [[
    { text: `← ${parentLabel}`, callback_data: `menu:${parentMenu}` },
    { text: '← Главное', callback_data: 'menu:main' },
  ]];
}

commands['help'] = async (chatId) => {
  const text = [
    '📋 <b>Команды CTS Anti-Fraud Bot</b>',
    '',
    'Выберите раздел для навигации или используйте команды напрямую:',
    '',
    '/account &lt;CID&gt; — Детали аккаунта',
    '/ai &lt;CID&gt; — AI-анализ',
    '/predict &lt;CID&gt; — ML-прогноз',
    '/assess &lt;домен&gt; &lt;CID&gt; — Оценка риска',
    '/chains &lt;CID&gt; — Связи аккаунта',
    '/velocity &lt;CID&gt; — Скорость расхода',
    '/quality &lt;CID&gt; — Quality Score',
    '/postmortem &lt;CID&gt; — Post-mortem бана',
  ].join('\n');

  await sendMessageWithKeyboard(chatId, text, MAIN_MENU_KEYBOARD);
};

// Helper: build main screen with stats
async function buildMainScreen(pool: Pool, greeting: string): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const [accountsRes, bansRes, suspendedRes, recentBansRes, spendRes, lifetimeRes] = await Promise.all([
    pool.query(`SELECT COUNT(*) as total FROM accounts`),
    pool.query(`SELECT COUNT(*) as total FROM ban_logs`),
    pool.query(`SELECT COUNT(*) as total FROM accounts WHERE status = 'suspended'`),
    pool.query(`SELECT COUNT(*) as cnt FROM ban_logs WHERE created_at > NOW() - INTERVAL '24 hours'`),
    pool.query(`SELECT COALESCE(SUM(total_spend), 0) as total_spend FROM accounts`),
    pool.query(`SELECT
      ROUND(AVG(lifetime_hours)::numeric, 1) as avg_lt,
      ROUND(MIN(lifetime_hours)::numeric, 1) as min_lt,
      ROUND(MAX(lifetime_hours)::numeric, 1) as max_lt
    FROM ban_logs WHERE lifetime_hours IS NOT NULL`),
  ]);

  const totalAccounts = (accountsRes.rows[0] as { total: string }).total;
  const totalBans = (bansRes.rows[0] as { total: string }).total;
  const totalSuspended = (suspendedRes.rows[0] as { total: string }).total;
  const bans24h = (recentBansRes.rows[0] as { cnt: string }).cnt;
  const totalSpend = parseFloat((spendRes.rows[0] as { total_spend: string }).total_spend);
  const lt = lifetimeRes.rows[0] as { avg_lt: string | null; min_lt: string | null; max_lt: string | null };
  const banRate = Number(totalAccounts) > 0
    ? ((Number(totalBans) / Number(totalAccounts)) * 100).toFixed(1)
    : '0';

  const lines = [
    greeting,
    '',
    `👤 Аккаунтов: <b>${totalAccounts}</b>  ·  ⚠️ Suspended: <b>${totalSuspended}</b>`,
    `🚨 Банов: <b>${totalBans}</b>  ·  🕐 За 24ч: <b>${bans24h}</b>`,
    `💰 Расход: <b>$${totalSpend.toFixed(2)}</b>`,
  ];

  // Lifetime & ban rate
  if (lt.avg_lt != null) {
    lines.push(`⏱ Lifetime: <b>${lt.avg_lt}ч</b> (${lt.min_lt}ч — ${lt.max_lt}ч)`);
  }
  lines.push(`📊 Ban Rate: <b>${banRate}%</b>`);

  const text = lines.join('\n');

  return { text, keyboard: MAIN_MENU_KEYBOARD };
}

// /start
commands['start'] = async (chatId, _args, pool) => {
  const user = await getUserByChatId(pool, chatId);
  if (user) {
    const { text, keyboard } = await buildMainScreen(pool, `👋 <b>${escapeHtml(user.name)}</b>, добро пожаловать!`);
    await sendMessageWithKeyboard(chatId, text, keyboard);
  }
};

// /menu — back to main menu (also callable)
commands['menu'] = async (chatId, _args, pool) => {
  const user = await requireAuth(chatId, pool);
  if (!user) return;

  const { text, keyboard } = await buildMainScreen(pool, '📌 <b>Главное меню</b>');
  await sendMessageWithKeyboard(chatId, text, keyboard);
};

// /stats — alias for menu (main screen)
commands['stats'] = async (chatId, args, pool) => {
  await commands['menu']!(chatId, args, pool);
};

// Sub-menus sent via callback
async function sendSubMenu(chatId: string, section: string, pool: Pool): Promise<void> {
  const user = await requireAuth(chatId, pool);
  if (!user) return;

  switch (section) {
    case 'overview': {
      await sendMessageWithKeyboard(chatId, '📊 <b>Обзор</b>\n\nВыберите действие:', {
        inline_keyboard: [
          [
            { text: '📋 Аккаунты', callback_data: 'cmd:accounts' },
            { text: '🔔 Уведомления', callback_data: 'cmd:notifications' },
          ],
          [BACK_TO_MENU_ROW[0]!],
        ],
      });
      break;
    }

    case 'bans': {
      const recentRes = await pool.query(
        `SELECT COUNT(*) as cnt FROM ban_logs WHERE created_at > NOW() - INTERVAL '24 hours'`,
      );
      const recent = (recentRes.rows[0] as { cnt: string }).cnt;

      const text = [
        `🚨 <b>Баны и риски</b>  ·  ${recent} за 24ч`,
        '',
        'Выберите действие:',
      ].join('\n');

      await sendMessageWithKeyboard(chatId, text, {
        inline_keyboard: [
          [
            { text: '🚨 Последние баны', callback_data: 'cmd:bans' },
            { text: '⚠️ Аккаунты в зоне риска', callback_data: 'cmd:risks' },
          ],
          [
            { text: '🔗 Связи /chains CID', callback_data: 'hint:chains' },
            { text: '📝 Post-mortem /postmortem CID', callback_data: 'hint:postmortem' },
          ],
          [BACK_TO_MENU_ROW[0]!],
        ],
      });
      break;
    }

    case 'analytics': {
      const text = [
        '📈 <b>Аналитика</b>',
        '',
        'Выберите действие:',
      ].join('\n');

      await sendMessageWithKeyboard(chatId, text, {
        inline_keyboard: [
          [
            { text: '📉 Creative Decay', callback_data: 'cmd:decay' },
            { text: '🌐 Домены', callback_data: 'cmd:domains' },
          ],
          [
            { text: '🔍 Скан домена /scan', callback_data: 'hint:scan' },
            { text: '💸 Расход /velocity CID', callback_data: 'hint:velocity' },
          ],
          [
            { text: '📊 Quality /quality CID', callback_data: 'hint:quality' },
          ],
          [BACK_TO_MENU_ROW[0]!],
        ],
      });
      break;
    }

    case 'ai': {
      const text = [
        '🤖 <b>AI / ML</b>',
        '',
        'Выберите действие:',
      ].join('\n');

      await sendMessageWithKeyboard(chatId, text, {
        inline_keyboard: [
          [
            { text: '🤖 AI-анализ /ai CID', callback_data: 'hint:ai' },
            { text: '🎯 ML-прогноз /predict CID', callback_data: 'hint:predict' },
          ],
          [
            { text: '📋 Оценка риска /assess ...', callback_data: 'hint:assess' },
          ],
          [
            { text: '🏆 Лидерборд моделей', callback_data: 'cmd:leaderboard' },
          ],
          [BACK_TO_MENU_ROW[0]!],
        ],
      });
      break;
    }

    default:
      await sendMessageWithKeyboard(chatId, '📌 <b>Главное меню</b>\n\nВыберите раздел:', MAIN_MENU_KEYBOARD);
  }
}

// /accounts — Account list
commands['accounts'] = async (chatId, _args, pool) => {
  const user = await requireAuth(chatId, pool);
  if (!user) return;

  const result = await pool.query(
    `SELECT a.google_account_id, a.display_name, a.status,
            COUNT(bl.id) as ban_count
     FROM accounts a
     LEFT JOIN ban_logs bl ON bl.account_google_id = a.google_account_id
     GROUP BY a.id, a.google_account_id, a.display_name, a.status
     ORDER BY a.created_at DESC
     LIMIT 15`,
  );

  if (result.rows.length === 0) {
    await sendMessage(chatId, 'Аккаунты не найдены.');
    return;
  }

  const lines = result.rows.map((row) => {
    const r = row as { google_account_id: string; display_name: string | null; status: string; ban_count: string };
    const emoji = r.status === 'suspended' ? '🔴' : r.status === 'active' ? '🟢' : '⚪';
    const bans = parseInt(r.ban_count) > 0 ? ` (${r.ban_count} бан)` : '';
    const name = r.display_name ? ` ${escapeHtml(r.display_name)}` : '';
    return `${emoji} <code>${formatCid(r.google_account_id)}</code>${name}${bans}`;
  });

  const text = [
    '📋 <b>Аккаунты</b> (последние 15)',
    '',
    ...lines,
    '',
    '📌 /account &lt;CID&gt; — детали аккаунта',
  ].join('\n');

  await sendMessageWithKeyboard(chatId, text, {
    inline_keyboard: navRow('overview', 'Обзор'),
  });
};

// /account <CID> — Account details
commands['account'] = async (chatId, args, pool) => {
  const user = await requireAuth(chatId, pool);
  if (!user) return;

  const cid = args.replace(/[-\s]/g, '').trim();
  if (!cid) {
    await sendMessage(chatId, 'Укажите CID аккаунта: /account 7973813934');
    return;
  }

  const accRes = await pool.query(
    `SELECT google_account_id, display_name, status, offer_vertical,
            total_spend, campaign_count, created_at
     FROM accounts WHERE google_account_id = $1`,
    [cid],
  );

  if (accRes.rows.length === 0) {
    await sendMessage(chatId, `❌ Аккаунт <code>${escapeHtml(cid)}</code> не найден.`);
    return;
  }

  const acc = accRes.rows[0] as {
    google_account_id: string; display_name: string | null;
    status: string; offer_vertical: string | null;
    total_spend: string; campaign_count: number; created_at: string;
  };

  // Bans count
  const bansRes = await pool.query(
    `SELECT COUNT(*) as cnt FROM ban_logs WHERE account_google_id = $1`,
    [cid],
  );
  const banCount = (bansRes.rows[0] as { cnt: string }).cnt;

  // Domain from ban_logs or campaigns
  const domainRes = await pool.query(
    `SELECT domain FROM ban_logs WHERE account_google_id = $1 AND domain IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    [cid],
  );
  const domain = (domainRes.rows[0] as { domain: string } | undefined)?.domain ?? null;

  const spend = parseFloat(acc.total_spend);
  const statusEmoji = acc.status === 'suspended' ? '🔴' : acc.status === 'active' ? '🟢' : '⚪';

  const text = [
    `${statusEmoji} <b>Аккаунт ${formatCid(acc.google_account_id)}</b>`,
    '',
    acc.display_name ? `📛 Имя: ${escapeHtml(acc.display_name)}` : null,
    `📊 Статус: <b>${escapeHtml(acc.status)}</b>`,
    domain ? `🌐 Домен: ${escapeHtml(domain)}` : null,
    acc.offer_vertical ? `📁 Вертикаль: ${escapeHtml(acc.offer_vertical)}` : null,
    `🚨 Банов: ${banCount}`,
    `📣 Кампаний: ${acc.campaign_count}`,
    `💰 Расход: $${spend.toFixed(2)}`,
    '',
    `🔗 <a href="${env.DASHBOARD_URL}/accounts/${cid}">Открыть в Dashboard</a>`,
  ].filter(Boolean).join('\n');

  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      [
        { text: '🤖 AI Анализ', callback_data: `ai:${cid}` },
        { text: '🎯 ML Прогноз', callback_data: `predict:${cid}` },
      ],
      [
        { text: '🔗 Связи', callback_data: `chains:${cid}` },
        { text: '💸 Расход', callback_data: `velocity:${cid}` },
      ],
      [
        { text: '📊 Quality', callback_data: `quality:${cid}` },
        { text: '🔄 Обновить', callback_data: `account:${cid}` },
      ],
    ],
  };

  await sendMessageWithKeyboard(chatId, text, keyboard);
};

// /bans — Recent bans
commands['bans'] = async (chatId, _args, pool) => {
  const user = await requireAuth(chatId, pool);
  if (!user) return;

  const result = await pool.query(
    `SELECT bl.account_google_id, bl.ban_reason, bl.created_at,
            a.display_name
     FROM ban_logs bl
     LEFT JOIN accounts a ON a.google_account_id = bl.account_google_id
     ORDER BY bl.created_at DESC
     LIMIT 10`,
  );

  if (result.rows.length === 0) {
    await sendMessage(chatId, '✅ Банов нет!');
    return;
  }

  const lines = result.rows.map((row) => {
    const r = row as { account_google_id: string; ban_reason: string | null; created_at: string; display_name: string | null };
    const reason = r.ban_reason ? escapeHtml(r.ban_reason.replace(/^\d+:/, '').replace(/_/g, ' ').toLowerCase()) : 'неизвестна';
    const date = new Date(r.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `🚨 <code>${formatCid(r.account_google_id)}</code>\n   ${reason} · ${date}`;
  });

  const text = [
    '🚨 <b>Последние баны</b>',
    '',
    ...lines,
  ].join('\n');

  await sendMessageWithKeyboard(chatId, text, {
    inline_keyboard: navRow('bans', 'Баны и риски'),
  });
};

// /risks — High risk accounts
commands['risks'] = async (chatId, _args, pool) => {
  const user = await requireAuth(chatId, pool);
  if (!user) return;

  const result = await pool.query(
    `SELECT a.google_account_id, a.display_name, a.status,
            COUNT(DISTINCT bl.id) as ban_count,
            COUNT(DISTINCT CASE WHEN nd.category = 'CRITICAL' OR nd.category = 'WARNING' THEN nd.id END) as warning_count
     FROM accounts a
     LEFT JOIN ban_logs bl ON bl.account_google_id = a.google_account_id
     LEFT JOIN notification_details nd ON nd.account_google_id = a.google_account_id
     WHERE a.status != 'suspended'
     GROUP BY a.id, a.google_account_id, a.display_name, a.status
     HAVING COUNT(DISTINCT CASE WHEN nd.category = 'CRITICAL' OR nd.category = 'WARNING' THEN nd.id END) > 0
        OR COUNT(DISTINCT bl.id) > 0
     ORDER BY COUNT(DISTINCT CASE WHEN nd.category = 'CRITICAL' THEN nd.id END) DESC,
              COUNT(DISTINCT bl.id) DESC
     LIMIT 10`,
  );

  if (result.rows.length === 0) {
    await sendMessage(chatId, '✅ Аккаунтов с высоким риском не обнаружено.');
    return;
  }

  const lines = result.rows.map((row) => {
    const r = row as { google_account_id: string; display_name: string | null; ban_count: string; warning_count: string };
    const bans = parseInt(r.ban_count) > 0 ? `${r.ban_count} бан` : '';
    const warnings = parseInt(r.warning_count) > 0 ? `${r.warning_count} предупр.` : '';
    const detail = [bans, warnings].filter(Boolean).join(', ');
    return `⚠️ <code>${formatCid(r.google_account_id)}</code> — ${detail}`;
  });

  const text = [
    '⚠️ <b>Аккаунты с повышенным риском</b>',
    '',
    ...lines,
    '',
    '📌 /account &lt;CID&gt; — детали аккаунта',
  ].join('\n');

  await sendMessageWithKeyboard(chatId, text, {
    inline_keyboard: navRow('bans', 'Баны и риски'),
  });
};

// /analytics — Analytics overview
commands['analytics'] = async (chatId, _args, pool) => {
  const user = await requireAuth(chatId, pool);
  if (!user) return;

  const totalRes = await pool.query(`SELECT COUNT(*) as cnt FROM accounts`);
  const bannedRes = await pool.query(`SELECT COUNT(DISTINCT account_google_id) as cnt FROM ban_logs`);
  const totalAccounts = parseInt((totalRes.rows[0] as { cnt: string }).cnt);
  const bannedAccounts = parseInt((bannedRes.rows[0] as { cnt: string }).cnt);
  const banRate = totalAccounts > 0 ? ((bannedAccounts / totalAccounts) * 100).toFixed(1) : '0';

  // Average lifetime
  const lifetimeRes = await pool.query(
    `SELECT AVG(EXTRACT(EPOCH FROM (bl.created_at - a.created_at)) / 3600) as avg_hours
     FROM ban_logs bl
     JOIN accounts a ON a.google_account_id = bl.account_google_id`,
  );
  const avgLifetime = parseFloat((lifetimeRes.rows[0] as { avg_hours: string | null }).avg_hours ?? '0');

  // Top ban reasons
  const reasonsRes = await pool.query(
    `SELECT ban_reason, COUNT(*) as cnt
     FROM ban_logs WHERE ban_reason IS NOT NULL
     GROUP BY ban_reason ORDER BY cnt DESC LIMIT 5`,
  );

  const reasonLines = reasonsRes.rows.map((row) => {
    const r = row as { ban_reason: string; cnt: string };
    const clean = r.ban_reason.replace(/^\d+:/, '').replace(/_/g, ' ').toLowerCase();
    return `  • ${escapeHtml(clean)}: ${r.cnt}`;
  });

  const text = [
    '📈 <b>Аналитика</b>',
    '',
    `📊 Всего аккаунтов: <b>${totalAccounts}</b>`,
    `🚨 Забанено: <b>${bannedAccounts}</b> (${banRate}%)`,
    `⏱ Средний lifetime: <b>${avgLifetime.toFixed(1)}ч</b>`,
    '',
    reasonLines.length > 0 ? '<b>Топ причин бана:</b>' : null,
    ...reasonLines,
    '',
    `🔗 <a href="${env.DASHBOARD_URL}/analytics">Полная аналитика</a>`,
  ].filter(Boolean).join('\n');

  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      [
        { text: '📉 Creative Decay', callback_data: 'cmd:decay' },
        { text: '🌐 Домены', callback_data: 'cmd:domains' },
      ],
      ...navRow('analytics', 'Аналитика'),
    ],
  };

  await sendMessageWithKeyboard(chatId, text, keyboard);
};

// /decay — Creative decay (compares recent 3 days vs baseline 7 days from creative_snapshots)
commands['decay'] = async (chatId, _args, pool) => {
  const user = await requireAuth(chatId, pool);
  if (!user) return;

  try {
    const result = await pool.query(
      `WITH baseline AS (
        SELECT campaign_id, account_google_id, campaign_name,
               AVG(ctr) AS baseline_ctr
        FROM creative_snapshots
        WHERE snapshot_date BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 4
          AND impressions >= 100
        GROUP BY campaign_id, account_google_id, campaign_name
      ),
      recent AS (
        SELECT campaign_id, account_google_id,
               AVG(ctr) AS current_ctr
        FROM creative_snapshots
        WHERE snapshot_date >= CURRENT_DATE - 3
          AND impressions >= 100
        GROUP BY campaign_id, account_google_id
      )
      SELECT b.campaign_id, b.campaign_name, b.account_google_id,
             b.baseline_ctr, r.current_ctr,
             ROUND(((r.current_ctr - b.baseline_ctr) / NULLIF(b.baseline_ctr, 0)) * 100, 1) AS ctr_change_pct
      FROM baseline b
      JOIN recent r ON b.campaign_id = r.campaign_id AND b.account_google_id = r.account_google_id
      WHERE b.baseline_ctr > 0
        AND ((r.current_ctr - b.baseline_ctr) / b.baseline_ctr) < -0.15
      ORDER BY ctr_change_pct ASC
      LIMIT 10`,
    );

    if (result.rows.length === 0) {
      await sendMessageWithKeyboard(chatId, '✅ Активных creative decay не обнаружено. CTR всех кампаний в норме.', {
        inline_keyboard: navRow('analytics', 'Аналитика'),
      });
      return;
    }

    const lines = result.rows.map((row) => {
      const r = row as {
        campaign_id: string; campaign_name: string; account_google_id: string;
        baseline_ctr: number | null; current_ctr: number | null; ctr_change_pct: number | null;
      };
      const change = r.ctr_change_pct != null ? Number(r.ctr_change_pct).toFixed(1) : '?';
      const emoji = (Number(r.ctr_change_pct) ?? 0) < -30 ? '🔴' : '⚠️';
      const basePct = r.baseline_ctr != null ? (Number(r.baseline_ctr) * 100).toFixed(2) : '?';
      const currPct = r.current_ctr != null ? (Number(r.current_ctr) * 100).toFixed(2) : '?';
      return `${emoji} <code>${formatCid(r.account_google_id)}</code>\n   ${escapeHtml(r.campaign_name ?? 'N/A')}\n   CTR: ${basePct}% → ${currPct}% (${change}%)`;
    });

    const text = [
      '📉 <b>Creative Decay</b>',
      '',
      ...lines,
      '',
      '💡 Рекомендация: обновите креативы у кампаний с падением CTR',
    ].join('\n');

    await sendMessageWithKeyboard(chatId, text, {
      inline_keyboard: navRow('analytics', 'Аналитика'),
    });
  } catch (err) {
    console.error('[telegram-cmd] decay error:', err instanceof Error ? err.message : err);
    await sendMessageWithKeyboard(chatId, '📉 Creative Decay: ошибка при загрузке данных. Попробуйте позже.', {
      inline_keyboard: navRow('analytics', 'Аналитика'),
    });
  }
};

// /domains — Domain stats
commands['domains'] = async (chatId, _args, pool) => {
  const user = await requireAuth(chatId, pool);
  if (!user) return;

  const result = await pool.query(
    `SELECT d.domain_name as domain,
            COUNT(DISTINCT bl.account_google_id) as account_count,
            COUNT(DISTINCT bl.id) as ban_count
     FROM domains d
     LEFT JOIN ban_logs bl ON bl.domain = d.domain_name
     GROUP BY d.domain_name
     ORDER BY COUNT(DISTINCT bl.account_google_id) DESC
     LIMIT 10`,
  );

  if (result.rows.length === 0) {
    await sendMessage(chatId, 'Домены не найдены.');
    return;
  }

  const lines = result.rows.map((row) => {
    const r = row as { domain: string; account_count: string; ban_count: string };
    const bans = parseInt(r.ban_count) > 0 ? ` · 🚨${r.ban_count}` : '';
    return `🌐 ${escapeHtml(r.domain)} — ${r.account_count} акк${bans}`;
  });

  const text = [
    '🌐 <b>Домены</b> (топ 10)',
    '',
    ...lines,
    '',
    `🔗 <a href="${env.DASHBOARD_URL}/domains">Все домены</a>`,
  ].join('\n');

  await sendMessageWithKeyboard(chatId, text, {
    inline_keyboard: navRow('analytics', 'Аналитика'),
  });
};

// /scan <domain> — Domain content analysis
commands['scan'] = async (chatId, args, pool) => {
  const user = await requireAuth(chatId, pool);
  if (!user) return;

  const domain = args.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!domain) {
    await sendMessage(chatId, '⚠️ Укажите домен: <code>/scan example.com</code>');
    return;
  }

  await sendMessage(chatId, `🔍 Анализирую <code>${escapeHtml(domain)}</code>...`);

  try {
    const { analyzeContent } = await import('./domain-content-analyzer.js');
    const result = await analyzeContent(`https://${domain}`);

    const riskEmoji = result.contentRiskScore >= 70 ? '🔴' : result.contentRiskScore >= 40 ? '🟡' : '🟢';
    const compEmoji = result.complianceScore >= 70 ? '🟢' : result.complianceScore >= 40 ? '🟡' : '🔴';

    const kwLines: string[] = [];
    const critical = result.keywordMatches.filter(m => m.severity === 'critical');
    const warning = result.keywordMatches.filter(m => m.severity === 'warning');
    if (critical.length > 0) kwLines.push(`  🔴 Critical: ${critical.map(m => m.keyword).join(', ')}`);
    if (warning.length > 0) kwLines.push(`  ⚠️ Warning: ${warning.map(m => m.keyword).join(', ')}`);

    const flagLines = result.redFlags.map(f => {
      const e = f.severity === 'critical' ? '🔴' : f.severity === 'warning' ? '⚠️' : 'ℹ️';
      return `  ${e} ${escapeHtml(f.detail)}`;
    });

    const lines = [
      `🔍 <b>Content Analysis: ${escapeHtml(domain)}</b>`,
      '',
      `${riskEmoji} Content Risk: <b>${result.contentRiskScore}/100</b>`,
      `🎯 Keywords: <b>${result.keywordRiskScore}/100</b>`,
      `${compEmoji} Compliance: <b>${result.complianceScore}/100</b>`,
      `🏗 Structure: <b>${result.structureRiskScore}/100</b>`,
      `🔀 Redirects: <b>${result.redirectRiskScore}/100</b>`,
    ];

    if (result.detectedVertical) {
      lines.push(`\n📂 Вертикаль: <b>${escapeHtml(result.detectedVertical)}</b>`);
    }

    if (kwLines.length > 0) {
      lines.push(`\n🔑 <b>Grey Keywords (${result.keywordMatches.length}):</b>`);
      lines.push(...kwLines);
    }

    lines.push('');
    lines.push(`📄 Compliance:`);
    lines.push(`  Privacy Policy: ${result.hasPrivacyPolicy ? '✅' : '❌'}`);
    lines.push(`  Terms of Service: ${result.hasTermsOfService ? '✅' : '❌'}`);
    lines.push(`  Contact Info: ${result.hasContactInfo ? '✅' : '❌'}`);
    lines.push(`  Disclaimer: ${result.hasDisclaimer ? '✅' : '❌'}`);

    if (flagLines.length > 0) {
      lines.push(`\n🚩 <b>Red Flags (${result.redFlags.length}):</b>`);
      lines.push(...flagLines);
    }

    if (result.redirectCount > 1) {
      lines.push(`\n🔀 Redirect Chain (${result.redirectCount}):`);
      for (const u of result.redirectChain.slice(0, 5)) lines.push(`  → ${escapeHtml(u)}`);
      if (result.urlMismatch) lines.push('  ⚠️ URL mismatch!');
    }

    // TLD & Security Headers
    const tldEmoji = result.tldRisk.risk === 'high' ? '🔴' : result.tldRisk.risk === 'medium' ? '🟡' : '🟢';
    lines.push(`\n${tldEmoji} TLD: <b>${escapeHtml(result.tldRisk.tld)}</b> (${result.tldRisk.risk})`);
    lines.push(`🔒 Security Headers: <b>${result.securityHeaders.securityScore}/100</b>`);
    if (result.securityHeaders.serverHeader) lines.push(`  Server: ${escapeHtml(result.securityHeaders.serverHeader)}`);

    // robots.txt
    if (result.robotsTxt.exists) {
      if (result.robotsTxt.blocksGooglebot) {
        lines.push(`\n🤖 robots.txt: 🔴 <b>Блокирует Googlebot!</b>`);
      } else {
        lines.push(`\n🤖 robots.txt: ✅ Googlebot разрешён${result.robotsTxt.hasSitemap ? ' · Sitemap есть' : ''}`);
      }
    }

    // Third-party scripts
    const scripts = [...result.thirdPartyScripts.analytics, ...result.thirdPartyScripts.advertising];
    const suspiciousScripts = result.thirdPartyScripts.suspicious;
    if (scripts.length > 0 || suspiciousScripts.length > 0) {
      lines.push(`\n📜 <b>Скрипты:</b>`);
      if (scripts.length > 0) lines.push(`  ${scripts.join(', ')}`);
      if (suspiciousScripts.length > 0) lines.push(`  🔴 Подозрительные: ${suspiciousScripts.join(', ')}`);
    }

    // Forms
    if (result.formAnalysis.forms.length > 0) {
      const formParts: string[] = [`${result.formAnalysis.forms.length} форм`];
      if (result.formAnalysis.collectsPersonalData) formParts.push('📋 персональные данные');
      if (result.formAnalysis.collectsPaymentData) formParts.push('💳 платёжные данные');
      if (result.formAnalysis.externalFormTargets.length > 0) formParts.push(`🔗 внешние: ${result.formAnalysis.externalFormTargets.join(', ')}`);
      lines.push(`\n📝 Формы: ${formParts.join(' · ')}`);
    }

    // Link reputation
    const linkIssues = [...result.linkReputation.affiliateLinks, ...result.linkReputation.trackerLinks, ...result.linkReputation.shortenerLinks];
    if (linkIssues.length > 0) {
      lines.push(`\n🔗 <b>Подозрительные ссылки:</b>`);
      if (result.linkReputation.affiliateLinks.length > 0) lines.push(`  Affiliate: ${result.linkReputation.affiliateLinks.join(', ')}`);
      if (result.linkReputation.trackerLinks.length > 0) lines.push(`  Trackers: ${result.linkReputation.trackerLinks.join(', ')}`);
      if (result.linkReputation.shortenerLinks.length > 0) lines.push(`  Shorteners: ${result.linkReputation.shortenerLinks.join(', ')}`);
    }

    // Structured data
    if (result.structuredData.hasJsonLd) {
      lines.push(`\n🏷 Schema.org: ${result.structuredData.schemaTypes.join(', ')}`);
    }

    // External APIs
    if (result.safeBrowsing.checked) {
      lines.push(result.safeBrowsing.safe
        ? `\n🛡 Safe Browsing: ✅ Безопасен`
        : `\n🛡 Safe Browsing: 🔴 <b>УГРОЗЫ: ${result.safeBrowsing.threats.map(t => t.type).join(', ')}</b>`);
    }
    if (result.pageSpeed.checked && result.pageSpeed.performanceScore != null) {
      const psEmoji = result.pageSpeed.performanceScore >= 90 ? '🟢' : result.pageSpeed.performanceScore >= 50 ? '🟡' : '🔴';
      const lcp = result.pageSpeed.largestContentfulPaint != null ? ` · LCP: ${(result.pageSpeed.largestContentfulPaint / 1000).toFixed(1)}s` : '';
      lines.push(`${psEmoji} PageSpeed: <b>${result.pageSpeed.performanceScore}/100</b>${lcp}`);
    }
    if (result.virusTotal.checked) {
      if (result.virusTotal.malicious > 0) {
        lines.push(`🦠 VirusTotal: 🔴 <b>${result.virusTotal.malicious} malicious</b>, ${result.virusTotal.suspicious} suspicious`);
      } else if (result.virusTotal.suspicious > 0) {
        lines.push(`🦠 VirusTotal: ⚠️ ${result.virusTotal.suspicious} suspicious`);
      } else {
        lines.push(`🦠 VirusTotal: ✅ Чисто`);
      }
      if (result.virusTotal.categories.length > 0) lines.push(`  Категории: ${result.virusTotal.categories.slice(0, 3).join(', ')}`);
    }
    if (result.wayback.checked && result.wayback.hasHistory) {
      const age = result.wayback.domainAgeFromArchive != null ? `${Math.round(result.wayback.domainAgeFromArchive / 365 * 10) / 10} лет` : '?';
      lines.push(`📚 Wayback: ${age} в архиве (с ${result.wayback.firstSnapshot})`);
    }

    // Page metrics
    lines.push(`\n📊 ${result.wordCount} слов · ${result.totalLinks} ссылок (${result.externalLinks} внешних) · ${result.scriptCount} скриптов · ${result.iframeCount} iframe`);
    if (result.pageLanguage) lines.push(`🌐 Язык: ${result.pageLanguage}`);

    if (result.wordCount < 50) {
      lines.push(`\n⚠️ <i>Мало контента — сайт может использовать JS-рендеринг (SPA). Результаты могут быть неполными.</i>`);
    }

    await sendMessageWithKeyboard(chatId, lines.join('\n'), {
      inline_keyboard: [
        [{ text: '🔗 Открыть в Dashboard', callback_data: `hint:scan_dash` }],
        ...navRow('analytics', 'Аналитика'),
      ],
    });
  } catch (err) {
    console.error('[telegram-cmd] scan error:', err instanceof Error ? err.message : err);
    await sendMessage(chatId, `❌ Не удалось проанализировать <code>${escapeHtml(domain)}</code>: ${escapeHtml(err instanceof Error ? err.message : 'ошибка')}`);
  }
};

// /ai <CID> — AI analysis
commands['ai'] = async (chatId, args, pool) => {
  const user = await requireAuth(chatId, pool);
  if (!user) return;

  const cid = args.replace(/[-\s]/g, '').trim();
  if (!cid) {
    await sendMessage(chatId, 'Укажите CID аккаунта: /ai 7973813934\n\nДля теста фидбека: /ai test');
    return;
  }

  // --- Test mode: show mock results with feedback buttons ---
  if (cid === 'test') {
    const predRes = await pool.query(
      `SELECT id, model_id, predicted_risk_level, predicted_ban_prob, latency_ms, tokens_used, cost_usd
       FROM ai_model_predictions ORDER BY created_at DESC LIMIT 3`,
    );

    if (predRes.rows.length === 0) {
      await sendMessageWithKeyboard(chatId, '⚠️ Нет тестовых predictions в БД.\n\nВставьте тестовые данные через psql.', {
        inline_keyboard: navRow('ai', 'AI / ML'),
      });
      return;
    }

    const lines = ['🤖 <b>[ТЕСТ] AI-анализ</b>', '', 'Результаты моделей:'];

    const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

    for (const row of predRes.rows) {
      const r = row as { id: string; model_id: string; predicted_risk_level: string | null; predicted_ban_prob: string | null; latency_ms: number; tokens_used: number; cost_usd: string };
      const riskEmoji = r.predicted_risk_level === 'high' ? '🔴' : r.predicted_risk_level === 'medium' ? '🟡' : '🟢';
      const prob = r.predicted_ban_prob != null ? `${(parseFloat(r.predicted_ban_prob) * 100).toFixed(0)}%` : '?';
      lines.push('');
      lines.push(`${riskEmoji} <b>${escapeHtml(r.model_id)}</b> — риск: ${r.predicted_risk_level ?? '?'} (${prob})`);
      lines.push(`   ⏱ ${r.latency_ms}ms · 🔤 ${r.tokens_used} токенов · 💰 $${parseFloat(r.cost_usd).toFixed(4)}`);

      // Feedback buttons for this prediction
      keyboard.push([
        { text: `👍 ${r.model_id}`, callback_data: `feedback:like:${r.id}` },
        { text: `👎 ${r.model_id}`, callback_data: `feedback:dislike:${r.id}` },
      ]);
    }

    lines.push('', '<i>Нажмите 👍/👎 чтобы оценить модель:</i>');
    keyboard.push(...navRow('ai', 'AI / ML'));

    await sendMessageWithKeyboard(chatId, lines.join('\n'), { inline_keyboard: keyboard });
    return;
  }

  const accRes = await pool.query(
    `SELECT google_account_id FROM accounts WHERE google_account_id = $1`,
    [cid],
  );

  if (accRes.rows.length === 0) {
    await sendMessage(chatId, `❌ Аккаунт <code>${escapeHtml(cid)}</code> не найден.`);
    return;
  }

  await sendMessage(chatId, `🤖 Запускаю AI-анализ для <code>${formatCid(cid)}</code>... Это может занять 10-30 секунд.`);

  try {
    const { analyzeAccountForTelegram } = await import('./ai/ai-telegram.service.js');
    const resultText = await analyzeAccountForTelegram(pool, cid);
    await sendMessageWithKeyboard(chatId, resultText, {
      inline_keyboard: navRow('ai', 'AI / ML'),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Неизвестная ошибка';
    await sendMessageWithKeyboard(chatId, `❌ AI-анализ не удался: ${escapeHtml(msg)}\n\nВозможно, не настроены API-ключи AI моделей.`, {
      inline_keyboard: navRow('ai', 'AI / ML'),
    });
  }
};

// /predict <CID> — ML ban prediction
commands['predict'] = async (chatId, args, pool) => {
  const user = await requireAuth(chatId, pool);
  if (!user) return;

  const cid = args.replace(/[-\s]/g, '').trim();
  if (!cid) {
    await sendMessage(chatId, 'Укажите CID аккаунта: /predict 7973813934');
    return;
  }

  const accRes = await pool.query(
    `SELECT google_account_id FROM accounts WHERE google_account_id = $1`,
    [cid],
  );
  if (accRes.rows.length === 0) {
    await sendMessage(chatId, `❌ Аккаунт <code>${escapeHtml(cid)}</code> не найден.`);
    return;
  }

  try {
    const { BanPredictor } = await import('./ml/ban-predictor.js');
    const { getAccountFeatures } = await import('./feature-extraction.service.js');
    const predictor = new BanPredictor();
    await predictor.loadModel(pool);

    if (!predictor.isReady()) {
      await sendMessage(chatId, '⚠️ ML-модель ещё не обучена. Запустите обучение через Dashboard.');
      return;
    }

    const features = await getAccountFeatures(pool, cid);
    if (!features) {
      await sendMessage(chatId, `❌ Данных по аккаунту <code>${formatCid(cid)}</code> недостаточно для прогноза.`);
      return;
    }

    const result = predictor.predict(features);

    const riskEmoji = result.risk_level === 'critical' ? '🔴🔴'
      : result.risk_level === 'high' ? '🔴'
      : result.risk_level === 'medium' ? '🟡' : '🟢';

    const factors = result.top_factors.slice(0, 5).map((f) => {
      const arrow = f.direction === 'increases_risk' ? '📈' : '📉';
      return `  ${arrow} ${escapeHtml(f.label)}: ${f.value.toFixed(2)} (${f.direction === 'increases_risk' ? '+' : '-'}${f.contribution.toFixed(3)})`;
    });

    const lines = [
      `🎯 <b>ML Прогноз: ${formatCid(cid)}</b>`,
      '',
      `${riskEmoji} Риск: <b>${result.risk_level}</b>`,
      `📊 Вероятность бана: <b>${(result.ban_probability * 100).toFixed(1)}%</b>`,
      `🎯 Уверенность: ${(result.confidence * 100).toFixed(0)}%`,
    ];

    if (result.predicted_days_to_ban != null) {
      lines.push(`⏱ Прогноз до бана: <b>${result.predicted_days_to_ban} дн.</b>`);
    }

    if (factors.length > 0) {
      lines.push('', '<b>Ключевые факторы:</b>', ...factors);
    }

    await sendMessageWithKeyboard(chatId, lines.join('\n'), { inline_keyboard: navRow('ai', 'AI / ML') });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Неизвестная ошибка';
    await sendMessageWithKeyboard(chatId, `❌ ML-прогноз не удался: ${escapeHtml(msg)}\n\nВозможно, модель ещё не обучена.`, { inline_keyboard: navRow('ai', 'AI / ML') });
  }
};

// /assess — Risk assessment (pre-launch)
commands['assess'] = async (chatId, args, pool) => {
  const user = await requireAuth(chatId, pool);
  if (!user) return;

  // Parse args: domain and/or CID
  const parts = args.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) {
    await sendMessageWithKeyboard(chatId, [
      '📋 <b>Оценка риска перед запуском</b>',
      '',
      'Формат: /assess [домен] [CID] [вертикаль]',
      '',
      'Примеры:',
      '  /assess example.com',
      '  /assess example.com 7973813934',
      '  /assess example.com 7973813934 nutra',
    ].join('\n'), { inline_keyboard: navRow('ai', 'AI / ML') });
    return;
  }

  const req: Record<string, string> = {};
  for (const part of parts) {
    if (part.includes('.')) {
      req['domain'] = part;
    } else if (/^\d{10}$/.test(part.replace(/[-]/g, ''))) {
      req['account_google_id'] = part.replace(/[-]/g, '');
    } else {
      req['vertical'] = part;
    }
  }

  try {
    const { assess } = await import('./assessment.service.js');
    const result = await assess(pool, req);

    const riskEmoji = result.risk_level === 'critical' ? '🔴🔴'
      : result.risk_level === 'high' ? '🔴'
      : result.risk_level === 'medium' ? '🟡' : '🟢';

    const factorLines = result.factors.map((f) => {
      const fEmoji = f.score >= 60 ? '🔴' : f.score >= 35 ? '🟡' : '🟢';
      return `  ${fEmoji} ${escapeHtml(f.category)}: ${f.score}/100 (вес ${(f.weight * 100).toFixed(0)}%)`;
    });

    const lines = [
      `📋 <b>Оценка риска</b>`,
      '',
      `${riskEmoji} Общий риск: <b>${result.risk_score}/100 (${result.risk_level})</b>`,
      '',
      '<b>Факторы:</b>',
      ...factorLines,
    ];

    if (result.comparable_accounts.total > 0) {
      const ca = result.comparable_accounts;
      lines.push(
        '',
        '<b>Похожие аккаунты:</b>',
        `  Всего: ${ca.total}, забанено: ${ca.banned} (${ca.ban_rate.toFixed(1)}%)`,
        `  Средний lifetime: ${ca.avg_lifetime_days.toFixed(1)} дн.`,
      );
    }

    if (result.budget_recommendation != null) {
      lines.push('', `💰 Рекомендуемый бюджет: <b>$${result.budget_recommendation.toFixed(0)}</b>`);
    }

    if (result.recommendations.length > 0) {
      lines.push('', '<b>Рекомендации:</b>');
      result.recommendations.slice(0, 5).forEach(r => lines.push(`  • ${escapeHtml(r)}`));
    }

    await sendMessageWithKeyboard(chatId, lines.join('\n'), { inline_keyboard: navRow('ai', 'AI / ML') });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Неизвестная ошибка';
    await sendMessageWithKeyboard(chatId, `❌ Оценка не удалась: ${escapeHtml(msg)}`, { inline_keyboard: navRow('ai', 'AI / ML') });
  }
};

// /chains <CID> — Ban chain analysis
commands['chains'] = async (chatId, args, pool) => {
  const user = await requireAuth(chatId, pool);
  if (!user) return;

  const cid = args.replace(/[-\s]/g, '').trim();
  if (!cid) {
    await sendMessageWithKeyboard(chatId, 'Укажите CID аккаунта: /chains 7973813934', { inline_keyboard: navRow('bans', 'Баны') });
    return;
  }

  try {
    const { getDomainConnections, getBinConnections, getProxyConnections, getProfileConnections } =
      await import('../repositories/analytics.repository.js');

    const [domainConns, binConns, proxyConns, profileConns] = await Promise.all([
      getDomainConnections(pool, cid),
      getBinConnections(pool, cid),
      getProxyConnections(pool, cid),
      getProfileConnections(pool, cid),
    ]);

    interface Conn {
      account_google_id: string;
      display_name: string | null;
      link_type: string;
      link_value: string;
      banned_at: string | null;
    }

    const allConns: Conn[] = [
      ...domainConns.map(c => ({ ...c, link_type: 'domain' })),
      ...binConns.map(c => ({ ...c, link_type: 'bin' })),
      ...proxyConns.map(c => ({ ...c, link_type: 'proxy' })),
      ...profileConns.map(c => ({ ...c, link_type: 'profile' })),
    ];

    // Deduplicate by account_google_id
    const seen = new Set<string>();
    const unique = allConns.filter(c => {
      if (seen.has(c.account_google_id)) return false;
      seen.add(c.account_google_id);
      return true;
    });

    if (unique.length === 0) {
      await sendMessageWithKeyboard(chatId, `✅ У аккаунта <code>${formatCid(cid)}</code> не обнаружено связей с другими аккаунтами.`, { inline_keyboard: navRow('bans', 'Баны') });
      return;
    }

    const bannedCount = unique.filter(c => c.banned_at != null).length;
    const riskLevel = bannedCount >= 3 ? 'critical' : bannedCount >= 1 ? 'elevated' : 'low';
    const riskEmoji = riskLevel === 'critical' ? '🔴' : riskLevel === 'elevated' ? '🟡' : '🟢';

    const linkTypeEmoji: Record<string, string> = { domain: '🌐', bin: '💳', proxy: '🔗', profile: '👤' };

    const lines = [
      `🔗 <b>Связи аккаунта ${formatCid(cid)}</b>`,
      '',
      `${riskEmoji} Риск цепочки: <b>${riskLevel}</b> (${bannedCount} забанено из ${unique.length})`,
      '',
    ];

    unique.slice(0, 15).forEach(c => {
      const isBanned = c.banned_at != null;
      const emoji = isBanned ? '🚨' : '✅';
      const typeEmoji = linkTypeEmoji[c.link_type] ?? '🔗';
      lines.push(`${emoji} <code>${formatCid(c.account_google_id)}</code> ${typeEmoji}${escapeHtml(c.link_value)}`);
    });

    if (unique.length > 15) {
      lines.push('', `... и ещё ${unique.length - 15} связей`);
    }

    await sendMessageWithKeyboard(chatId, lines.join('\n'), { inline_keyboard: navRow('bans', 'Баны') });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Неизвестная ошибка';
    await sendMessageWithKeyboard(chatId, `❌ Ошибка анализа связей: ${escapeHtml(msg)}`, { inline_keyboard: navRow('bans', 'Баны') });
  }
};

// /velocity <CID> — Spend velocity
commands['velocity'] = async (chatId, args, pool) => {
  const user = await requireAuth(chatId, pool);
  if (!user) return;

  const cid = args.replace(/[-\s]/g, '').trim();
  if (!cid) {
    await sendMessageWithKeyboard(chatId, 'Укажите CID аккаунта: /velocity 7973813934', { inline_keyboard: navRow('analytics', 'Аналитика') });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT a.created_at as account_created,
              a.total_spend
       FROM accounts a WHERE a.google_account_id = $1`,
      [cid],
    );

    if (result.rows.length === 0) {
      await sendMessageWithKeyboard(chatId, `❌ Аккаунт <code>${escapeHtml(cid)}</code> не найден.`, { inline_keyboard: navRow('analytics', 'Аналитика') });
      return;
    }

    const acc = result.rows[0] as { account_created: string; total_spend: string };
    const ageDays = Math.max(1, Math.floor((Date.now() - new Date(acc.account_created).getTime()) / 86400000));
    const totalSpend = parseFloat(acc.total_spend);
    const avgDaily = totalSpend / ageDays;

    // Get daily campaign metrics for last 7 days
    const dailyRes = await pool.query(
      `SELECT date, SUM(cost) as daily_cost
       FROM campaign_daily_stats cds
       JOIN campaigns c ON c.id = cds.campaign_id
       WHERE c.account_google_id = $1
       AND date > NOW() - INTERVAL '7 days'
       GROUP BY date ORDER BY date DESC LIMIT 7`,
      [cid],
    );

    const statusEmoji = avgDaily > 100 ? '🔴' : avgDaily > 50 ? '🟡' : '🟢';

    const lines = [
      `💸 <b>Скорость расхода: ${formatCid(cid)}</b>`,
      '',
      `📅 Возраст: <b>${ageDays} дн.</b>`,
      `💰 Общий расход: <b>$${totalSpend.toFixed(2)}</b>`,
      `${statusEmoji} Средний расход/день: <b>$${avgDaily.toFixed(2)}</b>`,
    ];

    if (dailyRes.rows.length > 0) {
      lines.push('', '<b>Последние дни:</b>');
      dailyRes.rows.forEach((row) => {
        const r = row as { date: string; daily_cost: string };
        const cost = parseFloat(r.daily_cost);
        const date = new Date(r.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        lines.push(`  ${date}: $${cost.toFixed(2)}`);
      });
    }

    await sendMessageWithKeyboard(chatId, lines.join('\n'), { inline_keyboard: navRow('analytics', 'Аналитика') });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Неизвестная ошибка';
    await sendMessageWithKeyboard(chatId, `❌ Ошибка: ${escapeHtml(msg)}`, { inline_keyboard: navRow('analytics', 'Аналитика') });
  }
};

// /leaderboard — AI model leaderboard
commands['leaderboard'] = async (chatId, args, pool) => {
  const user = await requireAuth(chatId, pool);
  if (!user) return;

  try {
    const { calculateLeaderboardSummary } = await import('./ai/leaderboard.service.js');
    const period = args.trim() || '30d';
    const summary = await calculateLeaderboardSummary(pool, period);

    if (summary.entries.length === 0) {
      await sendMessageWithKeyboard(chatId, '📊 Лидерборд пуст. Запустите AI-анализ для нескольких аккаунтов.', { inline_keyboard: navRow('ai', 'AI / ML') });
      return;
    }

    const lines = [
      `🏆 <b>Лидерборд AI моделей</b> (${summary.period})`,
      '',
    ];

    const medals = ['🥇', '🥈', '🥉'];
    summary.entries.forEach((e, i) => {
      const medal = medals[i] ?? `${i + 1}.`;
      const acc = e.accuracy != null ? `acc ${(e.accuracy * 100).toFixed(0)}%` : '';
      const sat = e.user_satisfaction != null ? `👍${(e.user_satisfaction * 100).toFixed(0)}%` : '';
      const cost = `$${e.avg_cost_usd.toFixed(4)}`;
      const details = [acc, sat, cost].filter(Boolean).join(' · ');
      lines.push(`${medal} <b>${escapeHtml(e.model)}</b> — score ${(e.composite_score * 100).toFixed(1)}`);
      lines.push(`   ${details} · ${e.total_analyses} анализов`);
    });

    if (!summary.has_outcomes) {
      lines.push('', '⚠️ Мало данных для accuracy. Score по latency и cost.');
    }

    const keyboard: InlineKeyboard = {
      inline_keyboard: [
        [
          { text: '7 дней', callback_data: 'leaderboard:7d' },
          { text: '30 дней', callback_data: 'leaderboard:30d' },
          { text: 'Всё время', callback_data: 'leaderboard:all' },
        ],
        ...navRow('ai', 'AI / ML'),
      ],
    };

    await sendMessageWithKeyboard(chatId, lines.join('\n'), keyboard);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Неизвестная ошибка';
    await sendMessageWithKeyboard(chatId, `❌ Ошибка: ${escapeHtml(msg)}`, { inline_keyboard: navRow('ai', 'AI / ML') });
  }
};

// /quality <CID> — Keyword quality scores
commands['quality'] = async (chatId, args, pool) => {
  const user = await requireAuth(chatId, pool);
  if (!user) return;

  const cid = args.replace(/[-\s]/g, '').trim();
  if (!cid) {
    await sendMessageWithKeyboard(chatId, 'Укажите CID аккаунта: /quality 7973813934', { inline_keyboard: navRow('analytics', 'Аналитика') });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT k.keyword_text, k.quality_score, k.match_type,
              kds.impressions, kds.clicks, kds.cost
       FROM keywords k
       LEFT JOIN keyword_daily_stats kds ON kds.keyword_id = k.id
         AND kds.date = (SELECT MAX(date) FROM keyword_daily_stats WHERE keyword_id = k.id)
       WHERE k.account_google_id = $1
       ORDER BY k.quality_score ASC NULLS LAST
       LIMIT 15`,
      [cid],
    );

    if (result.rows.length === 0) {
      await sendMessageWithKeyboard(chatId, `Ключевые слова для <code>${formatCid(cid)}</code> не найдены.`, { inline_keyboard: navRow('analytics', 'Аналитика') });
      return;
    }

    // Distribution
    const distRes = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE quality_score >= 7) as good,
         COUNT(*) FILTER (WHERE quality_score BETWEEN 4 AND 6) as avg,
         COUNT(*) FILTER (WHERE quality_score <= 3) as bad,
         COUNT(*) as total,
         ROUND(AVG(quality_score), 1) as avg_qs
       FROM keywords WHERE account_google_id = $1 AND quality_score IS NOT NULL`,
      [cid],
    );

    const dist = distRes.rows[0] as { good: string; avg: string; bad: string; total: string; avg_qs: string };

    const lines = [
      `📊 <b>Quality Score: ${formatCid(cid)}</b>`,
      '',
      `Средний QS: <b>${dist.avg_qs ?? 'N/A'}</b>`,
      `🟢 Хорошие (7+): ${dist.good}  🟡 Средние (4-6): ${dist.avg}  🔴 Плохие (1-3): ${dist.bad}`,
      `Всего: ${dist.total}`,
      '',
      '<b>Худшие ключи:</b>',
    ];

    result.rows.forEach((row) => {
      const r = row as { keyword_text: string; quality_score: number | null; match_type: string | null; impressions: string | null };
      const qs = r.quality_score != null ? String(r.quality_score) : '?';
      const emoji = (r.quality_score ?? 0) <= 3 ? '🔴' : (r.quality_score ?? 0) <= 6 ? '🟡' : '🟢';
      const imp = r.impressions ? ` · ${r.impressions} imp` : '';
      lines.push(`  ${emoji} QS ${qs} — ${escapeHtml(r.keyword_text)}${imp}`);
    });

    await sendMessageWithKeyboard(chatId, lines.join('\n'), { inline_keyboard: navRow('analytics', 'Аналитика') });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Неизвестная ошибка';
    await sendMessageWithKeyboard(chatId, `❌ Ошибка: ${escapeHtml(msg)}`, { inline_keyboard: navRow('analytics', 'Аналитика') });
  }
};

// /notifications — Recent notifications
commands['notifications'] = async (chatId, _args, pool) => {
  const user = await requireAuth(chatId, pool);
  if (!user) return;

  const unreadRes = await pool.query(
    `SELECT COUNT(*) as cnt FROM notifications WHERE user_id = $1 AND is_read = false`,
    [user.id],
  );
  const unread = (unreadRes.rows[0] as { cnt: string }).cnt;

  const result = await pool.query(
    `SELECT title, message, severity, type, is_read, created_at
     FROM notifications
     WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 10`,
    [user.id],
  );

  if (result.rows.length === 0) {
    await sendMessageWithKeyboard(chatId, '📭 У вас нет уведомлений.', { inline_keyboard: navRow('overview', 'Обзор') });
    return;
  }

  const severityEmoji: Record<string, string> = {
    critical: '🔴',
    warning: '⚠️',
    info: 'ℹ️',
    success: '✅',
  };

  const lines = [
    `🔔 <b>Уведомления</b> (непрочитанных: ${unread})`,
    '',
  ];

  result.rows.forEach((row) => {
    const r = row as { title: string; message: string | null; severity: string; is_read: boolean; created_at: string };
    const emoji = severityEmoji[r.severity] ?? 'ℹ️';
    const readMark = r.is_read ? '' : ' 🆕';
    const date = new Date(r.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    lines.push(`${emoji}${readMark} <b>${escapeHtml(r.title)}</b>`);
    if (r.message) lines.push(`   ${escapeHtml(r.message).slice(0, 100)}`);
    lines.push(`   <i>${date}</i>`);
    lines.push('');
  });

  lines.push(`🔗 <a href="${env.DASHBOARD_URL}/notifications">Все уведомления</a>`);

  await sendMessageWithKeyboard(chatId, lines.join('\n'), { inline_keyboard: navRow('overview', 'Обзор') });
};

// /postmortem <ban_id or CID> — Ban post-mortem
commands['postmortem'] = async (chatId, args, pool) => {
  const user = await requireAuth(chatId, pool);
  if (!user) return;

  const input = args.replace(/[-\s]/g, '').trim();
  if (!input) {
    await sendMessageWithKeyboard(chatId, 'Укажите CID или ID бана: /postmortem 7973813934', { inline_keyboard: navRow('bans', 'Баны') });
    return;
  }

  try {
    // Try to find ban by account CID first (latest ban)
    let banId: string | null = null;
    const banRes = await pool.query(
      `SELECT id, account_google_id, ban_reason, domain, post_mortem, created_at
       FROM ban_logs
       WHERE account_google_id = $1 OR id::text = $2
       ORDER BY created_at DESC LIMIT 1`,
      [input, args.trim()],
    );

    if (banRes.rows.length === 0) {
      await sendMessageWithKeyboard(chatId, `❌ Бан для <code>${escapeHtml(input)}</code> не найден.`, { inline_keyboard: navRow('bans', 'Баны') });
      return;
    }

    const ban = banRes.rows[0] as {
      id: string; account_google_id: string; ban_reason: string | null;
      domain: string | null; post_mortem: Record<string, unknown> | null; created_at: string;
    };
    banId = ban.id;

    if (!ban.post_mortem) {
      await sendMessageWithKeyboard(chatId, `📝 Post-mortem для этого бана ещё не сгенерирован.\n\nID бана: <code>${banId}</code>`, { inline_keyboard: navRow('bans', 'Баны') });
      return;
    }

    const pm = ban.post_mortem;
    const date = new Date(ban.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });

    const lines = [
      `📝 <b>Post-Mortem</b>`,
      '',
      `🚨 Бан: <code>${formatCid(ban.account_google_id)}</code>`,
      `📅 Дата: ${date}`,
      ban.ban_reason ? `📋 Причина: ${escapeHtml(ban.ban_reason)}` : null,
      ban.domain ? `🌐 Домен: ${escapeHtml(ban.domain)}` : null,
    ].filter(Boolean);

    // Extract key post-mortem fields
    if (pm['summary']) {
      lines.push('', `<b>Итог:</b> ${escapeHtml(String(pm['summary']))}`);
    }
    if (pm['root_cause']) {
      lines.push(`<b>Причина:</b> ${escapeHtml(String(pm['root_cause']))}`);
    }
    if (Array.isArray(pm['contributing_factors'])) {
      lines.push('', '<b>Факторы:</b>');
      (pm['contributing_factors'] as string[]).slice(0, 5).forEach(f =>
        lines.push(`  • ${escapeHtml(String(f))}`),
      );
    }
    if (Array.isArray(pm['lessons_learned'])) {
      lines.push('', '<b>Уроки:</b>');
      (pm['lessons_learned'] as string[]).slice(0, 3).forEach(l =>
        lines.push(`  • ${escapeHtml(String(l))}`),
      );
    }

    await sendMessageWithKeyboard(chatId, lines.join('\n'), { inline_keyboard: navRow('bans', 'Баны') });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Неизвестная ошибка';
    await sendMessageWithKeyboard(chatId, `❌ Ошибка: ${escapeHtml(msg)}`, { inline_keyboard: navRow('bans', 'Баны') });
  }
};

// ─── Exports ─────────────────────────────────────────────────────────────────

export async function handleCommand(chatId: string, command: string, args: string, pool: Pool): Promise<boolean> {
  const handler = commands[command];
  if (!handler) return false;

  try {
    await handler(chatId, args, pool);
  } catch (err) {
    console.error(`[telegram] Command /${command} error:`, err);
    await sendMessage(chatId, `❌ Ошибка при выполнении /${command}. Попробуйте позже.`);
  }
  return true;
}

const HINT_MESSAGES: Record<string, string> = {
  ai: '🤖 Отправьте: /ai &lt;CID&gt;\nПример: <code>/ai 7973813934</code>',
  predict: '🎯 Отправьте: /predict &lt;CID&gt;\nПример: <code>/predict 7973813934</code>',
  assess: '📋 Отправьте: /assess &lt;домен&gt; &lt;CID&gt; &lt;вертикаль&gt;\nПример: <code>/assess example.com 7973813934 nutra</code>',
  chains: '🔗 Отправьте: /chains &lt;CID&gt;\nПример: <code>/chains 7973813934</code>',
  velocity: '💸 Отправьте: /velocity &lt;CID&gt;\nПример: <code>/velocity 7973813934</code>',
  quality: '📊 Отправьте: /quality &lt;CID&gt;\nПример: <code>/quality 7973813934</code>',
  postmortem: '📝 Отправьте: /postmortem &lt;CID&gt;\nПример: <code>/postmortem 7973813934</code>',
  scan: '🔍 Отправьте: /scan &lt;домен&gt;\nПример: <code>/scan example.com</code>\n\nАнализ контента: серые ключи, compliance, редиректы, red flags.',
  scan_dash: '🔗 Откройте страницу доменов в Dashboard для полного отчёта.',
};

export async function handleCallbackQuery(chatId: string, data: string, pool: Pool): Promise<void> {
  // Menu navigation
  if (data === 'menu:main') {
    await handleCommand(chatId, 'menu', '', pool);
    return;
  }

  if (data.startsWith('menu:')) {
    const section = data.slice(5);
    await sendSubMenu(chatId, section, pool);
    return;
  }

  // Hint messages (for commands that require CID argument)
  if (data.startsWith('hint:')) {
    const key = data.slice(5);
    const hint = HINT_MESSAGES[key];
    if (hint) {
      await sendMessage(chatId, hint);
    }
    return;
  }

  // Direct command execution
  if (data.startsWith('cmd:')) {
    const command = data.slice(4);
    await handleCommand(chatId, command, '', pool);
    return;
  }

  // Commands with arguments
  if (data.startsWith('account:')) {
    await handleCommand(chatId, 'account', data.slice(8), pool);
    return;
  }
  if (data.startsWith('ai:')) {
    await handleCommand(chatId, 'ai', data.slice(3), pool);
    return;
  }
  if (data.startsWith('predict:')) {
    await handleCommand(chatId, 'predict', data.slice(8), pool);
    return;
  }
  if (data.startsWith('chains:')) {
    await handleCommand(chatId, 'chains', data.slice(7), pool);
    return;
  }
  if (data.startsWith('velocity:')) {
    await handleCommand(chatId, 'velocity', data.slice(9), pool);
    return;
  }
  if (data.startsWith('quality:')) {
    await handleCommand(chatId, 'quality', data.slice(8), pool);
    return;
  }
  if (data.startsWith('leaderboard:')) {
    await handleCommand(chatId, 'leaderboard', data.slice(12), pool);
    return;
  }
  if (data.startsWith('postmortem:')) {
    await handleCommand(chatId, 'postmortem', data.slice(11), pool);
    return;
  }

  // Feedback on AI predictions
  if (data.startsWith('feedback:')) {
    const parts = data.split(':');
    const action = parts[1]; // 'like', 'dislike', 'outcome', 'skip_outcome'
    const predictionId = parts[2];
    if (!predictionId) return;

    const userRow = await getUserByChatId(pool, chatId);
    if (!userRow) {
      await sendMessage(chatId, '❌ Пользователь не найден.');
      return;
    }

    // Like — save immediately
    if (action === 'like') {
      try {
        const { submitFeedback } = await import('./ai/feedback.service.js');
        await submitFeedback(pool, { predictionId, userId: userRow.id, rating: 1 });
        await sendMessage(chatId, '👍 Оценка сохранена! Спасибо за обратную связь.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Неизвестная ошибка';
        await sendMessage(chatId, `❌ Не удалось сохранить: ${escapeHtml(msg)}`);
      }
      return;
    }

    // Dislike — show correction options first
    if (action === 'dislike') {
      await sendMessageWithKeyboard(chatId, '👎 <b>Что не так с прогнозом?</b>\n\nВыберите правильный исход:', {
        inline_keyboard: [
          [
            { text: '🚨 Забанен', callback_data: `feedback:outcome:${predictionId}:banned` },
            { text: '✅ Выжил', callback_data: `feedback:outcome:${predictionId}:survived` },
          ],
          [
            { text: '📋 Апелляция успешна', callback_data: `feedback:outcome:${predictionId}:appealed` },
          ],
          [
            { text: '⏭ Пропустить (просто дизлайк)', callback_data: `feedback:skip_outcome:${predictionId}` },
          ],
        ],
      });
      return;
    }

    // Outcome selected — save dislike with correct_outcome
    if (action === 'outcome') {
      const correctOutcome = parts[3]; // 'banned', 'survived', 'appealed'
      try {
        const { submitFeedback } = await import('./ai/feedback.service.js');
        await submitFeedback(pool, {
          predictionId,
          userId: userRow.id,
          rating: -1,
          correctOutcome: correctOutcome ?? undefined,
          comment: undefined,
        });

        const outcomeLabels: Record<string, string> = {
          banned: '🚨 Забанен',
          survived: '✅ Выжил',
          appealed: '📋 Апелляция успешна',
        };
        const label = outcomeLabels[correctOutcome ?? ''] ?? correctOutcome;

        await sendMessageWithKeyboard(chatId, `👎 Дизлайк сохранён.\n📝 Правильный исход: <b>${label}</b>\n\n💬 Хотите добавить комментарий?`, {
          inline_keyboard: [
            [
              { text: '💬 Добавить комментарий', callback_data: `feedback:comment:${predictionId}` },
              { text: '✓ Готово', callback_data: 'menu:ai' },
            ],
          ],
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Неизвестная ошибка';
        await sendMessage(chatId, `❌ Не удалось сохранить: ${escapeHtml(msg)}`);
      }
      return;
    }

    // Skip outcome — just save dislike
    if (action === 'skip_outcome') {
      try {
        const { submitFeedback } = await import('./ai/feedback.service.js');
        await submitFeedback(pool, { predictionId, userId: userRow.id, rating: -1 });

        await sendMessageWithKeyboard(chatId, '👎 Дизлайк сохранён.\n\n💬 Хотите добавить комментарий?', {
          inline_keyboard: [
            [
              { text: '💬 Добавить комментарий', callback_data: `feedback:comment:${predictionId}` },
              { text: '✓ Готово', callback_data: 'menu:ai' },
            ],
          ],
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Неизвестная ошибка';
        await sendMessage(chatId, `❌ Не удалось сохранить: ${escapeHtml(msg)}`);
      }
      return;
    }

    // Comment prompt — ask user to reply with text
    if (action === 'comment') {
      pendingComments.set(chatId, predictionId);
      await sendMessage(chatId, '💬 Напишите комментарий в следующем сообщении:');
      return;
    }

    return;
  }
}

// ─── Handle pending feedback comments ────────────────────────────────────────

export async function handlePendingComment(chatId: string, text: string, pool: Pool): Promise<boolean> {
  const predictionId = pendingComments.get(chatId);
  if (!predictionId) return false;

  pendingComments.delete(chatId);

  const userRow = await getUserByChatId(pool, chatId);
  if (!userRow) {
    await sendMessage(chatId, '❌ Пользователь не найден.');
    return true;
  }

  try {
    const { submitFeedback } = await import('./ai/feedback.service.js');
    await submitFeedback(pool, {
      predictionId,
      userId: userRow.id,
      rating: -1,
      comment: text,
    });
    await sendMessage(chatId, `💬 Комментарий сохранён: "<i>${escapeHtml(text.slice(0, 200))}</i>"\n\nСпасибо за обратную связь!`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Неизвестная ошибка';
    await sendMessage(chatId, `❌ Не удалось сохранить комментарий: ${escapeHtml(msg)}`);
  }

  return true;
}

// Only register key commands in Telegram menu (the rest work via inline buttons)
export const BOT_COMMANDS = [
  { command: 'menu', description: 'Главное меню со статистикой' },
  { command: 'account', description: 'Детали аккаунта (+ CID)' },
  { command: 'ai', description: 'AI-анализ аккаунта (+ CID)' },
  { command: 'predict', description: 'ML-прогноз бана (+ CID)' },
  { command: 'assess', description: 'Оценка риска (домен/CID)' },
  { command: 'scan', description: 'Анализ контента домена (+ домен)' },
  { command: 'help', description: 'Все команды' },
];
