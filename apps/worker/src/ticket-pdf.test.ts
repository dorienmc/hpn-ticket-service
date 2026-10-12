import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFPage } from 'pdf-lib';
import { createRequire } from 'node:module';
import type { QRCode } from 'jsqr';
import { createTicketPdf, ticketUrl } from './ticket-pdf.js';
import type { TicketRecord } from './types.js';

const decodeQr: (pixels: Uint8ClampedArray, width: number, height: number) => QRCode | null =
  createRequire(import.meta.url)('jsqr');

const tickets: TicketRecord[] = ['TICKET-1', 'TICKET-2'].map((ticket_code, index) => ({
  id: index + 1, order_id: 1, ticket_code, status: 'VALID',
  created_at: '2026-10-11T10:00:00Z', used_at: null,
}));
const reservationUrl = 'https://example.github.io/hpn-ticket-service/payment/HP9-1234-ABCD/token123';

afterEach(() => vi.restoreAllMocks());

describe('ticket PDFs', () => {
  it('produces one A4 page per ticket with QR codes pointing to the exact ticket links', async () => {
    const rectangles = vi.spyOn(PDFPage.prototype, 'drawRectangle');
    const bytes = await createTicketPdf('HP9-1234-ABCD', reservationUrl, tickets);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getTitle()).toBe('Tickets HP9-1234-ABCD');
    expect(pdf.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
    // Rasterize the actual PDF drawing operations to verify the rendered QR codes.
    const pages = [...new Set(rectangles.mock.contexts)];
    expect(pages).toHaveLength(tickets.length);
    for (const [index, page] of pages.entries()) {
      const width = 600;
      const height = 842;
      const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
      rectangles.mock.calls.forEach(([rectangle], callIndex) => {
        if (rectangles.mock.contexts[callIndex] !== page || !rectangle || (rectangle.width ?? 0) > 20) return;
        const left = Math.round(rectangle.x ?? 0);
        const top = Math.round(height - (rectangle.y ?? 0) - (rectangle.height ?? 0));
        const right = Math.round((rectangle.x ?? 0) + (rectangle.width ?? 0));
        const bottom = Math.round(height - (rectangle.y ?? 0));
        for (let y = top; y < bottom; y += 1) {
          for (let x = left; x < right; x += 1) {
            const offset = (y * width + x) * 4;
            pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
          }
        }
      });
      expect(decodeQr(pixels, width, height)?.data).toBe(
        `${reservationUrl}#ticket-${tickets[index].ticket_code}`,
      );
    }
  });

  it('escapes the ticket code in the URL fragment', () => {
    expect(ticketUrl(reservationUrl, 'TICKET /#')).toBe(`${reservationUrl}#ticket-TICKET%20%2F%23`);
  });

  it('does not generate an empty PDF for a paid order without tickets', async () => {
    await expect(createTicketPdf('HP9-1234-ABCD', reservationUrl, [])).rejects.toThrow('without tickets');
  });
});
