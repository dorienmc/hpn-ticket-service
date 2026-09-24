import './styles.css';

const app = document.querySelector('#app');

if (!app) {
  throw new Error('App root not found');
}

const appRoot = app;

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';
const maxTickets = import.meta.env.VITE_MAX_TICKETS_PER_RESERVATION ?? '5';
const reservationsEnabled = import.meta.env.VITE_RESERVATIONS_ENABLED !== 'false';
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY ?? '';
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
const path = window.location.pathname;
const isAdminPath = path.replace(/\/+$/, '').endsWith('/admin');

let recaptchaScriptPromise: Promise<void> | null = null;

function loadRecaptcha(): Promise<void> {
  if (!recaptchaSiteKey) return Promise.resolve();
  if (window.grecaptcha) return Promise.resolve();
  if (recaptchaScriptPromise) return recaptchaScriptPromise;

  recaptchaScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(recaptchaSiteKey)}`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('reCAPTCHA kon niet worden geladen.'));
    document.head.append(script);
  });

  return recaptchaScriptPromise;
}

async function getRecaptchaToken(): Promise<string | undefined> {
  if (!recaptchaSiteKey) return undefined;

  await loadRecaptcha();
  return new Promise((resolve, reject) => {
    window.grecaptcha.ready(() => {
      window.grecaptcha.execute(recaptchaSiteKey, { action: 'reserve' }).then(resolve).catch(reject);
    });
  });
}

let googleScriptPromise: Promise<void> | null = null;

function loadGoogleIdentityServices(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Sign-In kon niet worden geladen.'));
    document.head.append(script);
  });

  return googleScriptPromise;
}

function statusLabel(status: string): string {
  return {
    RESERVED: 'Gereserveerd',
    PAID: 'Betaald',
    EXPIRED: 'Verlopen',
    CANCELLED: 'Geannuleerd',
    VALID: 'Geldig',
    USED: 'Ingecheckt',
  }[status] ?? status;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function initApp() {
  if (isAdminPath) {
    appRoot.innerHTML = `
      <main class="page page--admin">
        <section class="card reservation-card">
          <p class="eyebrow">Beheer</p>
          <h1>Overzicht reserveringen</h1>
          <div id="admin-summary" class="summary-grid"></div>
          <div id="admin-login" class="payment-box muted-box" hidden>
            <p>Log in om reserveringen te beheren.</p>
            <a id="admin-google-mock-link" class="primary-link" href="${baseUrl}/api/auth/google">Inloggen met Google</a>
            <div id="google-signin-button"></div>
            <p id="admin-google-error" class="error-message" aria-live="polite"></p>
            <form id="admin-password-form" class="form">
              <label>
                Beheerderswachtwoord
                <input id="admin-password" name="password" type="password" autocomplete="current-password" required />
              </label>
              <button type="submit">Inloggen met wachtwoord</button>
            </form>
            <p id="admin-password-error" class="error-message" aria-live="polite"></p>
          </div>
          <div id="admin-content" hidden>
            <div class="admin-toolbar">
              <button id="admin-logout" class="admin-button secondary">Uitloggen</button>
            </div>
            <div class="admin-filters">
              <label>
                Reserveringen zoeken
                <input id="order-search" type="search" placeholder="Ordernummer, naam of e-mail" />
              </label>
            </div>
            <div id="admin-tabs" class="admin-tabs">
              <button class="tab-button" data-tab="RESERVED">Gereserveerd</button>
              <button class="tab-button" data-tab="PAID">Betaald</button>
              <button class="tab-button" data-tab="ARCHIVE">Verlopen / geannuleerd</button>
            </div>
            <div id="admin-list" class="admin-list"></div>
          </div>
          <p id="admin-status" class="status" aria-live="polite"></p>
        </section>
      </main>
      <dialog id="ticket-modal" class="ticket-modal">
        <div class="ticket-modal-header">
          <h2 id="ticket-modal-title">Tickets</h2>
          <button class="admin-button secondary" data-action="close-modal">Sluiten</button>
        </div>
        <div id="ticket-modal-body"></div>
      </dialog>
    `;

    const summaryContainer = document.querySelector('#admin-summary');
    const listContainer = document.querySelector('#admin-list');
    const adminStatus = document.querySelector<HTMLParagraphElement>('#admin-status');
    const loginContainer = document.querySelector<HTMLDivElement>('#admin-login');
    const contentContainer = document.querySelector<HTMLDivElement>('#admin-content');

    try {
      const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, { credentials: 'include' });
      const session = await sessionResponse.json();

      if (!session.authenticated) {
        if (loginContainer) loginContainer.hidden = false;

        if (googleClientId) {
          const googleMockLink = document.querySelector<HTMLAnchorElement>('#admin-google-mock-link');
          if (googleMockLink) googleMockLink.hidden = true;

          const googleError = document.querySelector<HTMLParagraphElement>('#admin-google-error');
          const googleButtonContainer = document.querySelector<HTMLDivElement>('#google-signin-button');
          try {
            await loadGoogleIdentityServices();
            window.google?.accounts.id.initialize({
              client_id: googleClientId,
              callback: async (credentialResponse) => {
                const response = await fetch(`${baseUrl}/api/auth/google`, {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ credential: credentialResponse.credential }),
                });

                if (!response.ok) {
                  if (googleError) googleError.textContent = 'Inloggen met Google is mislukt.';
                  return;
                }

                window.location.reload();
              },
            });
            if (googleButtonContainer) {
              window.google?.accounts.id.renderButton(googleButtonContainer, { theme: 'outline', size: 'large' });
            }
          } catch (error) {
            if (googleError) googleError.textContent = error instanceof Error ? error.message : 'Google Sign-In kon niet worden geladen.';
          }
        }

        const passwordForm = document.querySelector<HTMLFormElement>('#admin-password-form');
        const passwordError = document.querySelector<HTMLParagraphElement>('#admin-password-error');
        passwordForm?.addEventListener('submit', async (event) => {
          event.preventDefault();
          const formData = new FormData(passwordForm);
          const password = String(formData.get('password') ?? '');

          const response = await fetch(`${baseUrl}/api/auth/password`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
          });

          if (!response.ok) {
            if (passwordError) passwordError.textContent = 'Ongeldig wachtwoord.';
            return;
          }

          window.location.reload();
        });

        return;
      }

      if (contentContainer) contentContainer.hidden = false;

      const ticketModalCloseButton = document.querySelector<HTMLButtonElement>('#ticket-modal [data-action="close-modal"]');
      ticketModalCloseButton?.addEventListener('click', () => {
        document.querySelector<HTMLDialogElement>('#ticket-modal')?.close();
      });

      const logoutButton = document.querySelector<HTMLButtonElement>('#admin-logout');
      logoutButton?.addEventListener('click', async () => {
        logoutButton.disabled = true;
        const response = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', credentials: 'include' });
        const payload = response.status === 204 ? null : await response.json();
        if (payload?.logoutUrl) {
          window.location.href = payload.logoutUrl;
          return;
        }
        window.location.reload();
      });

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

      async function refreshOrders() {
        const response = await fetch(`${baseUrl}/api/admin/orders`, { credentials: 'include' });
        const data = await response.json();
        orders.length = 0;
        orders.push(...(data.orders ?? []));
      }

      if (listContainer) {
        const searchInput = document.querySelector<HTMLInputElement>('#order-search');
        const tabButtons = document.querySelectorAll<HTMLButtonElement>('#admin-tabs [data-tab]');
        let activeTab: 'RESERVED' | 'PAID' | 'ARCHIVE' = 'RESERVED';

        const setActiveTab = (tab: typeof activeTab) => {
          activeTab = tab;
          tabButtons.forEach((tabButton) => {
            tabButton.classList.toggle('active', tabButton.dataset.tab === tab);
          });
          renderOrders();
        };

        const renderOrders = () => {
          const searchTerm = searchInput?.value.trim().toLowerCase() ?? '';
          const filteredOrders = orders.filter((order: any) => {
            const searchable = `${order.order_number} ${order.name} ${order.email}`.toLowerCase();
            const matchesTab = activeTab === 'ARCHIVE'
              ? (order.status === 'EXPIRED' || order.status === 'CANCELLED')
              : order.status === activeTab;
            return (!searchTerm || searchable.includes(searchTerm)) && matchesTab;
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
                    <td>${escapeHtml(order.order_number)}</td>
                    <td>${escapeHtml(order.name)}</td>
                    <td>${escapeHtml(order.email)}</td>
                    <td>${order.quantity}</td>
                    <td>${statusLabel(order.status)}</td>
                    <td>€${(order.amount_cents / 100).toFixed(2)}</td>
                    <td>
                      ${order.status === 'RESERVED'
                        ? `<div class="admin-actions">
                            <button class="admin-button" data-action="pay" data-order="${order.order_number}"><span aria-hidden="true">✅</span> Markeer als betaald</button>
                            <button class="admin-button secondary" data-action="extend" data-order="${order.order_number}"><span aria-hidden="true">⏱️</span> Verleng 24 uur</button>
                            <button class="admin-button secondary" data-action="resend" data-order="${order.order_number}"><span aria-hidden="true">✉️</span> Opnieuw sturen</button>
                            <button class="admin-button danger" data-action="cancel" data-order="${order.order_number}"><span aria-hidden="true">✕</span> Annuleer</button>
                          </div>`
                        : order.status === 'PAID'
                          ? (() => {
                              const tickets = order.tickets ?? [];
                              const usedCount = tickets.filter((ticket: { status: string }) => ticket.status === 'USED').length;
                              return `
                                <div class="ticket-progress">${usedCount}/${tickets.length} ingecheckt</div>
                                <div class="admin-actions">
                                  <button class="admin-button" data-action="open-tickets" data-order="${order.order_number}"><span aria-hidden="true">🎫</span> Tickets inchecken</button>
                                  <button class="admin-button secondary" data-action="resend" data-order="${order.order_number}"><span aria-hidden="true">✉️</span> Opnieuw sturen</button>
                                </div>
                              `;
                            })()
                        : `<div class="admin-actions">
                            <button class="admin-button secondary" data-action="resend" data-order="${order.order_number}"><span aria-hidden="true">✉️</span> Opnieuw sturen</button>
                          </div>`}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `;

          const ticketModal = document.querySelector<HTMLDialogElement>('#ticket-modal');
          const ticketModalTitle = document.querySelector<HTMLHeadingElement>('#ticket-modal-title');
          const ticketModalBody = document.querySelector<HTMLDivElement>('#ticket-modal-body');

          async function checkinTicket(ticketCode: string) {
            const response = await fetch(`${baseUrl}/api/admin/tickets/${encodeURIComponent(ticketCode)}/use`, {
              method: 'POST',
              credentials: 'include',
            });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload.error || 'Ticket kon niet worden ingecheckt.');
            }
            return payload;
          }

          function renderTicketModal(order: any) {
            if (!ticketModal || !ticketModalBody || !ticketModalTitle) return;
            ticketModalTitle.textContent = `Tickets voor ${order.order_number}`;
            const tickets = order.tickets ?? [];
            const remaining = tickets.filter((ticket: any) => ticket.status !== 'USED');

            ticketModalBody.innerHTML = `
              <button class="admin-button" data-modal-action="checkin-all" ${remaining.length ? '' : 'disabled'}><span aria-hidden="true">✅</span> Alles inchecken</button>
              <ul class="ticket-modal-list">
                ${tickets.map((ticket: any) => `
                  <li>
                    <span>${escapeHtml(ticket.ticket_code)}</span>
                    <span class="ticket-status${ticket.status === 'USED' ? ' used' : ''}">${statusLabel(ticket.status)}</span>
                    <button class="admin-button secondary" data-modal-action="checkin-one" data-ticket="${ticket.ticket_code}" ${ticket.status === 'USED' ? 'disabled' : ''}><span aria-hidden="true">🎫</span> Inchecken</button>
                  </li>
                `).join('')}
              </ul>
            `;

            ticketModalBody.querySelector<HTMLButtonElement>('[data-modal-action="checkin-all"]')?.addEventListener('click', async (event) => {
              const button = event.currentTarget as HTMLButtonElement;
              button.disabled = true;
              const targets = tickets.filter((ticket: any) => ticket.status !== 'USED');
              for (const ticket of targets) {
                try {
                  await checkinTicket(ticket.ticket_code);
                  ticket.status = 'USED';
                } catch (error) {
                  alert(error instanceof Error ? error.message : 'Ticket kon niet worden ingecheckt.');
                }
              }
              if (adminStatus) adminStatus.textContent = `Alle tickets van order ${order.order_number} zijn ingecheckt.`;
              renderTicketModal(order);
              renderOrders();
            });

            ticketModalBody.querySelectorAll<HTMLButtonElement>('[data-modal-action="checkin-one"]').forEach((button) => {
              button.addEventListener('click', async () => {
                const ticketCode = button.dataset.ticket;
                if (!ticketCode) return;
                button.disabled = true;
                try {
                  await checkinTicket(ticketCode);
                  const ticket = tickets.find((candidate: any) => candidate.ticket_code === ticketCode);
                  if (ticket) ticket.status = 'USED';
                  if (adminStatus) adminStatus.textContent = `Ticket ${ticketCode} is ingecheckt.`;
                  renderTicketModal(order);
                  renderOrders();
                } catch (error) {
                  button.disabled = false;
                  alert(error instanceof Error ? error.message : 'Ticket kon niet worden ingecheckt.');
                }
              });
            });
          }

          const buttons = listContainer.querySelectorAll<HTMLButtonElement>('[data-action][data-order]');
          buttons.forEach((button) => {
            button.addEventListener('click', async () => {
              const orderNumber = button.dataset.order;
              const action = button.dataset.action;
              if (!orderNumber || !action) return;

              if (action === 'open-tickets') {
                const order = orders.find((candidate: any) => candidate.order_number === orderNumber);
                if (order) {
                  renderTicketModal(order);
                  ticketModal?.showModal();
                }
                return;
              }

              const confirmation = action === 'cancel'
                ? `Reservering ${orderNumber} annuleren? De tickets komen dan weer beschikbaar.`
                : undefined;

              if (confirmation && !window.confirm(confirmation)) {
                return;
              }

              button.disabled = true;
              const endpoint = `${baseUrl}/api/admin/orders/${encodeURIComponent(orderNumber)}/${action}`;
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
                    : `De reserverings-e-mail is opnieuw verstuurd naar ${payload.email}.`;
                    if (action === 'pay' || action === 'cancel') {
                      await refreshOrders();
                    } else {
                      const order = orders.find((candidate: any) => candidate.order_number === orderNumber);
                      if (order && action === 'extend') order.expires_at = payload.expiresAt;
                    }
                    if (adminStatus) adminStatus.textContent = message;
                    renderOrders();
            });
          });

        };

        searchInput?.addEventListener('input', renderOrders);
        tabButtons.forEach((tabButton) => {
          tabButton.addEventListener('click', () => {
            const tab = tabButton.dataset.tab as typeof activeTab | undefined;
            if (tab) setActiveTab(tab);
          });
        });
        setActiveTab('RESERVED');
      }
    } catch (error) {
      if (listContainer) {
        listContainer.innerHTML = `<p class="error-message">${error instanceof Error ? error.message : 'Beheergegevens konden niet worden geladen.'}</p>`;
      }
    }

    return;
  }

  if (path.includes('/payment/')) {
    const segments = path.split('/').filter(Boolean);
    const orderNumber = segments.at(-2);
    const token = segments.at(-1);

    appRoot.innerHTML = `
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
                <p>De betaling is ontvangen.</p>
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
            <div><dt>Ordernummer</dt><dd>${escapeHtml(payload.orderNumber)}</dd></div>
              <div><dt>Naam</dt><dd>${escapeHtml(payload.name)}</dd></div>
              <div><dt>E-mail</dt><dd>${escapeHtml(payload.email)}</dd></div>
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

  appRoot.innerHTML = `
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

          <button type="submit" ${reservationsEnabled ? '' : 'disabled'}>Tickets reserveren</button>
        </form>

        <p id="status" class="status" aria-live="polite">${reservationsEnabled ? '' : 'Online reserveren is binnenkort beschikbaar.'}</p>
      </section>
    </main>
  `;

  const form = document.querySelector<HTMLFormElement>('#reservation-form');
  const status = document.querySelector<HTMLParagraphElement>('#status');

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!reservationsEnabled) {
      status!.textContent = 'Online reserveren is binnenkort beschikbaar.';
      return;
    }

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
      const recaptchaToken = await getRecaptchaToken();
      const response = await fetch(`${baseUrl}/api/reservations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, quantity, recaptchaToken })
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
