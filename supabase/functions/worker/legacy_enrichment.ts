import type { WorkerTask } from './handler.ts';
import type { ServiceRpc } from './daily_reminders.ts';
import { generateLegacy, LegacyError } from './legacy_generation.ts';

type Config = {
  enabled: boolean;
  apiKey: string;
  dailyCap: number;
  maxConcurrent: number;
  reviewLimit: number;
};
type Claim = {
  id: string;
  claim_token: string;
  source_body: Record<string, unknown>;
  topic: string;
  subtopic: string;
  model: string;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES = new Set(['ready_for_review', 'queued', 'blocked', 'failed',
  'skipped', 'superseded']);

function claim(value: unknown): Claim | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_legacy_claim');
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !UUID.test(row.id) ||
      typeof row.claim_token !== 'string' || !UUID.test(row.claim_token) ||
      typeof row.topic !== 'string' || !row.topic ||
      typeof row.subtopic !== 'string' || !row.subtopic ||
      typeof row.model !== 'string' || !row.model ||
      typeof row.source_body !== 'object' || row.source_body === null ||
      Array.isArray(row.source_body) ||
      typeof (row.source_body as Record<string, unknown>).title !== 'string' ||
      typeof (row.source_body as Record<string, unknown>).subtopic_slug !== 'string') {
    throw new Error('invalid_legacy_claim');
  }
  return row as Claim;
}

/** One owner-created batch entry and one grounded Gemini call per invocation. */
export function createLegacyEnrichmentTask(
  rpc: ServiceRpc, fetcher: typeof fetch, config: Config,
): WorkerTask {
  return async () => {
    if (!config.enabled) return { disabled: 1, claimed: 0, ready: 0, failed: 0 };
    if (!config.apiKey || !Number.isSafeInteger(config.dailyCap) ||
        config.dailyCap < 0 || config.dailyCap > 10000 ||
        !Number.isSafeInteger(config.maxConcurrent) ||
        config.maxConcurrent < 1 || config.maxConcurrent > 20 ||
        !Number.isSafeInteger(config.reviewLimit) ||
        config.reviewLimit < 1 || config.reviewLimit > 250) {
      throw new Error('invalid_legacy_configuration');
    }
    const row = claim(await rpc('edge_worker_claim_legacy_enrichment', {
      p_daily_cap: config.dailyCap, p_max_concurrent: config.maxConcurrent,
      p_review_limit: config.reviewLimit,
    }));
    if (!row) return { disabled: 0, claimed: 0, ready: 0, failed: 0 };
    let body;
    let failure: string | null = null;
    try {
      body = await generateLegacy(fetcher,
        { apiKey: config.apiKey, model: row.model },
        row.source_body as Parameters<typeof generateLegacy>[2],
        row.topic, row.subtopic);
    } catch (error) {
      failure = error instanceof LegacyError ? error.code : 'provider_error';
    }
    const state = await rpc('edge_worker_finish_legacy_enrichment', {
      p_id: row.id, p_token: row.claim_token, p_enabled: config.enabled,
      p_failure: failure, p_body: body ?? null,
    });
    if (typeof state !== 'string' || !STATES.has(state)) {
      throw new Error('invalid_legacy_completion');
    }
    return { disabled: 0, claimed: 1, ready: state === 'ready_for_review' ? 1 : 0,
      failed: ['queued', 'blocked', 'failed'].includes(state) ? 1 : 0 };
  };
}
