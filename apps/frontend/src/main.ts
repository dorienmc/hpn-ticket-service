import './styles.css';

const app = document.querySelector('#app');

if (!app) {
  throw new Error('App root not found');
}

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';
const maxTickets = import.meta.env.VITE_MAX_TICKETS_PER_RESERVATION ?? '5';
const path = window.location.pathname;

function statusLabel(status: string): string {
  return {
    RESERVED: 'Gereserveerd',
    PAID: 'Betaald',
    EXPIRED: 'Verlopen',
    CANCELLED: 'Geannuleerd',
    VALID: 'Geldig',
    USED: 'Gebruikt',
  }[status] ?? status;
}

async function initApp() {
  if (path.startsWith('/admin')) {
    app.innerHTML = `
      <main class="page">
        <section class="card reservation-card">
          <p class="eyebrow">Beheer</p>
          <h1>Overzicht reserveringen</h1>
          <div id="admin-summary" class="summary-grid"></div>
          <div id="admin-login" class="payment-box muted-box" hidden>
            <p>Log in om reserveringen te beheren.</p>
            <a class="primary-link" href="${baseUrl}/api/auth/google">Inloggen met Google</a>
          </div>
          <div class="admin-filters">
            <label>
              Reserveringen zoeken
              <input id="order-search" type="search" placeholder="Ordernummer, naam of e-mail" />
            </label>
            <label>
              Status
              <select id="status-filter">
                  <option value="ALL">Alle</option>
                  <option value="RESERVED">Gereserveerd</option>
                  <option value="PAID">Betaald</option>
                  <option value="EXPIRED">Verlopen</option>
                  <option value="CANCELLED">Geannuleerd</option>
              </select>
            </label>
          </div>
          <div id="admin-list" class="admin-list"></div>
          <p id="admin-status" class="status" aria-live="polite"></p>
        </section>
      </main>
    `;

    const summaryContainer = document.querySelector('#admin-summary');
    const listContainer = document.querySelector('#admin-list');
    const adminStatus = document.querySelector<HTMLParagraphElement>('#admin-status');
    const loginContainer = document.querySelector<HTMLDivElement>('#admin-login');

    try {
      const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, { credentials: 'include' });
      const session = await sessionResponse.json();

      if (!session.authenticated) {
        if (loginContainer) loginContainer.hidden = false;
        return;
      }

      const summaryResponse = await fetch(`${baseUrl}/api/admin/summary`, { credentials: 'include' });
      const summary = await summaryResponse.json();

      if (summaryContainer) {
        summaryContainer.innerHTML = `
          <div class="summary-tile"><span>Totale capaciteit</span><strong>${summary.totalCapacity ?? 0}</strong></div>
          <div class="summary-tile"><span>Gereserveerd</span><strong>${summary.reserved ?? 0}</strong></div>
          <div class="summary-tile"><span>Betaald</span><strong>${summary.paid ?? 0}</strong></div>
          <div class="summary-tile"><span>Beschikbaar</span><strong>${summary.available ?? 0}</strong></div>
          <div class="summary-tile"><span>Verlopen</span><strong>${summary.expired ?? 0}</strong></div>
          <div class="summary-tile"><span>Geannuleerd</span><strong>${summary.cancelled ?? 0}</strong></div>
        `;
      }

      const ordersResponse = await fetch(`${baseUrl}/api/admin/orders`, { credentials: 'include' });
      const ordersData = await ordersResponse.json();
      const orders = ordersData.orders ?? [];

      if (listContainer) {
        const searchInput = document.querySelector<HTMLInputElement>('#order-search');
        const statusFilter = document.querySelector<HTMLSelectElement>('#status-filter');

        const renderOrders = () => {
          const searchTerm = searchInput?.value.trim().toLowerCase() ?? '';
          const selectedStatus = statusFilter?.value ?? 'ALL';
          const filteredOrders = orders.filter((order: any) => {
            const searchable = `${order.order_number} ${order.name} ${order.email}`.toLowerCase();
            return (!searchTerm || searchable.includes(searchTerm))
              && (selectedStatus === 'ALL' || order.status === selectedStatus);
          });

          if (!filteredOrders.length) {
            listContainer.innerHTML = '<p>Geen overeenkomende reserveringen.</p>';
            return;
          }

          listContainer.innerHTML = `
            <table class="orders-table">
              <thead>
                <tr>
                  <th>Ordernummer</th>
                  <th>Naam</th>
                  <th>E-mail</th>
                  <th>Aantal</th>
                  <th>Status</th>
                  <th>Bedrag</th>
                  <th>Actie</th>
                </tr>
              </thead>
              <tbody>
                ${filteredOrders.map((order: any) => `
                  <tr>
                    <td>${order.order_number}</td>
                    <td>${order.name}</td>
                    <td>${order.email}</td>
                    <td>${order.quantity}</td>
                    <td>${statusLabel(order.status)}</td>
                    <td>€${(order.amount_cents / 100).toFixed(2)}</td>
                    <td>
                      ${order.status === 'RESERVED'
                        ? `<div class="admin-actions">
                            <button class="admin-button" data-action="pay" data-order="${order.order_number}">Markeer als betaald</button>
                            <button class="admin-button secondary" data-action="extend" data-order="${order.order_number}">Verleng 24 uur</button>
                            <button class="admin-button danger" data-action="cancel" data-order="${order.order_number}">Annuleer</button>
                            <button class="admin-button secondary" data-action="resend" data-order="${order.order_number}">E-mail opnieuw sturen</button>
                          </div>`
                        : order.status === 'PAID'
                          ? `<div class="admin-actions">
                              ${order.tickets?.map((ticket: { ticket_code: string; status: string }) => `<button class="admin-button ${ticket.status === 'USED' ? 'secondary' : ''}" data-action="checkin" data-ticket="${ticket.ticket_code}" data-order="${order.order_number}" ${ticket.status === 'USED' ? 'disabled' : ''}>${ticket.ticket_code}: ${ticket.status === 'USED' ? 'Gebruikt' : 'Inchecken'}</button>`).join('') ?? ''}
                              <button class="admin-button secondary" data-action="resend" data-order="${order.order_number}">E-mail opnieuw sturen</button>
                            </div>`
                        : `<div class="admin-actions">
                            <button class="admin-button secondary" data-action="resend" data-order="${order.order_number}">E-mail opnieuw sturen</button>
                          </div>`}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `;

          const buttons = listContainer.querySelectorAll<HTMLButtonElement>('[data-action][data-order]');
          buttons.forEach((button) => {
            button.addEventListener('click', async () => {
              const orderNumber = button.dataset.order;
              const action = button.dataset.action;
              if (!orderNumber || !action) return;

              const confirmation = action === 'cancel'
                ? `Reservering ${orderNumber} annuleren? De tickets komen dan weer beschikbaar.`
                : undefined;

              if (confirmation && !window.confirm(confirmation)) {
                return;
              }

              button.disabled = true;
              const ticketCode = button.dataset.ticket;
              const endpoint = action === 'checkin'
                ? `${baseUrl}/api/admin/tickets/${encodeURIComponent(ticketCode ?? '')}/use`
                : `${baseUrl}/api/admin/orders/${encodeURIComponent(orderNumber)}/${action}`;
              const response = await fetch(endpoint, {
                method: 'POST',
                credentials: 'include',
                headers: action === 'extend' ? { 'Content-Type': 'application/json' } : undefined,
                body: action === 'extend' ? JSON.stringify({ hours: 24 }) : undefined,
              });
              const payload = await response.json();
              button.disabled = false;

              if (!response.ok) {
                alert(payload.error || `Actie voor deze reservering is mislukt`);
                return;
              }

              const message = action === 'pay'
                ? `Order ${payload.orderNumber} is als betaald gemarkeerd.`
                : action === 'extend'
                  ? `Order ${payload.orderNumber} is met 24 uur verlengd.`
                  : action === 'cancel'
                    ? `Order ${payload.orderNumber} is geannuleerd.`
                    : action === 'checkin'
                      ? `Ticket ${payload.ticketCode} is ingecheckt.`
                      : `De reserverings-e-mail is opnieuw verstuurd naar ${payload.email}.`;
                    const order = orders.find((candidate: any) => candidate.order_number === orderNumber);
                    if (order && action === 'pay') order.status = 'PAID';
                    if (order && action === 'cancel') order.status = 'CANCELLED';
                    if (order && action === 'extend') order.expires_at = payload.expiresAt;
              if (order && action === 'checkin') {
                const ticket = order.tickets.find((candidate: any) => candidate.ticket_code === ticketCode);
                if (ticket) ticket.status = 'USED';
              }
                    if (adminStatus) adminStatus.textContent = message;
                    renderOrders();
            });
          });

        };

        searchInput?.addEventListener('input', renderOrders);
        statusFilter?.addEventListener('change', renderOrders);
        renderOrders();
      }
    } catch (error) {
      if (listContainer) {
        listContainer.innerHTML = `<p class="error-message">${error instanceof Error ? error.message : 'Beheergegevens konden niet worden geladen.'}</p>`;
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
          <h1>Reserveringsstatus</h1>
          <div id="reservation-content" class="reservation-content">Laden...</div>
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
        const expiresAt = new Date(payload.expiresAt).toLocaleString('nl-NL', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });

        const statusMarkup = payload.status === 'PAID'
          ? `<div class="badge success">Betaald</div>`
          : payload.status === 'EXPIRED'
            ? `<div class="badge warning">Verlopen</div>`
            : payload.status === 'CANCELLED'
              ? `<div class="badge muted">Geannuleerd</div>`
              : `<div class="badge info">Gereserveerd</div>`;

        const paymentSection = payload.status === 'RESERVED'
          ? `
            <div class="payment-box">
              <p>Voor deze reservering moet nog worden betaald.</p>
              <a class="primary-link" href="${payload.paymentLink}" target="_blank" rel="noreferrer">
                Betalen via ING
              </a>
            </div>
          `
          : payload.status === 'PAID'
            ? `
              <div class="payment-box success-box">
                <p>De betaling is ontvangen en de reservering is als betaald gemarkeerd.</p>
              </div>
            `
            : `
              <div class="payment-box muted-box">
                <p>Deze reservering is niet meer actief.</p>
              </div>
            `;

        const ticketSection = payload.status === 'PAID' && payload.tickets?.length
          ? `
            <div class="payment-box success-box">
              <h2>Je tickets</h2>
              <ul class="ticket-list">
                ${payload.tickets.map((ticket: { ticket_code: string; status: string }) => `<li><strong>${ticket.ticket_code}</strong><span>${statusLabel(ticket.status)}</span></li>`).join('')}
              </ul>
            </div>
          `
          : '';

        container.innerHTML = `
          <div class="status-header">
            ${statusMarkup}
          </div>
          <dl class="detail-list">
            <div><dt>Ordernummer</dt><dd>${payload.orderNumber}</dd></div>
              <div><dt>Naam</dt><dd>${payload.name}</dd></div>
              <div><dt>E-mail</dt><dd>${payload.email}</dd></div>
              <div><dt>Tickets</dt><dd>${payload.quantity}</dd></div>
              <div><dt>Bedrag</dt><dd>€${amount}</dd></div>
              <div><dt>Verloopt op</dt><dd>${expiresAt}</dd></div>
          </dl>
          ${paymentSection}
          ${ticketSection}
        `;
      } catch (error) {
        container.innerHTML = `
          <p class="error-message">${error instanceof Error ? error.message : 'Deze reservering kon niet worden gevonden.'}</p>
        `;
      }
    }

    return;
  }

  app.innerHTML = `
    <main class="page">
      <section class="card">
        <p class="eyebrow">Half Past Nine</p>
        <h1>Reserveer je tickets</h1>
        <form id="reservation-form" class="form">
          <label>
            Volledige naam
            <input id="name" name="name" type="text" required />
          </label>

          <label>
            E-mailadres
            <input id="email" name="email" type="email" required />
          </label>

          <label>
            Aantal tickets
            <input id="quantity" name="quantity" type="number" min="1" max="${maxTickets}" value="1" required />
          </label>

          <button type="submit">Tickets reserveren</button>
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
      status!.textContent = 'Vul alle verplichte velden in.';
      return;
    }

    status!.textContent = 'Je reservering wordt aangemaakt...';

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

      status!.textContent = `Reservering aangemaakt. Order ${payload.orderNumber}. Bekijk je reservering: ${payload.paymentUrl}`;
      window.location.href = payload.paymentUrl;
    } catch (error) {
      status!.textContent = error instanceof Error ? error.message : 'Er is een onbekende fout opgetreden.';
    }
  });
}

void initApp();
