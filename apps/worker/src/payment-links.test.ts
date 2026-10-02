import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { paymentLinkFor } from './payment-links.js';

const links = {
  1: 'https://ing.example/pay/1',
  2: 'https://ing.example/pay/2',
  3: 'https://ing.example/pay/3',
  4: 'https://ing.example/pay/4',
  5: 'https://ing.example/pay/5',
};

describe('paymentLinkFor', () => {
  it.each([1, 2, 3, 4, 5] as const)('returns the link for %i ticket(s)', (quantity) => {
    expect(paymentLinkFor(quantity, links)).toBe(links[quantity]);
  });

  it.each([0, 6, 2.5, Number.NaN])('returns undefined for unsupported quantity %s', (quantity) => {
    expect(paymentLinkFor(quantity, links)).toBeUndefined();
  });

  it('returns undefined when the link for a quantity is not configured', () => {
    expect(paymentLinkFor(3, { 1: links[1] })).toBeUndefined();
  });

  it('provides a distinct local fallback link for every ticket quantity', () => {
    const { vars } = JSON.parse(readFileSync(new URL('../wrangler.local.jsonc', import.meta.url), 'utf8'));
    const fallbackLinks = [1, 2, 3, 4, 5].map((quantity) => vars[`ING_PAYMENT_LINK_${quantity}`]);

    expect(fallbackLinks.every(Boolean)).toBe(true);
    expect(new Set(fallbackLinks).size).toBe(5);
  });
});
