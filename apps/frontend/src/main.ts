import './styles.css';

const app = document.querySelector('#app');

if (!app) {
  throw new Error('App root not found');
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
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'}/api/reservations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, quantity })
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Reservation failed');
    }

    status!.textContent = `Reservation created. Order ${payload.orderNumber}. Payment link: ${payload.paymentUrl}`;
  } catch (error) {
    status!.textContent = error instanceof Error ? error.message : 'Unknown error';
  }
});
