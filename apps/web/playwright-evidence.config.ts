import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

config({ path: resolve(import.meta.dirname, '../../.env') });

const PORT = Number(process.env.WEB_PORT ?? 5173);
const API_PORT = Number(process.env.API_PORT ?? process.env.SERVER_PORT ?? 3001);

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/pipeline/**'],
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
  webServer: [
    ...(!process.env.EVIDENCE_ONLY
      ? [
          {
            command: 'pnpm --filter @goose-hub/server start',
            port: API_PORT,
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
            env: {
              GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? '',
              PORT: String(API_PORT),
            },
          },
        ]
      : []),
    {
      command: `pnpm dev --port ${PORT}`,
      port: PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        SERVER_PORT: String(API_PORT),
      },
    },
  ],
});
