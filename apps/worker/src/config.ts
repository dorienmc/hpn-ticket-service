function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function emailsFromEnv(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export const config = {
  totalCapacity: numberFromEnv('TOTAL_CAPACITY', 100),
  maxTicketsPerReservation: numberFromEnv('MAX_TICKETS_PER_RESERVATION', 5),
  ticketPriceCents: numberFromEnv('TICKET_PRICE_CENTS', 1000),
  reservationTtlHours: numberFromEnv('RESERVATION_TTL_HOURS', 48),
  paymentLink: process.env.ING_PAYMENT_LINK || 'https://www.ing.nl/payreq/m/?trxid=example-demo-link',
  mockGoogleLogin: (process.env.MOCK_GOOGLE_LOGIN ?? 'false') === 'true',
  adminAllowedEmails: emailsFromEnv('ADMIN_ALLOWED_EMAILS'),
  mockGoogleEmail: (process.env.MOCK_GOOGLE_EMAIL || 'admin@example.com').trim().toLowerCase(),
};
