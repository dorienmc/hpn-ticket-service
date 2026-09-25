import { expect, test } from '@playwright/test';

function uniqueEmail(): string {
  return `e2e-${Date.now()}@example.com`;
}

async function loginAsMockGoogleAdmin(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('http://localhost:8787/api/auth/google');
  await expect(page).toHaveURL(/\/hpn-ticket-service\/admin\/?$/);
}

test('admin page requires Google login', async ({ page }) => {
  await page.goto('admin');

  await expect(page.getByRole('heading', { name: 'Overzicht reserveringen' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Inloggen met Google' })).toBeVisible();
  await expect(page.locator('#admin-summary')).toBeEmpty();
  await expect(page.locator('#admin-list')).toBeEmpty();
});

test('admin can open a person reservation page', async ({ page, request }) => {
  const customerName = 'Reservation Link E2E Customer';
  const response = await request.post(`${process.env.E2E_API_URL || 'http://localhost:8787'}/api/reservations`, {
    data: {
      name: customerName,
      email: uniqueEmail(),
      quantity: 2,
    },
  });

  expect(response.ok()).toBeTruthy();
  const reservation = await response.json();

  await loginAsMockGoogleAdmin(page);
  const orderRow = page.locator('tr').filter({ hasText: reservation.orderNumber });
  await expect(orderRow).toContainText(customerName);

  const reservationPagePromise = page.waitForEvent('popup');
  await orderRow.getByRole('link', { name: 'Bekijk reservering' }).click();
  const reservationPage = await reservationPagePromise;

  await expect(reservationPage).toHaveURL(reservation.paymentUrl);
  await expect(reservationPage.getByRole('heading', { name: 'Reserveringsstatus' })).toBeVisible();
  await expect(reservationPage.getByText(customerName, { exact: true })).toBeVisible();
  await expect(reservationPage.getByText(reservation.orderNumber, { exact: true })).toBeVisible();
});

test('customer can create a reservation and view its private status page', async ({ page }) => {
  await page.goto('');

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

  await expect.poll(async () => {
    const response = await page.request.get('http://localhost:8025/api/v1/search?query=to:e2e-');
    const mailbox = await response.json();
    return mailbox.messages_count;
  }).toBeGreaterThan(0);
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
  await Promise.all([
    page.waitForResponse((response) => response.url().includes(`/api/admin/orders/${reservation.orderNumber}/pay`)),
    orderRow.getByRole('button', { name: 'Markeer als betaald' }).click(),
  ]);
  await page.waitForLoadState('networkidle');

  await page.goto(reservation.paymentUrl);
  await expect(page.getByText('Betaald', { exact: true })).toBeVisible();
  await expect(page.locator('.status-header .badge')).toHaveClass(/success/);
  await expect(page.getByText('De betaling is ontvangen.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Je tickets' })).toBeVisible();
  const ticketItems = page.locator('.ticket-list li');
  await expect(ticketItems).toHaveCount(2);
  await expect(ticketItems.filter({ hasText: 'Geldig' })).toHaveCount(2);
  await expect(ticketItems.filter({ hasText: 'Ingecheckt' })).toHaveCount(0);

  await page.goto('admin');
  await page.locator('#admin-tabs').getByRole('link', { name: 'Betaald', exact: true }).click();
  await expect(page).toHaveURL(/\?tab=PAID$/);
  const paidOrderRow = page.locator('tr').filter({ hasText: reservation.orderNumber });
  await paidOrderRow.getByRole('button', { name: 'Tickets inchecken' }).click();
  const ticketModal = page.locator('#ticket-modal');
  const ticketCode = await ticketModal.locator('.ticket-modal-list li').first().locator('span').first().textContent();
  await Promise.all([
    page.waitForResponse((response) => response.url().includes(`/api/admin/tickets/${ticketCode}/use`)),
    ticketModal.getByRole('button', { name: 'Inchecken', exact: true }).first().click(),
  ]);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('tr').filter({ hasText: reservation.orderNumber })).toContainText('1/2 ingecheckt');

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

  await Promise.all([
    page.waitForResponse((response) => response.url().includes(`/api/admin/orders/${reservation.orderNumber}/pay`)),
    orderRow.getByRole('button', { name: 'Markeer als betaald' }).click(),
  ]);
  await page.waitForLoadState('networkidle');

  await expect(orderRow).not.toBeVisible();

  await page.locator('#admin-tabs').getByRole('link', { name: 'Betaald', exact: true }).click();
  await expect(page).toHaveURL(/\?tab=PAID$/);
  const paidOrderRow = page.locator('tr').filter({ hasText: reservation.orderNumber });
  await expect(paidOrderRow).toContainText('Betaald');
  await expect(paidOrderRow).toContainText('0/1 ingecheckt');

  await paidOrderRow.getByRole('button', { name: 'Tickets inchecken' }).click();
  const ticketModal = page.locator('#ticket-modal');
  await expect(ticketModal).toBeVisible();
  const ticketCode = await ticketModal.locator('.ticket-modal-list li').first().locator('span').first().textContent();
  await Promise.all([
    page.waitForResponse((response) => response.url().includes(`/api/admin/tickets/${ticketCode}/use`)),
    ticketModal.getByRole('button', { name: 'Inchecken', exact: true }).click(),
  ]);
  await page.waitForLoadState('networkidle');
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
  await Promise.all([
    page.waitForResponse((response) => response.url().includes(`/api/admin/orders/${reservation.orderNumber}/pay`)),
    orderRow.getByRole('button', { name: 'Markeer als betaald' }).click(),
  ]);
  await page.waitForLoadState('networkidle');

  await page.locator('#admin-tabs').getByRole('link', { name: 'Betaald', exact: true }).click();
  await expect(page).toHaveURL(/\?tab=PAID$/);
  const paidOrderRow = page.locator('tr').filter({ hasText: reservation.orderNumber });
  await expect(paidOrderRow).toContainText('0/3 ingecheckt');

  await paidOrderRow.getByRole('button', { name: 'Tickets inchecken' }).click();
  const ticketModal = page.locator('#ticket-modal');
  await expect(ticketModal.locator('.ticket-modal-list li')).toHaveCount(3);

  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/admin/tickets/')),
    ticketModal.getByRole('button', { name: 'Alles inchecken' }).click(),
  ]);
  await page.waitForLoadState('networkidle');
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

  await page.locator('#admin-tabs').getByRole('link', { name: 'Betaald', exact: true }).click();
  await expect(page).toHaveURL(/\?tab=PAID$/);
  await expect(orderRow).not.toBeVisible();

  await page.locator('#admin-tabs').getByRole('link', { name: 'Gereserveerd', exact: true }).click();
  await expect(page).toHaveURL(/\?tab=RESERVED$/);
  await page.getByLabel('Reserveringen zoeken').fill('Filterable E2E Customer');
  await expect(orderRow).toBeVisible();
});
