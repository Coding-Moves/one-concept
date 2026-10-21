import { createHandler } from './handler.ts';
import { createDailyReminderTask } from './daily_reminders.ts';
import { createWeeklyQuizTask } from './weekly_quiz.ts';
import { createEditorialEmailTask } from './editorial_email.ts';
import type { EmailTransaction } from './editorial_email.ts';
import { createCuratedRefillTask } from './curated_refill.ts';
import { createEditorialGenerationTask } from './editorial_generation.ts';
import { createLegacyEnrichmentTask } from './legacy_enrichment.ts';
import { generationAllowed } from './provider_gate.ts';
import { workerSetting } from './worker_settings.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

// Edge secrets are project-wide. Staging canaries override only this worker,
// leaving the staged API's CORS, editorial flags and provider settings alone.
function setting(name: string): string | undefined {
  return workerSetting(Deno.env.get('ENVIRONMENT') ?? 'development',
    name, key => Deno.env.get(key));
}

const supabaseUrl = required('SUPABASE_URL').replace(/\/$/, '');
const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
const workerDatabaseUrl = Deno.env.get('WORKER_DATABASE_URL') ?? '';
const dashboardOrigin = setting('EDITORIAL_EMAIL_DASHBOARD_URL') ?? '';
const emailRecipients = new Set((setting('EDITORIAL_EMAIL_TEST_RECIPIENTS') ?? '')
  .split(',').map(email => email.trim().toLowerCase()).filter(Boolean));
const allowedOrigins = new Set((setting('ALLOWED_ORIGINS') ?? '')
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
  testTokens: new Set((setting('WORKER_PUSH_TEST_TOKENS') ?? '')
    .split(',').map(token => token.trim()).filter(Boolean)),
};
const canGenerate = generationAllowed(pushOptions.environment,
  setting('WORKER_GENERATION_TEST_ENABLED'));
const integerSetting = (name: string, fallback: number): number => {
  const raw = setting(name);
  return raw === undefined ? fallback : Number(raw);
};
const refillOptions = {
  enabled: setting('GENERATION_ENABLED') === 'true' &&
    setting('FUTURE_REFILL_ENABLED') === 'true' && canGenerate,
  urgentEnabled: setting('FUTURE_REFILL_URGENT_ENABLED') === 'true',
  apiKey: setting('GEMINI_API_KEY') ?? '',
  model: setting('GEMINI_MODEL') ?? 'gemini-3.1-flash-lite',
  activeDays: integerSetting('CONTENT_ACTIVE_DAYS', 90),
  reserve: integerSetting('CONTENT_RESERVE_PER_TOPIC', 60),
  low: integerSetting('CONTENT_LOW_WATERMARK', 10),
  critical: integerSetting('CONTENT_CRITICAL_WATERMARK', 3),
  minPool: integerSetting('MIN_POOL_PER_TOPIC', 25),
  dailyCap: integerSetting('FUTURE_REFILL_DAILY_CALL_CAP', 5),
  topicCap: integerSetting('FUTURE_REFILL_TOPIC_DAILY_CAP', 1),
  urgentDailyCap: integerSetting('FUTURE_REFILL_URGENT_DAILY_CALL_CAP', 10),
  urgentTopicCap: integerSetting('FUTURE_REFILL_URGENT_TOPIC_DAILY_CAP', 2),
  maxConcurrent: integerSetting('GENERATION_MAX_CONCURRENT', 3),
  reviewLimit: integerSetting('CONTENT_REVIEW_BACKLOG_LIMIT', 25),
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
      enabled: setting('WEEKLY_QUIZ_NOTIFICATIONS_ENABLED') === 'true',
    }),
    editorial_email: createEditorialEmailTask(serviceRpc, emailTransaction, fetch, {
      enabled: setting('EDITORIAL_ENABLED') === 'true' &&
        setting('EDITORIAL_EMAIL_ENABLED') === 'true',
      environment: pushOptions.environment,
      testRecipients: emailRecipients,
      dashboardOrigin,
      allowedOrigins,
      from: setting('EDITORIAL_EMAIL_FROM') ?? '',
      clientId: setting('EDITORIAL_GMAIL_CLIENT_ID') ?? '',
      clientSecret: setting('EDITORIAL_GMAIL_CLIENT_SECRET') ?? '',
      refreshToken: setting('EDITORIAL_GMAIL_REFRESH_TOKEN') ?? '',
      dailyCap: Number(setting('EDITORIAL_EMAIL_DAILY_CAP') ?? '0'),
      databaseReady: workerDatabaseUrl.length > 0,
    }),
    content_pool: createCuratedRefillTask(serviceRpc, fetch, refillOptions, false),
    prefetch: createCuratedRefillTask(serviceRpc, fetch, refillOptions, true),
    editorial_generation: createEditorialGenerationTask(serviceRpc, fetch, {
      enabled: setting('EDITORIAL_ENABLED') === 'true' &&
        setting('GENERATION_ENABLED') === 'true' && canGenerate,
      apiKey: setting('GEMINI_API_KEY') ?? '',
      model: setting('GEMINI_MODEL') ?? 'gemini-3.1-flash-lite',
      dailyCap: integerSetting('GENERATION_DAILY_CALL_CAP', 200),
      maxConcurrent: integerSetting('GENERATION_MAX_CONCURRENT', 3),
    }),
    legacy_enrichment: createLegacyEnrichmentTask(serviceRpc, fetch, {
      enabled: setting('GENERATION_ENABLED') === 'true' &&
        setting('LEGACY_ENRICHMENT_ENABLED') === 'true' && canGenerate,
      apiKey: setting('GEMINI_API_KEY') ?? '',
      dailyCap: integerSetting('GENERATION_DAILY_CALL_CAP', 200),
      maxConcurrent: integerSetting('GENERATION_MAX_CONCURRENT', 3),
      reviewLimit: integerSetting('CONTENT_REVIEW_BACKLOG_LIMIT', 25),
    }),
  },
}));
