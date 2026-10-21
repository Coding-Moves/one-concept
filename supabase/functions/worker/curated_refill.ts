import type { WorkerTask } from './handler.ts';
import type { ServiceRpc } from './daily_reminders.ts';
import { generateConcept, GeminiError, PROMPT_VERSION } from './gemini.ts';

type Config = {
  enabled: boolean;
  urgentEnabled: boolean;
  apiKey: string;
  model: string;
  activeDays: number;
  reserve: number;
  low: number;
  critical: number;
  minPool: number;
  dailyCap: number;
  topicCap: number;
  urgentDailyCap: number;
  urgentTopicCap: number;
  maxConcurrent: number;
  reviewLimit: number;
};

type Claim = {
  id: string;
  claim_token: string;
  title: string;
  angle: string | null;
  difficulty: number | null;
  topic_name: string;
  subtopic_name: string;
  curriculum: Record<string, unknown>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function claim(value: unknown): Claim | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_refill_claim');
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !UUID.test(row.id) ||
      typeof row.claim_token !== 'string' || !UUID.test(row.claim_token) ||
      typeof row.title !== 'string' || !row.title || row.title.length > 240 ||
      typeof row.topic_name !== 'string' || !row.topic_name ||
      typeof row.subtopic_name !== 'string' || !row.subtopic_name ||
      (row.angle !== null && typeof row.angle !== 'string') ||
      (row.difficulty !== null && (!Number.isInteger(row.difficulty) ||
        Number(row.difficulty) < 1 || Number(row.difficulty) > 5)) ||
      typeof row.curriculum !== 'object' || row.curriculum === null ||
      Array.isArray(row.curriculum)) throw new Error('invalid_refill_claim');
  return row as Claim;
}

function bounded(config: Config): void {
  const limits: Array<[number, number, number]> = [
    [config.activeDays, 1, 365], [config.reserve, 1, 365],
    [config.low, 0, 30], [config.critical, 0, 10],
    [config.minPool, 0, 1000], [config.dailyCap, 0, 100],
    [config.topicCap, 1, 10], [config.urgentDailyCap, 0, 100],
    [config.urgentTopicCap, 1, 10], [config.maxConcurrent, 1, 20],
    [config.reviewLimit, 1, 250],
  ];
  if (limits.some(([value, min, max]) => !Number.isSafeInteger(value) ||
      value < min || value > max) || config.critical > config.low ||
      config.urgentDailyCap < config.dailyCap ||
      config.urgentTopicCap < config.topicCap) {
    throw new Error('invalid_refill_configuration');
  }
}

function groundedAngle(row: Claim): string | null {
  const source = row.curriculum;
  const lines = [row.angle];
  if (typeof source.objective === 'string') lines.push(`Learning objective: ${source.objective}`);
  lines.push(`Difficulty: ${row.difficulty ?? 1}. Prerequisites: ${JSON.stringify(source.prerequisites ?? [])}`);
  lines.push(`Editorial references: ${JSON.stringify(source.references ?? [])}`);
  return lines.filter(Boolean).join('\n');
}

/** One claim and one provider call per invocation; the ledger and SQL own retries. */
export function createCuratedRefillTask(
  rpc: ServiceRpc, fetcher: typeof fetch, config: Config, urgent: boolean,
): WorkerTask {
  return async () => {
    if (!config.enabled || (urgent && !config.urgentEnabled)) {
      return { disabled: 1, planned: 0, claimed: 0, drafted: 0, failed: 0 };
    }
    bounded(config);
    if (!config.apiKey || !config.model) throw new Error('refill_provider_unconfigured');
    let planned = 0;
    if (!urgent) {
      const result = await rpc('edge_worker_plan_active_readers', {
        p_days: config.activeDays, p_reserve: config.reserve, p_low: config.low,
      });
      if (!Number.isSafeInteger(result) || Number(result) < 0) {
        throw new Error('invalid_refill_plan');
      }
      planned = Number(result);
    }
    const row = claim(await rpc('edge_worker_claim_curated_refill', {
      p_topic_id: null, p_urgent: urgent, p_active_days: config.activeDays,
      p_low: urgent ? config.critical : config.low,
      p_min_pool: config.minPool,
      p_global_cap: urgent ? config.urgentDailyCap : config.dailyCap,
      p_topic_cap: urgent ? config.urgentTopicCap : config.topicCap,
      p_max_concurrent: config.maxConcurrent, p_review_limit: config.reviewLimit,
    }));
    if (!row) return { disabled: 0, planned, claimed: 0, drafted: 0, failed: 0 };
    let result;
    try {
      result = await generateConcept(fetcher, { apiKey: config.apiKey, model: config.model }, {
        title: row.title, topic: row.topic_name, subtopic: row.subtopic_name,
        angle: groundedAngle(row),
      });
    } catch (error) {
      const code = error instanceof GeminiError &&
        ['rate_limited', 'provider_error', 'validation_failed'].includes(error.code)
        ? error.code : 'provider_error';
      const released = await rpc('edge_worker_release_curated_refill', {
        p_id: row.id, p_token: row.claim_token, p_code: code,
      });
      if (released !== true) throw new Error('refill_claim_lost');
      return { disabled: 0, planned, claimed: 1, drafted: 0, failed: 1 };
    }
    const complete = await rpc('edge_worker_complete_curated_refill', {
      p_id: row.id, p_token: row.claim_token, p_summary: result.summary,
      p_example: result.example, p_learning_package: result.learning_package,
      p_model: config.model, p_prompt_version: PROMPT_VERSION,
    });
    if (complete !== true && complete !== false) throw new Error('invalid_refill_completion');
    return { disabled: 0, planned, claimed: 1, drafted: complete ? 1 : 0,
      failed: complete ? 0 : 1 };
  };
}
