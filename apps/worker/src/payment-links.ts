export type TicketQuantity = 1 | 2 | 3 | 4 | 5;

export type PaymentLinks = Partial<Record<TicketQuantity, string>>;

export const MAX_SUPPORTED_TICKET_QUANTITY: TicketQuantity = 5;

function isTicketQuantity(quantity: number): quantity is TicketQuantity {
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_SUPPORTED_TICKET_QUANTITY;
}

export function paymentLinkFor(quantity: number, links: PaymentLinks): string | undefined {
  if (!isTicketQuantity(quantity)) {
    return undefined;
  }

  return links[quantity];
}
