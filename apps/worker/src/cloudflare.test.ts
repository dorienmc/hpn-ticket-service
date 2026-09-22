import { describe, expect, it } from 'vitest';
import { app } from './cloudflare.js';

const env = {
  FRONTEND_URL: 'https://example.github.io/hpn-ticket-service',
} as never;

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
});