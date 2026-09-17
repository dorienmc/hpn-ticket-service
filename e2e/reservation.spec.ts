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
});

test('admin can mark a reservation as paid', async ({ page, request }) => {
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
  await expect(page.locator('tr').filter({ hasText: reservation.orderNumber })).toContainText('Betaald');

  await page.goto(reservation.paymentUrl);
  await expect(page.getByRole('heading', { name: 'Je tickets' })).toBeVisible();
  await expect(page.locator('.ticket-list li')).toHaveCount(1);

  await loginAsMockGoogleAdmin(page);
  const paidOrderRow = page.locator('tr').filter({ hasText: reservation.orderNumber });
  await expect(paidOrderRow.getByRole('button', { name: /HP9-TKT-.*Inchecken/ })).toBeVisible();
  await paidOrderRow.getByRole('button', { name: /HP9-TKT-.*Inchecken/ }).click();
  await expect(page.getByText(/Ticket HP9-TKT-.* is ingecheckt\./)).toBeVisible();
});

test('admin can filter orders by search and status', async ({ page, request }) => {
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

  await page.getByLabel('Status').selectOption('PAID');
  await expect(orderRow).not.toBeVisible();

  await page.getByLabel('Status').selectOption('RESERVED');
  await page.getByLabel('Reserveringen zoeken').fill('Filterable E2E Customer');
  await expect(orderRow).toBeVisible();
});
