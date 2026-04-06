import type pg from 'pg';
import type { AccountFeatureVector } from '../../repositories/features.repository.js';
import type { PredictionResult } from '../ml/ban-predictor.js';
import {
  ACCOUNT_ANALYSIS_SYSTEM,
  BAN_ANALYSIS_SYSTEM,
  buildBanAnalysisPrompt,
  buildComparisonPrompt,
} from './prompts/account-analysis.prompt.js';
import { buildPostMortemFactors } from './analysis-utils.js';
import type { AiAnalysisResult } from './analysis-utils.js';
import { getAccountFeatures } from '../feature-extraction.service.js';
import { BanPredictor } from '../ml/ban-predictor.js';
import { getConfiguredAdapters, parseModelResponse } from './model-adapter.js';
import { compareModels } from './model-comparator.js';
import type { ComparisonResult } from './model-comparator.js';

export type { AiAnalysisResult, AiAnalysisAction } from './analysis-utils.js';

export class AIAnalyzer {
  private predictor: BanPredictor | null = null;

  /**
   * Analyze an account using the multi-model comparator.
   * Uses majority_vote if 2+ models configured, best_model if only 1.
   * Returns the comparator's final_result (aggregated).
   */
  async analyzeAccount(
    pool: pg.Pool,
    accountGoogleId: string,
  ): Promise<ComparisonResult> {
    return compareModels(pool, accountGoogleId);
  }

  /**
   * Analyze a ban using the best available adapter.
   * Ban analysis uses a specialized prompt, so we call adapters directly
   * (not the account-level comparator).
   */
  async analyzeBan(
    pool: pg.Pool,
    banLogId: string,
  ): Promise<AiAnalysisResult> {
    const banResult = await pool.query(
      `SELECT id, account_google_id, ban_reason, banned_at, created_at FROM ban_logs WHERE id = $1`,
      [banLogId],
    );
    if (banResult.rowCount === 0) {
      throw new Error(`Бан ${banLogId} не найден`);
    }
    const ban = banResult.rows[0]!;
    const accountGoogleId = ban['account_google_id'] as string;

    const accountResult = await pool.query(
      `SELECT created_at FROM accounts WHERE google_account_id = $1`,
      [accountGoogleId],
    );
    let lifetimeHours: number | null = null;
    if (accountResult.rows[0]) {
      const created = new Date(accountResult.rows[0]['created_at'] as string);
      const banned = new Date(ban['banned_at'] as string);
      lifetimeHours = Math.round((banned.getTime() - created.getTime()) / (1000 * 60 * 60));
    }

    const features = await getAccountFeatures(pool, accountGoogleId);
    if (!features) {
      throw new Error(`Данные аккаунта ${accountGoogleId} не найдены`);
    }

    const postMortemFactors = buildPostMortemFactors(features, lifetimeHours);
    const prompt = buildBanAnalysisPrompt(
      accountGoogleId,
      ban['ban_reason'] as string | null,
      lifetimeHours,
      features,
      postMortemFactors,
    );

    // Use first available adapter (prefer Claude for ban analysis)
    const adapters = getConfiguredAdapters();
    if (adapters.length === 0) {
      throw new Error('Нет настроенных моделей. Проверьте API ключи.');
    }

    const adapter = adapters[0]!;
    const response = await adapter.call(BAN_ANALYSIS_SYSTEM, prompt);
    return parseModelResponse(response);
  }

  /**
   * Compare multiple accounts side-by-side.
   * Uses a specialized comparison prompt via the best available adapter.
   */
  async compareAccounts(
    pool: pg.Pool,
    accountGoogleIds: string[],
  ): Promise<AiAnalysisResult> {
    let predictor: BanPredictor | null = null;
    try {
      if (!this.predictor) {
        this.predictor = new BanPredictor();
        await this.predictor.loadModel(pool);
      }
      if (this.predictor.isReady()) {
        predictor = this.predictor;
      }
    } catch {
      // ML prediction is optional
    }

    const accounts: Array<{ id: string; features: AccountFeatureVector; prediction: PredictionResult | null }> = [];

    for (const id of accountGoogleIds) {
      const features = await getAccountFeatures(pool, id);
      if (!features) continue;

      let prediction: PredictionResult | null = null;
      if (predictor) {
        try {
          prediction = predictor.predict(features);
        } catch {
          // skip
        }
      }
      accounts.push({ id, features, prediction });
    }

    if (accounts.length < 2) {
      throw new Error('Нужно минимум 2 аккаунта для сравнения');
    }

    const prompt = buildComparisonPrompt(accounts);

    // Use first available adapter
    const adapters = getConfiguredAdapters();
    if (adapters.length === 0) {
      throw new Error('Нет настроенных моделей. Проверьте API ключи.');
    }

    const adapter = adapters[0]!;
    const response = await adapter.call(ACCOUNT_ANALYSIS_SYSTEM, prompt);
    return parseModelResponse(response);
  }
}
