import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dirname, '../../.env') });

const PORT = Number(process.env.WEB_PORT ?? 5173);

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer:
    process.env.SKIP_WEBSERVER === '1'
      ? undefined
      : [
          {
            // Apps/server boots first — vite proxies /api and /events to it.
            command: 'pnpm --filter @goose-hub/server start',
            port: 3001,
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
            env: {
              GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? '',
            },
          },
          {
            command: `pnpm dev --port ${PORT}`,
            port: PORT,
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
          },
        ],
});
