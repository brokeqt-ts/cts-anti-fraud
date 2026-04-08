"""
Feature extraction for XGBoost ban predictor.

Extracts 52 features per account directly from PostgreSQL.
Mirrors + extends packages/server/src/repositories/features.repository.ts.
"""

from __future__ import annotations
import datetime
from typing import Any
from .db import get_conn

# ─── Feature names (order matters — must match predictor input) ────────────────

FEATURE_NAMES: list[str] = [
    # --- Account (6) ---
    "account_age_days",
    "policy_violation_count",
    "active_campaign_count",
    "notification_warning_count",
    "notification_critical_count",
    "days_in_current_status",
    # --- Domain (5) ---
    "domain_age_days",
    "domain_safe_page_score",
    "domain_has_ssl",
    "domain_has_privacy_page",
    "domain_switch_count_30d",
    # --- Financial (7) ---
    "total_spend_usd",
    "daily_spend_avg",
    "spend_velocity_ratio",
    "spend_acceleration",
    "max_single_day_spend",
    "bin_ban_rate",
    "payment_method_count",
    # --- Campaigns / creatives (5) ---
    "campaign_count",
    "avg_quality_score",
    "low_qs_keyword_ratio",
    "ad_disapproval_count",
    "keyword_count",
    # --- Network / connections (6) ---
    "connected_banned_accounts",
    "connected_accounts_total",
    "max_connection_weight",
    "shared_domain_with_banned",
    "shared_bin_with_banned",
    "network_risk_score",
    # --- Behavioral (6) ---
    "change_frequency_7d",
    "budget_change_count_7d",
    "days_since_last_notification",
    "total_notification_count",
    "shared_proxy_ban_rate",
    "shared_payment_ban_rate",
    # --- Vertical / GEO (5) ---
    "vertical_ban_rate",
    "geo_ban_rate",
    "vertical_account_count",
    "is_high_risk_vertical",
    "is_high_risk_geo",
    # --- Temporal (6) ---
    "hour_of_day",
    "day_of_week",
    "is_high_risk_time",
    "hour_of_creation",
    "days_since_last_ban_in_vertical",
    "days_since_last_ban_in_geo",
    # --- Quality signals (6) ---
    "enabled_keyword_ratio",
    "avg_bid",
    "account_type_numeric",
    "proxy_ban_rate",
    "has_active_violations",
    "lifetime_risk_score",
]

FEATURE_LABELS: dict[str, str] = {
    "account_age_days": "Возраст аккаунта",
    "policy_violation_count": "Нарушения политики",
    "active_campaign_count": "Активные кампании",
    "notification_warning_count": "Предупреждения (30д)",
    "notification_critical_count": "Критические уведомления",
    "days_in_current_status": "Дней в текущем статусе",
    "domain_age_days": "Возраст домена",
    "domain_safe_page_score": "Safe Page Score",
    "domain_has_ssl": "SSL домена",
    "domain_has_privacy_page": "Privacy page домена",
    "domain_switch_count_30d": "Смен домена за 30д",
    "total_spend_usd": "Общий расход",
    "daily_spend_avg": "Ср. дневной расход",
    "spend_velocity_ratio": "Скорость расхода",
    "spend_acceleration": "Ускорение расхода",
    "max_single_day_spend": "Макс. расход за день",
    "bin_ban_rate": "BIN ban rate %",
    "payment_method_count": "Кол-во карт",
    "campaign_count": "Кол-во кампаний",
    "avg_quality_score": "Средний QS",
    "low_qs_keyword_ratio": "Доля низких QS",
    "ad_disapproval_count": "Отклонённые объявления",
    "keyword_count": "Кол-во ключевых слов",
    "connected_banned_accounts": "Связанные забаненные",
    "connected_accounts_total": "Всего связанных аккаунтов",
    "max_connection_weight": "Вес связи с баном",
    "shared_domain_with_banned": "Общий домен с забаненным",
    "shared_bin_with_banned": "Общий BIN с забаненным",
    "network_risk_score": "Сетевой риск-скор",
    "change_frequency_7d": "Частота изменений (7д)",
    "budget_change_count_7d": "Изменений бюджета (7д)",
    "days_since_last_notification": "Дней с последнего уведомления",
    "total_notification_count": "Всего уведомлений",
    "shared_proxy_ban_rate": "Ban rate прокси",
    "shared_payment_ban_rate": "Ban rate платёжного метода",
    "vertical_ban_rate": "Ban rate вертикали %",
    "geo_ban_rate": "Ban rate ГЕО %",
    "vertical_account_count": "Аккаунтов в вертикали",
    "is_high_risk_vertical": "Высокорисковая вертикаль",
    "is_high_risk_geo": "Высокорисковое ГЕО",
    "hour_of_day": "Час дня",
    "day_of_week": "День недели",
    "is_high_risk_time": "Высокорисковое время",
    "hour_of_creation": "Час создания аккаунта",
    "days_since_last_ban_in_vertical": "Дней с посл. бана в вертикали",
    "days_since_last_ban_in_geo": "Дней с посл. бана в ГЕО",
    "enabled_keyword_ratio": "Доля активных ключей",
    "avg_bid": "Средняя ставка",
    "account_type_numeric": "Тип аккаунта (число)",
    "proxy_ban_rate": "Ban rate прокси аккаунта",
    "has_active_violations": "Есть активные нарушения",
    "lifetime_risk_score": "Составной риск-скор",
}

# High-risk verticals and GEOs
HIGH_RISK_VERTICALS = {"gambling", "crypto", "nutra", "finance"}
HIGH_RISK_GEOS = {"IN", "PK", "BD", "NG", "PH", "ID", "VN"}

ACCOUNT_TYPE_MAP = {"standard": 0, "manager": 1, "test": 2, None: 0}


def _safe_float(val: Any, default: float = 0.0) -> float:
    if val is None:
        return default
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def extract_features(account_google_id: str) -> dict[str, float] | None:
    """Extract all 52 features for a single account."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(_FEATURE_SQL, (account_google_id,) * _FEATURE_SQL.count("%s"))
            row = cur.fetchone()
            if row is None:
                return None
            cols = [desc[0] for desc in cur.description]
            raw = dict(zip(cols, row))

    return _map_features(raw)


def extract_training_data() -> list[dict]:
    """
    Extract features + labels for all accounts suitable for training.
    Returns list of dicts with feature keys + 'is_banned' + 'days_to_ban'.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    a.google_account_id,
                    EXISTS(SELECT 1 FROM ban_logs bl WHERE bl.account_google_id = a.google_account_id) AS is_banned,
                    (SELECT MIN(bl.lifetime_hours) / 24.0 FROM ban_logs bl
                     WHERE bl.account_google_id = a.google_account_id) AS days_to_ban
                FROM accounts a
                WHERE a.account_age_days > 3
                   OR EXISTS(SELECT 1 FROM ban_logs bl WHERE bl.account_google_id = a.google_account_id)
                ORDER BY a.created_at DESC
                LIMIT 2000
            """)
            account_rows = cur.fetchall()

    result = []
    for (gid, is_banned, days_to_ban) in account_rows:
        features = extract_features(gid)
        if features is None:
            continue
        features["is_banned"] = 1 if is_banned else 0
        features["days_to_ban"] = float(days_to_ban) if days_to_ban is not None else None
        features["account_google_id"] = gid
        result.append(features)
    return result


def extract_bulk_features(user_id: str | None = None) -> list[dict]:
    """Extract features for all active accounts (for batch prediction)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            if user_id:
                cur.execute("""
                    SELECT google_account_id FROM accounts
                    WHERE account_status != 'suspended' AND user_id = %s
                    ORDER BY created_at DESC LIMIT 500
                """, (user_id,))
            else:
                cur.execute("""
                    SELECT google_account_id FROM accounts
                    WHERE account_status != 'suspended'
                    ORDER BY created_at DESC LIMIT 500
                """)
            gids = [r[0] for r in cur.fetchall()]

    result = []
    for gid in gids:
        features = extract_features(gid)
        if features is not None:
            features["account_google_id"] = gid
            result.append(features)
    return result


def features_to_vector(features: dict[str, float]) -> list[float]:
    """Convert feature dict to ordered numeric vector matching FEATURE_NAMES."""
    return [_safe_float(features.get(name, 0.0)) for name in FEATURE_NAMES]


# ─── SQL ──────────────────────────────────────────────────────────────────────

_FEATURE_SQL = """
WITH
account_base AS (
  SELECT
    a.id,
    a.google_account_id,
    COALESCE(a.account_age_days,
      EXTRACT(EPOCH FROM (NOW() - a.created_at)) / 86400)::float AS account_age_days,
    a.account_type,
    a.offer_vertical,
    a.target_geo,
    a.payment_bin,
    COALESCE(a.total_spend, 0)::float AS total_spend,
    a.account_status,
    a.created_at,
    EXTRACT(EPOCH FROM (NOW() - a.updated_at)) / 86400 AS days_since_updated
  FROM accounts a
  WHERE a.google_account_id = %s
),
domain_data AS (
  SELECT
    d.domain_age_days,
    d.safe_page_quality_score,
    CASE WHEN COALESCE(d.ssl_type, 'none') != 'none' THEN 1 ELSE 0 END AS has_ssl,
    CASE WHEN d.has_privacy_page THEN 1 ELSE 0 END AS has_privacy_page
  FROM account_base ab
  JOIN ads ad ON ad.account_google_id = ab.google_account_id
  JOIN domains d ON ad.final_urls::text ILIKE '%' || d.domain_name || '%'
  ORDER BY d.domain_age_days DESC NULLS LAST
  LIMIT 1
),
domain_switches AS (
  SELECT COUNT(DISTINCT ch.new_value)::int AS switch_count
  FROM change_history ch
  WHERE ch.account_google_id = %s
    AND ch.field_name ILIKE '%domain%'
    AND ch.changed_at > NOW() - INTERVAL '30 days'
),
violation_data AS (
  SELECT
    COUNT(*) FILTER (WHERE nd.category = 'WARNING')::int AS warning_count,
    COUNT(*) FILTER (WHERE nd.category = 'CRITICAL')::int AS critical_count,
    COUNT(*)::int AS total_count,
    EXTRACT(EPOCH FROM (NOW() - MAX(nd.captured_at))) / 86400 AS days_since_last
  FROM notification_details nd
  WHERE nd.account_google_id = %s
    AND nd.captured_at > NOW() - INTERVAL '90 days'
),
campaign_data AS (
  SELECT
    COUNT(DISTINCT c.campaign_id)::int AS campaign_count,
    COUNT(DISTINCT c.campaign_id) FILTER (WHERE c.status = 3)::int AS active_count
  FROM campaigns c
  WHERE c.account_google_id = %s
),
keyword_data AS (
  SELECT
    COUNT(*)::int AS keyword_count,
    ROUND(AVG(k.quality_score)::numeric, 1) AS avg_qs,
    CASE WHEN COUNT(*) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE k.quality_score IS NOT NULL AND k.quality_score <= 4)::numeric
           / NULLIF(COUNT(*) FILTER (WHERE k.quality_score IS NOT NULL), 0), 3)
      ELSE 0 END AS low_qs_ratio,
    CASE WHEN COUNT(*) > 0
      THEN COUNT(*) FILTER (WHERE k.status = 2)::float / NULLIF(COUNT(*), 0)
      ELSE 0 END AS enabled_ratio,
    ROUND(AVG(k.cpc_bid_micros / 1000000.0)::numeric, 4) AS avg_bid
  FROM keywords k
  WHERE k.account_google_id = %s
),
financial_data AS (
  SELECT
    ab.total_spend,
    CASE WHEN ab.account_age_days > 0
      THEN ROUND((ab.total_spend / GREATEST(ab.account_age_days, 1))::numeric, 2)
      ELSE 0 END AS daily_avg,
    COALESCE((
      SELECT SUM(am.spend) / NULLIF(COUNT(am.date), 0)
      FROM account_metrics am
      WHERE am.account_google_id = ab.google_account_id
        AND am.date >= CURRENT_DATE - 7
    ), 0) AS recent_daily_avg,
    COALESCE((
      SELECT MAX(am.spend)
      FROM account_metrics am
      WHERE am.account_google_id = ab.google_account_id
    ), 0) AS max_day_spend
  FROM account_base ab
),
bin_data AS (
  SELECT
    COUNT(DISTINCT a2.google_account_id)::int AS bin_total,
    COUNT(DISTINCT bl.account_google_id)::int AS bin_banned
  FROM account_base ab
  JOIN accounts a2 ON a2.payment_bin = ab.payment_bin AND ab.payment_bin IS NOT NULL
  LEFT JOIN ban_logs bl ON bl.account_google_id = a2.google_account_id
),
network_data AS (
  SELECT
    COUNT(DISTINCT bl2.account_google_id)::int AS connected_banned,
    COUNT(DISTINCT a_net.google_account_id)::int AS connected_total,
    CASE WHEN EXISTS(
      SELECT 1 FROM ads ad1
      JOIN ads ad2 ON ad2.final_urls::text = ad1.final_urls::text
        AND ad2.account_google_id != (SELECT google_account_id FROM account_base)
      JOIN ban_logs bl3 ON bl3.account_google_id = ad2.account_google_id
      WHERE ad1.account_google_id = (SELECT google_account_id FROM account_base)
    ) THEN 1 ELSE 0 END AS shared_domain_banned,
    CASE WHEN EXISTS(
      SELECT 1 FROM accounts a3
      JOIN ban_logs bl4 ON bl4.account_google_id = a3.google_account_id
      WHERE a3.payment_bin = (SELECT payment_bin FROM account_base)
        AND a3.google_account_id != (SELECT google_account_id FROM account_base)
        AND (SELECT payment_bin FROM account_base) IS NOT NULL
    ) THEN 1 ELSE 0 END AS shared_bin_banned
  FROM account_base ab
  LEFT JOIN accounts a_net ON
    a_net.payment_bin = ab.payment_bin AND ab.payment_bin IS NOT NULL
    AND a_net.google_account_id != ab.google_account_id
  LEFT JOIN ban_logs bl2 ON bl2.account_google_id = a_net.google_account_id
),
change_history_data AS (
  SELECT
    COUNT(*) FILTER (WHERE ch.changed_at > NOW() - INTERVAL '7 days')::int AS changes_7d,
    COUNT(*) FILTER (
      WHERE ch.changed_at > NOW() - INTERVAL '7 days'
        AND ch.field_name ILIKE '%budget%'
    )::int AS budget_changes_7d
  FROM change_history ch
  WHERE ch.account_google_id = %s
),
proxy_data AS (
  SELECT
    CASE WHEN COUNT(DISTINCT a_proxy.google_account_id) > 0
      THEN COUNT(DISTINCT bl_proxy.account_google_id)::float
           / COUNT(DISTINCT a_proxy.google_account_id)
      ELSE 0 END AS proxy_ban_rate,
    CASE WHEN COUNT(DISTINCT a_pm.google_account_id) > 0
      THEN COUNT(DISTINCT bl_pm.account_google_id)::float
           / COUNT(DISTINCT a_pm.google_account_id)
      ELSE 0 END AS payment_ban_rate,
    -- account's own proxy ban rate (if available)
    (SELECT COALESCE(100.0 * COUNT(bl5.account_google_id) / NULLIF(COUNT(a5.google_account_id), 0), 0)
     FROM account_consumables ac5
     JOIN antidetect_profiles ap5 ON ap5.id = ac5.antidetect_profile_id
     JOIN account_consumables ac6 ON ac6.antidetect_profile_id = ap5.id
     JOIN accounts a5 ON a5.id = ac6.account_id
     LEFT JOIN ban_logs bl5 ON bl5.account_google_id = a5.google_account_id
     WHERE ac5.account_id = (SELECT id FROM account_base)
     LIMIT 1) AS own_proxy_ban_rate
  FROM account_base ab
  LEFT JOIN account_consumables ac ON ac.account_id = ab.id
  LEFT JOIN account_consumables ac2 ON ac2.proxy_id = ac.proxy_id AND ac.proxy_id IS NOT NULL
  LEFT JOIN accounts a_proxy ON a_proxy.id = ac2.account_id AND a_proxy.google_account_id != ab.google_account_id
  LEFT JOIN ban_logs bl_proxy ON bl_proxy.account_google_id = a_proxy.google_account_id
  LEFT JOIN account_consumables ac3 ON ac3.account_id = ab.id
  LEFT JOIN account_consumables ac4 ON ac4.payment_method_id = ac3.payment_method_id AND ac3.payment_method_id IS NOT NULL
  LEFT JOIN accounts a_pm ON a_pm.id = ac4.account_id AND a_pm.google_account_id != ab.google_account_id
  LEFT JOIN ban_logs bl_pm ON bl_pm.account_google_id = a_pm.google_account_id
),
vertical_stats AS (
  SELECT
    CASE WHEN COUNT(*) > 0
      THEN COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM ban_logs bl WHERE bl.account_google_id = a_v.google_account_id))::float / COUNT(*)
      ELSE 0 END * 100 AS ban_rate,
    COUNT(*)::int AS account_count,
    (SELECT EXTRACT(EPOCH FROM (NOW() - MAX(bl_v.banned_at))) / 86400
     FROM ban_logs bl_v
     JOIN accounts a_v2 ON a_v2.google_account_id = bl_v.account_google_id
     WHERE a_v2.offer_vertical = (SELECT offer_vertical FROM account_base)
    ) AS days_since_last_ban
  FROM accounts a_v
  WHERE a_v.offer_vertical = (SELECT offer_vertical FROM account_base)
    AND (SELECT offer_vertical FROM account_base) IS NOT NULL
),
geo_stats AS (
  SELECT
    CASE WHEN COUNT(*) > 0
      THEN COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM ban_logs bl WHERE bl.account_google_id = a_g.google_account_id))::float / COUNT(*)
      ELSE 0 END * 100 AS ban_rate,
    (SELECT EXTRACT(EPOCH FROM (NOW() - MAX(bl_g.banned_at))) / 86400
     FROM ban_logs bl_g
     JOIN accounts a_g2 ON a_g2.google_account_id = bl_g.account_google_id
     WHERE a_g2.target_geo = (SELECT target_geo FROM account_base)
    ) AS days_since_last_ban
  FROM accounts a_g
  WHERE a_g.target_geo = (SELECT target_geo FROM account_base)
    AND (SELECT target_geo FROM account_base) IS NOT NULL
),
payment_methods AS (
  SELECT COUNT(DISTINCT ac.payment_method_id)::int AS pm_count
  FROM account_base ab
  JOIN account_consumables ac ON ac.account_id = ab.id AND ac.payment_method_id IS NOT NULL
),
ad_disapprovals AS (
  SELECT COUNT(*)::int AS disapproval_count
  FROM ads ad
  WHERE ad.account_google_id = %s
    AND ad.review_status = 'DISAPPROVED'
)
SELECT
  -- Account
  COALESCE(ab.account_age_days, 0)                      AS account_age_days,
  COALESCE(vd.critical_count, 0)                        AS policy_violation_count,
  COALESCE(cd.active_count, 0)                          AS active_campaign_count,
  COALESCE(vd.warning_count, 0)                         AS notification_warning_count,
  COALESCE(vd.critical_count, 0)                        AS notification_critical_count,
  COALESCE(ab.days_since_updated, 0)                    AS days_in_current_status,
  -- Domain
  COALESCE(dd.domain_age_days, 0)                       AS domain_age_days,
  COALESCE(dd.safe_page_quality_score, 50)              AS domain_safe_page_score,
  COALESCE(dd.has_ssl, 0)                               AS domain_has_ssl,
  COALESCE(dd.has_privacy_page, 0)                      AS domain_has_privacy_page,
  COALESCE(ds.switch_count, 0)                          AS domain_switch_count_30d,
  -- Financial
  COALESCE(fd.total_spend, 0)                           AS total_spend_usd,
  COALESCE(fd.daily_avg, 0)                             AS daily_spend_avg,
  CASE WHEN fd.daily_avg > 0 AND fd.recent_daily_avg > 0
    THEN ROUND((fd.recent_daily_avg / GREATEST(fd.daily_avg, 0.01))::numeric, 2)
    ELSE 1 END                                          AS spend_velocity_ratio,
  CASE WHEN COALESCE(fd.recent_daily_avg, 0) > COALESCE(fd.daily_avg, 0)
    THEN ROUND(((fd.recent_daily_avg - fd.daily_avg) / GREATEST(fd.daily_avg, 0.01))::numeric, 2)
    ELSE 0 END                                          AS spend_acceleration,
  COALESCE(fd.max_day_spend, 0)                         AS max_single_day_spend,
  CASE WHEN COALESCE(bd.bin_total, 0) > 0
    THEN ROUND((bd.bin_banned::numeric / bd.bin_total) * 100, 1)
    ELSE 0 END                                          AS bin_ban_rate,
  COALESCE(pm.pm_count, 0)                              AS payment_method_count,
  -- Campaigns / creatives
  COALESCE(cd.campaign_count, 0)                        AS campaign_count,
  COALESCE(kd.avg_qs, 6)                                AS avg_quality_score,
  COALESCE(kd.low_qs_ratio, 0)                          AS low_qs_keyword_ratio,
  COALESCE(adis.disapproval_count, 0)                   AS ad_disapproval_count,
  COALESCE(kd.keyword_count, 0)                         AS keyword_count,
  -- Network
  COALESCE(nd.connected_banned, 0)                      AS connected_banned_accounts,
  COALESCE(nd.connected_total, 0)                       AS connected_accounts_total,
  CASE WHEN COALESCE(nd.connected_banned, 0) > 0 THEN 1 ELSE 0 END AS max_connection_weight,
  COALESCE(nd.shared_domain_banned, 0)                  AS shared_domain_with_banned,
  COALESCE(nd.shared_bin_banned, 0)                     AS shared_bin_with_banned,
  ROUND(LEAST(
    (COALESCE(nd.connected_banned, 0) * 20
     + COALESCE(nd.shared_domain_banned, 0) * 30
     + COALESCE(nd.shared_bin_banned, 0) * 25)::numeric,
  100), 1)                                              AS network_risk_score,
  -- Behavioral
  COALESCE(chd.changes_7d, 0)                           AS change_frequency_7d,
  COALESCE(chd.budget_changes_7d, 0)                    AS budget_change_count_7d,
  COALESCE(vd.days_since_last, 999)                     AS days_since_last_notification,
  COALESCE(vd.total_count, 0)                           AS total_notification_count,
  COALESCE(pd.proxy_ban_rate * 100, 0)                  AS shared_proxy_ban_rate,
  COALESCE(pd.payment_ban_rate * 100, 0)                AS shared_payment_ban_rate,
  -- Vertical / GEO
  COALESCE(vs.ban_rate, 0)                              AS vertical_ban_rate,
  COALESCE(gs.ban_rate, 0)                              AS geo_ban_rate,
  COALESCE(vs.account_count, 0)                         AS vertical_account_count,
  CASE WHEN ab.offer_vertical IN ('gambling','crypto','nutra','finance') THEN 1 ELSE 0 END AS is_high_risk_vertical,
  CASE WHEN ab.target_geo IN ('IN','PK','BD','NG','PH','ID','VN') THEN 1 ELSE 0 END AS is_high_risk_geo,
  -- Temporal
  EXTRACT(HOUR FROM NOW())::int                         AS hour_of_day,
  EXTRACT(DOW FROM NOW())::int                          AS day_of_week,
  CASE WHEN EXTRACT(HOUR FROM NOW()) BETWEEN 2 AND 5 THEN 1 ELSE 0 END AS is_high_risk_time,
  EXTRACT(HOUR FROM ab.created_at)::int                 AS hour_of_creation,
  COALESCE(vs.days_since_last_ban, 9999)                AS days_since_last_ban_in_vertical,
  COALESCE(gs.days_since_last_ban, 9999)                AS days_since_last_ban_in_geo,
  -- Quality signals
  COALESCE(kd.enabled_ratio, 0)                         AS enabled_keyword_ratio,
  COALESCE(kd.avg_bid, 0)                               AS avg_bid,
  CASE ab.account_type
    WHEN 'standard' THEN 0 WHEN 'manager' THEN 1 WHEN 'test' THEN 2 ELSE 0 END AS account_type_numeric,
  COALESCE(pd.own_proxy_ban_rate, 0)                    AS proxy_ban_rate,
  CASE WHEN COALESCE(vd.critical_count, 0) > 0 THEN 1 ELSE 0 END AS has_active_violations,
  -- Composite lifetime risk score (0-100)
  LEAST(
    (COALESCE(vd.critical_count, 0) * 15
     + CASE WHEN COALESCE(dd.safe_page_quality_score, 100) < 40 THEN 20 ELSE 0 END
     + CASE WHEN COALESCE(dd.domain_age_days, 30) < 7 THEN 15 ELSE 0 END
     + COALESCE(nd.connected_banned, 0) * 10
     + CASE WHEN COALESCE(bd.bin_total, 1) > 0
         THEN (bd.bin_banned::float / bd.bin_total) * 20 ELSE 0 END
    )::numeric, 100)                                    AS lifetime_risk_score
FROM account_base ab
LEFT JOIN domain_data dd ON true
LEFT JOIN domain_switches ds ON true
LEFT JOIN violation_data vd ON true
LEFT JOIN campaign_data cd ON true
LEFT JOIN keyword_data kd ON true
LEFT JOIN financial_data fd ON true
LEFT JOIN bin_data bd ON true
LEFT JOIN network_data nd ON true
LEFT JOIN change_history_data chd ON true
LEFT JOIN proxy_data pd ON true
LEFT JOIN vertical_stats vs ON true
LEFT JOIN geo_stats gs ON true
LEFT JOIN payment_methods pm ON true
LEFT JOIN ad_disapprovals adis ON true
"""


def _map_features(raw: dict[str, Any]) -> dict[str, float]:
    """Convert raw DB row to float feature dict."""
    result: dict[str, float] = {}
    for key in FEATURE_NAMES:
        val = raw.get(key)
        if isinstance(val, bool):
            result[key] = 1.0 if val else 0.0
        elif val is None:
            result[key] = 0.0
        else:
            try:
                result[key] = float(val)
            except (TypeError, ValueError):
                result[key] = 0.0
    return result
