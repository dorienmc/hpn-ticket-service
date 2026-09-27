import nodemailer from 'nodemailer';

const host = process.env.MAILPIT_HOST || 'localhost';
const port = Number(process.env.MAILPIT_PORT || 1025);

const transporter = nodemailer.createTransport({
  host,
  port,
  ignoreTLS: true,
  secure: false,
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  const safeCustomerName = escapeHtml(customerName);
  const safePaymentUrl = escapeHtml(paymentUrl);

  await transporter.sendMail({
    from: 'noreply@halfpastnine.test',
    to,
    subject: `Je reservering voor het dubbelconcert van Half Past Nine & Diva Power (${orderNumber})`,
    html: `
      <div style="margin:0;padding:32px 12px;background-color:#f3f7f6;color:#172321;font-family:Arial,Helvetica,sans-serif;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td align="center">
              <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #dce7e4;">
                <tr>
                  <td style="padding:22px 30px;background-color:#087b76;border-bottom:5px solid #f5c900;color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:1px;">
                    HALF PAST NINE DUBBEL CONCERT
                  </td>
                </tr>
                <tr>
                  <td style="padding:30px;">
                    <h1 style="margin:0 0 12px;color:#101010;font-size:26px;line-height:1.25;">Bedankt, ${safeCustomerName}!</h1>
                    <p style="margin:0 0 24px;color:#4b5563;font-size:16px;line-height:1.6;">Je reservering voor ${quantity} ticket(s) is aangemaakt.</p>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px;background-color:#f8f6ed;border:1px solid #e7e1cc;">
                      <tr>
                        <td style="padding:12px 14px;border-bottom:1px solid #e7e1cc;color:#4b5563;font-size:14px;">Ordernummer</td>
                        <td align="right" style="padding:12px 14px;border-bottom:1px solid #e7e1cc;color:#101010;font-size:14px;font-weight:bold;">${orderNumber}</td>
                      </tr>
                      <tr>
                        <td style="padding:12px 14px;color:#4b5563;font-size:14px;">Bedrag</td>
                        <td align="right" style="padding:12px 14px;color:#101010;font-size:14px;font-weight:bold;">€${amountEuros}</td>
                      </tr>
                    </table>
                    <p style="margin:0 0 20px;color:#4b5563;font-size:14px;line-height:1.6;"><strong style="color:#101010;">Volgende stap:</strong> betaal via de persoonlijke reserveringspagina.</p>
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td align="center" style="background-color:#f5c900;border:1px solid #101010;">
                          <a href="${safePaymentUrl}" style="display:inline-block;padding:14px 20px;color:#101010;font-size:15px;font-weight:bold;text-decoration:none;">Open je reserveringspagina&nbsp; →</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 30px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.5;">Half Past Nine</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
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
