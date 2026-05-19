import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

config({ path: resolve(import.meta.dirname, '../../.env') });

const PORT = Number(process.env.WEB_PORT ?? 5398);
const MOCK_SERVER_PORT = Number(process.env.CHAT_API_PORT ?? 3198);

process.env.SERVER_URL = `http://localhost:${MOCK_SERVER_PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: 'chat.spec.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
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
            // Mock-backed server so chat tools work without a GitHub token.
            // MOCK_AGENTS + MOCK_SOURCE together make hub-chat runs deterministic.
            command: 'pnpm --filter @goose-hub/server start',
            port: MOCK_SERVER_PORT,
            reuseExistingServer: false,
            timeout: 30_000,
            env: {
              PORT: String(MOCK_SERVER_PORT),
              GITHUB_TOKEN: '',
              GITHUB_WEBHOOK_SECRET: 'mock-webhook-secret-for-e2e',
              MOCK_AGENTS: 'true',
              MOCK_SOURCE: 'true',
              DB_PATH: resolve(import.meta.dirname, '../../.e2e-chat.db'),
            },
          },
          {
            command: `pnpm dev --port ${PORT}`,
            port: PORT,
            reuseExistingServer: false,
            timeout: 30_000,
            env: { SERVER_PORT: String(MOCK_SERVER_PORT) },
          },
        ],
});
