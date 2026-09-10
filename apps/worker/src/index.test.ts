import { describe, it, expect, beforeEach } from 'vitest';
import { createReservation, getAvailableCapacity, expireReservations, findReservationByToken } from './services.js';
import { getDb } from './db.js';

beforeEach(() => {
  const db = getDb();
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

  it('returns capacity based on active reservations', () => {
    createReservation({ name: 'A', email: 'a@example.com', quantity: 10 });
    createReservation({ name: 'B', email: 'b@example.com', quantity: 5 });

    expect(getAvailableCapacity()).toBe(85);
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
});
