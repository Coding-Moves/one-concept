import { createHandler } from './handler.ts';
import { createDailyReminderTask } from './daily_reminders.ts';

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
    daily_reminders: createDailyReminderTask(serviceRpc, fetch, {
      environment: Deno.env.get('ENVIRONMENT') ?? 'development',
      testTokens: new Set((Deno.env.get('WORKER_PUSH_TEST_TOKENS') ?? '')
        .split(',').map(token => token.trim()).filter(Boolean)),
    }),
  },
}));
