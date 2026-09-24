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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Cloudflare Worker shell', () => {
  it('reports a healthy status', async () => {
    const response = await app.request('/api/health', {}, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, status: 'healthy' });
  });

  it('requires Cloudflare Access for admin routes', async () => {
    const response = await app.request('/api/admin/orders', {}, env);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Admin authentication required' });
  });

  it('recognizes the Cloudflare Access session cookie', async () => {
    const response = await app.request('/api/auth/session', {
      headers: { Cookie: 'CF_Authorization=test-token' },
    }, env);

    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      provider: 'cloudflare-access',
    });
  });

  it('returns the Cloudflare Access logout URL', async () => {
    const response = await app.request('https://api.example.com/api/auth/logout', { method: 'POST' }, env);

    await expect(response.json()).resolves.toEqual({
      logoutUrl: 'https://api.example.com/cdn-cgi/access/logout',
    });
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
    } as never;

    const loginResponse = await app.request('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'super-secret' }),
    }, passwordEnv);

    expect(loginResponse.status).toBe(200);
    const setCookie = loginResponse.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
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

  it('skips reCAPTCHA verification when no secret is configured', async () => {
    await expect(verifyRecaptcha({} as never, undefined)).resolves.toBe(true);
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

  it('rejects missing reCAPTCHA tokens when a secret is configured', async () => {
    await expect(verifyRecaptcha({ RECAPTCHA_SECRET_KEY: 'secret' } as never, undefined)).resolves.toBe(false);
  });
});
