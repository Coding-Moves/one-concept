/** Authenticated, bounded entry point for scheduled work. */

export const JOBS = [
  'daily_reminders', 'weekly_quiz', 'editorial_email',
  'content_pool', 'editorial_generation', 'legacy_enrichment', 'prefetch',
] as const;
export type Job = typeof JOBS[number];
export type WorkerResult = Record<string, number>;
export type WorkerTask = (runId: string) => Promise<WorkerResult>;

export type WorkerConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
  signingKey: string;
  tasks: Partial<Record<Job, WorkerTask>>;
};

type Fetcher = typeof fetch;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();

function json(status: number, data: Record<string, unknown>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function signDispatch(
  key: string, runId: string, job: Job, issuedAt: number,
): Promise<string> {
  const imported = await crypto.subtle.importKey(
    'raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const message = `v1\n${runId}\n${job}\n${issuedAt}`;
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(message))));
}

function sameHex(a: string, b: string): boolean {
  if (!HEX_SHA256.test(a) || !HEX_SHA256.test(b)) return false;
  let delta = 0;
  for (let i = 0; i < a.length; i++) delta |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return delta === 0;
}

async function rpc(
  config: WorkerConfig, name: 'edge_worker_start_run' | 'edge_worker_finish_run',
  args: Record<string, unknown>, fetcher: Fetcher,
): Promise<boolean> {
  const result = await fetcher(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: config.serviceRoleKey,
      authorization: `Bearer ${config.serviceRoleKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  });
  if (!result.ok) throw new Error('worker_rpc_failed');
  const value: unknown = await result.json();
  if (typeof value !== 'boolean') throw new Error('worker_rpc_invalid');
  return value;
}

export function createHandler(
  config: WorkerConfig, fetcher: Fetcher = fetch,
  now: () => number = () => Date.now(),
): (request: Request) => Promise<Response> {
  if (!config.supabaseUrl.startsWith('https://') || !config.serviceRoleKey ||
      config.signingKey.length < 32) throw new Error('Worker configuration is incomplete');

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname !== '/functions/v1/worker' && url.pathname !== '/worker') {
      return json(404, { error: 'not_found' });
    }
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (Number(request.headers.get('content-length') ?? '0') > 512) {
      return json(413, { error: 'request_too_large' });
    }
    let data: unknown;
    try {
      const body = await request.text();
      if (encoder.encode(body).byteLength > 512) return json(413, { error: 'request_too_large' });
      data = JSON.parse(body);
    } catch { return json(400, { error: 'invalid_request' }); }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return json(400, { error: 'invalid_request' });
    }
    const item = data as Record<string, unknown>;
    const runId = item.run_id;
    const job = item.job;
    const issuedAt = item.issued_at;
    const signature = item.signature;
    if (typeof runId !== 'string' || !UUID.test(runId) ||
        typeof job !== 'string' || !JOBS.includes(job as Job) ||
        typeof issuedAt !== 'number' || !Number.isSafeInteger(issuedAt) ||
        typeof signature !== 'string' || !HEX_SHA256.test(signature)) {
      return json(401, { error: 'invalid_dispatch' });
    }
    const age = Math.floor(now() / 1000) - issuedAt;
    if (age < -30 || age > 300) return json(401, { error: 'expired_dispatch' });
    const expected = await signDispatch(config.signingKey, runId, job as Job, issuedAt);
    if (!sameHex(signature, expected)) return json(401, { error: 'invalid_dispatch' });
    const task = config.tasks[job as Job];
    if (!task) return json(503, { error: 'job_unavailable' });

    let claimed: boolean;
    try {
      claimed = await rpc(config, 'edge_worker_start_run', {
        p_id: runId, p_job: job,
      }, fetcher);
    } catch { return json(503, { error: 'ledger_unavailable' }); }
    if (!claimed) return json(409, { error: 'run_not_claimed' });

    let success = false;
    let counts: WorkerResult = {};
    let failure = 'worker_error';
    try {
      counts = await task(runId);
      if (Object.values(counts).some(value => !Number.isSafeInteger(value) || value < 0)) {
        throw new Error('invalid_worker_result');
      }
      success = true;
    } catch {
      failure = 'task_failed';
    }
    try {
      const finished = await rpc(config, 'edge_worker_finish_run', {
        p_id: runId, p_success: success, p_result: counts,
        p_error_code: success ? null : failure,
      }, fetcher);
      if (!finished) return json(503, { error: 'run_fenced' });
    } catch { return json(503, { error: 'ledger_unavailable' }); }
    return success ? json(200, { status: 'completed', counts })
      : json(503, { error: failure });
  };
}
