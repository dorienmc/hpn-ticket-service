import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { config } from './config.js';
import { cancelReservation, createReservation, expireReservations, extendReservation, findReservationByToken, getAvailableCapacity, getReservationStatusSummary, listOrders, listTickets, markOrderPaid, markTicketUsed } from './services.js';
import { sendReservationEmail } from './email.js';

const app = express();

function frontendOrigin(): string {
  return new URL(process.env.FRONTEND_URL || 'http://localhost:5173/hpn-ticket-service').origin;
}

function frontendUrl(path: string): string {
  const frontendBaseUrl = process.env.FRONTEND_URL || 'http://localhost:5173/hpn-ticket-service';
  return `${frontendBaseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
const port = Number(process.env.PORT || 8787);
const mockAdminCookie = 'hpn_mock_google_admin=authenticated';

app.use(cors({ origin: frontendOrigin(), credentials: true }));
app.use(express.json());

function isAdminAuthenticated(req: Request): boolean {
  return req.headers.cookie?.split(';').some((cookie) => cookie.trim() === mockAdminCookie) ?? false;
}

function requireAdmin(req: Request, res: Response, next: () => void): void {
  if (!config.mockGoogleLogin || !isAdminAuthenticated(req)) {
    res.status(401).json({ error: 'Admin authentication required' });
    return;
  }

  next();
}

app.get('/api/auth/google', (_req: Request, res: Response) => {
  if (!config.mockGoogleLogin) {
    res.status(404).json({ error: 'Local Google login mock is disabled' });
    return;
  }

  const email = String(_req.query.email || config.mockGoogleEmail).trim().toLowerCase();
  if (!config.adminAllowedEmails.includes(email)) {
    res.status(403).json({ error: 'This Google account is not allowed to access the admin area' });
    return;
  }

  res.setHeader('Set-Cookie', `${mockAdminCookie}; Path=/; HttpOnly; SameSite=Lax`);
  res.redirect(frontendUrl('admin'));
});

app.get('/api/auth/session', (req: Request, res: Response) => {
  res.json({ authenticated: config.mockGoogleLogin && isAdminAuthenticated(req), provider: 'google' });
});

app.post('/api/auth/logout', (_req: Request, res: Response) => {
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

  if (reservation.status === 'RESERVED' && now > expiresAt) {
    reservation.status = 'EXPIRED';
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
    paymentLink: config.paymentLink,
    tickets: reservation.status === 'PAID' ? listTickets(reservation.order_number) : [],
  });
});

app.use('/api/admin', requireAdmin);

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
      tickets: listTickets(order.order_number),
    })),
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${port}`);
});
