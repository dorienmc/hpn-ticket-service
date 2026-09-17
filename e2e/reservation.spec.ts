import { expect, test } from '@playwright/test';

function uniqueEmail(): string {
  return `e2e-${Date.now()}@example.com`;
}

test('customer can create a reservation and view its private status page', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Full name').fill('E2E Customer');
  await page.getByLabel('Email address').fill(uniqueEmail());
  await page.getByLabel('Number of tickets').fill('2');
  await page.getByRole('button', { name: 'Reserve tickets' }).click();

  await expect(page).toHaveURL(/\/payment\/HP9-[^/]+\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Reservation status' })).toBeVisible();
  await expect(page.getByText('Reserved', { exact: true })).toBeVisible();
  await expect(page.getByText('E2E Customer', { exact: true })).toBeVisible();
  await expect(page.getByText('Pay via ING', { exact: true })).toBeVisible();
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

  await page.goto('/admin');
  const orderRow = page.locator('tr').filter({ hasText: reservation.orderNumber });
  await expect(orderRow).toBeVisible();

  const dialogPromise = page.waitForEvent('dialog');
  await orderRow.getByRole('button', { name: 'Mark paid' }).click();

  const dialog = await dialogPromise;
  expect(dialog.message()).toBe(`Order ${reservation.orderNumber} marked as paid.`);
  await dialog.accept();
  await expect(page.locator('tr').filter({ hasText: reservation.orderNumber })).toContainText('PAID');
});
