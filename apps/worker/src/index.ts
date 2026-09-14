import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { cancelReservation, createReservation, expireReservations, extendReservation, findReservationByToken, getAvailableCapacity, getReservationStatusSummary, listOrders, markOrderPaid } from './services.js';
import { sendReservationEmail } from './email.js';

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, status: 'healthy' });
});

app.get('/api/capacity', (_req: Request, res: Response) => {
  expireReservations();
  res.json({ totalCapacity: 100, available: getAvailableCapacity() });
});

app.post('/api/reservations', async (req: Request, res: Response) => {
  try {
    const { name, email, quantity } = req.body ?? {};

    const reservation = createReservation({ name, email, quantity });
    const paymentUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/${reservation.order_number}/${reservation.access_token}`;

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
  const reservation = findReservationByToken(req.params.token);

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
    paymentLink: 'https://www.ing.nl/payreq/m/?trxid=example-demo-link',
  });
});

app.post('/api/admin/orders/:orderNumber/pay', (req: Request, res: Response) => {
  const updatedReservation = markOrderPaid(req.params.orderNumber);

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
  const updatedReservation = cancelReservation(req.params.orderNumber);

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
  const updatedReservation = extendReservation(req.params.orderNumber, hours);

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
  const reservation = listOrders().find((order) => order.order_number === req.params.orderNumber);

  if (!reservation) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  const paymentUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/${reservation.order_number}/${reservation.access_token}`;
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

app.get('/api/admin/summary', (_req: Request, res: Response) => {
  expireReservations();
  res.json(getReservationStatusSummary());
});

app.get('/api/admin/orders', (_req: Request, res: Response) => {
  expireReservations();
  res.json({ orders: listOrders() });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${port}`);
});
