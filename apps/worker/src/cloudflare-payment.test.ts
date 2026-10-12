import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { DatabaseSync as SQLiteDatabase, SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from './cloudflare.js';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const databases: SQLiteDatabase[] = [];
const orderNumber = 'HP9-PAYMENT-TEST';
const originalPaidAt = '2026-09-23T11:00:00.000Z';

function createPaymentDb(quantity: number, status = 'RESERVED') {
  const sqlite = new DatabaseSync(':memory:');
  databases.push(sqlite);
  for (const migration of ['0001_initial.sql', '0002_admin_access.sql', '0003_admin_session_revocations.sql']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  }
  sqlite.prepare(`INSERT INTO orders
    (order_number, access_token, name, email, quantity, amount_cents, status, created_at, expires_at, paid_at)
    VALUES (?, 'token', 'Test Customer', 'customer@example.com', ?, ?, ?, '2026-09-23T10:00:00.000Z', '', ?)`)
    .run(orderNumber, quantity, quantity * 1000, status, status === 'PAID' ? originalPaidAt : null);

  let beforeBatch: (() => Promise<void>) | undefined;
  function prepare(sql: string, args: SQLInputValue[] = []) {
    return {
      bind(...values: SQLInputValue[]) {
        return prepare(sql, values);
      },
      async first() {
        return sqlite.prepare(sql).get(...args) ?? null;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...args) };
      },
      run() {
        return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } };
      },
    };
  }
  const db = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      await beforeBatch?.();
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return {
    sqlite,
    db,
    setBeforeBatch(callback: () => Promise<void>) {
      beforeBatch = callback;
    },
  };
}

async function paymentClient(database: ReturnType<typeof createPaymentDb>) {
  const bindings = {
    FRONTEND_URL: 'https://example.github.io/hpn-ticket-service',
    EMAIL_DELIVERY: 'mailpit',
    MAILPIT_API_URL: 'http://mailpit:8025',
    ADMIN_PASSWORD: 'test-admin-password',
    DB: database.db,
  } as never;
  const login = await app.request('/api/auth/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-admin-password' }),
  }, bindings);
  expect(login.status).toBe(200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  return () => app.request(`/api/admin/orders/${orderNumber}/pay`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: 'https://example.github.io' },
  }, bindings);
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  vi.restoreAllMocks();
});

describe('Atomic payment ticket issuance', () => {
  it.each([1, 2, 5])('issues exactly %i tickets and one email for concurrent payment requests', async (quantity) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 202 }));
    const database = createPaymentDb(quantity);
    const pay = await paymentClient(database);
    let batches = 0;
    let release!: () => void;
    const bothRequestsReady = new Promise<void>((resolve) => { release = resolve; });
    database.setBeforeBatch(async () => {
      batches += 1;
      if (batches === 2) release();
      await bothRequestsReady;
    });

    const responses = await Promise.all([pay(), pay()]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    expect(bodies[0]).toEqual(bodies[1]);
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count, COUNT(DISTINCT ticket_code) AS unique_count FROM tickets').get())
      .toMatchObject({ count: quantity, unique_count: quantity });
    const order = database.sqlite.prepare('SELECT status, paid_at FROM orders').get();
    expect(order).toMatchObject({ status: 'PAID', paid_at: expect.any(String) });
    expect(bodies[0]).toMatchObject({ paidAt: order?.paid_at });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).HTML.match(/Bekijk dit ticket/g)).toHaveLength(quantity);

    database.setBeforeBatch(async () => {});
    const retry = await pay();
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(bodies[0]);
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM tickets').get()).toMatchObject({ count: quantity });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves existing used tickets and the original payment timestamp', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const database = createPaymentDb(2, 'PAID');
    database.sqlite.exec(`INSERT INTO tickets (order_id, ticket_code, status, created_at, used_at)
      VALUES (1, 'USED-TICKET', 'USED', '${originalPaidAt}', '${originalPaidAt}'),
             (1, 'VALID-TICKET', 'VALID', '${originalPaidAt}', NULL)`);
    const tickets = database.sqlite.prepare('SELECT * FROM tickets').all();
    const response = await (await paymentClient(database))();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ orderNumber, status: 'PAID', paidAt: originalPaidAt });
    expect(database.sqlite.prepare('SELECT * FROM tickets').all()).toEqual(tickets);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('still repairs an already-paid order with no tickets without resending email', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const database = createPaymentDb(2, 'PAID');
    const response = await (await paymentClient(database))();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ paidAt: originalPaidAt });
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM tickets').get()).toMatchObject({ count: 2 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['CANCELLED', 'EXPIRED'])('does not issue tickets or resurrect an order concurrently changed to %s', async (status) => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const database = createPaymentDb(2);
    const pay = await paymentClient(database);
    database.setBeforeBatch(async () => {
      database.sqlite.prepare('UPDATE orders SET status = ?').run(status);
    });
    const response = await pay();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Order could not be marked paid: its status changed' });
    expect(database.sqlite.prepare('SELECT status, paid_at FROM orders').get()).toMatchObject({ status, paid_at: null });
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM tickets').get()).toMatchObject({ count: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rolls back ticket issuance if the payment transition fails', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const database = createPaymentDb(2);
    database.sqlite.exec(`CREATE TRIGGER fail_payment BEFORE UPDATE ON orders
      WHEN NEW.status = 'PAID' BEGIN SELECT RAISE(ABORT, 'Payment transition failed'); END`);
    const response = await (await paymentClient(database))();
    expect(response.status).toBe(500);
    expect(database.sqlite.prepare('SELECT status, paid_at FROM orders').get()).toMatchObject({ status: 'RESERVED', paid_at: null });
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM tickets').get()).toMatchObject({ count: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
