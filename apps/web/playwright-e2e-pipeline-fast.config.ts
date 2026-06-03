import { defineConfig } from '@playwright/test';
import baseConfig from './playwright-e2e-pipeline.config.js';

export default defineConfig({
  ...baseConfig,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  maxFailures: 3,
  retries: 0,
  use: {
    ...baseConfig.use,
    trace: 'retain-on-failure',
  },
});
