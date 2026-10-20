import type { WorkerTask } from './handler.ts';
import type { ServiceRpc } from './daily_reminders.ts';

type SendRow = { id: string; quiz_id: string; to: string; attempts: number };
type ReceiptRow = { id: string; ticket: string; accepted_at: string };
type Config = { enabled: boolean; environment: string; testTokens: ReadonlySet<string> };

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sendRows(value: unknown): SendRow[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(row =>
    typeof row !== 'object' || row === null || Array.isArray(row) ||
    !UUID.test(row.id) || !UUID.test(row.quiz_id) ||
    typeof row.to !== 'string' || row.to.length < 1 || row.to.length > 512 ||
    !Number.isInteger(row.attempts) || row.attempts < 1 || row.attempts > 3)) {
    throw new Error('invalid_weekly_claim');
  }
  return value as SendRow[];
}

function receiptRows(value: unknown): ReceiptRow[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(row =>
    typeof row !== 'object' || row === null || Array.isArray(row) ||
    !UUID.test(row.id) || typeof row.ticket !== 'string' ||
    row.ticket.length < 1 || row.ticket.length > 256 ||
    typeof row.accepted_at !== 'string')) {
    throw new Error('invalid_weekly_receipt_claim');
  }
  return value as ReceiptRow[];
}

function providerData(value: unknown, length: number): Record<string, unknown>[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data) || data.length !== length || data.some(row =>
    typeof row !== 'object' || row === null || Array.isArray(row))) return [];
  return data as Record<string, unknown>[];
}

function errorCode(value: Record<string, unknown>): string | undefined {
  const details = value.details;
  if (typeof details !== 'object' || details === null || Array.isArray(details)) return undefined;
  const error = (details as Record<string, unknown>).error;
  return typeof error === 'string' ? error : undefined;
}

export function createWeeklyQuizTask(rpc: ServiceRpc, fetcher: typeof fetch, config: Config): WorkerTask {
  return async () => {
    if (!config.enabled) return { disabled: 1, enqueued: 0, claimed: 0,
      receipts: 0, receiptFailures: 0, blocked: 0, accepted: 0, unknown: 0 };
    await rpc('edge_worker_expire_weekly_sends', {});
    const enqueued = await rpc('edge_worker_enqueue_weekly', { p_window: 15, p_limit: 50 });
    if (!Number.isSafeInteger(enqueued) || Number(enqueued) < 0) throw new Error('invalid_weekly_enqueue');

    const receipts = receiptRows(await rpc('edge_worker_claim_weekly_receipts', { p_limit: 100 }));
    let receiptFailures = 0;
    if (receipts.length) {
      let data: Record<string, unknown> = {};
      try {
        const response = await fetcher(RECEIPTS_URL, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids: receipts.map(row => row.ticket) }),
          signal: AbortSignal.timeout(20000), redirect: 'error',
        });
        if (response.ok) {
          const parsed: unknown = await response.json();
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            const candidate = (parsed as Record<string, unknown>).data;
            if (typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)) {
              data = candidate as Record<string, unknown>;
            }
          }
        } else receiptFailures++;
      } catch { receiptFailures++; }
      await rpc('edge_worker_record_weekly_receipts', { p_results: receipts.map(row => {
        const result = data[row.ticket];
        const receipt = typeof result === 'object' && result !== null && !Array.isArray(result)
          ? result as Record<string, unknown> : {};
        const error = errorCode(receipt);
        const status = receipt.status === 'ok' ? 'ok'
          : receipt.status !== 'error' ? 'missing'
          : error === 'MessageRateExceeded' ? 'rate_limited'
          : error === 'DeviceNotRegistered' ? 'device_gone' : 'failed';
        return { id: row.id, ticket: row.ticket, status };
      }) });
    }

    const batch = sendRows(await rpc('edge_worker_claim_weekly', { p_limit: 100 }));
    if (!batch.length) return { disabled: 0, enqueued: Number(enqueued), claimed: 0,
      receipts: receipts.length, receiptFailures, blocked: 0, accepted: 0, unknown: 0 };

    // Staging must never deliver to a real learner's handset.
    if (config.environment !== 'production' && batch.some(row => !config.testTokens.has(row.to))) {
      await rpc('edge_worker_record_weekly', { p_results: batch.map(row => ({
        id: row.id, status: 'failed', error: 'staging_blocked',
      })) });
      return { disabled: 0, enqueued: Number(enqueued), claimed: batch.length,
        receipts: receipts.length, receiptFailures, blocked: batch.length, accepted: 0, unknown: 0 };
    }

    let tickets: Record<string, unknown>[] = [];
    let retry = false;
    try {
      const staging = config.environment !== 'production';
      const response = await fetcher(SEND_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch.map(row => ({
          to: row.to, title: staging ? 'One Concept staging test' : 'Your weekly quiz is ready',
          body: staging ? 'Weekly quiz notification test. No action needed.'
            : 'Seven questions from concepts you learned. Take it when you like.',
          sound: 'default', channelId: 'reminders', ttl: 3600,
          data: staging ? { type: 'worker_canary' }
            : { type: 'weekly_quiz', quiz_id: row.quiz_id },
        }))),
        signal: AbortSignal.timeout(20000), redirect: 'error',
      });
      retry = response.status === 429;
      if (response.ok) tickets = providerData(await response.json(), batch.length);
    } catch { /* A timeout or broken response has an unknown delivery outcome. */ }

    let accepted = 0;
    let unknown = 0;
    const results = batch.map((row, index) => {
      const ticket = tickets[index];
      if (ticket?.status === 'ok' && typeof ticket.id === 'string' &&
          /^[!-~]{1,256}$/.test(ticket.id)) {
        accepted++;
        return { id: row.id, status: 'accepted', ticket: ticket.id };
      }
      const error = ticket ? errorCode(ticket) : undefined;
      if (retry || error === 'MessageRateExceeded') return { id: row.id, status: 'retry' };
      if (ticket?.status === 'error') {
        return { id: row.id, status: 'failed', error: error === 'DeviceNotRegistered'
          ? error : undefined };
      }
      unknown++;
      return { id: row.id, status: 'unknown' };
    });
    await rpc('edge_worker_record_weekly', { p_results: results });
    if (unknown) throw new Error('weekly_push_outcome_unknown');
    return { disabled: 0, enqueued: Number(enqueued), claimed: batch.length,
      receipts: receipts.length, receiptFailures, blocked: 0, accepted, unknown };
  };
}
