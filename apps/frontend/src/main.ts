import './styles.css';

const app = document.querySelector('#app');

if (!app) {
  throw new Error('App root not found');
}

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';
const path = window.location.pathname;

if (path.startsWith('/payment/')) {
  const segments = path.split('/').filter(Boolean);
  const orderNumber = segments[1];
  const token = segments[2];

  app.innerHTML = `
    <main class="page">
      <section class="card reservation-card">
        <p class="eyebrow">Half Past Nine</p>
        <h1>Reservation status</h1>
        <div id="reservation-content" class="reservation-content">Loading...</div>
      </section>
    </main>
  `;

  const container = document.querySelector('#reservation-content');

  if (container && orderNumber && token) {
    try {
      const response = await fetch(`${baseUrl}/api/reservations/${encodeURIComponent(orderNumber)}/${encodeURIComponent(token)}`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Reservation not found');
      }

      const amount = (payload.amountCents / 100).toFixed(2);
      const expiresAt = new Date(payload.expiresAt).toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });

      const statusMarkup = payload.status === 'PAID'
        ? `<div class="badge success">Paid</div>`
        : payload.status === 'EXPIRED'
          ? `<div class="badge warning">Expired</div>`
          : payload.status === 'CANCELLED'
            ? `<div class="badge muted">Cancelled</div>`
            : `<div class="badge info">Reserved</div>`;

      const paymentSection = payload.status === 'RESERVED'
        ? `
          <div class="payment-box">
            <p>Payment is still required for this reservation.</p>
            <a class="primary-link" href="${payload.paymentLink}" target="_blank" rel="noreferrer">
              Pay via ING
            </a>
          </div>
        `
        : payload.status === 'PAID'
          ? `
            <div class="payment-box success-box">
              <p>Payment received and the reservation is marked as paid.</p>
            </div>
          `
          : `
            <div class="payment-box muted-box">
              <p>This reservation is no longer active.</p>
            </div>
          `;

      container.innerHTML = `
        <div class="status-header">
          ${statusMarkup}
        </div>
        <dl class="detail-list">
          <div><dt>Order number</dt><dd>${payload.orderNumber}</dd></div>
          <div><dt>Name</dt><dd>${payload.name}</dd></div>
          <div><dt>Email</dt><dd>${payload.email}</dd></div>
          <div><dt>Tickets</dt><dd>${payload.quantity}</dd></div>
          <div><dt>Amount</dt><dd>€${amount}</dd></div>
          <div><dt>Expires</dt><dd>${expiresAt}</dd></div>
        </dl>
        ${paymentSection}
      `;
    } catch (error) {
      container.innerHTML = `
        <p class="error-message">${error instanceof Error ? error.message : 'This reservation could not be found.'}</p>
      `;
    }
  }
} else {
  app.innerHTML = `
    <main class="page">
      <section class="card">
        <p class="eyebrow">Half Past Nine</p>
        <h1>Reserve your tickets</h1>
        <form id="reservation-form" class="form">
          <label>
            Full name
            <input id="name" name="name" type="text" required />
          </label>

          <label>
            Email address
            <input id="email" name="email" type="email" required />
          </label>

          <label>
            Number of tickets
            <input id="quantity" name="quantity" type="number" min="1" max="10" value="1" required />
          </label>

          <button type="submit">Reserve tickets</button>
        </form>

        <p id="status" class="status" aria-live="polite"></p>
      </section>
    </main>
  `;

  const form = document.querySelector<HTMLFormElement>('#reservation-form');
  const status = document.querySelector<HTMLParagraphElement>('#status');

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const name = String(formData.get('name') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim();
    const quantity = Number(formData.get('quantity') ?? 1);

    if (!name || !email || quantity < 1) {
      status!.textContent = 'Please fill in all required fields.';
      return;
    }

    status!.textContent = 'Creating your reservation...';

    try {
      const response = await fetch(`${baseUrl}/api/reservations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, quantity })
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Reservation failed');
      }

      status!.textContent = `Reservation created. Order ${payload.orderNumber}. View your reservation: ${payload.paymentUrl}`;
      window.location.href = payload.paymentUrl;
    } catch (error) {
      status!.textContent = error instanceof Error ? error.message : 'Unknown error';
    }
  });
}
