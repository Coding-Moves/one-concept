import type { WorkerTask } from './handler.ts';
import type { ServiceRpc } from './daily_reminders.ts';
import { mailSetupStatus, sendEditorialMail } from './editorial_mail.ts';
import type { MailBatch, MailConfig, MailOutcome } from './editorial_mail.ts';

type Claim = MailBatch & { claim_token: string; attempts: number };
export type EmailQuery = (statement: string, parameters: unknown[]) => Promise<Record<string, unknown>[]>;
export type EmailTransaction = <T>(work: (query: EmailQuery) => Promise<T>) => Promise<T>;
type EmailConfig = MailConfig & { dailyCap: number; databaseReady: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function claim(value: unknown): Claim | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value) ||
      !UUID.test((value as Claim).id) || !UUID.test((value as Claim).claim_token) ||
      !Number.isInteger((value as Claim).attempts) ||
      (value as Claim).attempts < 1 || (value as Claim).attempts > 5 ||
      typeof (value as Claim).recipient_email !== 'string' ||
      typeof (value as Claim).subject !== 'string' ||
      typeof (value as Claim).body !== 'string') throw new Error('invalid_editorial_email_claim');
  return value as Claim;
}

async function deliver(
  query: EmailQuery, fetcher: typeof fetch, batch: Claim, config: EmailConfig,
): Promise<'sent' | 'pending' | 'failed' | 'suppressed' | 'superseded'> {
  // Review access changes take these locks in the same order. Keep them until
  // Gmail responds, so revocation either wins before send or waits for it.
  await query('select pg_advisory_xact_lock(274,263)', []);
  await query('select pg_advisory_xact_lock(195,1)', []);
  await query('select pg_advisory_xact_lock(279,263)', []);
  const rows = await query('select status,claim_token from public.editorial_email_batches where id=$1::uuid for update',
    [batch.id]);
  if (rows.length !== 1 || rows[0].status !== 'sending' ||
      rows[0].claim_token !== batch.claim_token) return 'superseded';
  const eligible = await query('select public.edge_worker_email_batch_eligible($1::uuid) as valid', [batch.id]);
  const allowed = config.environment === 'production' ||
    config.testRecipients.has(batch.recipient_email.toLowerCase());
  if (eligible.length !== 1 || eligible[0].valid !== true || !allowed) {
    await query('update public.editorial_notification_outbox set batch_id=null where batch_id=$1::uuid',
      [batch.id]);
    await query(`update public.editorial_email_batches set status='suppressed',
      failure_code='assignment_or_access_changed',lease_until=null,claim_token=null
      where id=$1::uuid and claim_token=$2::uuid`, [batch.id, batch.claim_token]);
    return 'suppressed';
  }

  const outcome: MailOutcome = await sendEditorialMail(fetcher, batch, config);
  const state = outcome.state === 'pending' && batch.attempts >= 5 ? 'failed' : outcome.state;
  const delay = Math.min(360, 15 * 2 ** (batch.attempts - 1));
  await query(`update public.editorial_email_batches set status=$3::text,
      failure_code=$4::text,
      sent_at=case when $3::text='sent' then now() else sent_at end,
      available_at=now()+make_interval(mins=>$5::integer),
      lease_until=null,claim_token=null
      where id=$1::uuid and claim_token=$2::uuid`,
    [batch.id, batch.claim_token, state, outcome.code, delay]);
  return state;
}

export function createEditorialEmailTask(
  rpc: ServiceRpc, transaction: EmailTransaction, fetcher: typeof fetch,
  config: EmailConfig,
): WorkerTask {
  return async () => {
    const setup = mailSetupStatus(config);
    if (setup === 'disabled') return { disabled: 1, prepared: 0, claimed: 0,
      sent: 0, pending: 0, failed: 0, suppressed: 0 };
    if (setup !== 'ready' || !config.databaseReady ||
        !Number.isInteger(config.dailyCap) || config.dailyCap < 0 || config.dailyCap > 500) {
      throw new Error('editorial_email_setup_blocked');
    }
    const prepared = await rpc('edge_worker_prepare_email', {
      p_production: config.environment === 'production',
      p_recipients: [...config.testRecipients],
      p_dashboard_origin: config.dashboardOrigin.replace(/\/$/, ''), p_limit: 10,
    });
    if (!Number.isInteger(prepared) || Number(prepared) < 0 || Number(prepared) > 10) {
      throw new Error('invalid_editorial_email_prepare');
    }
    let claimed = 0;
    let sent = 0;
    let pending = 0;
    let failed = 0;
    let suppressed = 0;
    // Two Gmail calls bound the invocation below the Free Edge wall limit.
    for (let index = 0; index < 2; index++) {
      const batch = claim(await rpc('edge_worker_claim_email', { p_daily_cap: config.dailyCap }));
      if (!batch) break;
      claimed++;
      const state = await transaction(query => deliver(query, fetcher, batch, config));
      if (state === 'sent') sent++;
      else if (state === 'pending') pending++;
      else if (state === 'failed') failed++;
      else if (state === 'suppressed') suppressed++;
    }
    return { disabled: 0, prepared: Number(prepared), claimed, sent, pending, failed, suppressed };
  };
}
