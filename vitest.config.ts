import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'apps/web/src'),
      '@goose-hub/core': path.resolve(__dirname, 'core'),
    },
  },
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      thresholds: {
        lines: 40,
        functions: 55,
        branches: 45,
        statements: 40,
      },
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.claude/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
        '**/e2e/**',
        '**/vitest.config.ts',
        '**/vite.config.ts',
        '**/playwright.config.ts',
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
        // React components — covered by Playwright e2e, not unit tests
        '**/*.tsx',
      ],
    },
  },
});
