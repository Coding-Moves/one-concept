import { createHandler } from './handler.ts';
import { createDailyReminderTask } from './daily_reminders.ts';
import { createWeeklyQuizTask } from './weekly_quiz.ts';
import { createEditorialEmailTask } from './editorial_email.ts';
import type { EmailTransaction } from './editorial_email.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const supabaseUrl = required('SUPABASE_URL').replace(/\/$/, '');
const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
const workerDatabaseUrl = Deno.env.get('WORKER_DATABASE_URL') ?? '';
const dashboardOrigin = Deno.env.get('EDITORIAL_EMAIL_DASHBOARD_URL') ?? '';
const emailRecipients = new Set((Deno.env.get('EDITORIAL_EMAIL_TEST_RECIPIENTS') ?? '')
  .split(',').map(email => email.trim().toLowerCase()).filter(Boolean));
const allowedOrigins = new Set((Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',').map(origin => origin.trim().replace(/\/$/, '')).filter(Boolean));

const emailTransaction: EmailTransaction = async work => {
  const database = new URL(workerDatabaseUrl);
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
  if (!['postgres:', 'postgresql:'].includes(database.protocol) ||
      database.username !== `postgres.${projectRef}` ||
      database.port !== '5432' || database.pathname !== '/postgres' ||
      !database.hostname.endsWith('.pooler.supabase.com')) {
    throw new Error('worker_database_mismatch');
  }
  // Deno resolves the pinned npm module at deployment; the repository's Node
  // typecheck does not resolve npm: specifiers.
  // @ts-expect-error Deno-only npm specifier
  const { default: postgres } = await import('npm:postgres@3.4.8');
  const db = postgres(workerDatabaseUrl, {
    max: 1, prepare: false, ssl: 'require', connect_timeout: 5, idle_timeout: 5,
  });
  try {
    return await db.begin(async (tx: {
      unsafe: (statement: string, parameters: unknown[]) => Promise<Record<string, unknown>[]>;
    }) => work((statement, parameters) => tx.unsafe(statement, parameters)));
  } finally {
    await db.end({ timeout: 1 });
  }
};
const pushOptions = {
  environment: Deno.env.get('ENVIRONMENT') ?? 'development',
  testTokens: new Set((Deno.env.get('WORKER_PUSH_TEST_TOKENS') ?? '')
    .split(',').map(token => token.trim()).filter(Boolean)),
};
const serviceRpc = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`,
      'content-type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('worker_rpc_failed');
  return response.json();
};

Deno.serve(createHandler({
  supabaseUrl,
  serviceRoleKey,
  signingKey: required('WORKER_DISPATCH_SIGNING_KEY'),
  tasks: {
    daily_reminders: createDailyReminderTask(serviceRpc, fetch, pushOptions),
    weekly_quiz: createWeeklyQuizTask(serviceRpc, fetch, {
      ...pushOptions,
      enabled: Deno.env.get('WEEKLY_QUIZ_NOTIFICATIONS_ENABLED') === 'true',
    }),
    editorial_email: createEditorialEmailTask(serviceRpc, emailTransaction, fetch, {
      enabled: Deno.env.get('EDITORIAL_ENABLED') === 'true' &&
        Deno.env.get('EDITORIAL_EMAIL_ENABLED') === 'true',
      environment: pushOptions.environment,
      testRecipients: emailRecipients,
      dashboardOrigin,
      allowedOrigins,
      from: Deno.env.get('EDITORIAL_EMAIL_FROM') ?? '',
      clientId: Deno.env.get('EDITORIAL_GMAIL_CLIENT_ID') ?? '',
      clientSecret: Deno.env.get('EDITORIAL_GMAIL_CLIENT_SECRET') ?? '',
      refreshToken: Deno.env.get('EDITORIAL_GMAIL_REFRESH_TOKEN') ?? '',
      dailyCap: Number(Deno.env.get('EDITORIAL_EMAIL_DAILY_CAP') ?? '40'),
      databaseReady: workerDatabaseUrl.length > 0,
    }),
  },
}));
