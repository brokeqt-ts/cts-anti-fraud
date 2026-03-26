import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import * as domainsRepo from '../repositories/domains.repository.js';
import { analyzeAndSave, analyzeAllDomains, analyzeContent } from '../services/domain-content-analyzer.js';

/**
 * GET /domains — list all unique domains from ads.final_urls,
 * enriched with data from the domains table if available.
 */
export async function listDomainsHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);

  try {
    const result = await domainsRepo.listDomains(pool);

    await reply.status(200).send(result);
  } catch (err: unknown) {
    _request.log.error({ err, handler: 'listDomainsHandler' }, 'Failed to list domains');
    await reply.status(500).send({
      error: 'Failed to list domains',
      code: 'INTERNAL_ERROR',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * GET /domains/:domain — details for a specific domain.
 */
export async function getDomainHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { domain } = request.params as { domain: string };

  try {
    const [domainData, accounts, bans, contentAnalysis] = await Promise.all([
      domainsRepo.getDomainByName(pool, domain),
      domainsRepo.getAccountsByDomain(pool, domain),
      domainsRepo.getBansByDomain(pool, domain),
      pool.query(
        `SELECT dca.* FROM domain_content_analysis dca
         JOIN domains d ON d.id = dca.domain_id
         WHERE d.domain_name = $1 LIMIT 1`,
        [domain],
      ).then(r => r.rows[0] ?? null).catch(() => null),
    ]);

    await reply.status(200).send({
      domain: domainData ?? { domain_name: domain },
      accounts,
      bans,
      content_analysis: contentAnalysis,
    });
  } catch (err: unknown) {
    request.log.error({ err, handler: 'getDomainHandler', domain }, 'Failed to get domain');
    await reply.status(500).send({
      error: 'Failed to get domain details',
      code: 'INTERNAL_ERROR',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * POST /domains/:domain/content-analysis — trigger content analysis for a single domain.
 */
export async function analyzeDomainContentHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { domain } = request.params as { domain: string };

  try {
    const domainRow = await domainsRepo.getDomainByName(pool, domain);

    const r = domainRow
      ? await analyzeAndSave(pool, (domainRow as { id: string }).id, `https://${domain}`)
      : await analyzeContent(`https://${domain}`);

    // Normalize camelCase → snake_case for frontend compatibility
    await reply.status(200).send({
      url: r.url,
      content_risk_score: r.contentRiskScore,
      keyword_risk_score: r.keywordRiskScore,
      compliance_score: r.complianceScore,
      structure_risk_score: r.structureRiskScore,
      redirect_risk_score: r.redirectRiskScore,
      keyword_matches: r.keywordMatches,
      detected_vertical: r.detectedVertical,
      has_privacy_policy: r.hasPrivacyPolicy,
      has_terms_of_service: r.hasTermsOfService,
      has_contact_info: r.hasContactInfo,
      has_disclaimer: r.hasDisclaimer,
      has_about_page: r.hasAboutPage,
      has_cookie_consent: r.hasCookieConsent,
      has_age_verification: r.hasAgeVerification,
      red_flags: r.redFlags,
      has_countdown_timer: r.hasCountdownTimer,
      has_fake_reviews: r.hasFakeReviews,
      has_before_after: r.hasBeforeAfter,
      has_hidden_text: r.hasHiddenText,
      has_aggressive_cta: r.hasAggressiveCta,
      has_popup_overlay: r.hasPopupOverlay,
      has_auto_play_video: r.hasAutoPlayVideo,
      has_external_redirect: r.hasExternalRedirect,
      redirect_count: r.redirectCount,
      redirect_chain: r.redirectChain,
      final_url: r.finalUrl,
      url_mismatch: r.urlMismatch,
      page_language: r.pageLanguage,
      word_count: r.wordCount,
      total_links: r.totalLinks,
      external_links: r.externalLinks,
      form_count: r.formCount,
      image_count: r.imageCount,
      script_count: r.scriptCount,
      iframe_count: r.iframeCount,
      security_headers: r.securityHeaders,
      tld_risk: r.tldRisk,
      robots_txt: r.robotsTxt,
      form_analysis: r.formAnalysis,
      third_party_scripts: r.thirdPartyScripts,
      link_reputation: r.linkReputation,
      structured_data: r.structuredData,
      analysis_summary: r.analysisSummary,
      llm_context: r.llmContext,
      analyzed_at: new Date().toISOString(),
    });
  } catch (err: unknown) {
    request.log.error({ err, handler: 'analyzeDomainContentHandler', domain }, 'Content analysis failed');
    await reply.status(500).send({
      error: 'Content analysis failed',
      code: 'ANALYSIS_ERROR',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * POST /domains/content-analysis/scan — batch scan all domains (admin).
 */
export async function scanAllDomainsContentHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);

  try {
    const result = await analyzeAllDomains(pool, 20);
    await reply.status(200).send(result);
  } catch (err: unknown) {
    _request.log.error({ err, handler: 'scanAllDomainsContentHandler' }, 'Batch content scan failed');
    await reply.status(500).send({
      error: 'Batch content scan failed',
      code: 'SCAN_ERROR',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
