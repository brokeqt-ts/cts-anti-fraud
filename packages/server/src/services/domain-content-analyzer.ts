/**
 * Domain Content Analyzer — deep content analysis for Google Ads compliance.
 *
 * Analyzes landing pages for:
 * - Grey keywords that trigger Google Ads policy flags
 * - Compliance (Privacy Policy, ToS, disclaimers, contact info)
 * - Suspicious structural patterns (timers, fake reviews, hidden text)
 * - Redirect chains and URL mismatches
 * - LLM-ready context generation for AI-powered analysis
 */

import type pg from 'pg';
import { runAllExternalChecks, type AllExternalResults } from './domain-external-apis.js';

// ─── Grey keyword dictionaries by vertical ────────────────────────────────────

interface KeywordEntry {
  keyword: string;
  severity: 'critical' | 'warning' | 'info';
  vertical: string;
}

const GREY_KEYWORDS: KeywordEntry[] = [
  // ── Gambling ──
  { keyword: 'casino', severity: 'critical', vertical: 'gambling' },
  { keyword: 'казино', severity: 'critical', vertical: 'gambling' },
  { keyword: 'slots', severity: 'critical', vertical: 'gambling' },
  { keyword: 'слоты', severity: 'critical', vertical: 'gambling' },
  { keyword: 'рулетка', severity: 'critical', vertical: 'gambling' },
  { keyword: 'roulette', severity: 'critical', vertical: 'gambling' },
  { keyword: 'betting', severity: 'critical', vertical: 'gambling' },
  { keyword: 'ставки', severity: 'critical', vertical: 'gambling' },
  { keyword: 'букмекер', severity: 'critical', vertical: 'gambling' },
  { keyword: 'bookmaker', severity: 'critical', vertical: 'gambling' },
  { keyword: 'jackpot', severity: 'critical', vertical: 'gambling' },
  { keyword: 'free spins', severity: 'warning', vertical: 'gambling' },
  { keyword: 'бесплатные вращения', severity: 'warning', vertical: 'gambling' },
  { keyword: 'выигрыш', severity: 'warning', vertical: 'gambling' },
  { keyword: 'deposit bonus', severity: 'warning', vertical: 'gambling' },
  { keyword: 'бонус за депозит', severity: 'warning', vertical: 'gambling' },
  { keyword: 'poker', severity: 'warning', vertical: 'gambling' },
  { keyword: 'покер', severity: 'warning', vertical: 'gambling' },
  { keyword: 'sports betting', severity: 'critical', vertical: 'gambling' },
  { keyword: 'ставки на спорт', severity: 'critical', vertical: 'gambling' },
  { keyword: '1xbet', severity: 'critical', vertical: 'gambling' },
  { keyword: 'pin-up', severity: 'critical', vertical: 'gambling' },
  { keyword: 'vulkan', severity: 'critical', vertical: 'gambling' },

  // ── Nutra / Health ──
  { keyword: 'похудение', severity: 'critical', vertical: 'nutra' },
  { keyword: 'weight loss', severity: 'critical', vertical: 'nutra' },
  { keyword: 'чудо-средство', severity: 'critical', vertical: 'nutra' },
  { keyword: 'miracle cure', severity: 'critical', vertical: 'nutra' },
  { keyword: 'clinically proven', severity: 'warning', vertical: 'nutra' },
  { keyword: 'клинически доказано', severity: 'warning', vertical: 'nutra' },
  { keyword: 'fda approved', severity: 'critical', vertical: 'nutra' },
  { keyword: 'до и после', severity: 'warning', vertical: 'nutra' },
  { keyword: 'before and after', severity: 'warning', vertical: 'nutra' },
  { keyword: 'потеря веса', severity: 'warning', vertical: 'nutra' },
  { keyword: 'fat burner', severity: 'warning', vertical: 'nutra' },
  { keyword: 'жиросжигатель', severity: 'warning', vertical: 'nutra' },
  { keyword: 'anti-aging', severity: 'info', vertical: 'nutra' },
  { keyword: 'омоложение', severity: 'info', vertical: 'nutra' },
  { keyword: 'detox', severity: 'info', vertical: 'nutra' },
  { keyword: 'детокс', severity: 'info', vertical: 'nutra' },
  { keyword: 'без диет', severity: 'warning', vertical: 'nutra' },
  { keyword: 'без тренировок', severity: 'warning', vertical: 'nutra' },
  { keyword: '-30 кг', severity: 'critical', vertical: 'nutra' },
  { keyword: 'результат гарантирован', severity: 'critical', vertical: 'nutra' },
  { keyword: 'guaranteed results', severity: 'critical', vertical: 'nutra' },

  // ── Crypto ──
  { keyword: 'guaranteed returns', severity: 'critical', vertical: 'crypto' },
  { keyword: 'гарантированная прибыль', severity: 'critical', vertical: 'crypto' },
  { keyword: 'guaranteed profit', severity: 'critical', vertical: 'crypto' },
  { keyword: '100% profit', severity: 'critical', vertical: 'crypto' },
  { keyword: 'passive income', severity: 'warning', vertical: 'crypto' },
  { keyword: 'пассивный доход', severity: 'warning', vertical: 'crypto' },
  { keyword: 'auto-trading', severity: 'warning', vertical: 'crypto' },
  { keyword: 'автоматический трейдинг', severity: 'warning', vertical: 'crypto' },
  { keyword: 'bitcoin investment', severity: 'warning', vertical: 'crypto' },
  { keyword: 'crypto investment', severity: 'warning', vertical: 'crypto' },
  { keyword: 'инвестиции в крипту', severity: 'warning', vertical: 'crypto' },
  { keyword: 'earn bitcoin', severity: 'warning', vertical: 'crypto' },
  { keyword: 'заработок на криптовалюте', severity: 'warning', vertical: 'crypto' },
  { keyword: 'nft investment', severity: 'info', vertical: 'crypto' },
  { keyword: 'defi yield', severity: 'info', vertical: 'crypto' },
  { keyword: 'trading bot', severity: 'warning', vertical: 'crypto' },

  // ── Finance ──
  { keyword: 'instant loan', severity: 'critical', vertical: 'finance' },
  { keyword: 'мгновенный кредит', severity: 'critical', vertical: 'finance' },
  { keyword: 'guaranteed approval', severity: 'critical', vertical: 'finance' },
  { keyword: 'гарантированное одобрение', severity: 'critical', vertical: 'finance' },
  { keyword: 'no credit check', severity: 'critical', vertical: 'finance' },
  { keyword: 'без проверки кредитной', severity: 'critical', vertical: 'finance' },
  { keyword: 'bad credit ok', severity: 'warning', vertical: 'finance' },
  { keyword: 'быстрый кредит', severity: 'warning', vertical: 'finance' },
  { keyword: 'займ без отказа', severity: 'critical', vertical: 'finance' },
  { keyword: 'микрозайм', severity: 'warning', vertical: 'finance' },
  { keyword: 'payday loan', severity: 'warning', vertical: 'finance' },
  { keyword: 'debt relief', severity: 'info', vertical: 'finance' },

  // ── Sweepstakes / Giveaways ──
  { keyword: 'you have won', severity: 'critical', vertical: 'sweepstakes' },
  { keyword: 'вы выиграли', severity: 'critical', vertical: 'sweepstakes' },
  { keyword: 'congratulations winner', severity: 'critical', vertical: 'sweepstakes' },
  { keyword: 'claim your prize', severity: 'critical', vertical: 'sweepstakes' },
  { keyword: 'получите приз', severity: 'critical', vertical: 'sweepstakes' },
  { keyword: 'free iphone', severity: 'critical', vertical: 'sweepstakes' },
  { keyword: 'бесплатный айфон', severity: 'critical', vertical: 'sweepstakes' },
  { keyword: 'spin the wheel', severity: 'warning', vertical: 'sweepstakes' },
  { keyword: 'gift card', severity: 'info', vertical: 'sweepstakes' },

  // ── Dating / Adult ──
  { keyword: 'знакомства без обязательств', severity: 'warning', vertical: 'dating' },
  { keyword: 'hookup', severity: 'critical', vertical: 'dating' },
  { keyword: 'casual dating', severity: 'warning', vertical: 'dating' },
  { keyword: 'adult dating', severity: 'critical', vertical: 'dating' },
  { keyword: 'sex dating', severity: 'critical', vertical: 'dating' },
  { keyword: 'hot singles', severity: 'warning', vertical: 'dating' },
  { keyword: 'одинокие девушки', severity: 'warning', vertical: 'dating' },

  // ── Pharma ──
  { keyword: 'buy without prescription', severity: 'critical', vertical: 'pharma' },
  { keyword: 'без рецепта', severity: 'critical', vertical: 'pharma' },
  { keyword: 'discount pharmacy', severity: 'warning', vertical: 'pharma' },
  { keyword: 'online pharmacy', severity: 'warning', vertical: 'pharma' },
  { keyword: 'cheap viagra', severity: 'critical', vertical: 'pharma' },
  { keyword: 'buy cialis', severity: 'critical', vertical: 'pharma' },
  { keyword: 'generic drugs', severity: 'warning', vertical: 'pharma' },

  // ── Generic aggressive patterns ──
  { keyword: 'limited time only', severity: 'info', vertical: 'generic' },
  { keyword: 'act now', severity: 'info', vertical: 'generic' },
  { keyword: 'только сегодня', severity: 'info', vertical: 'generic' },
  { keyword: 'осталось мест', severity: 'warning', vertical: 'generic' },
  { keyword: 'последний шанс', severity: 'info', vertical: 'generic' },
  { keyword: 'spots remaining', severity: 'warning', vertical: 'generic' },
  { keyword: 'exclusive offer', severity: 'info', vertical: 'generic' },
  { keyword: 'эксклюзивное предложение', severity: 'info', vertical: 'generic' },
];

// ─── Structural pattern detectors ─────────────────────────────────────────────

interface RedFlag {
  type: string;
  severity: 'critical' | 'warning' | 'info';
  detail: string;
}

interface KeywordMatch {
  keyword: string;
  vertical: string;
  severity: string;
  context: string; // surrounding text snippet
}

// ─── Analysis result ──────────────────────────────────────────────────────────

export interface ContentAnalysisResult {
  url: string;
  contentRiskScore: number;    // 0-100
  keywordRiskScore: number;    // 0-100
  complianceScore: number;     // 0-100 (higher = more compliant)
  structureRiskScore: number;  // 0-100
  redirectRiskScore: number;   // 0-100

  keywordMatches: KeywordMatch[];
  detectedVertical: string | null;

  // Compliance
  hasPrivacyPolicy: boolean;
  hasTermsOfService: boolean;
  hasContactInfo: boolean;
  hasDisclaimer: boolean;
  hasAboutPage: boolean;
  hasCookieConsent: boolean;
  hasAgeVerification: boolean;

  // Structure
  redFlags: RedFlag[];
  hasCountdownTimer: boolean;
  hasFakeReviews: boolean;
  hasBeforeAfter: boolean;
  hasHiddenText: boolean;
  hasAggressiveCta: boolean;
  hasPopupOverlay: boolean;
  hasAutoPlayVideo: boolean;
  hasExternalRedirect: boolean;

  // Redirects
  redirectCount: number;
  redirectChain: string[];
  finalUrl: string;
  urlMismatch: boolean;

  // Content metrics
  pageLanguage: string | null;
  totalLinks: number;
  externalLinks: number;
  formCount: number;
  imageCount: number;
  scriptCount: number;
  iframeCount: number;
  wordCount: number;
  pageTitle: string | null;
  pageDescription: string | null;
  ogTags: Record<string, string> | null;
  outboundDomains: string[];

  // Level 2: Security headers
  securityHeaders: SecurityHeadersResult;

  // Level 2: TLD risk
  tldRisk: { tld: string; risk: string; score: number };

  // Level 2: robots.txt
  robotsTxt: RobotsTxtResult;

  // Level 2: Form analysis
  formAnalysis: FormAnalysis;

  // Level 2: Third-party scripts
  thirdPartyScripts: ThirdPartyScripts;

  // Level 2: Link reputation
  linkReputation: LinkReputation;

  // Level 2: Structured data
  structuredData: StructuredDataResult;

  // Level 3: External APIs (built-in)
  safeBrowsing: SafeBrowsingResult;
  pageSpeed: PageSpeedResult;
  virusTotal: VirusTotalResult;
  wayback: WaybackResult;

  // Level 4: External API suite (13 services)
  externalApis: AllExternalResults | null;

  // LLM context
  analysisSummary: string;
  llmContext: Record<string, unknown>;
}

// ─── HTML fetch with redirect tracking ────────────────────────────────────────

interface FetchResult {
  html: string;
  finalUrl: string;
  redirectChain: string[];
  statusCode: number;
  headers: Record<string, string>;
}

async function fetchWithRedirects(url: string): Promise<FetchResult> {
  const chain: string[] = [url];
  let currentUrl = url;
  const maxRedirects = 10;

  for (let i = 0; i < maxRedirects; i++) {
    const res = await fetch(currentUrl, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5,ru;q=0.3',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) break;
      currentUrl = new URL(location, currentUrl).href;
      chain.push(currentUrl);
      continue;
    }

    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    const html = await res.text();
    return { html, finalUrl: currentUrl, redirectChain: chain, statusCode: res.status, headers };
  }

  // If we exhausted redirects, try final fetch
  const res = await fetch(currentUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(15_000),
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  const html = await res.text();
  return { html, finalUrl: currentUrl, redirectChain: chain, statusCode: res.status, headers };
}

// ─── HTML parsers (regex-based, no external deps) ─────────────────────────────

function extractText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMeta(html: string, name: string): string | null {
  const re = new RegExp(`<meta[^>]*(?:name|property)=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i');
  const alt = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']${name}["']`, 'i');
  return re.exec(html)?.[1] ?? alt.exec(html)?.[1] ?? null;
}

function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return m?.[1]?.trim() ?? null;
}

function countTag(html: string, tag: string): number {
  const re = new RegExp(`<${tag}[\\s>]`, 'gi');
  return (html.match(re) ?? []).length;
}

function extractLinks(html: string, baseUrl: string): { total: number; external: number; outboundDomains: string[] } {
  const hrefRe = /href=["']([^"']+)["']/gi;
  const baseDomain = new URL(baseUrl).hostname.replace(/^www\./, '');
  const domains = new Set<string>();
  let total = 0;
  let external = 0;
  let m: RegExpExecArray | null;

  while ((m = hrefRe.exec(html)) !== null) {
    total++;
    try {
      const href = new URL(m[1], baseUrl);
      if (href.protocol === 'http:' || href.protocol === 'https:') {
        const linkDomain = href.hostname.replace(/^www\./, '');
        if (linkDomain !== baseDomain) {
          external++;
          domains.add(linkDomain);
        }
      }
    } catch {
      // invalid URL
    }
  }

  return { total, external, outboundDomains: Array.from(domains) };
}

function detectLanguage(text: string): string | null {
  const sample = text.slice(0, 2000).toLowerCase();
  const cyrillic = (sample.match(/[а-яё]/g) ?? []).length;
  const latin = (sample.match(/[a-z]/g) ?? []).length;
  if (cyrillic > latin * 0.5) return 'ru';
  if (latin > 50) return 'en';
  return null;
}

// ─── Keyword scanner ──────────────────────────────────────────────────────────

function scanKeywords(text: string): { matches: KeywordMatch[]; score: number; detectedVertical: string | null } {
  const lower = text.toLowerCase();
  const matches: KeywordMatch[] = [];
  const verticalCounts: Record<string, number> = {};

  for (const entry of GREY_KEYWORDS) {
    const idx = lower.indexOf(entry.keyword.toLowerCase());
    if (idx === -1) continue;

    const start = Math.max(0, idx - 50);
    const end = Math.min(lower.length, idx + entry.keyword.length + 50);
    const context = text.slice(start, end).replace(/\s+/g, ' ').trim();

    matches.push({
      keyword: entry.keyword,
      vertical: entry.vertical,
      severity: entry.severity,
      context,
    });

    verticalCounts[entry.vertical] = (verticalCounts[entry.vertical] ?? 0) +
      (entry.severity === 'critical' ? 3 : entry.severity === 'warning' ? 2 : 1);
  }

  // Score: 0 = clean, 100 = very risky
  let score = 0;
  for (const m of matches) {
    if (m.severity === 'critical') score += 20;
    else if (m.severity === 'warning') score += 10;
    else score += 3;
  }
  score = Math.min(100, score);

  // Detect dominant vertical
  let detectedVertical: string | null = null;
  let maxCount = 0;
  for (const [v, c] of Object.entries(verticalCounts)) {
    if (c > maxCount && v !== 'generic') {
      maxCount = c;
      detectedVertical = v;
    }
  }

  return { matches, score, detectedVertical };
}

// ─── Compliance checker ───────────────────────────────────────────────────────

interface ComplianceResult {
  hasPrivacyPolicy: boolean;
  hasTermsOfService: boolean;
  hasContactInfo: boolean;
  hasDisclaimer: boolean;
  hasAboutPage: boolean;
  hasCookieConsent: boolean;
  hasAgeVerification: boolean;
  score: number; // 0-100, higher = more compliant
}

function checkCompliance(html: string, text: string): ComplianceResult {
  const lower = html.toLowerCase();
  const lowerText = text.toLowerCase();

  const hasPrivacyPolicy = /privacy.?policy|политика.?конфиденциальности|privacy-policy|confidentiality/i.test(lower);
  const hasTermsOfService = /terms.?(?:of.?)?(?:service|use)|пользовательское.?соглашение|terms-of-service|terms-of-use|user.?agreement/i.test(lower);
  const hasContactInfo = /contact.?us|контакты|связаться|contact-us|support@|info@|(?:\+\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{2,4})/i.test(lower);
  const hasDisclaimer = /disclaimer|отказ.?от.?ответственности|не является.?(?:медицинской|финансовой)|individual results may vary|результаты могут отличаться/i.test(lowerText);
  const hasAboutPage = /about.?us|о.?нас|о.?компании|about-us|our.?(?:story|team|company)/i.test(lower);
  const hasCookieConsent = /cookie.?(?:consent|policy|banner|notice)|gdpr|использование.?cookie/i.test(lower);
  const hasAgeVerification = /(?:18|21)\+|age.?verif|подтвердите.?возраст|are you (?:18|21)|вам.?(?:есть|исполнилось).?(?:18|21)/i.test(lower);

  let score = 0;
  if (hasPrivacyPolicy) score += 25;
  if (hasTermsOfService) score += 20;
  if (hasContactInfo) score += 20;
  if (hasDisclaimer) score += 15;
  if (hasAboutPage) score += 10;
  if (hasCookieConsent) score += 5;
  if (hasAgeVerification) score += 5;

  return { hasPrivacyPolicy, hasTermsOfService, hasContactInfo, hasDisclaimer, hasAboutPage, hasCookieConsent, hasAgeVerification, score };
}

// ─── Structure analyzer ───────────────────────────────────────────────────────

interface StructureResult {
  redFlags: RedFlag[];
  hasCountdownTimer: boolean;
  hasFakeReviews: boolean;
  hasBeforeAfter: boolean;
  hasHiddenText: boolean;
  hasAggressiveCta: boolean;
  hasPopupOverlay: boolean;
  hasAutoPlayVideo: boolean;
  hasExternalRedirect: boolean;
  score: number; // 0-100 risk
}

function analyzeStructure(html: string, text: string): StructureResult {
  const lower = html.toLowerCase();
  const flags: RedFlag[] = [];

  // Countdown timer
  const hasCountdownTimer = /countdown|timer|setInterval.*(?:hour|min|sec)|обратный.?отсчёт|осталось.?\d+.*(?:час|мин|сек)|(?:data-)?countdown/i.test(lower);
  if (hasCountdownTimer) flags.push({ type: 'countdown_timer', severity: 'warning', detail: 'Countdown timer detected — urgency pressure tactic' });

  // Fake reviews patterns
  const hasFakeReviews = /(?:★{4,5}|⭐{4,5}|(?:5|4\.\d)\s*(?:out of|из)\s*5).*(?:review|отзыв)/i.test(lower) &&
    (lower.match(/(?:★{4,5}|⭐{4,5})/g) ?? []).length >= 3;
  if (hasFakeReviews) flags.push({ type: 'fake_reviews', severity: 'warning', detail: 'Multiple identical star ratings — possible fake review pattern' });

  // Before/After
  const hasBeforeAfter = /before.?(?:&amp;|and|\/|,)?.?after|до.?(?:и|\/|,)?.?после/i.test(text.toLowerCase());
  if (hasBeforeAfter) flags.push({ type: 'before_after', severity: 'warning', detail: 'Before/After content — requires proper disclaimers for Google Ads' });

  // Hidden text (color matching background, display:none with content, font-size:0)
  const hasHiddenText = /(?:color:\s*(?:white|#fff|#ffffff|transparent)|font-size:\s*0|text-indent:\s*-\d{4}|overflow:\s*hidden.*height:\s*0)/i.test(lower);
  if (hasHiddenText) flags.push({ type: 'hidden_text', severity: 'critical', detail: 'Hidden text CSS detected — Google penalizes hidden content' });

  // Aggressive CTAs
  const hasAggressiveCta = /(?:buy.?now|купить.?сейчас|(?:get|claim).?(?:it|yours).?(?:now|today)|заказать.?сейчас|(?:don't|не).?(?:miss|упусти)|(?:last|последний).?chance)/i.test(text.toLowerCase()) &&
    (lower.match(/(?:btn|button|cta)/g) ?? []).length >= 3;
  if (hasAggressiveCta) flags.push({ type: 'aggressive_cta', severity: 'info', detail: 'Multiple aggressive call-to-action buttons' });

  // Popup / overlay
  const hasPopupOverlay = /(?:modal|popup|overlay|lightbox).*(?:display|show|visible|open)/i.test(lower) &&
    /(?:position:\s*fixed|z-index:\s*\d{4,})/i.test(lower);
  if (hasPopupOverlay) flags.push({ type: 'popup_overlay', severity: 'warning', detail: 'Popup/overlay detected — intrusive interstitials flagged by Google' });

  // Auto-play video
  const hasAutoPlayVideo = /<video[^>]*autoplay/i.test(lower) || /autoplay.*?(?:true|1|")/i.test(lower);
  if (hasAutoPlayVideo) flags.push({ type: 'autoplay_video', severity: 'info', detail: 'Auto-playing video detected' });

  // External redirect via JS
  const hasExternalRedirect = /(?:window\.location|location\.href|location\.replace)\s*=\s*["'][^"']*(?:https?:\/\/)/i.test(html);
  if (hasExternalRedirect) flags.push({ type: 'js_redirect', severity: 'critical', detail: 'JavaScript redirect to external URL — possible cloaking' });

  // Suspicious JS patterns
  if (/eval\s*\(\s*(?:atob|unescape|decodeURI)/i.test(html)) {
    flags.push({ type: 'obfuscated_js', severity: 'critical', detail: 'Obfuscated JavaScript (eval + decode) — cloaking indicator' });
  }

  // Many iframes
  const iframeCount = countTag(html, 'iframe');
  if (iframeCount >= 3) {
    flags.push({ type: 'excessive_iframes', severity: 'warning', detail: `${iframeCount} iframes detected — possible content injection` });
  }

  let score = 0;
  for (const f of flags) {
    if (f.severity === 'critical') score += 25;
    else if (f.severity === 'warning') score += 12;
    else score += 5;
  }
  score = Math.min(100, score);

  return {
    redFlags: flags,
    hasCountdownTimer, hasFakeReviews, hasBeforeAfter, hasHiddenText,
    hasAggressiveCta, hasPopupOverlay, hasAutoPlayVideo, hasExternalRedirect,
    score,
  };
}

// ─── Redirect analyzer ────────────────────────────────────────────────────────

function analyzeRedirects(chain: string[], declaredUrl?: string): { score: number; mismatch: boolean } {
  let score = 0;

  if (chain.length > 2) score += 15 * (chain.length - 2);
  if (chain.length > 5) score = Math.max(score, 60);

  // Check domain mismatch across chain
  const domains = chain.map((u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } });
  const uniqueDomains = new Set(domains.filter(Boolean));
  if (uniqueDomains.size > 1) score += 20;

  let mismatch = false;
  if (declaredUrl) {
    try {
      const declaredDomain = new URL(declaredUrl).hostname.replace(/^www\./, '');
      const finalDomain = domains[domains.length - 1];
      if (finalDomain && declaredDomain !== finalDomain) {
        mismatch = true;
        score += 30;
      }
    } catch { /* invalid declared URL */ }
  }

  return { score: Math.min(100, score), mismatch };
}

// ─── HTTP Security Headers analyzer ──────────────────────────────────────────

interface SecurityHeadersResult {
  hasHsts: boolean;
  hasCsp: boolean;
  hasXFrameOptions: boolean;
  hasXContentType: boolean;
  hasReferrerPolicy: boolean;
  hasPermissionsPolicy: boolean;
  serverHeader: string | null;
  poweredBy: string | null;
  securityScore: number; // 0-100
  details: Array<{ header: string; status: 'present' | 'missing'; value?: string }>;
}

function analyzeSecurityHeaders(headers: Record<string, string>): SecurityHeadersResult {
  const h = (name: string) => headers[name.toLowerCase()] ?? null;

  const hasHsts = h('strict-transport-security') != null;
  const hasCsp = h('content-security-policy') != null;
  const hasXFrameOptions = h('x-frame-options') != null;
  const hasXContentType = h('x-content-type-options') != null;
  const hasReferrerPolicy = h('referrer-policy') != null;
  const hasPermissionsPolicy = h('permissions-policy') != null;
  const serverHeader = h('server');
  const poweredBy = h('x-powered-by');

  const details: SecurityHeadersResult['details'] = [
    { header: 'Strict-Transport-Security', status: hasHsts ? 'present' : 'missing', value: h('strict-transport-security') ?? undefined },
    { header: 'Content-Security-Policy', status: hasCsp ? 'present' : 'missing' },
    { header: 'X-Frame-Options', status: hasXFrameOptions ? 'present' : 'missing', value: h('x-frame-options') ?? undefined },
    { header: 'X-Content-Type-Options', status: hasXContentType ? 'present' : 'missing' },
    { header: 'Referrer-Policy', status: hasReferrerPolicy ? 'present' : 'missing', value: h('referrer-policy') ?? undefined },
    { header: 'Permissions-Policy', status: hasPermissionsPolicy ? 'present' : 'missing' },
  ];

  let securityScore = 0;
  if (hasHsts) securityScore += 25;
  if (hasCsp) securityScore += 25;
  if (hasXFrameOptions) securityScore += 15;
  if (hasXContentType) securityScore += 10;
  if (hasReferrerPolicy) securityScore += 15;
  if (hasPermissionsPolicy) securityScore += 10;

  return { hasHsts, hasCsp, hasXFrameOptions, hasXContentType, hasReferrerPolicy, hasPermissionsPolicy, serverHeader, poweredBy, securityScore, details };
}

// ─── TLD Risk scoring ────────────────────────────────────────────────────────

const HIGH_RISK_TLDS = new Set(['.xyz', '.top', '.click', '.club', '.icu', '.buzz', '.gq', '.cf', '.tk', '.ml', '.ga', '.work', '.fun', '.monster', '.sbs', '.rest', '.cam']);
const MEDIUM_RISK_TLDS = new Set(['.io', '.co', '.me', '.cc', '.pw', '.ws', '.biz', '.info', '.link', '.site', '.online', '.store', '.shop', '.live', '.space']);
const LOW_RISK_TLDS = new Set(['.com', '.org', '.net', '.edu', '.gov', '.mil']);

function scoreTld(domain: string): { tld: string; risk: 'high' | 'medium' | 'low'; score: number } {
  const parts = domain.split('.');
  const tld = '.' + parts[parts.length - 1];
  if (HIGH_RISK_TLDS.has(tld)) return { tld, risk: 'high', score: 80 };
  if (MEDIUM_RISK_TLDS.has(tld)) return { tld, risk: 'medium', score: 40 };
  if (LOW_RISK_TLDS.has(tld)) return { tld, risk: 'low', score: 5 };
  // Country TLDs
  if (tld.length === 3) return { tld, risk: 'low', score: 15 };
  return { tld, risk: 'medium', score: 30 };
}

// ─── robots.txt analyzer ─────────────────────────────────────────────────────

interface RobotsTxtResult {
  exists: boolean;
  blocksGooglebot: boolean;
  blocksAll: boolean;
  hasSitemap: boolean;
  sitemapUrls: string[];
  disallowedPaths: string[];
  rawContent: string | null;
}

async function analyzeRobotsTxt(baseUrl: string): Promise<RobotsTxtResult> {
  try {
    const origin = new URL(baseUrl).origin;
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { exists: false, blocksGooglebot: false, blocksAll: false, hasSitemap: false, sitemapUrls: [], disallowedPaths: [], rawContent: null };

    const text = await res.text();
    if (text.length > 50000 || !text.includes('User-agent') && !text.includes('user-agent')) {
      return { exists: false, blocksGooglebot: false, blocksAll: false, hasSitemap: false, sitemapUrls: [], disallowedPaths: [], rawContent: null };
    }

    const lines = text.split('\n').map(l => l.trim());
    const sitemapUrls: string[] = [];
    const disallowedPaths: string[] = [];
    let inGooglebotBlock = false;
    let inAllBlock = false;
    let blocksGooglebot = false;
    let blocksAll = false;

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.startsWith('sitemap:')) {
        sitemapUrls.push(line.slice(8).trim());
      }
      if (lower.startsWith('user-agent:')) {
        const agent = lower.slice(11).trim();
        inGooglebotBlock = agent === 'googlebot' || agent === 'googlebot-image';
        inAllBlock = agent === '*';
      }
      if (lower.startsWith('disallow:')) {
        const path = line.slice(9).trim();
        if (path) disallowedPaths.push(path);
        if (path === '/' && inGooglebotBlock) blocksGooglebot = true;
        if (path === '/' && inAllBlock) blocksAll = true;
      }
    }

    return {
      exists: true,
      blocksGooglebot,
      blocksAll,
      hasSitemap: sitemapUrls.length > 0,
      sitemapUrls,
      disallowedPaths,
      rawContent: text.slice(0, 2000),
    };
  } catch {
    return { exists: false, blocksGooglebot: false, blocksAll: false, hasSitemap: false, sitemapUrls: [], disallowedPaths: [], rawContent: null };
  }
}

// ─── Form target analyzer ────────────────────────────────────────────────────

interface FormAnalysis {
  forms: Array<{ action: string; method: string; isExternal: boolean; inputNames: string[] }>;
  collectsPersonalData: boolean;
  collectsPaymentData: boolean;
  externalFormTargets: string[];
}

function analyzeForms(html: string, baseUrl: string): FormAnalysis {
  const baseDomain = new URL(baseUrl).hostname.replace(/^www\./, '');
  const formRe = /<form[^>]*>([\s\S]*?)<\/form>/gi;
  const actionRe = /action=["']([^"']*?)["']/i;
  const methodRe = /method=["']([^"']*?)["']/i;
  const inputNameRe = /name=["']([^"']*?)["']/gi;
  const forms: FormAnalysis['forms'] = [];
  const externalTargets = new Set<string>();
  let collectsPersonal = false;
  let collectsPayment = false;

  const personalFields = /email|phone|tel|name|address|город|телефон|имя|фамилия|адрес/i;
  const paymentFields = /card|cvv|cvc|ccnum|expir|billing|payment|карта|оплата/i;

  let m: RegExpExecArray | null;
  while ((m = formRe.exec(html)) !== null) {
    const formHtml = m[0];
    const action = actionRe.exec(formHtml)?.[1] ?? '';
    const method = (methodRe.exec(formHtml)?.[1] ?? 'get').toUpperCase();

    let isExternal = false;
    if (action && action.startsWith('http')) {
      try {
        const targetDomain = new URL(action).hostname.replace(/^www\./, '');
        if (targetDomain !== baseDomain) {
          isExternal = true;
          externalTargets.add(targetDomain);
        }
      } catch { /* invalid url */ }
    }

    const inputNames: string[] = [];
    let im: RegExpExecArray | null;
    while ((im = inputNameRe.exec(formHtml)) !== null) {
      inputNames.push(im[1]);
      if (personalFields.test(im[1])) collectsPersonal = true;
      if (paymentFields.test(im[1])) collectsPayment = true;
    }

    forms.push({ action, method, isExternal, inputNames });
  }

  return {
    forms,
    collectsPersonalData: collectsPersonal,
    collectsPaymentData: collectsPayment,
    externalFormTargets: Array.from(externalTargets),
  };
}

// ─── Third-party script cataloger ────────────────────────────────────────────

interface ThirdPartyScripts {
  analytics: string[];    // GA, GTM, Yandex Metrica
  advertising: string[];  // FB Pixel, TikTok, Google Ads
  trackers: string[];     // Known TDS/affiliate trackers
  suspicious: string[];   // Keitaro, Binom, known cloaking
  cdn: string[];          // Cloudflare, jsDelivr, etc.
  allDomains: string[];
}

const KNOWN_SCRIPTS: Record<string, { name: string; category: keyof ThirdPartyScripts }> = {
  'google-analytics.com': { name: 'Google Analytics', category: 'analytics' },
  'googletagmanager.com': { name: 'Google Tag Manager', category: 'analytics' },
  'mc.yandex.ru': { name: 'Yandex Metrica', category: 'analytics' },
  'connect.facebook.net': { name: 'Facebook Pixel', category: 'advertising' },
  'snap.licdn.com': { name: 'LinkedIn Insight', category: 'advertising' },
  'analytics.tiktok.com': { name: 'TikTok Pixel', category: 'advertising' },
  'googleads.g.doubleclick.net': { name: 'Google Ads', category: 'advertising' },
  'googlesyndication.com': { name: 'Google AdSense', category: 'advertising' },
  'pagead2.googlesyndication.com': { name: 'Google Ads', category: 'advertising' },
  'www.googleadservices.com': { name: 'Google Ads Conversion', category: 'advertising' },
  'keitaro.io': { name: 'Keitaro TDS', category: 'suspicious' },
  'binom.org': { name: 'Binom TDS', category: 'suspicious' },
  'trafficjunky.com': { name: 'TrafficJunky', category: 'suspicious' },
  'clickadu.com': { name: 'Clickadu', category: 'suspicious' },
  'propellerads.com': { name: 'PropellerAds', category: 'suspicious' },
  'exoclick.com': { name: 'ExoClick', category: 'suspicious' },
  'cdn.jsdelivr.net': { name: 'jsDelivr', category: 'cdn' },
  'cdnjs.cloudflare.com': { name: 'Cloudflare CDN', category: 'cdn' },
  'unpkg.com': { name: 'UNPKG', category: 'cdn' },
  'ajax.googleapis.com': { name: 'Google CDN', category: 'cdn' },
};

function catalogScripts(html: string, baseUrl: string): ThirdPartyScripts {
  const baseDomain = new URL(baseUrl).hostname.replace(/^www\./, '');
  const srcRe = /<script[^>]*src=["']([^"']+)["']/gi;
  const result: ThirdPartyScripts = { analytics: [], advertising: [], trackers: [], suspicious: [], cdn: [], allDomains: [] };
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  while ((m = srcRe.exec(html)) !== null) {
    try {
      const scriptUrl = new URL(m[1], baseUrl);
      const domain = scriptUrl.hostname.replace(/^www\./, '');
      if (domain === baseDomain || seen.has(domain)) continue;
      seen.add(domain);
      result.allDomains.push(domain);

      // Match against known scripts
      for (const [pattern, info] of Object.entries(KNOWN_SCRIPTS)) {
        if (domain.includes(pattern)) {
          result[info.category].push(info.name);
          break;
        }
      }
    } catch { /* invalid URL */ }
  }

  // Also check inline patterns
  if (/gtag|GA_TRACKING_ID|G-[A-Z0-9]{10}/i.test(html) && !result.analytics.includes('Google Analytics')) {
    result.analytics.push('Google Analytics (inline)');
  }
  if (/fbq\s*\(|facebook\.com\/tr/i.test(html) && !result.advertising.includes('Facebook Pixel')) {
    result.advertising.push('Facebook Pixel (inline)');
  }
  if (/ym\s*\(\s*\d+/i.test(html) && !result.analytics.includes('Yandex Metrica')) {
    result.analytics.push('Yandex Metrica (inline)');
  }
  if (/keitaro|binom|tds.*redirect/i.test(html)) {
    result.suspicious.push('TDS pattern (inline)');
  }

  return result;
}

// ─── External link reputation ────────────────────────────────────────────────

const KNOWN_BAD_DOMAINS = new Set([
  'bit.ly', 'tinyurl.com', 'goo.gl', 't.co', // URL shorteners (hiding destination)
  'keitaro.io', 'binom.org', 'bemob.com', 'voluum.com', // TDS/trackers
  'clickbank.net', 'clickbank.com', // Affiliate networks
  'digistore24.com', 'warriorplus.com', // Affiliate
  'buygoods.com', 'clktrk.com', 'trk.as', // Tracking
]);

interface LinkReputation {
  shortenerLinks: string[];
  affiliateLinks: string[];
  trackerLinks: string[];
  suspiciousDomains: string[];
  score: number; // 0-100 risk
}

function checkLinkReputation(outboundDomains: string[]): LinkReputation {
  const shorteners: string[] = [];
  const affiliates: string[] = [];
  const trackers: string[] = [];
  const suspicious: string[] = [];

  for (const domain of outboundDomains) {
    const lower = domain.toLowerCase();
    if (['bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'cutt.ly', 'rb.gy', 'is.gd', 'v.gd', 'shorturl.at'].some(s => lower === s)) {
      shorteners.push(domain);
    } else if (['clickbank.net', 'clickbank.com', 'digistore24.com', 'warriorplus.com', 'buygoods.com', 'jvzoo.com'].some(s => lower.includes(s))) {
      affiliates.push(domain);
    } else if (['keitaro.io', 'binom.org', 'bemob.com', 'voluum.com', 'clktrk.com', 'trk.as'].some(s => lower.includes(s))) {
      trackers.push(domain);
    } else if (KNOWN_BAD_DOMAINS.has(lower)) {
      suspicious.push(domain);
    }
  }

  let score = 0;
  score += shorteners.length * 15;
  score += affiliates.length * 20;
  score += trackers.length * 25;
  score += suspicious.length * 10;

  return { shortenerLinks: shorteners, affiliateLinks: affiliates, trackerLinks: trackers, suspiciousDomains: suspicious, score: Math.min(100, score) };
}

// ─── Schema.org structured data ──────────────────────────────────────────────

interface StructuredDataResult {
  hasJsonLd: boolean;
  hasSchemaOrg: boolean;
  schemaTypes: string[]; // e.g. ["Organization", "Product", "WebSite"]
  hasBreadcrumbs: boolean;
  hasProductSchema: boolean;
  hasOrganizationSchema: boolean;
  hasFaqSchema: boolean;
  legitimacyBonus: number; // 0-30 bonus for having proper structured data
}

function analyzeStructuredData(html: string): StructuredDataResult {
  const jsonLdRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const schemaTypes: string[] = [];
  let hasJsonLd = false;

  let m: RegExpExecArray | null;
  while ((m = jsonLdRe.exec(html)) !== null) {
    hasJsonLd = true;
    try {
      const data = JSON.parse(m[1]) as Record<string, unknown>;
      const type = (data['@type'] as string) ?? '';
      if (type) schemaTypes.push(type);
      if (Array.isArray(data['@graph'])) {
        for (const item of data['@graph']) {
          const t = (item as Record<string, unknown>)['@type'] as string;
          if (t) schemaTypes.push(t);
        }
      }
    } catch { /* invalid JSON-LD */ }
  }

  const hasSchemaOrg = /itemtype=["']https?:\/\/schema\.org/i.test(html) || hasJsonLd;
  const hasBreadcrumbs = schemaTypes.some(t => /breadcrumb/i.test(t)) || /breadcrumb/i.test(html);
  const hasProductSchema = schemaTypes.some(t => /product/i.test(t));
  const hasOrganizationSchema = schemaTypes.some(t => /organization|localbusiness/i.test(t));
  const hasFaqSchema = schemaTypes.some(t => /faq/i.test(t));

  let legitimacyBonus = 0;
  if (hasJsonLd) legitimacyBonus += 10;
  if (hasOrganizationSchema) legitimacyBonus += 10;
  if (hasBreadcrumbs) legitimacyBonus += 5;
  if (hasFaqSchema) legitimacyBonus += 5;

  return { hasJsonLd, hasSchemaOrg, schemaTypes, hasBreadcrumbs, hasProductSchema, hasOrganizationSchema, hasFaqSchema, legitimacyBonus };
}

// ─── Level 2: External API analyzers ──────────────────────────────────────────

// Google Safe Browsing (requires GOOGLE_SAFE_BROWSING_KEY env var)
export interface SafeBrowsingResult {
  safe: boolean;
  threats: Array<{ type: string; platform: string }>;
  checked: boolean; // false if API key not set
}

async function checkSafeBrowsing(url: string): Promise<SafeBrowsingResult> {
  const apiKey = process.env['GOOGLE_SAFE_BROWSING_KEY'];
  if (!apiKey) return { safe: true, threats: [], checked: false };

  try {
    const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: 'cts-antifraud', clientVersion: '1.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url }],
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json() as { matches?: Array<{ threatType: string; platformType: string }> };
    const threats = (data.matches ?? []).map(m => ({ type: m.threatType, platform: m.platformType }));
    return { safe: threats.length === 0, threats, checked: true };
  } catch (err) {
    console.error('[domain-content] Safe Browsing API error:', err instanceof Error ? err.message : err);
    return { safe: true, threats: [], checked: false };
  }
}

// Google PageSpeed Insights (free, no key required — but key increases quota)
export interface PageSpeedResult {
  performanceScore: number | null; // 0-100
  firstContentfulPaint: number | null; // ms
  largestContentfulPaint: number | null; // ms
  cumulativeLayoutShift: number | null;
  speedIndex: number | null; // ms
  totalBlockingTime: number | null; // ms
  mobile: boolean;
  checked: boolean;
}

async function checkPageSpeed(url: string): Promise<PageSpeedResult> {
  const empty: PageSpeedResult = { performanceScore: null, firstContentfulPaint: null, largestContentfulPaint: null, cumulativeLayoutShift: null, speedIndex: null, totalBlockingTime: null, mobile: true, checked: false };
  try {
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance`;
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return empty;

    const data = await res.json() as {
      lighthouseResult?: {
        categories?: { performance?: { score?: number } };
        audits?: Record<string, { numericValue?: number }>;
      };
    };

    const lh = data.lighthouseResult;
    if (!lh) return empty;

    return {
      performanceScore: lh.categories?.performance?.score != null ? Math.round(lh.categories.performance.score * 100) : null,
      firstContentfulPaint: lh.audits?.['first-contentful-paint']?.numericValue ?? null,
      largestContentfulPaint: lh.audits?.['largest-contentful-paint']?.numericValue ?? null,
      cumulativeLayoutShift: lh.audits?.['cumulative-layout-shift']?.numericValue ?? null,
      speedIndex: lh.audits?.['speed-index']?.numericValue ?? null,
      totalBlockingTime: lh.audits?.['total-blocking-time']?.numericValue ?? null,
      mobile: true,
      checked: true,
    };
  } catch (err) {
    console.error('[domain-content] PageSpeed API error:', err instanceof Error ? err.message : err);
    return empty;
  }
}

// VirusTotal (requires VIRUSTOTAL_API_KEY env var, free: 4 req/min)
export interface VirusTotalResult {
  malicious: number;
  suspicious: number;
  harmless: number;
  undetected: number;
  reputation: number;
  categories: string[];
  checked: boolean;
}

async function checkVirusTotal(domain: string): Promise<VirusTotalResult> {
  const apiKey = process.env['VIRUSTOTAL_API_KEY'];
  const empty: VirusTotalResult = { malicious: 0, suspicious: 0, harmless: 0, undetected: 0, reputation: 0, categories: [], checked: false };
  if (!apiKey) return empty;

  try {
    const res = await fetch(`https://www.virustotal.com/api/v3/domains/${domain}`, {
      headers: { 'x-apikey': apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return empty;

    const data = await res.json() as {
      data?: {
        attributes?: {
          last_analysis_stats?: { malicious?: number; suspicious?: number; harmless?: number; undetected?: number };
          reputation?: number;
          categories?: Record<string, string>;
        };
      };
    };

    const attrs = data.data?.attributes;
    if (!attrs) return empty;

    const stats = attrs.last_analysis_stats;
    return {
      malicious: stats?.malicious ?? 0,
      suspicious: stats?.suspicious ?? 0,
      harmless: stats?.harmless ?? 0,
      undetected: stats?.undetected ?? 0,
      reputation: attrs.reputation ?? 0,
      categories: Object.values(attrs.categories ?? {}),
      checked: true,
    };
  } catch (err) {
    console.error('[domain-content] VirusTotal API error:', err instanceof Error ? err.message : err);
    return empty;
  }
}

// Wayback Machine (free, no key)
export interface WaybackResult {
  hasHistory: boolean;
  firstSnapshot: string | null; // ISO date
  lastSnapshot: string | null;
  totalSnapshots: number;
  domainAgeFromArchive: number | null; // days
  checked: boolean;
}

async function checkWayback(domain: string): Promise<WaybackResult> {
  const empty: WaybackResult = { hasHistory: false, firstSnapshot: null, lastSnapshot: null, totalSnapshots: 0, domainAgeFromArchive: null, checked: false };
  try {
    // Single request: get first and last snapshot in parallel with 3s timeout
    const [firstRes, lastRes] = await Promise.all([
      fetch(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&output=json&limit=1&fl=timestamp&sort=asc`, { signal: AbortSignal.timeout(3000) }),
      fetch(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&output=json&limit=1&fl=timestamp&sort=desc`, { signal: AbortSignal.timeout(3000) }),
    ]);

    if (!firstRes.ok) return empty;
    const first = await firstRes.json() as string[][];
    if (!first || first.length < 2) return empty;
    const firstTs = first[1]?.[0];

    const last = lastRes.ok ? await lastRes.json() as string[][] : [];
    const lastTs = last[1]?.[0];

    function parseWaybackTs(ts: string): Date | null {
      if (!ts || ts.length < 8) return null;
      return new Date(`${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`);
    }

    const firstDate = firstTs ? parseWaybackTs(firstTs) : null;
    const lastDate = lastTs ? parseWaybackTs(lastTs) : null;
    const ageDays = firstDate ? Math.floor((Date.now() - firstDate.getTime()) / 86400000) : null;

    return {
      hasHistory: true,
      firstSnapshot: firstDate?.toISOString().slice(0, 10) ?? null,
      lastSnapshot: lastDate?.toISOString().slice(0, 10) ?? null,
      totalSnapshots: 0,
      domainAgeFromArchive: ageDays,
      checked: true,
    };
  } catch (err) {
    console.error('[domain-content] Wayback API error:', err instanceof Error ? err.message : err);
    return empty;
  }
}

// ─── LLM context builder ─────────────────────────────────────────────────────

function buildLlmContext(result: ContentAnalysisResult): { summary: string; context: Record<string, unknown> } {
  const lines: string[] = [];
  lines.push(`Domain: ${result.finalUrl}`);
  lines.push(`Content Risk Score: ${result.contentRiskScore}/100`);

  if (result.detectedVertical) {
    lines.push(`Detected Vertical: ${result.detectedVertical}`);
  }

  if (result.keywordMatches.length > 0) {
    lines.push(`\nGrey Keywords Found (${result.keywordMatches.length}):`);
    const critical = result.keywordMatches.filter(m => m.severity === 'critical');
    const warning = result.keywordMatches.filter(m => m.severity === 'warning');
    if (critical.length > 0) lines.push(`  CRITICAL: ${critical.map(m => m.keyword).join(', ')}`);
    if (warning.length > 0) lines.push(`  WARNING: ${warning.map(m => m.keyword).join(', ')}`);
  }

  lines.push(`\nCompliance (${result.complianceScore}/100):`);
  lines.push(`  Privacy Policy: ${result.hasPrivacyPolicy ? 'YES' : 'MISSING'}`);
  lines.push(`  Terms of Service: ${result.hasTermsOfService ? 'YES' : 'MISSING'}`);
  lines.push(`  Contact Info: ${result.hasContactInfo ? 'YES' : 'MISSING'}`);
  lines.push(`  Disclaimer: ${result.hasDisclaimer ? 'YES' : 'MISSING'}`);

  if (result.redFlags.length > 0) {
    lines.push(`\nRed Flags (${result.redFlags.length}):`);
    for (const f of result.redFlags) {
      lines.push(`  [${f.severity.toUpperCase()}] ${f.detail}`);
    }
  }

  if (result.redirectCount > 1) {
    lines.push(`\nRedirect Chain (${result.redirectCount} hops):`);
    for (const u of result.redirectChain) lines.push(`  → ${u}`);
    if (result.urlMismatch) lines.push(`  ⚠️ URL MISMATCH: final URL differs from declared`);
  }

  lines.push(`\nPage Metrics: ${result.wordCount} words, ${result.totalLinks} links (${result.externalLinks} external), ${result.formCount} forms, ${result.scriptCount} scripts, ${result.iframeCount} iframes`);
  if (result.pageLanguage) lines.push(`Language: ${result.pageLanguage}`);

  // Level 2 data
  lines.push(`\nTLD Risk: ${result.tldRisk.tld} (${result.tldRisk.risk})`);
  lines.push(`Security Headers Score: ${result.securityHeaders.securityScore}/100`);
  if (result.securityHeaders.serverHeader) lines.push(`Server: ${result.securityHeaders.serverHeader}`);

  if (result.robotsTxt.exists) {
    lines.push(`\nrobots.txt: exists`);
    if (result.robotsTxt.blocksGooglebot) lines.push('  ⚠️ BLOCKS GOOGLEBOT');
    if (result.robotsTxt.hasSitemap) lines.push(`  Sitemap: ${result.robotsTxt.sitemapUrls.join(', ')}`);
  }

  if (result.formAnalysis.forms.length > 0) {
    lines.push(`\nForms: ${result.formAnalysis.forms.length}`);
    if (result.formAnalysis.collectsPersonalData) lines.push('  Collects personal data');
    if (result.formAnalysis.collectsPaymentData) lines.push('  ⚠️ Collects payment data');
    if (result.formAnalysis.externalFormTargets.length > 0) lines.push(`  External targets: ${result.formAnalysis.externalFormTargets.join(', ')}`);
  }

  const allScripts = [...result.thirdPartyScripts.analytics, ...result.thirdPartyScripts.advertising, ...result.thirdPartyScripts.suspicious];
  if (allScripts.length > 0) lines.push(`\nThird-party scripts: ${allScripts.join(', ')}`);
  if (result.thirdPartyScripts.suspicious.length > 0) lines.push(`  ⚠️ SUSPICIOUS: ${result.thirdPartyScripts.suspicious.join(', ')}`);

  if (result.linkReputation.affiliateLinks.length > 0 || result.linkReputation.trackerLinks.length > 0) {
    lines.push(`\nLink reputation issues:`);
    if (result.linkReputation.affiliateLinks.length > 0) lines.push(`  Affiliate: ${result.linkReputation.affiliateLinks.join(', ')}`);
    if (result.linkReputation.trackerLinks.length > 0) lines.push(`  Trackers: ${result.linkReputation.trackerLinks.join(', ')}`);
  }

  if (result.structuredData.hasJsonLd) {
    lines.push(`\nStructured data: ${result.structuredData.schemaTypes.join(', ')}`);
  }

  // External APIs
  if (result.safeBrowsing.checked) {
    lines.push(`\nGoogle Safe Browsing: ${result.safeBrowsing.safe ? 'SAFE' : '⚠️ THREATS DETECTED: ' + result.safeBrowsing.threats.map(t => t.type).join(', ')}`);
  }
  if (result.pageSpeed.checked && result.pageSpeed.performanceScore != null) {
    lines.push(`PageSpeed (mobile): ${result.pageSpeed.performanceScore}/100, LCP: ${result.pageSpeed.largestContentfulPaint != null ? Math.round(result.pageSpeed.largestContentfulPaint) + 'ms' : 'N/A'}`);
  }
  if (result.virusTotal.checked) {
    lines.push(`VirusTotal: ${result.virusTotal.malicious} malicious, ${result.virusTotal.suspicious} suspicious (reputation: ${result.virusTotal.reputation})`);
    if (result.virusTotal.categories.length > 0) lines.push(`  Categories: ${result.virusTotal.categories.join(', ')}`);
  }
  if (result.wayback.checked && result.wayback.hasHistory) {
    lines.push(`Wayback Machine: first snapshot ${result.wayback.firstSnapshot}, ~${result.wayback.totalSnapshots} snapshots, archive age ${result.wayback.domainAgeFromArchive ?? '?'} days`);
  }

  const summary = lines.join('\n');

  const context: Record<string, unknown> = {
    domain: result.finalUrl,
    content_risk_score: result.contentRiskScore,
    keyword_risk_score: result.keywordRiskScore,
    compliance_score: result.complianceScore,
    structure_risk_score: result.structureRiskScore,
    redirect_risk_score: result.redirectRiskScore,
    detected_vertical: result.detectedVertical,
    keyword_matches_critical: result.keywordMatches.filter(m => m.severity === 'critical').map(m => m.keyword),
    keyword_matches_warning: result.keywordMatches.filter(m => m.severity === 'warning').map(m => m.keyword),
    compliance: {
      privacy_policy: result.hasPrivacyPolicy,
      terms_of_service: result.hasTermsOfService,
      contact_info: result.hasContactInfo,
      disclaimer: result.hasDisclaimer,
      about_page: result.hasAboutPage,
      cookie_consent: result.hasCookieConsent,
      age_verification: result.hasAgeVerification,
    },
    red_flags: result.redFlags.map(f => ({ type: f.type, severity: f.severity })),
    redirects: {
      count: result.redirectCount,
      chain: result.redirectChain,
      final_url: result.finalUrl,
      url_mismatch: result.urlMismatch,
    },
    page_metrics: {
      language: result.pageLanguage,
      word_count: result.wordCount,
      links_total: result.totalLinks,
      links_external: result.externalLinks,
      forms: result.formCount,
      scripts: result.scriptCount,
      iframes: result.iframeCount,
      images: result.imageCount,
    },
    outbound_domains: result.outboundDomains,
    tld_risk: result.tldRisk,
    security_headers: {
      score: result.securityHeaders.securityScore,
      hsts: result.securityHeaders.hasHsts,
      csp: result.securityHeaders.hasCsp,
      server: result.securityHeaders.serverHeader,
    },
    robots_txt: {
      exists: result.robotsTxt.exists,
      blocks_googlebot: result.robotsTxt.blocksGooglebot,
      has_sitemap: result.robotsTxt.hasSitemap,
    },
    forms: {
      count: result.formAnalysis.forms.length,
      collects_personal: result.formAnalysis.collectsPersonalData,
      collects_payment: result.formAnalysis.collectsPaymentData,
      external_targets: result.formAnalysis.externalFormTargets,
    },
    third_party_scripts: {
      analytics: result.thirdPartyScripts.analytics,
      advertising: result.thirdPartyScripts.advertising,
      suspicious: result.thirdPartyScripts.suspicious,
    },
    link_reputation: {
      affiliate_links: result.linkReputation.affiliateLinks,
      tracker_links: result.linkReputation.trackerLinks,
      shortener_links: result.linkReputation.shortenerLinks,
      score: result.linkReputation.score,
    },
    structured_data: {
      has_json_ld: result.structuredData.hasJsonLd,
      types: result.structuredData.schemaTypes,
      legitimacy_bonus: result.structuredData.legitimacyBonus,
    },
    safe_browsing: result.safeBrowsing.checked ? { safe: result.safeBrowsing.safe, threats: result.safeBrowsing.threats } : null,
    page_speed: result.pageSpeed.checked ? { score: result.pageSpeed.performanceScore, lcp: result.pageSpeed.largestContentfulPaint, cls: result.pageSpeed.cumulativeLayoutShift } : null,
    virus_total: result.virusTotal.checked ? { malicious: result.virusTotal.malicious, suspicious: result.virusTotal.suspicious, reputation: result.virusTotal.reputation, categories: result.virusTotal.categories } : null,
    wayback: result.wayback.checked ? { first: result.wayback.firstSnapshot, last: result.wayback.lastSnapshot, snapshots: result.wayback.totalSnapshots, age_days: result.wayback.domainAgeFromArchive } : null,
    external_apis: result.externalApis ? {
      dns: result.externalApis.dnsAnalysis.checked ? { spf: result.externalApis.dnsAnalysis.hasSpf, dmarc: result.externalApis.dnsAnalysis.hasDmarc, mx: result.externalApis.dnsAnalysis.hasMx } : null,
      blocklists: result.externalApis.blocklists.checked ? { listed: result.externalApis.blocklists.lists } : null,
      crt_sh: result.externalApis.crtSh.checked ? { certs: result.externalApis.crtSh.totalCerts, subdomains: result.externalApis.crtSh.subdomains.length } : null,
      shodan: result.externalApis.shodan.checked ? { ports: result.externalApis.shodan.ports, vulns: result.externalApis.shodan.vulns } : null,
      ipqs: result.externalApis.ipqs.checked ? { risk: result.externalApis.ipqs.riskScore, malware: result.externalApis.ipqs.malware, phishing: result.externalApis.ipqs.phishing } : null,
      abuse_ipdb: result.externalApis.abuseIpdb.checked ? { score: result.externalApis.abuseIpdb.abuseScore, reports: result.externalApis.abuseIpdb.totalReports } : null,
      urlhaus: result.externalApis.urlhaus.checked ? { malware: result.externalApis.urlhaus.isMalware } : null,
      phishtank: result.externalApis.phishTank.checked ? { phishing: result.externalApis.phishTank.isPhishing } : null,
      wot: result.externalApis.wot.checked ? { trust: result.externalApis.wot.trustworthiness } : null,
      google_indexed: result.externalApis.googleIndex.checked ? { indexed: result.externalApis.googleIndex.indexed, pages: result.externalApis.googleIndex.totalResults } : null,
      serp: result.externalApis.serpApi.checked ? { indexed: result.externalApis.serpApi.indexed, pages: result.externalApis.serpApi.totalResults } : null,
    } : null,
  };

  return { summary, context };
}

// ─── Main analyzer ────────────────────────────────────────────────────────────

export async function analyzeContent(url: string, declaredUrl?: string): Promise<ContentAnalysisResult> {
  const fullUrl = url.startsWith('http') ? url : `https://${url}`;
  const fetchResult = await fetchWithRedirects(fullUrl);
  const { html, finalUrl, redirectChain, headers } = fetchResult;

  const text = extractText(html);
  const links = extractLinks(html, finalUrl);
  const { matches, score: kwScore, detectedVertical } = scanKeywords(text);
  const compliance = checkCompliance(html, text);
  const structure = analyzeStructure(html, text);
  const redirects = analyzeRedirects(redirectChain, declaredUrl);

  // Level 1 analyzers (local)
  const securityHeaders = analyzeSecurityHeaders(headers);
  const domain = new URL(finalUrl).hostname.replace(/^www\./, '');
  const tldRisk = scoreTld(domain);
  const formAnalysis = analyzeForms(html, finalUrl);
  const thirdPartyScripts = catalogScripts(html, finalUrl);
  const linkReputation = checkLinkReputation(links.outboundDomains);
  const structuredData = analyzeStructuredData(html);

  // Level 1 + Level 2 + Level 3 analyzers (async, run in parallel)
  const [robotsTxt, safeBrowsing, pageSpeed, virusTotal, wayback, externalApis] = await Promise.all([
    analyzeRobotsTxt(finalUrl),
    checkSafeBrowsing(fullUrl),
    checkPageSpeed(fullUrl),
    checkVirusTotal(domain),
    checkWayback(domain),
    runAllExternalChecks(domain, fullUrl).catch((err) => {
      console.error('[domain-content] External APIs batch error:', err instanceof Error ? err.message : err);
      return null;
    }),
  ]);

  const ogTags: Record<string, string> = {};
  for (const prop of ['og:title', 'og:description', 'og:image', 'og:type']) {
    const val = extractMeta(html, prop);
    if (val) ogTags[prop.replace('og:', '')] = val;
  }

  // Weighted composite risk score (enhanced with Level 2 data)
  const complianceAdjusted = Math.min(100, compliance.score + structuredData.legitimacyBonus);
  const contentRiskScore = Math.min(100, Math.round(
    kwScore * 0.25 +
    (100 - complianceAdjusted) * 0.20 +
    structure.score * 0.20 +
    redirects.score * 0.10 +
    tldRisk.score * 0.10 +
    linkReputation.score * 0.10 +
    (100 - securityHeaders.securityScore) * 0.05
  ));

  const result: ContentAnalysisResult = {
    url: fullUrl,
    contentRiskScore,
    keywordRiskScore: kwScore,
    complianceScore: complianceAdjusted,
    structureRiskScore: structure.score,
    redirectRiskScore: redirects.score,

    keywordMatches: matches,
    detectedVertical,

    ...compliance,
    ...structure,

    redirectCount: redirectChain.length,
    redirectChain,
    finalUrl,
    urlMismatch: redirects.mismatch,

    pageLanguage: detectLanguage(text),
    totalLinks: links.total,
    externalLinks: links.external,
    formCount: countTag(html, 'form'),
    imageCount: countTag(html, 'img'),
    scriptCount: countTag(html, 'script'),
    iframeCount: countTag(html, 'iframe'),
    wordCount: text.split(/\s+/).filter(Boolean).length,
    pageTitle: extractTitle(html),
    pageDescription: extractMeta(html, 'description'),
    ogTags: Object.keys(ogTags).length > 0 ? ogTags : null,
    outboundDomains: links.outboundDomains,

    securityHeaders,
    tldRisk,
    robotsTxt,
    formAnalysis,
    thirdPartyScripts,
    linkReputation,
    structuredData,

    safeBrowsing,
    pageSpeed,
    virusTotal,
    wayback,
    externalApis: externalApis ?? null,

    analysisSummary: '',
    llmContext: {},
  };

  const { summary, context } = buildLlmContext(result);
  result.analysisSummary = summary;
  result.llmContext = context;

  return result;
}

// ─── DB persistence ───────────────────────────────────────────────────────────

export async function analyzeAndSave(pool: pg.Pool, domainId: string, url: string, declaredUrl?: string): Promise<ContentAnalysisResult> {
  const result = await analyzeContent(url, declaredUrl);

  await pool.query(
    `INSERT INTO domain_content_analysis (
       domain_id, url, content_risk_score, keyword_risk_score, compliance_score,
       structure_risk_score, redirect_risk_score, keyword_matches, detected_vertical,
       has_privacy_policy, has_terms_of_service, has_contact_info, has_disclaimer,
       has_about_page, has_cookie_consent, has_age_verification,
       red_flags, has_countdown_timer, has_fake_reviews, has_before_after,
       has_hidden_text, has_aggressive_cta, has_popup_overlay, has_auto_play_video,
       has_external_redirect, redirect_count, redirect_chain, final_url, url_mismatch,
       page_language, total_links, external_links, form_count, image_count,
       script_count, iframe_count, word_count, page_title, page_description,
       og_tags, outbound_domains, analysis_summary, llm_context, analyzed_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10, $11, $12, $13, $14, $15, $16,
       $17, $18, $19, $20, $21, $22, $23, $24, $25,
       $26, $27, $28, $29,
       $30, $31, $32, $33, $34, $35, $36, $37, $38, $39,
       $40, $41, $42, $43, NOW()
     )
     ON CONFLICT (domain_id) DO UPDATE SET
       url = EXCLUDED.url,
       content_risk_score = EXCLUDED.content_risk_score,
       keyword_risk_score = EXCLUDED.keyword_risk_score,
       compliance_score = EXCLUDED.compliance_score,
       structure_risk_score = EXCLUDED.structure_risk_score,
       redirect_risk_score = EXCLUDED.redirect_risk_score,
       keyword_matches = EXCLUDED.keyword_matches,
       detected_vertical = EXCLUDED.detected_vertical,
       has_privacy_policy = EXCLUDED.has_privacy_policy,
       has_terms_of_service = EXCLUDED.has_terms_of_service,
       has_contact_info = EXCLUDED.has_contact_info,
       has_disclaimer = EXCLUDED.has_disclaimer,
       has_about_page = EXCLUDED.has_about_page,
       has_cookie_consent = EXCLUDED.has_cookie_consent,
       has_age_verification = EXCLUDED.has_age_verification,
       red_flags = EXCLUDED.red_flags,
       has_countdown_timer = EXCLUDED.has_countdown_timer,
       has_fake_reviews = EXCLUDED.has_fake_reviews,
       has_before_after = EXCLUDED.has_before_after,
       has_hidden_text = EXCLUDED.has_hidden_text,
       has_aggressive_cta = EXCLUDED.has_aggressive_cta,
       has_popup_overlay = EXCLUDED.has_popup_overlay,
       has_auto_play_video = EXCLUDED.has_auto_play_video,
       has_external_redirect = EXCLUDED.has_external_redirect,
       redirect_count = EXCLUDED.redirect_count,
       redirect_chain = EXCLUDED.redirect_chain,
       final_url = EXCLUDED.final_url,
       url_mismatch = EXCLUDED.url_mismatch,
       page_language = EXCLUDED.page_language,
       total_links = EXCLUDED.total_links,
       external_links = EXCLUDED.external_links,
       form_count = EXCLUDED.form_count,
       image_count = EXCLUDED.image_count,
       script_count = EXCLUDED.script_count,
       iframe_count = EXCLUDED.iframe_count,
       word_count = EXCLUDED.word_count,
       page_title = EXCLUDED.page_title,
       page_description = EXCLUDED.page_description,
       og_tags = EXCLUDED.og_tags,
       outbound_domains = EXCLUDED.outbound_domains,
       analysis_summary = EXCLUDED.analysis_summary,
       llm_context = EXCLUDED.llm_context,
       analyzed_at = NOW()`,
    [
      domainId, result.url, result.contentRiskScore, result.keywordRiskScore, result.complianceScore,
      result.structureRiskScore, result.redirectRiskScore, JSON.stringify(result.keywordMatches), result.detectedVertical,
      result.hasPrivacyPolicy, result.hasTermsOfService, result.hasContactInfo, result.hasDisclaimer,
      result.hasAboutPage, result.hasCookieConsent, result.hasAgeVerification,
      JSON.stringify(result.redFlags), result.hasCountdownTimer, result.hasFakeReviews, result.hasBeforeAfter,
      result.hasHiddenText, result.hasAggressiveCta, result.hasPopupOverlay, result.hasAutoPlayVideo,
      result.hasExternalRedirect, result.redirectCount, JSON.stringify(result.redirectChain), result.finalUrl, result.urlMismatch,
      result.pageLanguage, result.totalLinks, result.externalLinks, result.formCount, result.imageCount,
      result.scriptCount, result.iframeCount, result.wordCount, result.pageTitle, result.pageDescription,
      result.ogTags ? JSON.stringify(result.ogTags) : null, JSON.stringify(result.outboundDomains),
      result.analysisSummary, JSON.stringify(result.llmContext),
    ],
  );

  return result;
}

// ─── Batch analysis (for enrichment pipeline) ─────────────────────────────────

export async function analyzeAllDomains(pool: pg.Pool, maxDomains = 20): Promise<{ analyzed: number; errors: number }> {
  const result = await pool.query(
    `SELECT d.id, d.domain_name
     FROM domains d
     LEFT JOIN domain_content_analysis dca ON dca.domain_id = d.id
     WHERE dca.id IS NULL OR dca.analyzed_at < NOW() - INTERVAL '7 days'
     ORDER BY dca.analyzed_at ASC NULLS FIRST
     LIMIT $1`,
    [maxDomains],
  );

  let analyzed = 0;
  let errors = 0;

  for (const row of result.rows) {
    const { id, domain_name } = row as { id: string; domain_name: string };
    try {
      await analyzeAndSave(pool, id, `https://${domain_name}`);
      analyzed++;
      console.log(`[domain-content] Analyzed ${domain_name}: OK`);
      // Rate limit: 3s between fetches
      await new Promise((r) => setTimeout(r, 3000));
    } catch (err) {
      errors++;
      console.error(`[domain-content] Failed ${domain_name}:`, err instanceof Error ? err.message : err);
    }
  }

  return { analyzed, errors };
}
