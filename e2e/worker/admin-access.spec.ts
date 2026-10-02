import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiUrl = process.env.E2E_API_URL || 'http://localhost:8789';
const frontendOrigin = 'http://localhost:5180';
const ownerEmail = 'dorienmc@gmail.com';
const emailLabel = 'Toegestane Google e-mailadressen (een per regel)';
let ownerRequest: APIRequestContext;
let originalEmails: string[];

async function login(page: Page, email = ownerEmail) {
  await page.goto(`${apiUrl}/api/auth/google?email=${encodeURIComponent(email)}`);
  await expect(page).toHaveURL('http://localhost:5180/hpn-ticket-service/admin');
}

test.beforeEach(async ({ playwright }) => {
  ownerRequest = await playwright.request.newContext();
  const loginResponse = await ownerRequest.get(`${apiUrl}/api/auth/google?email=${ownerEmail}`, { maxRedirects: 0 });
  expect(loginResponse.status()).toBe(302);
  const access = await ownerRequest.get(`${apiUrl}/api/admin/access`);
  expect(access.ok()).toBeTruthy();
  originalEmails = (await access.json()).emails;
});

test.afterEach(async () => {
  try {
    const response = await ownerRequest.post(`${apiUrl}/api/admin/access`, {
      headers: { Origin: frontendOrigin },
      data: { emails: originalEmails },
    });
    expect(response.ok()).toBeTruthy();
  } finally {
    await ownerRequest.dispose();
  }
});

test('owner can add an admin through the UI and changes survive reload and relogin', async ({ page, browser }) => {
  const newEmail = `added-${Date.now()}@example.com`;
  await login(page);
  await expect(page.getByRole('heading', { name: 'Toegang voor beheerders' })).toBeVisible();
  await expect(page.getByLabel(emailLabel)).toHaveValue(originalEmails.join('\n'));
  await page.getByLabel(emailLabel).fill([...originalEmails, ` ${newEmail.toUpperCase()} `, newEmail].join('\n'));
  await page.getByRole('button', { name: 'Toegang opslaan' }).click();
  await expect(page.getByText('Beheerderstoegang opgeslagen.', { exact: true })).toBeVisible();
  const expectedValue = [...originalEmails, newEmail].join('\n');
  await expect(page.getByLabel(emailLabel)).toHaveValue(expectedValue);
  await page.reload();
  await expect(page.getByLabel(emailLabel)).toHaveValue(expectedValue);
  await page.getByRole('button', { name: 'Uitloggen', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Inloggen met Google' })).toBeVisible();
  await login(page);
  await expect(page.getByLabel(emailLabel)).toHaveValue(expectedValue);

  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await login(other, newEmail);
    await expect(other.locator('#admin-content')).toBeVisible();
    await expect(other.locator('#admin-access')).toBeHidden();
    expect((await otherContext.request.get(`${apiUrl}/api/admin/access`)).status()).toBe(403);
    expect((await otherContext.request.post(`${apiUrl}/api/admin/access`, {
      headers: { Origin: frontendOrigin }, data: { emails: [ownerEmail] },
    })).status()).toBe(403);
  } finally {
    await otherContext.close();
  }
});

test('owner sees explicit validation errors and cannot remove their own access', async ({ page }) => {
  await login(page);
  await expect(page.getByLabel(emailLabel)).toHaveValue(originalEmails.join('\n'));
  await page.getByLabel(emailLabel).fill('someone@example.com');
  await page.getByRole('button', { name: 'Toegang opslaan' }).click();
  await expect(page.getByText('The owner email cannot be removed', { exact: true })).toBeVisible();
  await page.getByLabel(emailLabel).fill(`${ownerEmail}\ninvalid-email`);
  await page.getByRole('button', { name: 'Toegang opslaan' }).click();
  await expect(page.getByText('Provide valid email addresses; the allowlist cannot be empty', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(emailLabel)).toHaveValue(originalEmails.join('\n'));
});

test('removal revokes an already logged-in admin and blocks subsequent login', async ({ page, browser }) => {
  const removedEmail = `removed-${Date.now()}@example.com`;
  await login(page);
  await expect(page.getByLabel(emailLabel)).toHaveValue(originalEmails.join('\n'));
  await page.getByLabel(emailLabel).fill([...originalEmails, removedEmail].join('\n'));
  await page.getByRole('button', { name: 'Toegang opslaan' }).click();
  await expect(page.getByText('Beheerderstoegang opgeslagen.', { exact: true })).toBeVisible();
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await login(other, removedEmail);
    await expect(other.locator('#admin-content')).toBeVisible();
    await page.getByLabel(emailLabel).fill(originalEmails.join('\n'));
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/api/admin/access') && response.request().method() === 'POST'),
      page.getByRole('button', { name: 'Toegang opslaan' }).click(),
    ]);
    expect((await otherContext.request.get(`${apiUrl}/api/admin/orders`)).status()).toBe(401);
    await other.reload();
    await expect(other.getByRole('link', { name: 'Inloggen met Google' })).toBeVisible();
    await expect(other.locator('#admin-content')).toBeHidden();
    const rejected = await otherContext.request.get(`${apiUrl}/api/auth/google?email=${removedEmail}`, { maxRedirects: 0 });
    expect(rejected.status()).toBe(403);
  } finally {
    await otherContext.close();
  }
});

test('unauthenticated and cross-site updates fail without changing the saved list', async ({ page, request }) => {
  expect((await request.get(`${apiUrl}/api/admin/access`)).status()).toBe(401);
  expect((await request.post(`${apiUrl}/api/admin/access`, {
    headers: { Origin: frontendOrigin }, data: { emails: [ownerEmail] },
  })).status()).toBe(401);
  await login(page);
  const response = await page.request.post(`${apiUrl}/api/admin/access`, {
    headers: { Origin: 'http://attacker.example' }, data: { emails: [ownerEmail] },
  });
  expect(response.status()).toBe(403);
  await page.reload();
  await expect(page.getByLabel(emailLabel)).toHaveValue(originalEmails.join('\n'));
});
