import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Brain, Loader2, AlertTriangle, Trophy, Zap, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, MinusCircle, ThumbsUp, ThumbsDown, Download,
} from 'lucide-react';
import {
  compareModelsAI,
  mockCompareModelsAI,
  fetchAiLeaderboard,
  fetchConfiguredModels,
  fetchPredictionSummary,
  trainModel,
  predictAll,
  submitAiFeedback,
  getAiFeedback,
  ApiError,
  type AiAnalysisResult,
  type AiAnalyzeResponse,
  type AiComparisonData,
  type AiIndividualResult,
  type AiLeaderboardSummary,
  type AiModel,
  type AiFeedbackStats,
} from '../api.js';
import { BlurFade } from '../components/ui/animations.js';
import { downloadCsv } from '../utils/csv.js';

const priorityColors: Record<string, string> = {
  critical: '#f87171',
  high: '#fb923c',
  medium: '#fbbf24',
  low: '#4ade80',
};

const confidenceLabels: Record<string, string> = {
  low: 'Низкая',
  medium: 'Средняя',
  high: 'Высокая',
};

const confidenceColors: Record<string, string> = {
  low: '#f87171',
  medium: '#fbbf24',
  high: '#4ade80',
};

const strategyLabels: Record<string, string> = {
  best_model: 'Лучшая модель',
  majority_vote: 'Голосование',
  weighted_ensemble: 'Взвешенный ансамбль',
};

// --- Small components ---

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span
      className="px-2 py-0.5 rounded text-xs font-medium"
      style={{ backgroundColor: `${priorityColors[priority] ?? '#94a3b8'}22`, color: priorityColors[priority] ?? '#94a3b8' }}
    >
      {priority}
    </span>
  );
}

function ActionCard({ action }: { action: { priority: string; action_ru: string; reasoning_ru: string; estimated_impact: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card-static p-3 cursor-pointer" onClick={() => setOpen(!open)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PriorityBadge priority={action.priority} />
          <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{action.action_ru}</span>
        </div>
        {open ? <ChevronUp size={14} style={{ color: 'var(--text-secondary)' }} /> : <ChevronDown size={14} style={{ color: 'var(--text-secondary)' }} />}
      </div>
      {open && (
        <div className="mt-2 space-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <p><strong>Почему:</strong> {action.reasoning_ru}</p>
          <p><strong>Эффект:</strong> {action.estimated_impact}</p>
        </div>
      )}
    </div>
  );
}

function MetricPill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span className="px-2 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--bg-card)', color: color ?? 'var(--text-secondary)', border: '1px solid var(--border)' }}>
      {label}: <strong>{value}</strong>
    </span>
  );
}

// --- Section 1: Analysis Result ---

function AnalysisResultView({ result, comparison }: { result: AiAnalysisResult; comparison?: AiComparisonData }) {
  return (
    <div className="space-y-4">
      {/* Summary + confidence gauge */}
      <div className="card-static p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Резюме</h3>
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span>Уверенность: <strong style={{ color: confidenceColors[result.confidence] ?? '#94a3b8' }}>{confidenceLabels[result.confidence] ?? result.confidence}</strong></span>
            {comparison && <MetricPill label="Стратегия" value={strategyLabels[comparison.strategy] ?? comparison.strategy} />}
            <span>{result.tokens_used} ток.</span>
            <span>{(result.latency_ms / 1000).toFixed(1)}с</span>
            {comparison && <span>${comparison.total_cost_usd.toFixed(4)}</span>}
          </div>
        </div>
        <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{result.summary_ru}</p>
      </div>

      {/* Consensus indicator */}
      {comparison && (
        <div className="card-static p-3">
          <div className="flex items-center gap-3">
            {comparison.consensus.all_agree_on_confidence ? (
              <div className="flex items-center gap-1.5" style={{ color: '#4ade80' }}>
                <CheckCircle2 size={14} />
                <span className="text-xs font-medium">Все модели согласны</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5" style={{ color: '#fbbf24' }}>
                <AlertTriangle size={14} />
                <span className="text-xs font-medium">Расхождение между моделями</span>
              </div>
            )}
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Согласованность: {Math.round(comparison.consensus.agreement_level * 100)}%
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {comparison.models_used.length} из {comparison.models_used.length + comparison.models_failed.length} моделей
            </span>
          </div>
          {comparison.consensus.divergence_points.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {comparison.consensus.divergence_points.map((point, i) => (
                <p key={i} className="text-xs" style={{ color: 'var(--text-muted)' }}>- {point}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Individual model cards */}
      {comparison && comparison.individual_results.length > 1 && (
        <div>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Результаты по моделям</h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {comparison.individual_results.map((ir, i) => (
              <IndividualResultCard key={i} ir={ir} />
            ))}
          </div>
        </div>
      )}

      {/* Risk Assessment */}
      <div className="card-static p-4">
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Оценка риска</h3>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{result.risk_assessment}</p>
      </div>

      {/* Immediate Actions */}
      {result.immediate_actions.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Срочные действия</h3>
          <div className="space-y-2">
            {result.immediate_actions.map((a, i) => <ActionCard key={i} action={a} />)}
          </div>
        </div>
      )}

      {/* Strategic Recommendations */}
      {result.strategic_recommendations.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Стратегические рекомендации</h3>
          <div className="space-y-2">
            {result.strategic_recommendations.map((a, i) => <ActionCard key={i} action={a} />)}
          </div>
        </div>
      )}

      {/* Similar Patterns */}
      {result.similar_patterns.length > 0 && (
        <div className="card-static p-4">
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Похожие паттерны</h3>
          <ul className="space-y-1">
            {result.similar_patterns.map((p, i) => (
              <li key={i} className="text-xs" style={{ color: 'var(--text-secondary)' }}>- {p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Модель: {result.model}</div>
    </div>
  );
}

// --- Feedback buttons ---

function FeedbackButtons({ predictionId }: { predictionId: string | null }) {
  const [myVote, setMyVote] = useState<number | null>(null);
  const [stats, setStats] = useState<AiFeedbackStats | null>(null);
  const [sending, setSending] = useState(false);
  const [showCorrection, setShowCorrection] = useState(false);
  const [comment, setComment] = useState('');
  const [correctOutcome, setCorrectOutcome] = useState('');

  useEffect(() => {
    if (!predictionId) return;
    getAiFeedback(predictionId)
      .then(r => { setMyVote(r.my_vote); setStats(r.stats); })
      .catch(() => {});
  }, [predictionId]);

  const handleVote = useCallback(async (rating: number) => {
    if (!predictionId || sending) return;
    setSending(true);
    try {
      await submitAiFeedback(predictionId, rating);
      setMyVote(rating);
      // Refresh stats
      const r = await getAiFeedback(predictionId);
      setStats(r.stats);
      if (rating === -1) setShowCorrection(true);
    } catch { /* ignore */ }
    finally { setSending(false); }
  }, [predictionId, sending]);

  const handleSubmitCorrection = useCallback(async () => {
    if (!predictionId || sending) return;
    setSending(true);
    try {
      await submitAiFeedback(predictionId, -1, comment || undefined, correctOutcome || undefined);
      setShowCorrection(false);
      const r = await getAiFeedback(predictionId);
      setStats(r.stats);
    } catch { /* ignore */ }
    finally { setSending(false); }
  }, [predictionId, comment, correctOutcome, sending]);

  if (!predictionId) return null;

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleVote(1)}
          disabled={sending}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors"
          style={{
            backgroundColor: myVote === 1 ? 'rgba(74, 222, 128, 0.2)' : 'transparent',
            color: myVote === 1 ? '#4ade80' : 'var(--text-muted)',
            border: `1px solid ${myVote === 1 ? '#4ade80' : 'var(--border)'}`,
          }}
        >
          <ThumbsUp size={12} /> {stats?.likes ?? 0}
        </button>
        <button
          onClick={() => handleVote(-1)}
          disabled={sending}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors"
          style={{
            backgroundColor: myVote === -1 ? 'rgba(248, 113, 113, 0.2)' : 'transparent',
            color: myVote === -1 ? '#f87171' : 'var(--text-muted)',
            border: `1px solid ${myVote === -1 ? '#f87171' : 'var(--border)'}`,
          }}
        >
          <ThumbsDown size={12} /> {stats?.dislikes ?? 0}
        </button>
        {stats && stats.corrections > 0 && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {stats.corrections} корр.
          </span>
        )}
      </div>
      {showCorrection && myVote === -1 && (
        <div className="mt-2 space-y-2 p-2 rounded" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Комментарий (опционально)"
            className="w-full px-2 py-1 rounded text-xs"
            style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
            rows={2}
          />
          <select
            value={correctOutcome}
            onChange={e => setCorrectOutcome(e.target.value)}
            className="w-full px-2 py-1 rounded-lg text-xs"
            style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
          >
            <option value="">Правильный исход (опционально)</option>
            <option value="banned">Аккаунт забанен</option>
            <option value="survived">Аккаунт выжил</option>
            <option value="appealed">Апелляция успешна</option>
          </select>
          <div className="flex gap-2">
            <button
              onClick={handleSubmitCorrection}
              disabled={sending}
              className="px-2 py-1 rounded text-xs font-medium"
              style={{ backgroundColor: 'var(--accent-purple, #a78bfa)', color: '#fff' }}
            >
              Отправить
            </button>
            <button
              onClick={() => setShowCorrection(false)}
              className="px-2 py-1 rounded text-xs"
              style={{ color: 'var(--text-muted)' }}
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function IndividualResultCard({ ir }: { ir: AiIndividualResult }) {
  return (
    <div className="card-static p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{ir.model_display}</span>
        {ir.error ? (
          <XCircle size={14} style={{ color: '#f87171' }} />
        ) : (
          <CheckCircle2 size={14} style={{ color: '#4ade80' }} />
        )}
      </div>
      {ir.error ? (
        <p className="text-xs" style={{ color: '#f87171' }}>{ir.error}</p>
      ) : ir.result ? (
        <div className="space-y-1.5">
          <p className="text-xs line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{ir.result.summary_ru}</p>
          <div className="flex gap-1.5 flex-wrap">
            <MetricPill label="Уверенность" value={confidenceLabels[ir.result.confidence] ?? ir.result.confidence} color={confidenceColors[ir.result.confidence]} />
            <MetricPill label="" value={`${(ir.latency_ms / 1000).toFixed(1)}с`} />
            <MetricPill label="$" value={ir.cost_usd.toFixed(4)} />
          </div>
          <FeedbackButtons predictionId={ir.prediction_id} />
        </div>
      ) : null}
    </div>
  );
}

// --- Section 2: Leaderboard ---

function LeaderboardSection({ leaderboard, onPeriodChange }: {
  leaderboard: AiLeaderboardSummary | null;
  onPeriodChange: (p: string) => void;
}) {
  const [period, setPeriod] = useState('30d');
  const periods = [
    { value: '7d', label: '7 дней' },
    { value: '30d', label: '30 дней' },
    { value: 'all', label: 'Всё время' },
  ];

  return (
    <div className="card-static p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Trophy size={16} /> Лидерборд моделей
        </h3>
        <div className="flex items-center gap-2">
          {leaderboard && leaderboard.entries.length > 0 && (
            <button
              onClick={() => {
                const headers = ['#', 'Модель', 'Accuracy', 'Precision', 'Recall', 'Lifetime err (дни)', 'Latency (мс)', 'Стоимость ($)', 'Анализов', 'Score'];
                const rows = leaderboard.entries.map((e, i) => [
                  i + 1,
                  e.model,
                  e.accuracy != null ? `${(e.accuracy * 100).toFixed(1)}%` : '',
                  e.precision != null ? `${(e.precision * 100).toFixed(1)}%` : '',
                  e.recall != null ? `${(e.recall * 100).toFixed(1)}%` : '',
                  e.avg_lifetime_error_days ?? '',
                  e.avg_latency_ms,
                  e.avg_cost_usd.toFixed(4),
                  e.total_analyses,
                  (e.composite_score * 100).toFixed(1),
                ]);
                downloadCsv(`ai_leaderboard_${period}_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
              }}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-colors"
              style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', color: '#818cf8' }}
              title="Экспорт в CSV"
            >
              <Download size={12} />
              CSV
            </button>
          )}
        <div className="flex gap-1">
          {periods.map(p => (
            <button
              key={p.value}
              onClick={() => { setPeriod(p.value); onPeriodChange(p.value); }}
              className="px-2 py-0.5 rounded text-xs"
              style={{
                backgroundColor: period === p.value ? 'var(--accent-purple, #a78bfa)' : 'transparent',
                color: period === p.value ? '#fff' : 'var(--text-muted)',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        </div>
      </div>
      {!leaderboard || leaderboard.entries.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Нет данных. Запустите анализ для нескольких моделей.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ color: 'var(--text-muted)' }}>
                <th className="text-left py-1 pr-2">#</th>
                <th className="text-left py-1 pr-2">Модель</th>
                <th className="text-right py-1 pr-2">Accuracy</th>
                <th className="text-right py-1 pr-2">Precision</th>
                <th className="text-right py-1 pr-2">Recall</th>
                <th className="text-right py-1 pr-2">Lifetime err</th>
                <th className="text-right py-1 pr-2">Latency</th>
                <th className="text-right py-1 pr-2">Cost</th>
                <th className="text-right py-1 pr-2">Анализов</th>
                <th className="text-right py-1">Score</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.entries.map((entry, i) => (
                <tr key={entry.model} style={{ color: 'var(--text-primary)', borderTop: '1px solid var(--border)' }}>
                  <td className="py-1.5 pr-2 font-medium">{i === 0 ? '1' : String(i + 1)}</td>
                  <td className="py-1.5 pr-2 font-medium" style={{ color: i === 0 ? 'var(--accent-green)' : undefined }}>
                    {entry.model}
                  </td>
                  <td className="py-1.5 pr-2 text-right">{entry.accuracy != null ? `${(entry.accuracy * 100).toFixed(1)}%` : <span style={{ color: 'var(--text-muted)' }}>N/A</span>}</td>
                  <td className="py-1.5 pr-2 text-right">{entry.precision != null ? `${(entry.precision * 100).toFixed(1)}%` : <span style={{ color: 'var(--text-muted)' }}>N/A</span>}</td>
                  <td className="py-1.5 pr-2 text-right">{entry.recall != null ? `${(entry.recall * 100).toFixed(1)}%` : <span style={{ color: 'var(--text-muted)' }}>N/A</span>}</td>
                  <td className="py-1.5 pr-2 text-right">{entry.avg_lifetime_error_days != null ? `${entry.avg_lifetime_error_days}д` : <span style={{ color: 'var(--text-muted)' }}>N/A</span>}</td>
                  <td className="py-1.5 pr-2 text-right">{entry.avg_latency_ms}мс</td>
                  <td className="py-1.5 pr-2 text-right">${entry.avg_cost_usd.toFixed(4)}</td>
                  <td className="py-1.5 pr-2 text-right">{entry.total_analyses}</td>
                  <td className="py-1.5 text-right font-medium">{(entry.composite_score * 100).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!leaderboard.has_outcomes && (
            <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
              Недостаточно данных для accuracy. Score рассчитан по latency и cost.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// --- Section 3: Connected Models ---

function ModelsSection({ models, configuredCount }: { models: AiModel[]; configuredCount: number }) {
  const envHints: Record<string, string> = {
    claude: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
  };

  return (
    <div className="card-static p-4">
      <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Подключённые модели ({configuredCount} из {models.length})</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {models.map(m => (
          <div key={m.model} className="card-static p-3 flex items-center justify-between">
            <div>
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{m.display_name}</span>
              {m.status !== 'active' && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Добавьте {envHints[m.model] ?? 'API_KEY'} в env
                </p>
              )}
            </div>
            {m.status === 'active' ? (
              <CheckCircle2 size={16} style={{ color: '#4ade80' }} />
            ) : (
              <MinusCircle size={16} style={{ color: 'var(--text-muted)' }} />
            )}
          </div>
        ))}
        {models.length === 0 && (
          <span className="text-xs col-span-3" style={{ color: 'var(--text-muted)' }}>Загрузка...</span>
        )}
      </div>
    </div>
  );
}

// --- Main Page ---

export function AIAnalysisPage() {
  const [searchParams] = useSearchParams();
  const [accountId, setAccountId] = useState(searchParams.get('account') ?? '');
  const [strategy, setStrategy] = useState<string>('majority_vote');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiAnalyzeResponse | null>(null);
  const [models, setModels] = useState<AiModel[]>([]);
  const [leaderboard, setLeaderboard] = useState<AiLeaderboardSummary | null>(null);
  const [predictionSummary, setPredictionSummary] = useState<{ total: number; by_risk_level: Record<string, number> } | null>(null);
  const [training, setTraining] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);

  useEffect(() => {
    fetchConfiguredModels().then(r => setModels(r.models)).catch(() => {});
    fetchAiLeaderboard('30d').then(r => setLeaderboard(r)).catch(() => {});
    fetchPredictionSummary().then(r => setPredictionSummary(r)).catch(() => {});
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!accountId.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const id = accountId.trim();
      const r = id === 'test' ? await mockCompareModelsAI(id) : await compareModelsAI(id, strategy);
      // Map ComparisonResult → AiAnalyzeResponse shape for AnalysisResultView
      setResult({
        ...r.final_result,
        _comparison: {
          strategy: r.strategy,
          individual_results: r.individual_results,
          consensus: r.consensus,
          models_used: r.models_used,
          models_failed: r.models_failed,
          total_cost_usd: r.total_cost_usd,
          generated_at: r.generated_at,
        },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ошибка анализа');
    } finally {
      setLoading(false);
    }
  }, [accountId, strategy]);

  const handleTrain = useCallback(async () => {
    setTraining(true);
    try { await trainModel(); } catch { /* ignore */ } finally { setTraining(false); }
  }, []);

  const handleBatchPredict = useCallback(async () => {
    setBatchRunning(true);
    try {
      await predictAll();
      const s = await fetchPredictionSummary();
      setPredictionSummary(s);
    } catch { /* ignore */ } finally { setBatchRunning(false); }
  }, []);

  const handleLeaderboardPeriod = useCallback((p: string) => {
    fetchAiLeaderboard(p).then(r => setLeaderboard(r)).catch(() => {});
  }, []);

  const configuredCount = models.filter(m => m.status === 'active').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <BlurFade delay={0}>
        <div className="flex items-center gap-3 mb-2">
          <Brain size={24} style={{ color: 'var(--accent-purple, #a78bfa)' }} />
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>AI Анализ</h1>
        </div>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Мульти-модельный анализ аккаунтов. Claude, GPT-4o и Gemini с агрегацией результатов.
        </p>
      </BlurFade>

      {/* Section 1: Input + Analysis */}
      <BlurFade delay={0.05}>
        <div className="card-static p-4">
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Google Account ID</label>
              <input
                type="text"
                value={accountId}
                onChange={e => setAccountId(e.target.value)}
                placeholder="123-456-7890"
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
                onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Стратегия</label>
              <select
                value={strategy}
                onChange={e => setStrategy(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
              >
                <option value="best_model">Лучшая модель</option>
                <option value="majority_vote">Голосование</option>
                <option value="weighted_ensemble">Взвешенный ансамбль</option>
              </select>
            </div>
            <button
              onClick={handleAnalyze}
              disabled={loading || !accountId.trim()}
              className="px-4 py-2 rounded text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent-purple, #a78bfa)', color: '#fff' }}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
              Анализировать
            </button>
          </div>
        </div>
      </BlurFade>

      {/* Error */}
      {error && (
        <div className="card-static p-3 flex items-center gap-2" style={{ borderColor: '#f87171' }}>
          <AlertTriangle size={16} style={{ color: '#f87171' }} />
          <span className="text-sm" style={{ color: '#f87171' }}>{error}</span>
        </div>
      )}

      {/* Analysis result */}
      {result && (
        <BlurFade delay={0.1}>
          <AnalysisResultView result={result} comparison={result._comparison} />
        </BlurFade>
      )}

      {/* Section 2: Leaderboard */}
      <BlurFade delay={0.15}>
        <LeaderboardSection leaderboard={leaderboard} onPeriodChange={handleLeaderboardPeriod} />
      </BlurFade>

      {/* Section 3: Connected Models */}
      <BlurFade delay={0.2}>
        <ModelsSection models={models} configuredCount={configuredCount} />
      </BlurFade>

      {/* ML Section */}
      <BlurFade delay={0.25}>
        <div className="card-static p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Zap size={16} /> ML Модель (BanPredictor)
          </h3>
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                onClick={handleTrain}
                disabled={training}
                className="px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent-green)', color: '#000' }}
              >
                {training ? <Loader2 size={12} className="animate-spin" /> : null}
                Обучить модель
              </button>
              <button
                onClick={handleBatchPredict}
                disabled={batchRunning}
                className="px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent-blue, #60a5fa)', color: '#fff' }}
              >
                {batchRunning ? <Loader2 size={12} className="animate-spin" /> : null}
                Batch прогноз
              </button>
            </div>
            {predictionSummary && (
              <div className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
                <p>Прогнозов за 24ч: <strong>{predictionSummary.total}</strong></p>
                <div className="flex gap-3">
                  {Object.entries(predictionSummary.by_risk_level).map(([level, count]) => (
                    <span key={level} style={{ color: priorityColors[level] ?? 'var(--text-secondary)' }}>
                      {level}: {count}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </BlurFade>
    </div>
  );
}
