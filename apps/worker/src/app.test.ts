import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

vi.stubEnv('DATABASE_PATH', ':memory:');
vi.stubEnv('MOCK_GOOGLE_LOGIN', 'true');
vi.stubEnv('MOCK_GOOGLE_EMAIL', 'dorienmc@gmail.com');
vi.stubEnv('ADMIN_ALLOWED_EMAILS', 'admin@example.com');
vi.stubEnv('FRONTEND_URL', 'http://localhost:5173/hpn-ticket-service/');

const { app } = await import('./app.js');
const { config } = await import('./config.js');
const { getDb } = await import('./db.js');
const { allowedMockAdminEmails, saveMockAdminEmails } = await import('./mock-admin-access.js');

let server: Server;
let baseUrl: string;
const ownerEmail = 'dorienmc@gmail.com';

beforeAll(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  getDb().exec('DELETE FROM admin_access_settings; DELETE FROM admin_access_audit');
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  getDb().close();
  vi.unstubAllEnvs();
});

async function login(email = ownerEmail): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/google?email=${encodeURIComponent(email)}`, { redirect: 'manual' });
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe('http://localhost:5173/hpn-ticket-service/admin');
  return response.headers.get('set-cookie')!.split(';')[0];
}

function accessRequest(cookie: string, body: unknown, origin = 'http://localhost:5173') {
  return fetch(`${baseUrl}/api/admin/access`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Express mock admin access', () => {
  it('exposes owner permissions only for an email-specific owner session', async () => {
    const owner = await login();
    const other = await login('admin@example.com');
    expect(owner).not.toBe(other);
    const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: owner } });
    expect(await session.json()).toEqual({ authenticated: true, provider: 'google', canManageAdminEmails: true });
    const otherSession = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: other } });
    expect(await otherSession.json()).toEqual({ authenticated: true, provider: 'google' });
    const access = await fetch(`${baseUrl}/api/admin/access`, { headers: { Cookie: owner } });
    expect(await access.json()).toEqual({ ownerEmail, emails: [ownerEmail, 'admin@example.com'] });
  });

  it('persists normalized updates and audit records in SQLite and allows new mock logins', async () => {
    const owner = await login();
    const response = await accessRequest(owner, { emails: [ownerEmail, ' NEW@Example.com ', 'new@example.com'] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ownerEmail, emails: [ownerEmail, 'new@example.com'] });
    expect(allowedMockAdminEmails()).toEqual([ownerEmail, 'new@example.com']);
    expect(getDb().prepare('SELECT actor_email, emails FROM admin_access_audit').all()).toEqual([
      { actor_email: ownerEmail, emails: JSON.stringify([ownerEmail, 'new@example.com']) },
    ]);
    await login('new@example.com');
  });

  it('revokes existing sessions and new logins when an admin is removed', async () => {
    const owner = await login();
    const other = await login('admin@example.com');
    expect((await accessRequest(owner, { emails: [ownerEmail] })).status).toBe(200);
    const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: other } });
    expect(await session.json()).toEqual({ authenticated: false, provider: 'google' });
    expect((await fetch(`${baseUrl}/api/admin/orders`, { headers: { Cookie: other } })).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/auth/google?email=admin@example.com`, { redirect: 'manual' })).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/admin/access`, { headers: { Cookie: owner } })).status).toBe(200);
  });

  it('blocks non-owner, unauthenticated, legacy and forged sessions', async () => {
    const other = await login('admin@example.com');
    expect((await fetch(`${baseUrl}/api/admin/access`, { headers: { Cookie: other } })).status).toBe(403);
    expect((await accessRequest(other, { emails: [ownerEmail] })).status).toBe(403);
    for (const cookie of ['', 'hpn_mock_google_admin=authenticated', 'hpn_mock_google_admin=forged']) {
      expect((await accessRequest(cookie, { emails: [ownerEmail] })).status).toBe(401);
    }
    expect(getDb().prepare('SELECT * FROM admin_access_audit').all()).toEqual([]);
  });

  it('rejects empty, invalid and owner-removing lists and malformed JSON without saving', async () => {
    const owner = await login();
    for (const emails of [[], ['other@example.com'], [ownerEmail, 'invalid'], [42], Array(101).fill(ownerEmail)]) {
      expect((await accessRequest(owner, { emails })).status).toBe(400);
    }
    const response = await fetch(`${baseUrl}/api/admin/access`, {
      method: 'POST',
      headers: { Cookie: owner, Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: '{',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON request' });
    expect(getDb().prepare('SELECT * FROM admin_access_settings').all()).toEqual([]);
    expect(getDb().prepare('SELECT * FROM admin_access_audit').all()).toEqual([]);
  });

  it('requires the configured frontend origin for changes', async () => {
    const owner = await login();
    for (const origin of ['https://attacker.example', '', 'not-a-url']) {
      expect((await accessRequest(owner, { emails: [ownerEmail] }, origin)).status).toBe(403);
    }
    expect(getDb().prepare('SELECT * FROM admin_access_audit').all()).toEqual([]);
  });

  it('expires sessions and invalidates them on logout', async () => {
    const cookie = await login();
    const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });
    expect(logout.status).toBe(204);
    expect((await accessRequest(cookie, { emails: [ownerEmail] })).status).toBe(401);
    const expiring = await login();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 12 * 60 * 60 * 1000 + 1);
    expect((await accessRequest(expiring, { emails: [ownerEmail] })).status).toBe(401);
  });

  it('fails closed when mocks are disabled', async () => {
    const cookie = await login();
    const original = config.mockGoogleLogin;
    config.mockGoogleLogin = false;
    try {
      expect((await fetch(`${baseUrl}/api/auth/google`, { redirect: 'manual' })).status).toBe(404);
      expect((await accessRequest(cookie, { emails: [ownerEmail] })).status).toBe(401);
    } finally {
      config.mockGoogleLogin = original;
    }
  });

  it('does not allow anyone except the owner when the initial list is empty', () => {
    const original = config.adminAllowedEmails;
    config.adminAllowedEmails = [];
    try {
      expect(allowedMockAdminEmails()).toEqual([ownerEmail]);
    } finally {
      config.adminAllowedEmails = original;
    }
  });

  it('rolls back the allowlist if the audit write fails', () => {
    const db = getDb();
    db.exec("CREATE TRIGGER fail_admin_access_audit BEFORE INSERT ON admin_access_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
    try {
      expect(() => saveMockAdminEmails([ownerEmail])).toThrow('audit unavailable');
      expect(db.prepare('SELECT * FROM admin_access_settings').all()).toEqual([]);
    } finally {
      db.exec('DROP TRIGGER fail_admin_access_audit');
    }
  });
});
