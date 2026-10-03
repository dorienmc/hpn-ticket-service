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

async function openAccessPage(page: Page) {
  await expect(page.locator('#admin-access-form')).toHaveCount(0);
  const link = page.getByRole('link', { name: 'Toegang voor beheerders', exact: true });
  await expect(link).toHaveAttribute('href', '/hpn-ticket-service/admin/access');
  await link.click();
  await expect(page).toHaveURL(`${frontendOrigin}/hpn-ticket-service/admin/access`);
  await expect(page.getByRole('heading', { name: 'Toegang voor beheerders', level: 1 })).toBeVisible();
  await expect(page.locator('#order-search')).toHaveCount(0);
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
  await openAccessPage(page);
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
  await openAccessPage(page);
  await expect(page.getByLabel(emailLabel)).toHaveValue(expectedValue);
  await page.getByRole('link', { name: 'Terug naar reserveringen' }).click();
  await expect(page).toHaveURL(`${frontendOrigin}/hpn-ticket-service/admin`);
  await expect(page.getByRole('heading', { name: 'Overzicht reserveringen' })).toBeVisible();

  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await login(other, newEmail);
    await expect(other.locator('#admin-content')).toBeVisible();
    await expect(other.getByRole('link', { name: 'Toegang voor beheerders', exact: true })).toBeHidden();
    await other.goto('http://localhost:5180/hpn-ticket-service/admin/access');
    await expect(other.getByRole('alert')).toHaveText('Alleen de eigenaar ingelogd met Google kan beheerderstoegang beheren.');
    await expect(other.locator('#admin-access-form')).toHaveCount(0);
    expect((await otherContext.request.get(`${apiUrl}/api/admin/access`)).status()).toBe(403);
    expect((await otherContext.request.get(`${apiUrl}/api/admin/access/config`)).status()).toBe(403);
    expect((await otherContext.request.post(`${apiUrl}/api/admin/access`, {
      headers: { Origin: frontendOrigin }, data: { emails: [ownerEmail] },
    })).status()).toBe(403);
  } finally {
    await otherContext.close();
  }
});

test('owner sees explicit validation errors and cannot remove their own access', async ({ page }) => {
  await login(page);
  await openAccessPage(page);
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
  await openAccessPage(page);
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
  await openAccessPage(page);
  const response = await page.request.post(`${apiUrl}/api/admin/access`, {
    headers: { Origin: 'http://attacker.example' }, data: { emails: [ownerEmail] },
  });
  expect(response.status()).toBe(403);
  await page.reload();
  await expect(page.getByLabel(emailLabel)).toHaveValue(originalEmails.join('\n'));
});

test('direct access-page navigation requires login and supports a trailing slash', async ({ page }) => {
  await page.goto(`${frontendOrigin}/hpn-ticket-service/admin/access/`);
  await expect(page.getByRole('heading', { name: 'Toegang voor beheerders', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Inloggen met Google' })).toBeVisible();
  await expect(page.locator('#admin-access-form')).toHaveCount(0);

  await login(page);
  await page.goto(`${frontendOrigin}/hpn-ticket-service/admin/access/`);
  await expect(page.getByLabel(emailLabel)).toHaveValue(originalEmails.join('\n'));
});

test('password-only admins cannot manage access through direct navigation', async ({ page }) => {
  await page.goto(`${frontendOrigin}/hpn-ticket-service/admin/access`);
  await page.getByLabel('Beheerderswachtwoord').fill('local-development-only');
  await page.getByRole('button', { name: 'Inloggen met wachtwoord' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('#admin-access-form')).toHaveCount(0);
  await expect(page.locator('#admin-config')).toHaveCount(0);
  expect((await page.request.get(`${apiUrl}/api/admin/access/config`)).status()).toBe(403);
  await page.getByRole('link', { name: 'Terug naar reserveringen' }).click();
  await expect(page.getByRole('link', { name: 'Toegang voor beheerders', exact: true })).toBeHidden();
});

test('owner sees all seven read-only configuration values', async ({ page, request }) => {
  expect((await request.get(`${apiUrl}/api/admin/access/config`)).status()).toBe(401);
  await login(page);
  await openAccessPage(page);
  const response = await page.request.get(`${apiUrl}/api/admin/access/config`);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  const config = await response.json();
  const keys = [
    'GOOGLE_CLIENT_ID', 'GOOGLE_AUTH_CLIENT_ID',
    'ING_PAYMENT_LINK_1', 'ING_PAYMENT_LINK_2', 'ING_PAYMENT_LINK_3',
    'ING_PAYMENT_LINK_4', 'ING_PAYMENT_LINK_5',
  ];
  expect(Object.keys(config)).toEqual(keys);
  await expect(page.locator('#admin-config-values > div')).toHaveCount(7);
  for (const key of keys) {
    const row = page.locator('#admin-config-values > div').filter({ has: page.getByText(key, { exact: true }) });
    await expect(row.locator('dd')).toHaveText(config[key] ?? 'Niet ingesteld');
    await expect(row.locator('input, textarea')).toHaveCount(0);
  }
});

test('configuration values are rendered as text, not HTML', async ({ page }) => {
  await login(page);
  await page.route('**/api/admin/access/config', (route) => route.fulfill({
    json: {
      GOOGLE_CLIENT_ID: '<img src=x onerror=alert(1)>',
      GOOGLE_AUTH_CLIENT_ID: null,
      ING_PAYMENT_LINK_1: null, ING_PAYMENT_LINK_2: null, ING_PAYMENT_LINK_3: null,
      ING_PAYMENT_LINK_4: null, ING_PAYMENT_LINK_5: null,
    },
  }));
  await openAccessPage(page);
  await expect(page.locator('#admin-config-values')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#admin-config-values img')).toHaveCount(0);
});

test('configuration loading failures are explicit and do not prevent saving access', async ({ page }) => {
  await login(page);
  await page.route('**/api/admin/access/config', (route) => route.fulfill({
    status: 503,
    json: { error: 'Configuration temporarily unavailable' },
  }));
  await openAccessPage(page);
  await expect(page.locator('#admin-config-status')).toHaveText('Configuration temporarily unavailable');
  await expect(page.locator('#admin-config-values')).toBeEmpty();
  await expect(page.getByLabel(emailLabel)).toHaveValue(originalEmails.join('\n'));
  await expect(page.getByRole('button', { name: 'Toegang opslaan' })).toBeEnabled();
  await page.getByRole('button', { name: 'Toegang opslaan' }).click();
  await expect(page.getByText('Beheerderstoegang opgeslagen.', { exact: true })).toBeVisible();
  await expect(page.locator('#admin-config-status')).toHaveText('Configuration temporarily unavailable');
  const access = await page.request.get(`${apiUrl}/api/admin/access`);
  expect(access.ok()).toBeTruthy();
  expect((await access.json()).emails).toEqual(originalEmails);
});

test('configuration labels and long values fit at desktop, mobile and breakpoint widths', async ({ page }) => {
  await login(page);
  const longValue = `https://example.com/${'a'.repeat(300)}`;
  await page.route('**/api/admin/access/config', (route) => route.fulfill({
    json: {
      GOOGLE_CLIENT_ID: longValue, GOOGLE_AUTH_CLIENT_ID: longValue,
      ING_PAYMENT_LINK_1: longValue, ING_PAYMENT_LINK_2: longValue,
      ING_PAYMENT_LINK_3: longValue, ING_PAYMENT_LINK_4: longValue,
      ING_PAYMENT_LINK_5: longValue,
    },
  }));
  await openAccessPage(page);
  await expect(page.locator('#admin-config-values > div')).toHaveCount(7);
  for (const width of [1280, 721, 720, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const section = page.locator('#admin-config');
    expect(await section.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const sectionBounds = await section.boundingBox();
    if (!sectionBounds) throw new Error('Configuration section is not visible');
    expect(sectionBounds.x).toBeGreaterThanOrEqual(0);
    expect(sectionBounds.x + sectionBounds.width).toBeLessThanOrEqual(width + 1);
    for (const row of await page.locator('#admin-config-values > div').all()) {
      const label = await row.locator('dt').boundingBox();
      const value = await row.locator('dd').boundingBox();
      const bounds = await row.boundingBox();
      expect(label).not.toBeNull();
      expect(value).not.toBeNull();
      expect(bounds).not.toBeNull();
      if (!label || !value || !bounds) throw new Error('Configuration row is not visible');
      if (width > 720) {
        expect(label.x + label.width).toBeLessThanOrEqual(value.x);
      } else {
        expect(label.y + label.height).toBeLessThanOrEqual(value.y);
      }
      expect(value.x + value.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
      expect(await row.locator('dd').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
  }
});
