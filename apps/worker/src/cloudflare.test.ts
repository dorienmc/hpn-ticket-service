import { afterEach, describe, expect, it, vi } from 'vitest';
import { app, base64UrlEncode, sendReservationEmail, verifyGoogleIdToken, verifyRecaptcha } from './cloudflare.js';

const env = {
  FRONTEND_URL: 'https://example.github.io/hpn-ticket-service',
} as never;

const reservation = {
  id: 1,
  order_number: 'HP9-1234-ABCD',
  access_token: 'token123',
  name: 'Test Customer',
  email: 'customer@example.com',
  quantity: 2,
  amount_cents: 2000,
  status: 'RESERVED',
  created_at: '2026-09-23T10:00:00.000Z',
  expires_at: '2026-09-25T10:00:00.000Z',
  paid_at: null,
  notes: null,
} as const;

function createReservationDb() {
  function createPreparedResult(statement: string, args: unknown[]) {
    return {
      async run() {
        return { meta: { changes: 1 } };
      },
      async first<T>() {
        if (statement.includes('SELECT COALESCE(SUM(quantity), 0) AS active_quantity')) {
          return { active_quantity: 0 } as T;
        }
        if (statement.includes('INSERT INTO orders')) {
          const [orderNumber, accessToken, name, email, quantity, amountCents, createdAt, expiresAt] = args;
          return {
            ...reservation,
            id: 99,
            order_number: orderNumber,
            access_token: accessToken,
            name,
            email,
            quantity,
            amount_cents: amountCents,
            created_at: createdAt,
            expires_at: expiresAt,
          } as T;
        }
        return null as T;
      },
      async all<T>() {
        return { results: [] as T[] };
      },
    };
  }

  return {
    prepare(statement: string) {
      return {
        ...createPreparedResult(statement, []),
        bind(...args: unknown[]) {
          return createPreparedResult(statement, args);
        },
      };
    },
  } as never;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Cloudflare Worker shell', () => {
  it('reports a healthy status', async () => {
    const response = await app.request('/api/health', {}, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, status: 'healthy' });
  });

  it('requires an authenticated admin session for admin routes', async () => {
    const response = await app.request('/api/admin/orders', {}, env);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Admin authentication required' });
  });

  it('does not trust Cloudflare Access headers or cookies on the public worker origin', async () => {
    const response = await app.request('/api/auth/session', {
      headers: {
        Cookie: 'CF_Authorization=test-token',
        'Cf-Access-Authenticated-User-Email': 'admin@example.com',
      },
    }, {
      FRONTEND_URL: 'https://example.github.io/hpn-ticket-service',
      ADMIN_PASSWORD: 'super-secret',
    } as never);

    await expect(response.json()).resolves.toEqual({
      authenticated: false,
      provider: 'password',
    });
  });

  it('returns a local logout response without a Cloudflare Access redirect', async () => {
    const response = await app.request('https://api.example.com/api/auth/logout', { method: 'POST' }, env);

    expect(response.status).toBe(204);
  });

  it('rejects password login when ADMIN_PASSWORD is not configured', async () => {
    const response = await app.request('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'anything' }),
    }, env);

    expect(response.status).toBe(404);
  });

  it('rejects an incorrect admin password', async () => {
    const response = await app.request('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    }, {
      FRONTEND_URL: 'https://example.github.io/hpn-ticket-service',
      ADMIN_PASSWORD: 'super-secret',
    } as never);

    expect(response.status).toBe(401);
  });

  it('logs in with the correct admin password and reports an authenticated session', async () => {
    const passwordEnv = {
      FRONTEND_URL: 'https://example.github.io/hpn-ticket-service',
      ADMIN_PASSWORD: 'super-secret',
      DB: createReservationDb(),
    } as never;

    const loginResponse = await app.request('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'super-secret' }),
    }, passwordEnv);

    expect(loginResponse.status).toBe(200);
    const setCookie = loginResponse.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('SameSite=None');
    expect(setCookie).toContain('Secure');
    const cookie = setCookie!.split(';')[0];

    const sessionResponse = await app.request('/api/auth/session', { headers: { Cookie: cookie } }, passwordEnv);
    await expect(sessionResponse.json()).resolves.toEqual({ authenticated: true, provider: 'password' });

    const adminResponse = await app.request('/api/admin/orders', { headers: { Cookie: cookie } }, passwordEnv);
    expect(adminResponse.status).not.toBe(401);
  });

  it('rejects a Google credential with the wrong audience', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      aud: 'other-client-id',
      email: 'admin@example.com',
      email_verified: 'true',
    })));

    const result = await verifyGoogleIdToken({
      GOOGLE_CLIENT_ID: 'expected-client-id',
    } as never, 'token');

    expect(result).toBeNull();
  });

  it('rejects a Google credential for an email outside the allowlist', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      aud: 'expected-client-id',
      email: 'stranger@example.com',
      email_verified: 'true',
    })));

    const result = await verifyGoogleIdToken({
      GOOGLE_CLIENT_ID: 'expected-client-id',
      ADMIN_ALLOWED_EMAILS: 'admin@example.com, organiser@example.com',
    } as never, 'token');

    expect(result).toBeNull();
  });

  it('logs in with a Google credential and establishes an allowlisted admin session', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      aud: 'expected-client-id',
      email: 'Admin@Example.com',
      email_verified: 'true',
    })));

    const googleEnv = {
      FRONTEND_URL: 'https://example.github.io/hpn-ticket-service',
      GOOGLE_CLIENT_ID: 'expected-client-id',
      ADMIN_ALLOWED_EMAILS: 'admin@example.com',
      ADMIN_PASSWORD: 'super-secret',
      DB: createReservationDb(),
    } as never;

    const loginResponse = await app.request('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'google-id-token' }),
    }, googleEnv);

    expect(loginResponse.status).toBe(200);
    const setCookie = loginResponse.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    const cookie = setCookie!.split(';')[0];

    const sessionResponse = await app.request('/api/auth/session', { headers: { Cookie: cookie } }, googleEnv);
    await expect(sessionResponse.json()).resolves.toEqual({ authenticated: true, provider: 'google' });

    const adminResponse = await app.request('/api/admin/orders', { headers: { Cookie: cookie } }, googleEnv);
    expect(adminResponse.status).not.toBe(401);
  });

  it('requires an admin password before establishing a Google session', async () => {
    const response = await app.request('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'google-id-token' }),
    }, {
      FRONTEND_URL: 'https://example.github.io/hpn-ticket-service',
      GOOGLE_CLIENT_ID: 'expected-client-id',
    } as never);

    expect(response.status).toBe(500);
  });

  it('encodes Gmail MIME content as base64url', () => {
    const encoded = base64UrlEncode('hello?');

    expect(encoded).toBe('aGVsbG8_');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });

  it('sends reservation emails through Gmail API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: 'gmail-access-token',
    }))).mockResolvedValueOnce(new Response(JSON.stringify({ id: 'gmail-message-id' })));

    await sendReservationEmail({
      FRONTEND_URL: 'https://example.github.io/hpn-ticket-service',
      EMAIL_DELIVERY: 'gmail',
      GMAIL_CLIENT_ID: 'client-id',
      GMAIL_CLIENT_SECRET: 'client-secret',
      GMAIL_REFRESH_TOKEN: 'refresh-token',
      GMAIL_FROM_EMAIL: 'tickets@gmail.com',
    } as never, reservation);

    expect(fetchMock).toHaveBeenCalledWith('https://oauth2.googleapis.com/token', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }));
    expect(fetchMock).toHaveBeenCalledWith('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer gmail-access-token', 'Content-Type': 'application/json' },
    }));

    const sendRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const payload = JSON.parse(String(sendRequest.body));
    expect(payload.raw).toEqual(expect.any(String));
  });

  it('requires a reCAPTCHA secret outside local development', async () => {
    await expect(verifyRecaptcha({} as never, undefined)).resolves.toBe(false);
  });

  it('allows local reservations without a reCAPTCHA secret', async () => {
    await expect(verifyRecaptcha({ LOCAL_ADMIN_AUTH: 'true' } as never, undefined)).resolves.toBe(true);
  });

  it('verifies reCAPTCHA tokens with Google when a secret is configured', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      action: 'reserve',
      score: 0.9,
    })));

    await expect(verifyRecaptcha({ RECAPTCHA_SECRET_KEY: 'secret' } as never, 'token', '127.0.0.1')).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith('https://www.google.com/recaptcha/api/siteverify', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }));
  });

  it('rejects reCAPTCHA responses without the reserve action and numeric score', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      action: 'homepage',
      score: '0.9',
    })));

    await expect(verifyRecaptcha({ RECAPTCHA_SECRET_KEY: 'secret' } as never, 'token')).resolves.toBe(false);
  });

  it('rejects missing reCAPTCHA tokens when a secret is configured', async () => {
    await expect(verifyRecaptcha({ RECAPTCHA_SECRET_KEY: 'secret' } as never, undefined)).resolves.toBe(false);
  });

  it('uses the frontend origin for API CORS responses', async () => {
    const response = await app.request('/api/health', {
      headers: { Origin: 'https://example.github.io' },
    }, env);

    expect(response.headers.get('access-control-allow-origin')).toBe('https://example.github.io');
  });

  it('rejects cross-site admin mutations even with a valid admin session', async () => {
    const passwordEnv = {
      FRONTEND_URL: 'https://example.github.io/hpn-ticket-service',
      ADMIN_PASSWORD: 'super-secret',
      DB: createReservationDb(),
    } as never;

    const loginResponse = await app.request('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'super-secret' }),
    }, passwordEnv);
    const cookie = loginResponse.headers.get('set-cookie')!.split(';')[0];

    const response = await app.request('/api/admin/orders/HP9-1234-ABCD/cancel', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: 'https://evil.example',
      },
    }, passwordEnv);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Cross-site admin requests are not allowed' });
  });

  it('escapes untrusted reservation names in HTML email output', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 202 }));

    await sendReservationEmail({
      FRONTEND_URL: 'https://example.github.io/hpn-ticket-service',
      EMAIL_DELIVERY: 'mailpit',
      MAILPIT_API_URL: 'http://mailpit:8025',
    } as never, {
      ...reservation,
      name: '<img src=x onerror=alert(1)>',
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.HTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(payload.HTML).not.toContain('<img src=x onerror=alert(1)>');
  });

  it('keeps a created reservation when email delivery fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 500 }));

    const response = await app.request('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Customer', email: 'customer@example.com', quantity: 2 }),
    }, {
      FRONTEND_URL: 'http://localhost:5173/hpn-ticket-service',
      LOCAL_ADMIN_AUTH: 'true',
      EMAIL_DELIVERY: 'mailpit',
      MAILPIT_API_URL: 'http://mailpit:8025',
      DB: createReservationDb(),
    } as never);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      status: 'RESERVED',
      paymentUrl: expect.stringContaining('/payment/'),
    }));
    expect(consoleError).toHaveBeenCalled();
  });
});
