import { expect, test, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const api = process.env.E2E_API_URL || 'http://localhost:8789';
const origin = 'http://localhost:5180';

function executeSql(sql: string) {
  if (!process.env.E2E_STATE_DIR) throw new Error('Isolated D1 test state is not configured');
  const output = execFileSync(process.execPath, [
    resolve('apps/worker/node_modules/wrangler/bin/wrangler.js'),
    'd1', 'execute', 'hpn-ticket-service-prod', '--local', '--config', 'wrangler.local.jsonc',
    '--persist-to', process.env.E2E_STATE_DIR, '--command', sql, '--json',
  ], {
    cwd: resolve('apps/worker'),
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
    encoding: 'utf8',
  });
  return JSON.parse(output)[0].results;
}

async function reserve(request: APIRequestContext, quantity: number) {
  const response = await request.post(`${api}/api/reservations`, {
    data: { name: 'Worker API Customer', email: `api-${Date.now()}@example.com`, quantity },
  });
  expect(response.status()).toBe(201);
  const reservation = await response.json();
  const detail = await request.get(reservation.paymentUrl.replace(origin, api).replace('/hpn-ticket-service/payment/', '/api/reservations/'));
  expect(detail.ok()).toBeTruthy();
  return { ...reservation, detail: await detail.json() };
}

async function login(request: APIRequestContext) {
  expect((await request.get(`${api}/api/auth/google`, { maxRedirects: 0 })).status()).toBe(302);
}

function mutate(request: APIRequestContext, order: string, action: string, data = {}) {
  return request.post(`${api}/api/admin/orders/${order}/${action}`, { headers: { Origin: origin }, data });
}

test('creates valid reservations with secure identifiers, correct quantity and amount (former service test)', async ({ request }) => {
  const order = await reserve(request, 2);
  expect(order.orderNumber).toMatch(/^HP9-/);
  expect(new URL(order.paymentUrl).pathname.split('/').at(-1)!.length).toBeGreaterThan(20);
  expect(order.status).toBe('RESERVED');
  expect(order.detail.amountCents).toBe(2000);
  expect(order.detail.quantity).toBe(2);
});

test('reservation emails omit PDFs while payment and resend emails attach PDFs for the same tickets', async ({ request }) => {
  const order = await reserve(request, 2);
  const mailUrl = `${process.env.E2E_MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${order.detail.email}`)}`;
  const readMail = async () => {
    const response = await request.get(mailUrl);
    expect(response.ok()).toBeTruthy();
    return (await response.json()).messages;
  };
  const reservationMail = await readMail();
  expect(reservationMail).toHaveLength(1);
  expect(reservationMail[0].Attachments).toBeUndefined();
  await login(request);
  expect((await mutate(request, order.orderNumber, 'pay')).ok()).toBeTruthy();
  const paidMail = await readMail();
  expect(paidMail).toHaveLength(2);
  expect((await mutate(request, order.orderNumber, 'resend')).ok()).toBeTruthy();
  const resentMail = await readMail();
  expect(resentMail).toHaveLength(3);
  const details = await request.get(order.paymentUrl.replace(origin, api).replace('/hpn-ticket-service/payment/', '/api/reservations/'));
  const tickets = (await details.json()).tickets;
  for (const mail of [paidMail[1], resentMail[2]]) {
    expect(mail.Subject).toContain('Je tickets');
    expect(mail.Attachments).toHaveLength(1);
    expect(mail.Attachments[0].Filename).toBe(`tickets-${order.orderNumber}.pdf`);
    expect(mail.Attachments[0].ContentType).toBe('application/pdf');
    expect(Buffer.from(mail.Attachments[0].Content, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    for (const ticket of tickets) {
      expect(mail.HTML).toContain(`${order.paymentUrl}#ticket-${encodeURIComponent(ticket.ticket_code)}`);
    }
  }
});

test('rejects invalid quantities and accepts the supported maximum (former quantity tests)', async ({ request }) => {
  for (const quantity of [0, 6, 2.5]) {
    const response = await request.post(`${api}/api/reservations`, {
      data: { name: 'Invalid', email: 'invalid@example.com', quantity },
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: 'Quantity must be between 1 and 5' });
  }
  expect((await reserve(request, 5)).detail.quantity).toBe(5);
});

test('calculates capacity from active reservations (former capacity test)', async ({ request }) => {
  const before = await (await request.get(`${api}/api/capacity`)).json();
  await reserve(request, 5);
  await reserve(request, 4);
  const after = await (await request.get(`${api}/api/capacity`)).json();
  expect(after.available).toBe(before.available - 9);
});

test('expires stale reservations and releases their capacity (former expiry test)', async ({ request }) => {
  const before = await (await request.get(`${api}/api/capacity`)).json();
  const order = await reserve(request, 3);
  executeSql(`UPDATE orders SET expires_at = '2000-01-01T00:00:00.000Z' WHERE order_number = '${order.orderNumber}'`);
  const detailUrl = order.paymentUrl.replace(origin, api).replace('/hpn-ticket-service/payment/', '/api/reservations/');
  const detail = await (await request.get(detailUrl)).json();
  expect(detail.status).toBe('EXPIRED');
  expect((await (await request.get(`${api}/api/capacity`)).json()).available).toBe(before.available);
});

test('deletes an expired order from the admin archive', async ({ request, page }) => {
  const order = await reserve(request, 1);
  executeSql(`UPDATE orders SET expires_at = '2000-01-01T00:00:00.000Z' WHERE order_number = '${order.orderNumber}'`);

  await page.goto(`${api}/api/auth/google?email=${encodeURIComponent('dorienmc@gmail.com')}`);
  await expect(page).toHaveURL(/\/hpn-ticket-service\/admin$/);
  await expect(page.getByRole('heading', { name: 'Overzicht reserveringen' })).toBeVisible();
  await page.getByRole('link', { name: 'Verlopen / geannuleerd' }).click();

  const orderRow = page.getByRole('row').filter({ hasText: order.orderNumber });
  await expect(orderRow).toContainText('Verlopen');
  page.once('dialog', (dialog) => dialog.accept());
  await orderRow.getByRole('button', { name: 'Verwijder order' }).click();
  await expect(orderRow).toHaveCount(0);
});

test('lists orders, pays idempotently, creates unique tickets and checks in once (former paid-order test)', async ({ request }) => {
  const order = await reserve(request, 3);
  await login(request);
  const before = await (await request.get(`${api}/api/admin/summary`)).json();
  const listed = await (await request.get(`${api}/api/admin/orders`)).json();
  expect(listed.orders.some((entry: { order_number: string }) => entry.order_number === order.orderNumber)).toBe(true);
  for (let index = 0; index < 2; index += 1) {
    const paid = await mutate(request, order.orderNumber, 'pay');
    expect(paid.ok()).toBeTruthy();
    expect(await paid.json()).toMatchObject({ status: 'PAID' });
  }
  const detailUrl = order.paymentUrl.replace(origin, api).replace('/hpn-ticket-service/payment/', '/api/reservations/');
  const detail = await (await request.get(detailUrl)).json();
  expect(detail.tickets).toHaveLength(3);
  expect(new Set(detail.tickets.map((ticket: { ticket_code: string }) => ticket.ticket_code)).size).toBe(3);
  expect(detail.tickets.every((ticket: { status: string }) => ticket.status === 'VALID')).toBe(true);
  const useUrl = `${api}/api/admin/tickets/${detail.tickets[0].ticket_code}/use`;
  const used = await request.post(useUrl, { headers: { Origin: origin } });
  expect(await used.json()).toMatchObject({ status: 'USED' });
  expect((await request.post(useUrl, { headers: { Origin: origin } })).status()).toBe(400);
  const summary = await (await request.get(`${api}/api/admin/summary`)).json();
  expect(summary.total).toBe(before.total);
  expect(summary.paid).toBe(before.paid + 3);
});

test('cancels only reserved orders and releases capacity (former cancellation test)', async ({ request }) => {
  const before = await (await request.get(`${api}/api/capacity`)).json();
  const order = await reserve(request, 4);
  await login(request);
  const cancelled = await mutate(request, order.orderNumber, 'cancel');
  expect(await cancelled.json()).toMatchObject({ status: 'CANCELLED' });
  expect((await (await request.get(`${api}/api/capacity`)).json()).available).toBe(before.available);
  expect((await mutate(request, order.orderNumber, 'cancel')).status()).toBe(400);
});

test('extends from current expiry and rejects missing orders (former extension test)', async ({ request }) => {
  const order = await reserve(request, 1);
  await login(request);
  const extended = await mutate(request, order.orderNumber, 'extend', { hours: 24 });
  const payload = await extended.json();
  expect(payload.status).toBe('RESERVED');
  expect(new Date(payload.expiresAt).getTime()).toBe(new Date(order.expiresAt).getTime() + 24 * 60 * 60 * 1000);
  expect((await mutate(request, 'missing-order', 'extend', { hours: 24 })).status()).toBe(400);
});

test('persists admin audit records and atomically rolls back on audit failure (former SQLite tests)', async ({ request }) => {
  await login(request);
  const initial = await (await request.get(`${api}/api/admin/access`)).json();
  const emails = [...new Set([...initial.emails, 'audit-test@example.com'])];
  const save = () => request.post(`${api}/api/admin/access`, { headers: { Origin: origin }, data: { emails } });
  expect((await save()).ok()).toBeTruthy();
  const audit = executeSql('SELECT actor_email, emails FROM admin_access_audit ORDER BY id DESC LIMIT 1');
  expect(audit[0]).toEqual({ actor_email: 'dorienmc@gmail.com', emails: JSON.stringify(emails) });
  await request.post(`${api}/api/admin/access`, { headers: { Origin: origin }, data: { emails: initial.emails } });
  executeSql("CREATE TRIGGER fail_admin_access_audit BEFORE INSERT ON admin_access_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
  try {
    expect((await save()).status()).toBe(500);
    expect((await (await request.get(`${api}/api/admin/access`)).json()).emails).toEqual(initial.emails);
  } finally {
    executeSql('DROP TRIGGER fail_admin_access_audit');
  }
});

test('logout invalidates the original session and permits a fresh login (former mock session test)', async ({ request, playwright }) => {
  await login(request);
  const replay = await playwright.request.newContext({ storageState: await request.storageState() });
  try {
    expect((await request.post(`${api}/api/auth/logout`, { headers: { Origin: origin } })).status()).toBe(204);
    expect((await replay.get(`${api}/api/admin/orders`)).status()).toBe(401);
    await login(request);
    expect((await request.get(`${api}/api/admin/orders`)).ok()).toBeTruthy();
  } finally {
    await replay.dispose();
  }
});
