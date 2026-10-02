import { afterEach, describe, expect, it, vi } from 'vitest';
import { app, base64UrlEncode, sendReservationEmail, verifyGoogleIdToken, verifyRecaptcha } from './cloudflare.js';
import type { ReservationRecord } from './types.js';

const env = {
  FRONTEND_URL: 'https://example.github.io/hpn-ticket-service',
} as never;

const reservation: ReservationRecord = {
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

function createReservationDb(reservationToFind = reservation) {
  let storedReservation = reservationToFind;
  let storedEmails: string | null = null;
  const revokedSessions = new Set<string>();

  function createPreparedResult(statement: string, args: unknown[]) {
    return {
      async run() {
        if (statement.includes('INSERT OR IGNORE INTO admin_session_revocations')) {
          revokedSessions.add(String(args[0]));
        }
        if (statement.includes('INSERT INTO admin_access_settings')) {
          storedEmails = String(args[0]);
        }
        if (statement.includes("UPDATE orders SET status = 'EXPIRED'")
          && storedReservation.status === 'RESERVED'
          && storedReservation.expires_at <= String(args[0])) {
          storedReservation = { ...storedReservation, status: 'EXPIRED' };
        }
        return { meta: { changes: 1 } };
      },
      async first<T>() {
        if (statement.includes('SELECT session_value FROM admin_session_revocations')) {
          return revokedSessions.has(String(args[0])) ? { session_value: String(args[0]) } as T : null;
        }
        if (statement.includes('SELECT emails FROM admin_access_settings')) {
          return storedEmails === null ? null : { emails: storedEmails } as T;
        }
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
        if (statement.includes('SELECT * FROM orders WHERE order_number')) {
          return storedReservation as T;
        }
        return null as T;
      },
      async all<T>() {
        if (statement.includes('SELECT * FROM orders ORDER BY created_at DESC')) {
          return { results: [storedReservation] as T[] };
        }
        return { results: [] as T[] };
      },
    };
  }

  return {
    async batch(statements: { run(): Promise<unknown> }[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
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

describe('Local Worker mock login (replaces Express authentication tests)', () => {
  function mockEnv() {
    return {
      FRONTEND_URL: 'http://localhost:5173/hpn-ticket-service/',
      MOCK_GOOGLE_LOGIN: 'true',
      MOCK_GOOGLE_EMAIL: 'dorienmc@gmail.com',
      ADMIN_PASSWORD: 'local-test-password',
      ADMIN_ALLOWED_EMAILS: 'admin@example.com',
      DB: createReservationDb(),
    };
  }

  async function mockLogin(bindings: ReturnType<typeof mockEnv>, email = 'dorienmc@gmail.com') {
    const response = await app.request(`http://localhost:8787/api/auth/google?email=${encodeURIComponent(email)}`, {}, bindings);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('http://localhost:5173/hpn-ticket-service/admin');
    return response.headers.get('set-cookie')!.split(';')[0];
  }

  it('issues signed email-specific sessions and never calls Google', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const bindings = mockEnv();
    const owner = await mockLogin(bindings);
    const other = await mockLogin(bindings, 'admin@example.com');
    expect(owner).not.toBe(other);
    const ownerSession = await app.request('/api/auth/session', { headers: { Cookie: owner } }, bindings);
    expect(await ownerSession.json()).toEqual({ authenticated: true, provider: 'google', canManageAdminEmails: true });
    const otherSession = await app.request('/api/auth/session', { headers: { Cookie: other } }, bindings);
    expect(await otherSession.json()).toEqual({ authenticated: true, provider: 'google' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('exposes only the requested configuration to the Google owner without caching', async () => {
    const bindings = {
      ...mockEnv(),
      GOOGLE_CLIENT_ID: 'mail-client-id',
      GOOGLE_AUTH_CLIENT_ID: 'login-client-id',
      ING_PAYMENT_LINK_1: 'https://example.com/pay/1',
      ING_PAYMENT_LINK_2: 'https://example.com/pay/2',
      ING_PAYMENT_LINK_3: 'https://example.com/pay/3',
      ING_PAYMENT_LINK_4: 'https://example.com/pay/4',
      ING_PAYMENT_LINK_5: 'https://example.com/pay/5',
      GOOGLE_CLIENT_SECRET: 'must-not-be-returned',
      GOOGLE_REFRESH_TOKEN: 'must-not-be-returned',
    };
    const cookie = await mockLogin(bindings);
    const response = await app.request('/api/admin/access/config', { headers: { Cookie: cookie } }, bindings);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      GOOGLE_CLIENT_ID: bindings.GOOGLE_CLIENT_ID,
      GOOGLE_AUTH_CLIENT_ID: bindings.GOOGLE_AUTH_CLIENT_ID,
      ING_PAYMENT_LINK_1: bindings.ING_PAYMENT_LINK_1,
      ING_PAYMENT_LINK_2: bindings.ING_PAYMENT_LINK_2,
      ING_PAYMENT_LINK_3: bindings.ING_PAYMENT_LINK_3,
      ING_PAYMENT_LINK_4: bindings.ING_PAYMENT_LINK_4,
      ING_PAYMENT_LINK_5: bindings.ING_PAYMENT_LINK_5,
    });
  });

  it('returns null for unset configuration and denies anonymous, non-owner and password sessions', async () => {
    const bindings = mockEnv();
    const cookie = await mockLogin(bindings);
    const response = await app.request('/api/admin/access/config', { headers: { Cookie: cookie } }, bindings);
    expect(await response.json()).toEqual({
      GOOGLE_CLIENT_ID: null, GOOGLE_AUTH_CLIENT_ID: null,
      ING_PAYMENT_LINK_1: null, ING_PAYMENT_LINK_2: null, ING_PAYMENT_LINK_3: null,
      ING_PAYMENT_LINK_4: null, ING_PAYMENT_LINK_5: null,
    });
    expect((await app.request('/api/admin/access/config', {}, bindings)).status).toBe(401);
    const other = await mockLogin(bindings, 'admin@example.com');
    expect((await app.request('/api/admin/access/config', { headers: { Cookie: other } }, bindings)).status).toBe(403);
    const password = await app.request('/api/auth/password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: bindings.ADMIN_PASSWORD }),
    }, bindings);
    expect(password.status).toBe(200);
    expect((await app.request('/api/admin/access/config', {
      headers: { Cookie: password.headers.get('set-cookie')!.split(';')[0] },
    }, bindings)).status).toBe(403);
  });

  it('rejects disabled mocks, non-loopback frontends and non-loopback API requests', async () => {
    for (const bindings of [
      { ...mockEnv(), MOCK_GOOGLE_LOGIN: 'false' },
      { ...mockEnv(), FRONTEND_URL: 'https://example.com' },
    ]) {
      expect((await app.request('http://localhost:8787/api/auth/google', {}, bindings)).status).toBe(404);
    }
    expect((await app.request('https://api.example.com/api/auth/google', {}, mockEnv())).status).toBe(404);
    expect((await app.request('http://localhost:8787/api/auth/google', {}, { ...mockEnv(), ADMIN_PASSWORD: '' })).status).toBe(500);
  });

  it('cannot bypass production reCAPTCHA by setting the mock flag', async () => {
    await expect(verifyRecaptcha({
      MOCK_GOOGLE_LOGIN: 'true', FRONTEND_URL: 'https://example.com',
    } as never, undefined)).resolves.toBe(false);
  });

  it('blocks disallowed users and legacy/forged session cookies', async () => {
    const bindings = mockEnv();
    expect((await app.request('http://localhost:8787/api/auth/google?email=stranger@example.com', {}, bindings)).status).toBe(403);
    for (const cookie of ['hpn_mock_google_admin=authenticated', 'hpn_local_admin=authenticated', 'hpn_admin_google_session=forged']) {
      expect((await app.request('/api/admin/orders', { headers: { Cookie: cookie } }, bindings)).status).toBe(401);
    }
  });

  it('expires mock sessions after twelve hours and clears the signed cookie on logout', async () => {
    const bindings = mockEnv();
    const cookie = await mockLogin(bindings);
    const logout = await app.request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } }, bindings);
    expect(logout.status).toBe(204);
    expect(logout.headers.get('set-cookie')).toContain('hpn_admin_google_session=;');
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await app.request('/api/admin/orders', { headers: { Cookie: cookie } }, bindings)).status).toBe(401);
    const newCookie = await mockLogin(bindings);
    expect((await app.request('/api/admin/orders', { headers: { Cookie: newCookie } }, bindings)).status).toBe(200);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 12 * 60 * 60 * 1000 + 1000);
    expect((await app.request('/api/admin/orders', { headers: { Cookie: newCookie } }, bindings)).status).toBe(401);
  });

  it('persists the allowlist and audit in one D1 transaction and surfaces write failures', async () => {
    const bindings = mockEnv();
    const cookie = await mockLogin(bindings);
    const batch = vi.spyOn(bindings.DB, 'batch').mockRejectedValueOnce(new Error('audit unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await app.request('/api/admin/access', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails: ['dorienmc@gmail.com'] }),
    }, bindings);
    expect(response.status).toBe(500);
    expect(batch).toHaveBeenCalledWith([expect.any(Object), expect.any(Object)]);
    expect(log).toHaveBeenCalled();
    const saved = await app.request('/api/admin/access', { headers: { Cookie: cookie } }, bindings);
    expect(await saved.json()).toMatchObject({ emails: ['dorienmc@gmail.com', 'admin@example.com'] });
  });
});

describe('Owner-managed admin access', () => {
  function accessEnv() {
    return {
      FRONTEND_URL: 'https://example.github.io/hpn-ticket-service',
      GOOGLE_AUTH_CLIENT_ID: 'sign-in-client-id',
      ADMIN_PASSWORD: 'super-secret',
      ADMIN_ALLOWED_EMAILS: 'admin@example.com',
      RESEND_API_KEY: '',
      RESEND_FROM_EMAIL: '',
      DB: createReservationDb(),
    };
  }

  async function login(email: string, bindings: ReturnType<typeof accessEnv>) {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      aud: 'sign-in-client-id', email, email_verified: true,
    })));
    const response = await app.request('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'id-token' }),
    }, bindings);
    expect(response.status).toBe(200);
    return response.headers.get('set-cookie')!.split(';')[0];
  }

  function saveAccess(cookie: string, emails: unknown, bindings: ReturnType<typeof accessEnv>, origin = 'https://example.github.io') {
    return app.request('/api/admin/access', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails }),
    }, bindings);
  }

  it('lets only the fixed Google owner manage and persist normalized access with an audit record', async () => {
    const bindings = accessEnv();
    const cookie = await login('dorienmc@gmail.com', bindings);
    const session = await app.request('/api/auth/session', { headers: { Cookie: cookie } }, bindings);
    expect(await session.json()).toMatchObject({ canManageAdminEmails: true });
    const initial = await app.request('/api/admin/access', { headers: { Cookie: cookie } }, bindings);
    expect(await initial.json()).toEqual({
      ownerEmail: 'dorienmc@gmail.com', emails: ['dorienmc@gmail.com', 'admin@example.com'],
    });
    const batch = vi.spyOn(bindings.DB, 'batch');
    const prepare = vi.spyOn(bindings.DB, 'prepare');
    const response = await saveAccess(cookie, ['dorienmc@gmail.com', ' NEW@Example.com ', 'new@example.com'], bindings);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ownerEmail: 'dorienmc@gmail.com', emails: ['dorienmc@gmail.com', 'new@example.com'] });
    expect(batch).toHaveBeenCalledWith([expect.any(Object), expect.any(Object)]);
    expect(prepare).toHaveBeenCalledWith('INSERT INTO admin_access_audit (actor_email, emails, created_at) VALUES (?, ?, ?)');
    const saved = await app.request('/api/admin/access', { headers: { Cookie: cookie } }, { ...bindings });
    expect(await saved.json()).toEqual({ ownerEmail: 'dorienmc@gmail.com', emails: ['dorienmc@gmail.com', 'new@example.com'] });
    await login('new@example.com', bindings);
  });

  it('rejects another Google admin and password-only sessions', async () => {
    const bindings = accessEnv();
    const otherCookie = await login('admin@example.com', bindings);
    const otherSession = await app.request('/api/auth/session', { headers: { Cookie: otherCookie } }, bindings);
    expect(await otherSession.json()).not.toHaveProperty('canManageAdminEmails');
    const password = await app.request('/api/auth/password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: bindings.ADMIN_PASSWORD }),
    }, bindings);
    const passwordCookie = password.headers.get('set-cookie')!.split(';')[0];
    const batch = vi.spyOn(bindings.DB, 'batch');
    for (const cookie of [otherCookie, passwordCookie]) {
      expect((await app.request('/api/admin/access', { headers: { Cookie: cookie } }, bindings)).status).toBe(403);
      expect((await saveAccess(cookie, ['dorienmc@gmail.com'], bindings)).status).toBe(403);
    }
    expect(batch).not.toHaveBeenCalled();
  });

  it('revokes existing sessions and future logins immediately after removal', async () => {
    const bindings = accessEnv();
    const owner = await login('dorienmc@gmail.com', bindings);
    const other = await login('admin@example.com', bindings);
    expect((await saveAccess(owner, ['dorienmc@gmail.com'], bindings)).status).toBe(200);
    const session = await app.request('/api/auth/session', { headers: { Cookie: other } }, bindings);
    expect(await session.json()).toMatchObject({ authenticated: false });
    expect((await app.request('/api/admin/orders', { headers: { Cookie: other } }, bindings)).status).toBe(401);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      aud: 'sign-in-client-id', email: 'admin@example.com', email_verified: true,
    })));
    const response = await app.request('/api/auth/google', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: 'id-token' }),
    }, bindings);
    expect(response.status).toBe(401);
    const logout = await app.request('/api/auth/logout', { method: 'POST', headers: { Cookie: other } }, bindings);
    expect(logout.status).toBe(204);
    expect((await saveAccess(owner, ['dorienmc@gmail.com', 'admin@example.com'], bindings)).status).toBe(200);
    expect((await app.request('/api/admin/orders', { headers: { Cookie: other } }, bindings)).status).toBe(401);
  });

  it('rejects empty, malformed, oversized and owner-removing lists without writing', async () => {
    const bindings = accessEnv();
    const owner = await login('dorienmc@gmail.com', bindings);
    const batch = vi.spyOn(bindings.DB, 'batch');
    for (const emails of [[], ['new@example.com'], ['dorienmc@gmail.com', 'bad-email'], [42],
      'dorienmc@gmail.com', Array(101).fill('dorienmc@gmail.com'), ['dorienmc@gmail.com', `${'a'.repeat(255)}@example.com`]]) {
      expect((await saveAccess(owner, emails, bindings)).status).toBe(400);
    }
    const malformed = await app.request('/api/admin/access', {
      method: 'POST',
      headers: { Cookie: owner, Origin: 'https://example.github.io', 'Content-Type': 'application/json' },
      body: '{',
    }, bindings);
    expect(malformed.status).toBe(400);
    expect(batch).not.toHaveBeenCalled();
  });

  it('blocks unauthenticated, forged and cross-site changes', async () => {
    const bindings = accessEnv();
    const owner = await login('dorienmc@gmail.com', bindings);
    const batch = vi.spyOn(bindings.DB, 'batch');
    expect((await saveAccess('', ['dorienmc@gmail.com'], bindings)).status).toBe(401);
    expect((await saveAccess(`${owner}invalid`, ['dorienmc@gmail.com'], bindings)).status).toBe(401);
    expect((await saveAccess(owner, ['dorienmc@gmail.com'], bindings, 'https://attacker.example')).status).toBe(403);
    expect((await saveAccess(owner, ['dorienmc@gmail.com'], bindings, '')).status).toBe(403);
    expect(batch).not.toHaveBeenCalled();
  });

  it('allows only the fixed owner when the initial list is empty', async () => {
    const bindings = { ...accessEnv(), ADMIN_ALLOWED_EMAILS: '' };
    await login('dorienmc@gmail.com', bindings);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      aud: 'sign-in-client-id', email: 'stranger@example.com', email_verified: true,
    })));
    await expect(verifyGoogleIdToken(bindings, 'id-token')).resolves.toBeNull();
  });
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

  it('reports admin summary statistics as ticket quantities', async () => {
    const db = {
      prepare(statement: string) {
        const result = {
          async run() {
            return { meta: { changes: 0 } };
          },
          async first<T>() {
            if (statement.includes('SELECT COALESCE(SUM(quantity), 0) AS active_quantity')) {
              return { active_quantity: 5 } as T;
            }
            return null as T;
          },
          async all<T>() {
            if (statement.includes('COALESCE(SUM(quantity), 0) AS quantity')) {
              return {
                results: [
                  { status: 'RESERVED', quantity: 3 },
                  { status: 'PAID', quantity: 2 },
                  { status: 'EXPIRED', quantity: 4 },
                  { status: 'CANCELLED', quantity: 1 },
                ] as T[],
              };
            }
            return { results: [] as T[] };
          },
        };
        return {
          ...result,
          bind() {
            return result;
          },
        };
      },
    } as never;

    const summaryEnv = {
      FRONTEND_URL: 'https://example.github.io/hpn-ticket-service',
      ADMIN_PASSWORD: 'super-secret',
      TOTAL_CAPACITY: '20',
      DB: db,
    } as never;
    const login = await app.request('/api/auth/password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'super-secret' }),
    }, summaryEnv);
    const response = await app.request('/api/admin/summary', {
      headers: { Cookie: login.headers.get('set-cookie')!.split(';')[0] },
    }, summaryEnv);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      total: 10,
      totalCapacity: 20,
      reserved: 3,
      paid: 2,
      available: 15,
      expired: 4,
      cancelled: 1,
    });
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
    expect(adminResponse.status).toBe(200);
    await expect(adminResponse.json()).resolves.toEqual({
      orders: [expect.objectContaining({
        order_number: reservation.order_number,
        paymentUrl: `https://example.github.io/hpn-ticket-service/payment/${reservation.order_number}/${reservation.access_token}`,
      })],
    });
  });

  it('revokes copied password sessions on logout', async () => {
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

    const logout = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie },
    }, passwordEnv);

    expect(logout.status).toBe(204);
    await expect((await app.request('/api/auth/session', { headers: { Cookie: cookie } }, passwordEnv)).json())
      .resolves.toMatchObject({ authenticated: false });
    expect((await app.request('/api/admin/orders', { headers: { Cookie: cookie } }, passwordEnv)).status).toBe(401);
  });

  it('rejects a Google credential with the wrong audience', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      aud: 'other-client-id',
      email: 'admin@example.com',
      email_verified: 'true',
    })));

    const result = await verifyGoogleIdToken({
      GOOGLE_AUTH_CLIENT_ID: 'expected-client-id',
    } as never, 'token');

    expect(result).toBeNull();
  });

  it('rejects a Google credential issued for the mail client', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      aud: 'mail-client-id',
      email: 'admin@example.com',
      email_verified: 'true',
    })));

    const result = await verifyGoogleIdToken({
      GOOGLE_AUTH_CLIENT_ID: 'sign-in-client-id',
      GOOGLE_CLIENT_ID: 'mail-client-id',
    } as never, 'token');

    expect(result).toBeNull();
  });

  it('does not enable Google sign-in with only mail credentials', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const mailEnv = {
      FRONTEND_URL: 'https://example.github.io/hpn-ticket-service',
      GOOGLE_CLIENT_ID: 'mail-client-id',
      GOOGLE_CLIENT_SECRET: 'mail-client-secret',
      GOOGLE_REFRESH_TOKEN: 'mail-refresh-token',
      ADMIN_PASSWORD: 'super-secret',
    } as never;

    await expect(verifyGoogleIdToken(mailEnv, 'token')).resolves.toBeNull();
    const response = await app.request('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'google-id-token' }),
    }, mailEnv);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Google sign-in is not configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a Google credential for an email outside the allowlist', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      aud: 'expected-client-id',
      email: 'stranger@example.com',
      email_verified: 'true',
    })));

    const result = await verifyGoogleIdToken({
      GOOGLE_AUTH_CLIENT_ID: 'expected-client-id',
      ADMIN_ALLOWED_EMAILS: 'admin@example.com, organiser@example.com',
      DB: createReservationDb(),
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
      GOOGLE_AUTH_CLIENT_ID: 'expected-client-id',
      GOOGLE_CLIENT_ID: 'mail-client-id',
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
      GOOGLE_AUTH_CLIENT_ID: 'expected-client-id',
    } as never);

    expect(response.status).toBe(500);
  });

  it('clears Google session cookies when the sign-in client is configured', async () => {
    const response = await app.request('/api/auth/logout', {
      method: 'POST',
    }, {
      FRONTEND_URL: 'https://example.github.io/hpn-ticket-service',
      GOOGLE_AUTH_CLIENT_ID: 'sign-in-client-id',
    } as never);

    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('hpn_admin_google_session=;');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
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
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_AUTH_CLIENT_ID: 'sign-in-client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      GOOGLE_REFRESH_TOKEN: 'refresh-token',
      GOOGLE_SENDER_EMAIL: 'dorienmc@gmail.com',
    } as never, reservation);

    expect(fetchMock).toHaveBeenCalledWith('https://oauth2.googleapis.com/token', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: 'client-id',
        client_secret: 'client-secret',
        refresh_token: 'refresh-token',
        grant_type: 'refresh_token',
      }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer gmail-access-token', 'Content-Type': 'application/json' },
    }));

    const sendRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const payload = JSON.parse(String(sendRequest.body));
    expect(payload.raw).toEqual(expect.any(String));
    const mime = Buffer.from(payload.raw, 'base64url').toString();
    expect(mime).toContain('From: Dorien Lorijn namens Half Past Nine <dorienmc@gmail.com>');
  });

  it('requires a reCAPTCHA secret outside local development', async () => {
    await expect(verifyRecaptcha({} as never, undefined)).resolves.toBe(false);
  });

  it('allows local reservations without a reCAPTCHA secret', async () => {
    await expect(verifyRecaptcha({
      MOCK_GOOGLE_LOGIN: 'true', FRONTEND_URL: 'http://localhost:5173/hpn-ticket-service/',
    } as never, undefined)).resolves.toBe(true);
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
    expect(payload.HTML).toContain('HALF PAST NINE');
    expect(payload.HTML).toContain('background-color:#087b76');
    expect(payload.HTML).toContain('Open je reserveringspagina');
    expect(payload.HTML).toContain('href="https://example.github.io/hpn-ticket-service/payment/');
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
      MOCK_GOOGLE_LOGIN: 'true',
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

  it('rejects quantities above five even when the configured maximum is higher', async () => {
    const response = await app.request('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Customer', email: 'customer@example.com', quantity: 6 }),
    }, {
      FRONTEND_URL: 'http://localhost:5173/hpn-ticket-service',
      MOCK_GOOGLE_LOGIN: 'true',
      MAX_TICKETS_PER_RESERVATION: '10',
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Quantity must be between 1 and 5' });
  });

  it('returns the ING payment link matching the reservation ticket quantity', async () => {
    const paymentLinks = {
      ING_PAYMENT_LINK_1: 'https://ing.example/pay/1',
      ING_PAYMENT_LINK_2: 'https://ing.example/pay/2',
      ING_PAYMENT_LINK_3: 'https://ing.example/pay/3',
      ING_PAYMENT_LINK_4: 'https://ing.example/pay/4',
      ING_PAYMENT_LINK_5: 'https://ing.example/pay/5',
    };

    for (const quantity of [1, 2, 3, 4, 5]) {
      const response = await app.request('/api/reservations/HP9-1234-ABCD/token123', {}, {
        FRONTEND_URL: 'https://example.github.io/hpn-ticket-service',
        DB: createReservationDb({
          ...reservation,
          quantity,
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
        ...paymentLinks,
      } as never);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        quantity,
        paymentLink: Object.values(paymentLinks)[quantity - 1],
      }));
    }
  });

  it('returns a 503 when the payment link for the reservation quantity is not configured', async () => {
    const response = await app.request('/api/reservations/HP9-1234-ABCD/token123', {}, {
      FRONTEND_URL: 'https://example.github.io/hpn-ticket-service',
      DB: createReservationDb({
        ...reservation,
        quantity: 4,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Payment link for 4 ticket(s) is not configured',
    });
  });

  it('returns an expired reservation without requiring a payment link', async () => {
    const response = await app.request('/api/reservations/HP9-1234-ABCD/token123', {}, {
      FRONTEND_URL: 'https://example.github.io/hpn-ticket-service',
      DB: createReservationDb({ ...reservation, quantity: 4 }),
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      status: 'EXPIRED',
      expired: true,
      paymentLink: null,
    }));
  });
});
