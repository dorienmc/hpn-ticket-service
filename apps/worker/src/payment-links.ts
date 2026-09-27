export type TicketQuantity = 1 | 2 | 3 | 4 | 5;

export type PaymentLinks = Partial<Record<TicketQuantity, string>>;

function isTicketQuantity(quantity: number): quantity is TicketQuantity {
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 5;
}

export function paymentLinkFor(quantity: number, links: PaymentLinks): string | undefined {
  if (!isTicketQuantity(quantity)) {
    return undefined;
  }

  return links[quantity];
}
