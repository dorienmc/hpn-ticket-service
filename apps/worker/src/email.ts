import nodemailer from 'nodemailer';

const host = process.env.MAILPIT_HOST || 'localhost';
const port = Number(process.env.MAILPIT_PORT || 1025);

const transporter = nodemailer.createTransport({
  host,
  port,
  ignoreTLS: true,
  secure: false,
});

export async function sendReservationEmail({
  to,
  customerName,
  orderNumber,
  quantity,
  amountCents,
  paymentUrl,
}: {
  to: string;
  customerName: string;
  orderNumber: string;
  quantity: number;
  amountCents: number;
  paymentUrl: string;
}): Promise<void> {
  const amountEuros = (amountCents / 100).toFixed(2);

  await transporter.sendMail({
    from: 'noreply@halfpastnine.test',
    to,
    subject: `Je reservering voor Half Past Nine (${orderNumber})`,
    html: `
      <h2>Bedankt, ${customerName}!</h2>
      <p>Je reservering voor ${quantity} ticket(s) is aangemaakt.</p>
      <p><strong>Ordernummer:</strong> ${orderNumber}</p>
      <p><strong>Bedrag:</strong> €${amountEuros}</p>
      <p><strong>Volgende stap:</strong> betaal via de persoonlijke reserveringspagina.</p>
      <p><a href="${paymentUrl}">Open je reserveringspagina</a></p>
    `,
    text: `
      Bedankt, ${customerName}!
      Je reservering voor ${quantity} ticket(s) is aangemaakt.
      Ordernummer: ${orderNumber}
      Bedrag: €${amountEuros}
      Open je reserveringspagina:
      ${paymentUrl}
    `,
  });
}
