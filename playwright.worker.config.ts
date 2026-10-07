import { defineConfig, devices } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const frontendUrl = 'http://localhost:5180/hpn-ticket-service/';
const apiUrl = 'http://localhost:8789';
process.env.E2E_API_URL = apiUrl;
process.env.E2E_MAILPIT_URL = 'http://127.0.0.1:8030';
const stateDirectory = process.env.E2E_STATE_DIR ?? mkdtempSync(join(tmpdir(), 'hpn-worker-e2e-'));
mkdirSync(stateDirectory, { recursive: true });
process.env.E2E_STATE_DIR = stateDirectory;

export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/reservation.spec.ts', '**/worker/*.spec.ts'],
  timeout: 15_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['html', { outputFolder: 'playwright-report/worker', open: 'never' }]],
  use: {
    baseURL: frontendUrl,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node apps/worker/scripts/run-e2e-worker.mjs',
      url: `${apiUrl}/api/health`,
      reuseExistingServer: false,
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
