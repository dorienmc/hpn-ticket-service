import { expect, test } from '@playwright/test';

function uniqueEmail(): string {
  return `e2e-${Date.now()}@example.com`;
}

async function loginAsMockGoogleAdmin(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('http://localhost:8787/api/auth/google');
  await expect(page).toHaveURL(/\/admin$/);
}

test('admin page requires Google login', async ({ page }) => {
  await page.goto('/admin');

  await expect(page.getByRole('heading', { name: 'Overzicht reserveringen' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Inloggen met Google' })).toBeVisible();
  await expect(page.locator('#admin-summary')).toBeEmpty();
  await expect(page.locator('#admin-list')).toBeEmpty();
});

test('customer can create a reservation and view its private status page', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Volledige naam').fill('E2E Customer');
  await page.getByLabel('E-mailadres').fill(uniqueEmail());
  await page.getByLabel('Aantal tickets').fill('2');
  await page.getByRole('button', { name: 'Tickets reserveren' }).click();

  await expect(page).toHaveURL(/\/payment\/HP9-[^/]+\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Reserveringsstatus' })).toBeVisible();
  await expect(page.getByText('Gereserveerd', { exact: true })).toBeVisible();
  await expect(page.getByText('E2E Customer', { exact: true })).toBeVisible();
  await expect(page.getByText('Betalen via ING', { exact: true })).toBeVisible();
  await expect(page.locator('.status-header .badge')).toHaveClass(/info/);
  await expect(page.locator('.ticket-list')).toHaveCount(0);
});

test('customer status page reflects paid status and ticket check-in state', async ({ page, request }) => {
  const response = await request.post(`${process.env.E2E_API_URL || 'http://localhost:8787'}/api/reservations`, {
    data: {
      name: 'Status Page E2E Customer',
      email: uniqueEmail(),
      quantity: 2,
    },
  });

  expect(response.ok()).toBeTruthy();
  const reservation = await response.json();

  await page.goto(reservation.paymentUrl);
  await expect(page.getByText('Gereserveerd', { exact: true })).toBeVisible();
  await expect(page.locator('.status-header .badge')).toHaveClass(/info/);
  await expect(page.getByText('Voor deze reservering moet nog worden betaald.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Je tickets' })).toHaveCount(0);

  await loginAsMockGoogleAdmin(page);
  const orderRow = page.locator('tr').filter({ hasText: reservation.orderNumber });
  await orderRow.getByRole('button', { name: 'Markeer als betaald' }).click();
  await expect(page.getByText(`Order ${reservation.orderNumber} is als betaald gemarkeerd.`)).toBeVisible();

  await page.goto(reservation.paymentUrl);
  await expect(page.getByText('Betaald', { exact: true })).toBeVisible();
  await expect(page.locator('.status-header .badge')).toHaveClass(/success/);
  await expect(page.getByText('De betaling is ontvangen.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Je tickets' })).toBeVisible();
  const ticketItems = page.locator('.ticket-list li');
  await expect(ticketItems).toHaveCount(2);
  await expect(ticketItems.filter({ hasText: 'Geldig' })).toHaveCount(2);
  await expect(ticketItems.filter({ hasText: 'Ingecheckt' })).toHaveCount(0);

  await page.goto('/admin');
  await page.locator('#admin-tabs').getByRole('button', { name: 'Betaald', exact: true }).click();
  const paidOrderRow = page.locator('tr').filter({ hasText: reservation.orderNumber });
  await paidOrderRow.getByRole('button', { name: 'Tickets inchecken' }).click();
  const ticketModal = page.locator('#ticket-modal');
  await ticketModal.getByRole('button', { name: 'Inchecken', exact: true }).first().click();
  await expect(ticketModal.locator('.ticket-status.used')).toHaveCount(1);
  await ticketModal.getByRole('button', { name: 'Sluiten' }).click();

  await page.goto(reservation.paymentUrl);
  const refreshedTicketItems = page.locator('.ticket-list li');
  await expect(refreshedTicketItems.filter({ hasText: 'Ingecheckt' })).toHaveCount(1);
  await expect(refreshedTicketItems.filter({ hasText: 'Geldig' })).toHaveCount(1);
});

test('admin can mark a reservation as paid and check in its ticket', async ({ page, request }) => {
  const response = await request.post(`${process.env.E2E_API_URL || 'http://localhost:8787'}/api/reservations`, {
    data: {
      name: 'Admin E2E Customer',
      email: uniqueEmail(),
      quantity: 1,
    },
  });

  expect(response.ok()).toBeTruthy();
  const reservation = await response.json();

  await loginAsMockGoogleAdmin(page);
  const orderRow = page.locator('tr').filter({ hasText: reservation.orderNumber });
  await expect(orderRow).toBeVisible();

  await orderRow.getByRole('button', { name: 'Markeer als betaald' }).click();

  await expect(page.getByText(`Order ${reservation.orderNumber} is als betaald gemarkeerd.`)).toBeVisible();
  await expect(orderRow).not.toBeVisible();

  await page.locator('#admin-tabs').getByRole('button', { name: 'Betaald', exact: true }).click();
  const paidOrderRow = page.locator('tr').filter({ hasText: reservation.orderNumber });
  await expect(paidOrderRow).toContainText('Betaald');
  await expect(paidOrderRow).toContainText('0/1 ingecheckt');

  await paidOrderRow.getByRole('button', { name: 'Tickets inchecken' }).click();
  const ticketModal = page.locator('#ticket-modal');
  await expect(ticketModal).toBeVisible();
  await ticketModal.getByRole('button', { name: 'Inchecken', exact: true }).click();
  await expect(page.getByText(/Ticket HP9-TKT-.* is ingecheckt\./)).toBeVisible();
  await expect(ticketModal.locator('.ticket-status.used')).toHaveCount(1);
  await ticketModal.getByRole('button', { name: 'Sluiten' }).click();
  await expect(paidOrderRow).toContainText('1/1 ingecheckt');

  await page.goto(reservation.paymentUrl);
  await expect(page.getByRole('heading', { name: 'Je tickets' })).toBeVisible();
  await expect(page.locator('.ticket-list li')).toHaveCount(1);
});

test('admin can check in all tickets of an order at once', async ({ page, request }) => {
  const response = await request.post(`${process.env.E2E_API_URL || 'http://localhost:8787'}/api/reservations`, {
    data: {
      name: 'Bulk Checkin E2E Customer',
      email: uniqueEmail(),
      quantity: 3,
    },
  });

  expect(response.ok()).toBeTruthy();
  const reservation = await response.json();

  await loginAsMockGoogleAdmin(page);
  const orderRow = page.locator('tr').filter({ hasText: reservation.orderNumber });
  await orderRow.getByRole('button', { name: 'Markeer als betaald' }).click();
  await expect(page.getByText(`Order ${reservation.orderNumber} is als betaald gemarkeerd.`)).toBeVisible();

  await page.locator('#admin-tabs').getByRole('button', { name: 'Betaald', exact: true }).click();
  const paidOrderRow = page.locator('tr').filter({ hasText: reservation.orderNumber });
  await expect(paidOrderRow).toContainText('0/3 ingecheckt');

  await paidOrderRow.getByRole('button', { name: 'Tickets inchecken' }).click();
  const ticketModal = page.locator('#ticket-modal');
  await expect(ticketModal.locator('.ticket-modal-list li')).toHaveCount(3);

  await ticketModal.getByRole('button', { name: 'Alles inchecken' }).click();
  await expect(page.getByText(`Alle tickets van order ${reservation.orderNumber} zijn ingecheckt.`)).toBeVisible();
  await expect(ticketModal.locator('.ticket-status.used')).toHaveCount(3);

  await ticketModal.getByRole('button', { name: 'Sluiten' }).click();
  await expect(paidOrderRow).toContainText('3/3 ingecheckt');
});

test('admin can filter orders by search and tab', async ({ page, request }) => {
  const response = await request.post(`${process.env.E2E_API_URL || 'http://localhost:8787'}/api/reservations`, {
    data: {
      name: 'Filterable E2E Customer',
      email: uniqueEmail(),
      quantity: 1,
    },
  });

  expect(response.ok()).toBeTruthy();
  const reservation = await response.json();

  await loginAsMockGoogleAdmin(page);
  const orderRow = page.locator('tr').filter({ hasText: reservation.orderNumber });
  await expect(orderRow).toBeVisible();

  await page.locator('#admin-tabs').getByRole('button', { name: 'Betaald', exact: true }).click();
  await expect(orderRow).not.toBeVisible();

  await page.locator('#admin-tabs').getByRole('button', { name: 'Gereserveerd', exact: true }).click();
  await page.getByLabel('Reserveringen zoeken').fill('Filterable E2E Customer');
  await expect(orderRow).toBeVisible();
});
