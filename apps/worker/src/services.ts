import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { config } from './config.js';
import type { ReservationInput, ReservationRecord, ReservationStatus, TicketRecord } from './types.js';

function generateOrderNumber(): string {
  const timestamp = Date.now().toString().slice(-8);
  const suffix = randomUUID().slice(0, 4).toUpperCase();
  return `HP9-${timestamp}-${suffix}`;
}

function generateAccessToken(): string {
  return randomUUID().replace(/-/g, '');
}

function generateTicketCode(): string {
  return `HP9-TKT-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

function addHoursToIsoString(date: Date, hours: number): string {
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export function getAvailableCapacity(): number {
  const db = getDb();
  const result = db.prepare(`
    SELECT SUM(quantity) AS active_quantity
    FROM orders
    WHERE status IN ('RESERVED', 'PAID')
      AND expires_at > ?
  `).get(new Date().toISOString()) as { active_quantity: number | null };

  const activeQuantity = result?.active_quantity ?? 0;
  return config.totalCapacity - activeQuantity;
}

export function createReservation(input: ReservationInput): ReservationRecord {
  const name = input.name.trim();
  const email = input.email.trim();
  const quantity = Number(input.quantity);

  if (!name || !email || !Number.isInteger(quantity) || quantity < 1) {
    throw new Error('Invalid reservation payload');
  }

  const now = new Date();
  const expiresAt = addHoursToIsoString(now, config.reservationTtlHours);
  const amountCents = quantity * config.ticketPriceCents;
  const orderNumber = generateOrderNumber();
  const accessToken = generateAccessToken();

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO orders (
      order_number, access_token, name, email, quantity, amount_cents,
      status, created_at, expires_at, paid_at, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
  `).run(
    orderNumber,
    accessToken,
    name,
    email,
    quantity,
    amountCents,
    'RESERVED',
    now.toISOString(),
    expiresAt,
  );

  const reservation = db.prepare(`
    SELECT * FROM orders WHERE id = ?
  `).get(result.lastInsertRowid) as ReservationRecord;

  return reservation;
}

export function findReservationByToken(token: string): ReservationRecord | null {
  const db = getDb();
  return db.prepare(`SELECT * FROM orders WHERE access_token = ?`).get(token) as ReservationRecord | null;
}

export function findReservationByOrderNumber(orderNumber: string): ReservationRecord | null {
  const db = getDb();
  return db.prepare(`SELECT * FROM orders WHERE order_number = ?`).get(orderNumber) as ReservationRecord | null;
}

export function markOrderPaid(orderNumber: string): ReservationRecord | null {
  const db = getDb();
  const reservation = findReservationByOrderNumber(orderNumber);

  if (!reservation) {
    return null;
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE orders
    SET status = ?, paid_at = ?
    WHERE order_number = ?
  `).run('PAID', now, orderNumber);

  const existingTickets = db.prepare(`
    SELECT COUNT(*) AS count FROM tickets WHERE order_id = ?
  `).get(reservation.id) as { count: number };

  if (existingTickets.count === 0) {
    const insertTicket = db.prepare(`
      INSERT INTO tickets (order_id, ticket_code, status, created_at, used_at)
      VALUES (?, ?, 'VALID', ?, NULL)
    `);
    const createTickets = db.transaction((quantity: number) => {
      for (let index = 0; index < quantity; index += 1) {
        insertTicket.run(reservation.id, generateTicketCode(), now);
      }
    });
    createTickets(reservation.quantity);
  }

  return findReservationByOrderNumber(orderNumber);
}

export function listTickets(orderNumber: string): TicketRecord[] {
  const db = getDb();
  return db.prepare(`
    SELECT tickets.*
    FROM tickets
    INNER JOIN orders ON orders.id = tickets.order_id
    WHERE orders.order_number = ?
    ORDER BY tickets.id ASC
  `).all(orderNumber) as TicketRecord[];
}

export function markTicketUsed(ticketCode: string): TicketRecord | null {
  const db = getDb();
  const ticket = db.prepare(`
    SELECT * FROM tickets WHERE ticket_code = ? AND status = 'VALID'
  `).get(ticketCode) as TicketRecord | undefined;

  if (!ticket) {
    return null;
  }

  db.prepare(`
    UPDATE tickets
    SET status = 'USED', used_at = ?
    WHERE ticket_code = ? AND status = 'VALID'
  `).run(new Date().toISOString(), ticketCode);

  return db.prepare(`SELECT * FROM tickets WHERE ticket_code = ?`).get(ticketCode) as TicketRecord;
}

export function cancelReservation(orderNumber: string): ReservationRecord | null {
  const db = getDb();
  const reservation = findReservationByOrderNumber(orderNumber);

  if (!reservation || reservation.status !== 'RESERVED') {
    return null;
  }

  db.prepare(`
    UPDATE orders
    SET status = ?
    WHERE order_number = ?
  `).run('CANCELLED', orderNumber);

  return findReservationByOrderNumber(orderNumber);
}

export function extendReservation(orderNumber: string, hours: number): ReservationRecord | null {
  const db = getDb();
  const reservation = findReservationByOrderNumber(orderNumber);

  if (!reservation || reservation.status !== 'RESERVED' || !Number.isInteger(hours) || hours < 1) {
    return null;
  }

  const currentExpiry = new Date(reservation.expires_at);
  if (currentExpiry <= new Date()) {
    return null;
  }

  db.prepare(`
    UPDATE orders
    SET expires_at = ?
    WHERE order_number = ?
  `).run(addHoursToIsoString(currentExpiry, hours), orderNumber);

  return findReservationByOrderNumber(orderNumber);
}

export function expireReservations(): number {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE orders
    SET status = 'EXPIRED'
    WHERE status = 'RESERVED' AND expires_at <= ?
  `).run(now);

  return result.changes;
}

export function listOrders(): ReservationRecord[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM orders
    ORDER BY created_at DESC
  `).all() as ReservationRecord[];
}

export function getReservationStatusSummary() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM orders
    GROUP BY status
  `).all() as Array<{ status: ReservationStatus; count: number }>;

  const summary: Record<string, number> = {
    total: 0,
    totalCapacity: config.totalCapacity,
    reserved: 0,
    paid: 0,
    available: getAvailableCapacity(),
    expired: 0,
    cancelled: 0,
  };

  for (const row of rows) {
    summary.total += row.count;
    if (row.status === 'RESERVED') summary.reserved = row.count;
    if (row.status === 'PAID') summary.paid = row.count;
    if (row.status === 'EXPIRED') summary.expired = row.count;
    if (row.status === 'CANCELLED') summary.cancelled = row.count;
  }

  return summary;
}
