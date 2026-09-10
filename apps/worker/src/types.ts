export type ReservationStatus = 'RESERVED' | 'PAID' | 'CANCELLED' | 'EXPIRED' | 'TICKETS_SENT';

export interface ReservationRecord {
  id: number;
  order_number: string;
  access_token: string;
  name: string;
  email: string;
  quantity: number;
  amount_cents: number;
  status: ReservationStatus;
  created_at: string;
  expires_at: string;
  paid_at: string | null;
  notes: string | null;
}

export interface ReservationInput {
  name: string;
  email: string;
  quantity: number;
}
