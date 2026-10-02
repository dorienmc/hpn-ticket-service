import { defineConfig, devices } from '@playwright/test';

const frontendUrl = 'http://localhost:5180/hpn-ticket-service/';
const apiUrl = 'http://localhost:8789';

export default defineConfig({
  testDir: './e2e/express',
  timeout: 15_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['html', { outputFolder: 'playwright-report/express', open: 'never' }]],
  use: {
    baseURL: frontendUrl,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm --prefix apps/worker run start',
      url: `${apiUrl}/api/health`,
      reuseExistingServer: false,
      env: {
        PORT: '8789',
        PROJECT_ROOT: process.cwd(),
        DATABASE_PATH: ':memory:',
        MOCK_GOOGLE_LOGIN: 'true',
        MOCK_GOOGLE_EMAIL: 'dorienmc@gmail.com',
        ADMIN_ALLOWED_EMAILS: 'admin@example.com',
        FRONTEND_URL: frontendUrl,
      },
    },
    {
      command: 'npm --prefix apps/frontend run dev -- --host localhost --port 5180 --strictPort',
      url: frontendUrl,
      reuseExistingServer: false,
      env: {
        VITE_API_BASE_URL: apiUrl,
        VITE_FRONTEND_URL: frontendUrl,
        VITE_GOOGLE_AUTH_CLIENT_ID: '',
      },
    },
  ],
});
