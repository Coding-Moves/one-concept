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
}));
