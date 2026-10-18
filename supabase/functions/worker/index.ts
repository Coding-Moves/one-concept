import { createHandler } from './handler.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

Deno.serve(createHandler({
  supabaseUrl: required('SUPABASE_URL').replace(/\/$/, ''),
  serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  signingKey: required('WORKER_DISPATCH_SIGNING_KEY'),
  // Jobs are registered only after their durable queues and provider limits
  // have passed staging checks. An unregistered job cannot claim a run.
  tasks: {},
}));
