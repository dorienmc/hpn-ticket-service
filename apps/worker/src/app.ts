import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { cancelReservation, createReservation, expireReservations, extendReservation, findReservationByToken, getAvailableCapacity, getReservationStatusSummary, listOrders, listTickets, markOrderPaid, markTicketUsed } from './services.js';
import { sendReservationEmail } from './email.js';
import { paymentLinkFor } from './payment-links.js';
import { adminOwnerEmail, validateAdminEmails } from './admin-access.js';
import { allowedMockAdminEmails, saveMockAdminEmails } from './mock-admin-access.js';

export const app = express();

function frontendOrigin(): string {
  return new URL(process.env.FRONTEND_URL || 'http://localhost:5173/hpn-ticket-service').origin;
}

function frontendUrl(path: string): string {
  const frontendBaseUrl = process.env.FRONTEND_URL || 'http://localhost:5173/hpn-ticket-service';
  return `${frontendBaseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
const mockAdminCookieName = 'hpn_mock_google_admin';
const mockSessions = new Map<string, { email: string; expiresAt: number }>();
const mockSessionTtlMs = 12 * 60 * 60 * 1000;

app.use(cors({ origin: frontendOrigin(), credentials: true }));
app.use(express.json());

function sessionToken(req: Request): string | undefined {
  return req.headers.cookie?.split(';').map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${mockAdminCookieName}=`))?.slice(mockAdminCookieName.length + 1);
}

function mockSessionEmail(req: Request): string | null {
  if (!config.mockGoogleLogin) return null;
  const token = sessionToken(req);
  if (!token) return null;
  const session = mockSessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    mockSessions.delete(token);
    return null;
  }
  return allowedMockAdminEmails().includes(session.email) ? session.email : null;
}

function requestComesFromFrontend(req: Request): boolean {
  for (const value of [req.headers.origin, req.headers.referer]) {
    if (!value) continue;
    try {
      if (new URL(value).origin === frontendOrigin()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

function requireAdmin(req: Request, res: Response, next: () => void): void {
  if (!mockSessionEmail(req)) {
    res.status(401).json({ error: 'Admin authentication required' });
    return;
  }

  next();
}

app.get('/api/auth/google', (req: Request, res: Response) => {
  if (!config.mockGoogleLogin) {
    res.status(404).json({ error: 'Local Google login mock is disabled' });
    return;
  }

  const email = String(req.query.email || config.mockGoogleEmail).trim().toLowerCase();
  if (!allowedMockAdminEmails().includes(email)) {
    res.status(403).json({ error: 'This Google account is not allowed to access the admin area' });
    return;
  }

  for (const [token, session] of mockSessions) {
    if (session.expiresAt <= Date.now()) mockSessions.delete(token);
  }
  const oldToken = sessionToken(req);
  if (oldToken) mockSessions.delete(oldToken);
  const token = randomUUID();
  mockSessions.set(token, { email, expiresAt: Date.now() + mockSessionTtlMs });
  res.setHeader('Set-Cookie', `${mockAdminCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${mockSessionTtlMs / 1000}`);
  res.redirect(frontendUrl('admin'));
});

app.get('/api/auth/session', (req: Request, res: Response) => {
  const email = mockSessionEmail(req);
  res.json({
    authenticated: email !== null,
    provider: 'google',
    ...(email === adminOwnerEmail ? { canManageAdminEmails: true } : {}),
  });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  const token = sessionToken(req);
  if (token) mockSessions.delete(token);
  res.setHeader('Set-Cookie', 'hpn_mock_google_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.status(204).send();
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, status: 'healthy' });
});

app.get('/api/capacity', (_req: Request, res: Response) => {
  expireReservations();
  res.json({ totalCapacity: config.totalCapacity, available: getAvailableCapacity() });
});

app.post('/api/reservations', async (req: Request, res: Response) => {
  try {
    const { name, email, quantity } = req.body ?? {};

    const reservation = createReservation({ name, email, quantity });
    const paymentUrl = frontendUrl(`payment/${reservation.order_number}/${reservation.access_token}`);

    await sendReservationEmail({
      to: reservation.email,
      customerName: reservation.name,
      orderNumber: reservation.order_number,
      quantity: reservation.quantity,
      amountCents: reservation.amount_cents,
      paymentUrl,
    });

    res.status(201).json({
      orderNumber: reservation.order_number,
      status: reservation.status,
      expiresAt: reservation.expires_at,
      paymentUrl,
      available: getAvailableCapacity(),
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Unable to create reservation',
    });
  }
});

app.get('/api/reservations/:orderNumber/:token', (req: Request, res: Response) => {
  const reservation = findReservationByToken(String(req.params.token));

  if (!reservation || reservation.order_number !== req.params.orderNumber) {
    res.status(404).json({ error: 'Reservation not found' });
    return;
  }

  const now = new Date();
  const expiresAt = new Date(reservation.expires_at);
  const paymentLink = paymentLinkFor(reservation.quantity, config.paymentLinks);

  if (reservation.status === 'RESERVED' && now > expiresAt) {
    reservation.status = 'EXPIRED';
  }

  if (reservation.status === 'RESERVED' && !paymentLink) {
    res.status(503).json({ error: `Payment link for ${reservation.quantity} ticket(s) is not configured` });
    return;
  }

  res.json({
    orderNumber: reservation.order_number,
    name: reservation.name,
    email: reservation.email,
    quantity: reservation.quantity,
    amountCents: reservation.amount_cents,
    status: reservation.status,
    createdAt: reservation.created_at,
    expiresAt: reservation.expires_at,
    expired: now > expiresAt,
    paymentLink: paymentLink ?? null,
    tickets: reservation.status === 'PAID' ? listTickets(reservation.order_number) : [],
  });
});

app.use('/api/admin', requireAdmin);

app.use('/api/admin/access', (req: Request, res: Response, next: NextFunction) => {
  if (mockSessionEmail(req) !== adminOwnerEmail) {
    res.status(403).json({ error: 'Only the owner signed in with Google can manage admin access' });
    return;
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !requestComesFromFrontend(req)) {
    res.status(403).json({ error: 'Cross-site admin requests are not allowed' });
    return;
  }
  next();
});

app.get('/api/admin/access', (_req: Request, res: Response) => {
  res.json({ ownerEmail: adminOwnerEmail, emails: allowedMockAdminEmails() });
});

app.post('/api/admin/access', (req: Request, res: Response) => {
  const result = validateAdminEmails(req.body);
  if ('error' in result) {
    res.status(400).json(result);
    return;
  }
  saveMockAdminEmails(result.emails);
  res.json({ ownerEmail: adminOwnerEmail, emails: result.emails });
});

app.post('/api/admin/orders/:orderNumber/pay', (req: Request, res: Response) => {
  const updatedReservation = markOrderPaid(String(req.params.orderNumber));

  if (!updatedReservation) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  res.json({
    orderNumber: updatedReservation.order_number,
    status: updatedReservation.status,
    paidAt: updatedReservation.paid_at,
  });
});

app.post('/api/admin/orders/:orderNumber/cancel', (req: Request, res: Response) => {
  const updatedReservation = cancelReservation(String(req.params.orderNumber));

  if (!updatedReservation) {
    res.status(400).json({ error: 'Only active reserved orders can be cancelled' });
    return;
  }

  res.json({
    orderNumber: updatedReservation.order_number,
    status: updatedReservation.status,
  });
});

app.post('/api/admin/orders/:orderNumber/extend', (req: Request, res: Response) => {
  const hours = Number(req.body?.hours ?? 24);
  const updatedReservation = extendReservation(String(req.params.orderNumber), hours);

  if (!updatedReservation) {
    res.status(400).json({ error: 'Only active reserved orders can be extended with a positive whole number of hours' });
    return;
  }

  res.json({
    orderNumber: updatedReservation.order_number,
    status: updatedReservation.status,
    expiresAt: updatedReservation.expires_at,
  });
});

app.post('/api/admin/orders/:orderNumber/resend', async (req: Request, res: Response) => {
  const reservation = listOrders().find((order) => order.order_number === String(req.params.orderNumber));

  if (!reservation) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  const paymentUrl = frontendUrl(`payment/${reservation.order_number}/${reservation.access_token}`);
  await sendReservationEmail({
    to: reservation.email,
    customerName: reservation.name,
    orderNumber: reservation.order_number,
    quantity: reservation.quantity,
    amountCents: reservation.amount_cents,
    paymentUrl,
  });

  res.json({ orderNumber: reservation.order_number, email: reservation.email });
});

app.post('/api/admin/tickets/:ticketCode/use', (req: Request, res: Response) => {
  const ticket = markTicketUsed(String(req.params.ticketCode));

  if (!ticket) {
    res.status(400).json({ error: 'Ticket does not exist or has already been used' });
    return;
  }

  res.json({
    ticketCode: ticket.ticket_code,
    status: ticket.status,
    usedAt: ticket.used_at,
  });
});

app.get('/api/admin/summary', (_req: Request, res: Response) => {
  expireReservations();
  res.json(getReservationStatusSummary());
});

app.get('/api/admin/orders', (_req: Request, res: Response) => {
  expireReservations();
  res.json({
    orders: listOrders().map((order) => ({
      ...order,
      paymentUrl: frontendUrl(`payment/${order.order_number}/${order.access_token}`),
      tickets: listTickets(order.order_number),
    })),
  });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof SyntaxError && 'type' in error && error.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON request' });
    return;
  }
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});
