import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ReservationRecord, TicketRecord } from './types.js';

type Bindings = {
  DB: D1Database;
  FRONTEND_URL: string;
  ING_PAYMENT_LINK: string;
  RESEND_API_KEY: string;
  RESEND_FROM_EMAIL: string;
  EMAIL_DELIVERY?: 'resend' | 'gmail' | 'mailpit' | 'disabled';
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  GMAIL_FROM_EMAIL?: string;
  MAILPIT_API_URL?: string;
  LOCAL_ADMIN_AUTH?: string;
  TOTAL_CAPACITY?: string;
  MAX_TICKETS_PER_RESERVATION?: string;
  TICKET_PRICE_CENTS?: string;
  RESERVATION_TTL_HOURS?: string;
};

const app = new Hono<{ Bindings: Bindings }>();
const localAdminCookie = 'hpn_local_admin=authenticated';

function hasAccessSession(headers: Headers): boolean {
  if (headers.get('Cf-Access-Authenticated-User-Email')) return true;
  return /(?:^|;\s*)CF_Authorization=/.test(headers.get('Cookie') ?? '');
}

function hasLocalAdminSession(env: Bindings, headers: Headers): boolean {
  return env.LOCAL_ADMIN_AUTH === 'true' && (headers.get('Cookie') ?? '').split(';')
    .some((cookie) => cookie.trim() === localAdminCookie);
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function orderNumber(): string {
  return `HP9-${Date.now().toString().slice(-8)}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

function accessToken(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

function ticketCode(): string {
  return `HP9-TKT-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
}

function addHours(date: Date, hours: number): string {
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function expireReservations(db: D1Database): Promise<void> {
  await db.prepare(`UPDATE orders SET status = 'EXPIRED' WHERE status = 'RESERVED' AND expires_at <= ?`)
    .bind(new Date().toISOString()).run();
}

async function availableCapacity(env: Bindings): Promise<number> {
  const result = await env.DB.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS active_quantity
    FROM orders
    WHERE status = 'PAID' OR (status = 'RESERVED' AND expires_at > ?)
  `).bind(new Date().toISOString()).first<{ active_quantity: number }>();
  return numberFromEnv(env.TOTAL_CAPACITY, 100) - Number(result?.active_quantity ?? 0);
}

async function ticketsForOrder(db: D1Database, value: string): Promise<TicketRecord[]> {
  const result = await db.prepare(`
    SELECT tickets.* FROM tickets
    INNER JOIN orders ON orders.id = tickets.order_id
    WHERE orders.order_number = ? ORDER BY tickets.id ASC
  `).bind(value).all<TicketRecord>();
  return result.results;
}

async function sendReservationEmail(env: Bindings, reservation: ReservationRecord): Promise<void> {
  if (env.EMAIL_DELIVERY === 'disabled') return;

  const paymentUrl = `${env.FRONTEND_URL}/payment/${reservation.order_number}/${reservation.access_token}`;
  const amountEuros = (reservation.amount_cents / 100).toFixed(2);
  const subject = `Je reservering voor Half Past Nine (${reservation.order_number})`;
  const html = `<h2>Bedankt, ${reservation.name}!</h2><p>Je reservering voor ${reservation.quantity} ticket(s) is aangemaakt.</p><p><strong>Ordernummer:</strong> ${reservation.order_number}</p><p><strong>Bedrag:</strong> €${amountEuros}</p><p><a href="${paymentUrl}">Open je reserveringspagina</a></p>`;

  if (env.EMAIL_DELIVERY === 'mailpit') {
    const response = await fetch(`${env.MAILPIT_API_URL ?? 'http://mailpit:8025'}/api/v1/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        From: { Email: 'noreply@halfpastnine.test', Name: 'Half Past Nine' },
        To: [{ Email: reservation.email, Name: reservation.name }],
        Subject: subject,
        HTML: html,
      }),
    });
    if (!response.ok) throw new Error(`Mailpit rejected the email (${response.status})`);
    return;
  }

  if (env.EMAIL_DELIVERY === 'gmail') {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GMAIL_CLIENT_ID ?? '',
        client_secret: env.GMAIL_CLIENT_SECRET ?? '',
        refresh_token: env.GMAIL_REFRESH_TOKEN ?? '',
        grant_type: 'refresh_token',
      }),
    });
    const tokenPayload = await tokenResponse.json<{ access_token?: string; error_description?: string }>();
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      throw new Error(tokenPayload.error_description || `Gmail token request failed (${tokenResponse.status})`);
    }

    const mime = [
      'MIME-Version: 1.0',
      `From: ${sanitizeHeader(env.GMAIL_FROM_EMAIL ?? '')}`,
      `To: ${sanitizeHeader(reservation.email)}`,
      `Subject: ${sanitizeHeader(subject)}`,
      'Content-Type: text/html; charset=UTF-8',
      '',
      html,
    ].join('\r\n');

    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenPayload.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: base64UrlEncode(mime) }),
    });
    if (!response.ok) throw new Error(`Gmail rejected the email (${response.status})`);
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [reservation.email],
      subject,
      html,
    }),
  });
  if (!response.ok) throw new Error(`Resend rejected the email (${response.status})`);
}

app.use('/api/*', async (context, next) => cors({
  origin: context.env.FRONTEND_URL,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Cf-Access-Authenticated-User-Email'],
  credentials: true,
})(context, next));

app.use('/api/admin/*', async (context, next) => {
  if (!context.req.header('Cf-Access-Authenticated-User-Email') && !hasLocalAdminSession(context.env, context.req.raw.headers)) {
    return context.json({ error: 'Admin authentication required' }, 401);
  }
  await next();
});

app.get('/api/health', (context) => context.json({ ok: true, status: 'healthy' }));
app.get('/api/auth/session', (context) => context.json({
  authenticated: hasAccessSession(context.req.raw.headers) || hasLocalAdminSession(context.env, context.req.raw.headers),
  provider: context.env.LOCAL_ADMIN_AUTH === 'true' ? 'local' : 'cloudflare-access',
}));
app.get('/api/auth/google', (context) => {
  if (context.env.LOCAL_ADMIN_AUTH === 'true') {
    context.header('Set-Cookie', `${localAdminCookie}; Path=/; HttpOnly; SameSite=Lax`);
  }
  return context.redirect(`${context.env.FRONTEND_URL}/admin`);
});
app.post('/api/auth/logout', (context) => {
  if (context.env.LOCAL_ADMIN_AUTH === 'true') {
    context.header('Set-Cookie', 'hpn_local_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return context.body(null, 204);
  }
  return context.json({ logoutUrl: `${new URL(context.req.url).origin}/cdn-cgi/access/logout` });
});

app.get('/api/capacity', async (context) => {
  await expireReservations(context.env.DB);
  return context.json({
    totalCapacity: numberFromEnv(context.env.TOTAL_CAPACITY, 100),
    available: await availableCapacity(context.env),
  });
});

app.post('/api/reservations', async (context) => {
  try {
    const body = await context.req.json<{ name?: string; email?: string; quantity?: number }>();
    const name = body.name?.trim() ?? '';
    const email = body.email?.trim().toLowerCase() ?? '';
    const quantity = Number(body.quantity);
    const maximum = numberFromEnv(context.env.MAX_TICKETS_PER_RESERVATION, 5);
    if (!name || !email || !Number.isInteger(quantity) || quantity < 1 || quantity > maximum) {
      return context.json({ error: `Quantity must be between 1 and ${maximum}` }, 400);
    }

    await expireReservations(context.env.DB);
    if (quantity > await availableCapacity(context.env)) {
      return context.json({ error: 'Not enough tickets available' }, 400);
    }

    const now = new Date();
    const values = {
      orderNumber: orderNumber(),
      token: accessToken(),
      name,
      email,
      quantity,
      amountCents: quantity * numberFromEnv(context.env.TICKET_PRICE_CENTS, 1000),
      createdAt: now.toISOString(),
      expiresAt: addHours(now, numberFromEnv(context.env.RESERVATION_TTL_HOURS, 48)),
    };
    const reservation = await context.env.DB.prepare(`
      INSERT INTO orders (order_number, access_token, name, email, quantity, amount_cents, status, created_at, expires_at, paid_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?, NULL, NULL) RETURNING *
    `).bind(values.orderNumber, values.token, values.name, values.email, values.quantity, values.amountCents, values.createdAt, values.expiresAt)
      .first<ReservationRecord>();
    if (!reservation) throw new Error('Reservation could not be stored');

    await sendReservationEmail(context.env, reservation);
    return context.json({
      orderNumber: reservation.order_number,
      status: reservation.status,
      expiresAt: reservation.expires_at,
      paymentUrl: `${context.env.FRONTEND_URL}/payment/${reservation.order_number}/${reservation.access_token}`,
      available: await availableCapacity(context.env),
    }, 201);
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : 'Unable to create reservation' }, 400);
  }
});

app.get('/api/reservations/:orderNumber/:token', async (context) => {
  await expireReservations(context.env.DB);
  const reservation = await context.env.DB.prepare('SELECT * FROM orders WHERE order_number = ? AND access_token = ?')
    .bind(context.req.param('orderNumber'), context.req.param('token')).first<ReservationRecord>();
  if (!reservation) return context.json({ error: 'Reservation not found' }, 404);
  return context.json({
    orderNumber: reservation.order_number,
    name: reservation.name,
    email: reservation.email,
    quantity: reservation.quantity,
    amountCents: reservation.amount_cents,
    status: reservation.status,
    createdAt: reservation.created_at,
    expiresAt: reservation.expires_at,
    expired: reservation.status === 'EXPIRED',
    paymentLink: context.env.ING_PAYMENT_LINK,
    tickets: reservation.status === 'PAID' ? await ticketsForOrder(context.env.DB, reservation.order_number) : [],
  });
});

app.get('/api/admin/summary', async (context) => {
  await expireReservations(context.env.DB);
  const rows = await context.env.DB.prepare('SELECT status, COUNT(*) AS count FROM orders GROUP BY status')
    .all<{ status: string; count: number }>();
  const summary: Record<string, number> = {
    total: 0,
    totalCapacity: numberFromEnv(context.env.TOTAL_CAPACITY, 100),
    reserved: 0,
    paid: 0,
    available: await availableCapacity(context.env),
    expired: 0,
    cancelled: 0,
  };
  for (const row of rows.results) {
    summary.total += row.count;
    const key = row.status.toLowerCase();
    if (key in summary) summary[key] = row.count;
  }
  return context.json(summary);
});

app.get('/api/admin/orders', async (context) => {
  await expireReservations(context.env.DB);
  const result = await context.env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC').all<ReservationRecord>();
  const orders = await Promise.all(result.results.map(async (order: ReservationRecord) => ({
    ...order,
    tickets: await ticketsForOrder(context.env.DB, order.order_number),
  })));
  return context.json({ orders });
});

app.post('/api/admin/orders/:orderNumber/pay', async (context) => {
  const value = context.req.param('orderNumber');
  const reservation = await context.env.DB.prepare('SELECT * FROM orders WHERE order_number = ?')
    .bind(value).first<ReservationRecord>();
  if (!reservation) return context.json({ error: 'Order not found' }, 404);

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    context.env.DB.prepare("UPDATE orders SET status = 'PAID', paid_at = ? WHERE order_number = ?").bind(now, value),
  ];
  const existing = await context.env.DB.prepare('SELECT COUNT(*) AS count FROM tickets WHERE order_id = ?')
    .bind(reservation.id).first<{ count: number }>();
  if (Number(existing?.count ?? 0) === 0) {
    for (let index = 0; index < reservation.quantity; index += 1) {
      statements.push(context.env.DB.prepare(`INSERT INTO tickets (order_id, ticket_code, status, created_at, used_at) VALUES (?, ?, 'VALID', ?, NULL)`)
        .bind(reservation.id, ticketCode(), now));
    }
  }
  await context.env.DB.batch(statements);
  return context.json({ orderNumber: value, status: 'PAID', paidAt: now });
});

app.post('/api/admin/orders/:orderNumber/cancel', async (context) => {
  const value = context.req.param('orderNumber');
  const result = await context.env.DB.prepare("UPDATE orders SET status = 'CANCELLED' WHERE order_number = ? AND status = 'RESERVED'")
    .bind(value).run();
  if (!result.meta.changes) return context.json({ error: 'Only active reserved orders can be cancelled' }, 400);
  return context.json({ orderNumber: value, status: 'CANCELLED' });
});

app.post('/api/admin/orders/:orderNumber/extend', async (context) => {
  const { hours = 24 } = await context.req.json<{ hours?: number }>();
  const reservation = await context.env.DB.prepare("SELECT * FROM orders WHERE order_number = ? AND status = 'RESERVED'")
    .bind(context.req.param('orderNumber')).first<ReservationRecord>();
  if (!reservation || !Number.isInteger(hours) || hours < 1 || new Date(reservation.expires_at) <= new Date()) {
    return context.json({ error: 'Only active reserved orders can be extended with a positive whole number of hours' }, 400);
  }
  const expiresAt = addHours(new Date(reservation.expires_at), hours);
  await context.env.DB.prepare('UPDATE orders SET expires_at = ? WHERE id = ?').bind(expiresAt, reservation.id).run();
  return context.json({ orderNumber: reservation.order_number, status: reservation.status, expiresAt });
});

app.post('/api/admin/orders/:orderNumber/resend', async (context) => {
  const reservation = await context.env.DB.prepare('SELECT * FROM orders WHERE order_number = ?')
    .bind(context.req.param('orderNumber')).first<ReservationRecord>();
  if (!reservation) return context.json({ error: 'Order not found' }, 404);
  await sendReservationEmail(context.env, reservation);
  return context.json({ orderNumber: reservation.order_number, email: reservation.email });
});

app.post('/api/admin/tickets/:ticketCode/use', async (context) => {
  const result = await context.env.DB.prepare("UPDATE tickets SET status = 'USED', used_at = ? WHERE ticket_code = ? AND status = 'VALID' RETURNING *")
    .bind(new Date().toISOString(), context.req.param('ticketCode')).first<TicketRecord>();
  if (!result) return context.json({ error: 'Ticket does not exist or has already been used' }, 400);
  return context.json({ ticketCode: result.ticket_code, status: result.status, usedAt: result.used_at });
});

export { app, base64UrlEncode, sendReservationEmail };
export default app;
