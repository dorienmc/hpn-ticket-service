import { describe, it, expect, beforeEach } from 'vitest';
import { cancelReservation, createReservation, extendReservation, getAvailableCapacity, expireReservations, findReservationByToken, listOrders, listTickets, markOrderPaid, markTicketUsed, getReservationStatusSummary } from './services.js';
import { getDb } from './db.js';

beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM tickets');
  db.exec('DELETE FROM orders');
});

describe('reservation flow', () => {
  it('creates a reservation with a valid payload', () => {
    const reservation = createReservation({ name: 'Ada Lovelace', email: 'ada@example.com', quantity: 2 });

    expect(reservation.order_number).toMatch(/^HP9-/);
    expect(reservation.access_token.length).toBeGreaterThan(20);
    expect(reservation.status).toBe('RESERVED');
    expect(reservation.amount_cents).toBe(2000);
    expect(reservation.quantity).toBe(2);
  });

  it('rejects invalid reservation quantities', () => {
    expect(() => createReservation({ name: 'Invalid', email: 'invalid@example.com', quantity: 0 })).toThrow();
    expect(() => createReservation({ name: 'Too many', email: 'many@example.com', quantity: 6 })).toThrow();
  });

  it('returns capacity based on active reservations', () => {
    createReservation({ name: 'A', email: 'a@example.com', quantity: 5 });
    createReservation({ name: 'B', email: 'b@example.com', quantity: 4 });

    expect(getAvailableCapacity()).toBe(91);
  });

  it('expires stale reservations and releases capacity', () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO orders (order_number, access_token, name, email, quantity, amount_cents, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?)
    `).run(
      'HP9-OLD',
      'oldtoken1234567890',
      'Old User',
      'old@example.com',
      3,
      3000,
      new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
      new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    );

    const expired = expireReservations();

    expect(expired).toBe(1);
    expect(findReservationByToken('oldtoken1234567890')?.status).toBe('EXPIRED');
  });

  it('lists orders and marks them paid', () => {
    const reservation = createReservation({ name: 'Bob', email: 'bob@example.com', quantity: 3 });
    const orders = listOrders();

    expect(orders).toHaveLength(1);
    expect(orders[0].order_number).toBe(reservation.order_number);

    const updated = markOrderPaid(reservation.order_number);
    expect(updated?.status).toBe('PAID');

    const tickets = listTickets(reservation.order_number);
    expect(tickets).toHaveLength(3);
    expect(new Set(tickets.map((ticket) => ticket.ticket_code)).size).toBe(3);
    expect(tickets.every((ticket) => ticket.status === 'VALID')).toBe(true);

    markOrderPaid(reservation.order_number);
    expect(listTickets(reservation.order_number)).toHaveLength(3);

    const checkedIn = markTicketUsed(tickets[0].ticket_code);
    expect(checkedIn?.status).toBe('USED');
    expect(markTicketUsed(tickets[0].ticket_code)).toBeNull();

    const summary = getReservationStatusSummary();
    expect(summary.paid).toBe(1);
  });

  it('cancels a reserved order and releases its capacity', () => {
    const reservation = createReservation({ name: 'Carla', email: 'carla@example.com', quantity: 4 });

    const cancelled = cancelReservation(reservation.order_number);

    expect(cancelled?.status).toBe('CANCELLED');
    expect(getAvailableCapacity()).toBe(100);
    expect(cancelReservation(reservation.order_number)).toBeNull();
  });

  it('extends an active reservation from the current expiry time', () => {
    const reservation = createReservation({ name: 'Dev', email: 'dev@example.com', quantity: 1 });

    const extended = extendReservation(reservation.order_number, 24);

    expect(extended?.status).toBe('RESERVED');
    expect(new Date(extended!.expires_at).getTime()).toBeGreaterThan(new Date(reservation.expires_at).getTime());
    expect(extendReservation('missing-order', 24)).toBeNull();
  });
});
