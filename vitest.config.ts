import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'apps/web/src'),
      '@goose-hub/core': path.resolve(__dirname, 'core'),
      '@goose-hub/skills': path.resolve(__dirname, 'skills'),
      '#shared': path.resolve(__dirname, 'apps/server/src/shared'),
    },
  },
  test: {
    maxWorkers: 2,
    minWorkers: 1,
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.claude/**',
      '**/.worktrees/**',
      'docs/design/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.claude/**',
        '**/.worktrees/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
        '**/e2e/**',
        '**/vitest.config.ts',
        '**/vite.config.ts',
        '**/playwright.config.ts',
        '**/playwright-*.config.ts',
        '**/tailwind.config.ts',
        '**/*.d.ts',
        // One-time migration/setup scripts — not unit-testable
        '**/scripts/**',
        // Pure type declaration files — nothing to cover
        '**/types.ts',
        // SSE streaming infrastructure — requires live HTTP, covered by e2e
        '**/event-stream/sse.ts',
        // React context/state hooks — covered by e2e, not unit tests
        '**/apps/web/src/state/**',
        // Config files
        '**/target-projects/**',
        // Design reference docs — not code
        'docs/design/**',
        // React components — covered by Playwright e2e, not unit tests
        '**/*.tsx',
        // Entry points — not unit-testable (process lifecycle, HTTP server boot)
        'apps/server/src/index.ts',
        'apps/cli/src/index.ts',
        'apps/web/src/lib/api.ts',
        'core/db/migrate.ts',
        'drizzle.config.ts',
      ],
    },
  },
});
