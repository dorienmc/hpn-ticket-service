import './styles.css';

const app = document.querySelector('#app');

if (!app) {
  throw new Error('App root not found');
}

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';
const path = window.location.pathname;

async function initApp() {
  if (path.startsWith('/admin')) {
    app.innerHTML = `
      <main class="page">
        <section class="card reservation-card">
          <p class="eyebrow">Admin</p>
          <h1>Reservation overview</h1>
          <div id="admin-summary" class="summary-grid"></div>
          <div id="admin-list" class="admin-list"></div>
        </section>
      </main>
    `;

    const summaryContainer = document.querySelector('#admin-summary');
    const listContainer = document.querySelector('#admin-list');

    try {
      const summaryResponse = await fetch(`${baseUrl}/api/admin/summary`);
      const summary = await summaryResponse.json();

      if (summaryContainer) {
        summaryContainer.innerHTML = `
          <div class="summary-tile"><span>Total capacity</span><strong>${100}</strong></div>
          <div class="summary-tile"><span>Reserved</span><strong>${summary.reserved ?? 0}</strong></div>
          <div class="summary-tile"><span>Paid</span><strong>${summary.paid ?? 0}</strong></div>
          <div class="summary-tile"><span>Available</span><strong>${summary.available ?? 0}</strong></div>
          <div class="summary-tile"><span>Expired</span><strong>${summary.expired ?? 0}</strong></div>
          <div class="summary-tile"><span>Cancelled</span><strong>${summary.cancelled ?? 0}</strong></div>
        `;
      }

      const ordersResponse = await fetch(`${baseUrl}/api/admin/orders`);
      const ordersData = await ordersResponse.json();
      const orders = ordersData.orders ?? [];

      if (listContainer) {
        if (!orders.length) {
          listContainer.innerHTML = '<p>No reservations yet.</p>';
        } else {
          listContainer.innerHTML = `
            <table class="orders-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Qty</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${orders.map((order: any) => `
                  <tr>
                    <td>${order.order_number}</td>
                    <td>${order.name}</td>
                    <td>${order.email}</td>
                    <td>${order.quantity}</td>
                    <td>${order.status}</td>
                    <td>€${(order.amount_cents / 100).toFixed(2)}</td>
                    <td>
                      ${order.status === 'RESERVED'
                        ? `<button class="admin-button" data-order="${order.order_number}">Mark paid</button>`
                        : '<span>—</span>'}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `;

          const buttons = listContainer.querySelectorAll<HTMLButtonElement>('[data-order]');
          buttons.forEach((button) => {
            button.addEventListener('click', async () => {
              const orderNumber = button.dataset.order;
              if (!orderNumber) return;

              const response = await fetch(`${baseUrl}/api/admin/orders/${encodeURIComponent(orderNumber)}/pay`, {
                method: 'POST'
              });
              const payload = await response.json();

              if (!response.ok) {
                alert(payload.error || 'Could not mark as paid');
                return;
              }

              alert(`Order ${payload.orderNumber} marked as paid.`);
              window.location.reload();
            });
          });
        }
      }
    } catch (error) {
      if (listContainer) {
        listContainer.innerHTML = `<p class="error-message">${error instanceof Error ? error.message : 'Unable to load admin data.'}</p>`;
      }
    }

    return;
  }

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

    return;
  }

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

void initApp();
