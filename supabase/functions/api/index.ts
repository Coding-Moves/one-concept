import { createHandler } from './handler.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};

const required = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const optionalInteger = (name: string, fallback: number): number => {
  const raw = Deno.env.get(name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  return Number(raw);
};

Deno.serve(createHandler({
  supabaseUrl: required('SUPABASE_URL').replace(/\/$/, ''),
  anonKey: required('SUPABASE_ANON_KEY'),
  serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  allowedOrigins: (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean),
  contentLowWatermark: optionalInteger('CONTENT_LOW_WATERMARK', 10),
  contentReservePerTopic: optionalInteger('CONTENT_RESERVE_PER_TOPIC', 60),
  contentActiveDays: optionalInteger('CONTENT_ACTIVE_DAYS', 90),
  editorialEnabled: Deno.env.get('EDITORIAL_ENABLED') === 'true',
  minPoolPerTopic: optionalInteger('MIN_POOL_PER_TOPIC', 25),
  contentReviewBacklogLimit: optionalInteger('CONTENT_REVIEW_BACKLOG_LIMIT', 25),
  generationEnabled: Deno.env.get('GENERATION_ENABLED') === 'true',
  futureRefillEnabled: Deno.env.get('FUTURE_REFILL_ENABLED') === 'true',
  providerConfigured: Boolean(Deno.env.get('GEMINI_API_KEY')),
  legacyEnrichmentEnabled: Deno.env.get('LEGACY_ENRICHMENT_ENABLED') === 'true',
  geminiModel: Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.1-flash-lite',
  editorialEmailEnabled: Deno.env.get('EDITORIAL_EMAIL_ENABLED') === 'true',
  editorialEmailDashboardUrl: Deno.env.get('EDITORIAL_EMAIL_DASHBOARD_URL') ?? '',
  editorialEmailSenderConfigured: Boolean(Deno.env.get('EDITORIAL_GMAIL_CLIENT_ID')
    && Deno.env.get('EDITORIAL_GMAIL_CLIENT_SECRET')
    && Deno.env.get('EDITORIAL_GMAIL_REFRESH_TOKEN')
    && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(Deno.env.get('EDITORIAL_EMAIL_FROM') ?? '')),
  editorialEmailTestRecipientsConfigured: Boolean((Deno.env.get('EDITORIAL_EMAIL_TEST_RECIPIENTS') ?? '')
    .split(',').map(value => value.trim()).filter(Boolean).length),
  editorialEmailDailyCap: optionalInteger('EDITORIAL_EMAIL_DAILY_CAP', 40),
  environment: Deno.env.get('ENVIRONMENT') ?? 'development',
}));
