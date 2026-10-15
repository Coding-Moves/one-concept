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

Deno.serve(createHandler({
  supabaseUrl: required('SUPABASE_URL').replace(/\/$/, ''),
  anonKey: required('SUPABASE_ANON_KEY'),
  serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  allowedOrigins: (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean),
}));
