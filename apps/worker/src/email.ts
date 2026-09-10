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
    subject: `Your Half Past Nine reservation (${orderNumber})`,
    html: `
      <h2>Thanks, ${customerName}!</h2>
      <p>Your reservation for ${quantity} ticket(s) has been created.</p>
      <p><strong>Order:</strong> ${orderNumber}</p>
      <p><strong>Amount:</strong> €${amountEuros}</p>
      <p><strong>Next step:</strong> complete payment at the private reservation page.</p>
      <p><a href="${paymentUrl}">Open your reservation page</a></p>
    `,
    text: `
      Thanks, ${customerName}!
      Your reservation for ${quantity} ticket(s) has been created.
      Order: ${orderNumber}
      Amount: €${amountEuros}
      Please open your reservation page:
      ${paymentUrl}
    `,
  });
}
