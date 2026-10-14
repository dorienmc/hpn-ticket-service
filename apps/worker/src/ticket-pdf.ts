import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import type { TicketRecord } from './types.js';

export function ticketUrl(reservationUrl: string, ticketCode: string): string {
  return `${reservationUrl}#ticket-${encodeURIComponent(ticketCode)}`;
}

export async function createTicketPdf(
  orderNumber: string,
  reservationUrl: string,
  tickets: TicketRecord[],
): Promise<Uint8Array> {
  if (tickets.length === 0) throw new Error('Cannot generate a ticket PDF without tickets');

  const document = await PDFDocument.create();
  document.setTitle(`Tickets ${orderNumber}`);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);

  for (const [index, ticket] of tickets.entries()) {
    const page = document.addPage([595.28, 841.89]);
    page.drawRectangle({ x: 0, y: 745, width: page.getWidth(), height: 97, color: rgb(0.03, 0.48, 0.46) });
    page.drawText('HALF PAST NINE & DIVA POWER', { x: 40, y: 783, size: 22, font: bold, color: rgb(1, 1, 1) });
    page.drawText(`Ticket ${index + 1} van ${tickets.length}`, { x: 40, y: 700, size: 22, font: bold });
    page.drawText('Zondag 8 november 2026 om 15:00 uur', { x: 40, y: 660, size: 16, font });
    page.drawText('Twekkelerpoort - Lambertus', { x: 40, y: 633, size: 16, font });
    page.drawText('Buddestraat 1, 7521 SB Enschede', { x: 40, y: 606, size: 16, font });
    page.drawText(`Ordernummer: ${orderNumber}`, { x: 40, y: 564, size: 14, font });
    page.drawText(ticket.ticket_code, { x: 40, y: 537, size: 16, font: bold });

    const qr = QRCode.create(ticketUrl(reservationUrl, ticket.ticket_code), { errorCorrectionLevel: 'M' });
    const quietZone = 4;
    const moduleSize = 280 / (qr.modules.size + quietZone * 2);
    const left = (page.getWidth() - 280) / 2;
    const bottom = 200;
    for (let row = 0; row < qr.modules.size; row += 1) {
      for (let column = 0; column < qr.modules.size; column += 1) {
        if (qr.modules.get(row, column)) {
          page.drawRectangle({
            x: left + (column + quietZone) * moduleSize,
            y: bottom + (qr.modules.size + quietZone - row - 1) * moduleSize,
            width: moduleSize,
            height: moduleSize,
            color: rgb(0, 0, 0),
          });
        }
      }
    }
    page.drawText('Scan deze QR-code om dit ticket op de reserveringspagina te bekijken.', {
      x: 40, y: 164, size: 12, font,
    });
    page.drawText('Alleen ingelogde beheerders kunnen tickets inchecken.', { x: 40, y: 144, size: 12, font });
    page.drawText('Bewaar deze QR-code zorgvuldig: de link geeft toegang tot je reservering.', {
      x: 40, y: 80, size: 11, font,
    });
  }

  return document.save();
}
