import type { WorkerTask } from './handler.ts';

export type ServiceRpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;

type ReminderRow = { id: number; to: string };
type ReminderConfig = {
  environment: string;
  testTokens: ReadonlySet<string>;
};

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
const TITLE = 'One Concept';
const BODY = "Today's concept is waiting. A minute now keeps the streak alive.";

function rows(value: unknown): ReminderRow[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(item =>
    typeof item !== 'object' || item === null || Array.isArray(item) ||
    !Number.isSafeInteger(item.id) || item.id < 1 ||
    typeof item.to !== 'string' || item.to.length < 1 || item.to.length > 512)) {
    throw new Error('invalid_reminder_claim');
  }
  return value as ReminderRow[];
}

function tickets(value: unknown, batch: ReminderRow[]): Array<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data) || data.length !== batch.length ||
      data.some(item => typeof item !== 'object' || item === null || Array.isArray(item))) return [];
  return data as Array<Record<string, unknown>>;
}

export function createDailyReminderTask(
  rpc: ServiceRpc, fetcher: typeof fetch, options: ReminderConfig,
): WorkerTask {
  return async () => {
    await rpc('edge_worker_expire_reminders', {});
    const enqueued = await rpc('edge_worker_enqueue_reminders', { p_window: 15 });
    if (!Number.isSafeInteger(enqueued) || Number(enqueued) < 0) throw new Error('invalid_reminder_enqueue');
    const batch = rows(await rpc('edge_worker_claim_reminders', { p_limit: 100 }));
    if (batch.length === 0) return { enqueued: Number(enqueued), claimed: 0, accepted: 0,
      rejected: 0, dropped: 0, unknown: 0, blocked: 0 };

    // A non-production function may never contact Expo for a real handset.
    if (options.environment !== 'production' &&
        batch.some(item => !options.testTokens.has(item.to))) {
      await rpc('edge_worker_record_reminders', { p_results: batch.map(item => ({
        id: item.id, status: 'rejected', error: 'staging_blocked',
      })) });
      return { enqueued: Number(enqueued), claimed: batch.length, accepted: 0,
        rejected: 0, dropped: 0, unknown: 0, blocked: batch.length };
    }

    let received: Array<Record<string, unknown>> = [];
    let transportFailed = false;
    try {
      const response = await fetcher(EXPO_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch.map(item => ({
          to: item.to, title: TITLE, body: BODY, sound: 'default',
          priority: 'high', channelId: 'reminders',
        }))),
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
      if (!response.ok) transportFailed = true;
      else received = tickets(await response.json(), batch);
      if (received.length !== batch.length) transportFailed = true;
    } catch { transportFailed = true; }

    let accepted = 0;
    let rejected = 0;
    let dropped = 0;
    let unknown = 0;
    const results = batch.map((item, index) => {
      const ticket = received[index];
      if (ticket?.status === 'ok') {
        accepted++;
        return { id: item.id, status: 'accepted' };
      }
      const details = ticket?.details;
      if (ticket?.status === 'error' && typeof details === 'object' &&
          details !== null && !Array.isArray(details) &&
          (details as Record<string, unknown>).error === 'DeviceNotRegistered') {
        dropped++;
        return { id: item.id, status: 'rejected', error: 'DeviceNotRegistered' };
      }
      if (ticket?.status === 'error') {
        rejected++;
        return { id: item.id, status: 'rejected' };
      }
      unknown++;
      return { id: item.id, status: 'unknown' };
    });
    await rpc('edge_worker_record_reminders', { p_results: results });
    if (transportFailed) throw new Error('expo_transport_unknown');
    return { enqueued: Number(enqueued), claimed: batch.length, accepted, rejected, dropped, unknown,
      blocked: 0 };
  };
}
