export type MailBatch = {
  id: string;
  recipient_email: string;
  subject: string;
  body: string;
};

export type MailConfig = {
  enabled: boolean;
  environment: string;
  testRecipients: ReadonlySet<string>;
  dashboardOrigin: string;
  allowedOrigins: ReadonlySet<string>;
  from: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

export type MailOutcome = {
  state: 'sent' | 'pending' | 'failed';
  code: string | null;
};

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function mailSetupStatus(config: MailConfig): string {
  if (!config.enabled) return 'disabled';
  try {
    const url = new URL(config.dashboardOrigin);
    if (url.protocol !== 'https:' || url.username || url.password || url.search ||
        url.hash || url.pathname !== '/' ||
        config.dashboardOrigin.replace(/\/$/, '') !== url.origin ||
        !config.allowedOrigins.has(url.origin)) {
      return 'dashboard_setup_required';
    }
  } catch { return 'dashboard_setup_required'; }
  if (!config.clientId || !config.clientSecret || !config.refreshToken ||
      !EMAIL.test(config.from)) return 'sender_setup_required';
  if (config.environment !== 'production' && config.testRecipients.size === 0) {
    return 'test_recipients_required';
  }
  return 'ready';
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + 8192));
  }
  return btoa(binary);
}

function encoded(value: string): string {
  return base64(new TextEncoder().encode(value));
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] ?? char);
}

function reviewLink(line: string, origin: string): boolean {
  try {
    const url = new URL(line);
    const params = url.searchParams;
    return url.origin === origin && url.pathname === '/' && !url.hash &&
      Array.from(params.keys()).length === 3 &&
      params.get('view') === 'review' && params.get('kind') === 'revisions' &&
      UUID.test(params.get('id') ?? '');
  } catch { return false; }
}

function renderHtml(body: string, origin: string, liveLinks = true): string {
  let number = 0;
  const content = body.split(/\r?\n/).filter(Boolean).map(line => {
    const safe = htmlEscape(line);
    if (!liveLinks || !reviewLink(line, origin)) return `<p style="margin:0 0 12px">${safe}</p>`;
    number++;
    return `<p><a href="${safe}" style="background:#5248bf;color:#fff;padding:12px 20px">Open assigned lesson ${number}</a></p>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"></head>` +
    `<body style="font-family:Arial,sans-serif;color:#222238;background:#f4f4fc">` +
    `<main style="max-width:600px;margin:auto;padding:28px;background:#fff">` +
    `<h1>Lessons ready for your review</h1>${content}` +
    `<p>Assignments can change after this email is sent. The review workspace always shows their current status.</p>` +
    `</main></body></html>`;
}

function rawMessage(batch: MailBatch, config: MailConfig): string {
  const boundary = `one-concept-${batch.id}`;
  const domain = config.from.split('@')[1];
  const staging = config.environment !== 'production';
  const body = staging
    ? `STAGING DELIVERY TEST. No action needed; review links below are inactive.\n\n${batch.body}`
    : batch.body;
  const mime = [
    `From: ${config.from}`, `To: ${batch.recipient_email}`, `Subject: ${batch.subject}`,
    `Message-ID: <${batch.id}@${domain}>`, 'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64', '', encoded(body),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64', '',
    encoded(renderHtml(body, config.dashboardOrigin.replace(/\/$/, ''), !staging)),
    `--${boundary}--`, '',
  ].join('\r\n');
  return base64(new TextEncoder().encode(mime)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sendEditorialMail(
  fetcher: typeof fetch, batch: MailBatch, config: MailConfig,
): Promise<MailOutcome> {
  if (mailSetupStatus(config) !== 'ready' || !UUID.test(batch.id) ||
      !EMAIL.test(batch.recipient_email) || batch.subject !== 'One Concept: assigned lessons to review' ||
      batch.body.length > 50000) return { state: 'failed', code: 'setup_blocked' };
  if (config.environment !== 'production' &&
      !config.testRecipients.has(batch.recipient_email.toLowerCase())) {
    return { state: 'failed', code: 'staging_blocked' };
  }

  let access: string;
  try {
    const tokenResponse = await fetcher(TOKEN_URL, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: config.clientId,
        client_secret: config.clientSecret, refresh_token: config.refreshToken }),
      signal: AbortSignal.timeout(10000), redirect: 'error',
    });
    if (!tokenResponse.ok) return tokenResponse.status === 429 || tokenResponse.status >= 500
      ? { state: 'pending', code: 'provider_temporary' }
      : { state: 'failed', code: 'sender_authorization' };
    const payload: unknown = await tokenResponse.json();
    access = typeof payload === 'object' && payload !== null &&
      typeof (payload as Record<string, unknown>).access_token === 'string'
      ? (payload as Record<string, string>).access_token : '';
    if (!access) return { state: 'failed', code: 'sender_authorization' };
  } catch { return { state: 'pending', code: 'delivery_unknown' }; }

  try {
    const response = await fetcher(SEND_URL, {
      method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw: rawMessage(batch, config) }),
      signal: AbortSignal.timeout(10000), redirect: 'error',
    });
    if (response.ok) {
      const payload: unknown = await response.json();
      return typeof payload === 'object' && payload !== null &&
        typeof (payload as Record<string, unknown>).id === 'string' &&
        (payload as Record<string, string>).id.length > 0
        ? { state: 'sent', code: null } : { state: 'pending', code: 'delivery_unknown' };
    }
    let temporary = response.status === 429 || response.status >= 500;
    if (response.status === 403) {
      try {
        const payload = await response.json() as { error?: { errors?: Array<{ reason?: string }> } };
        temporary = (payload.error?.errors ?? []).some(item =>
          ['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded'].includes(item.reason ?? ''));
      } catch { /* An unreadable 403 is a rejection. */ }
    }
    return temporary ? { state: 'pending', code: 'provider_temporary' }
      : { state: 'failed', code: 'provider_rejected' };
  } catch { return { state: 'pending', code: 'delivery_unknown' }; }
}
