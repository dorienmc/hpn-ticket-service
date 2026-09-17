function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const config = {
  totalCapacity: numberFromEnv('TOTAL_CAPACITY', 100),
  maxTicketsPerReservation: numberFromEnv('MAX_TICKETS_PER_RESERVATION', 5),
  ticketPriceCents: numberFromEnv('TICKET_PRICE_CENTS', 1000),
  reservationTtlHours: numberFromEnv('RESERVATION_TTL_HOURS', 48),
  paymentLink: process.env.ING_PAYMENT_LINK || 'https://www.ing.nl/payreq/m/?trxid=example-demo-link',
};
