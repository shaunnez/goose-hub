import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import { PlaywrightReproSchema, PlaywrightReproSpecSchema } from './schema.js';
import config, { PlaywrightReproContextSchema } from './skill.config.js';

const PROMPT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'prompt.md'), 'utf8');

describe('playwright-repro schema', () => {
  it('accepts valid spec-plan output', () => {
    const result = PlaywrightReproSpecSchema.safeParse({
      specPath: 'apps/web/e2e/repro-login-error.spec.ts',
      slug: 'login-error',
      route: '/login',
      expectedAssertion: 'Login error remains visible after submit',
      reproSteps: ['Navigate to /login', 'Submit credentials'],
      evidenceIntent: 'Capture the login error before the fix.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid output with bug reproduced', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [
        {
          path: 'evidence/issue-42/step-1.png',
          caption: 'Step 1: Login form with validation error visible',
          step: 1,
          githubUrl:
            'https://raw.githubusercontent.com/shaunnez/goose-hub/abc1234/evidence/issue-42/step-1.png',
        },
        {
          path: 'evidence/issue-42/step-2.png',
          caption: 'Step 2: Dashboard with missing data',
          step: 2,
        },
      ],
      gifPath: 'evidence/issue-42/walkthrough.gif',
      consoleErrors: [
        {
          message: 'Uncaught TypeError: Cannot read property id of undefined',
          type: 'error',
          url: 'https://example.com/app.js',
        },
      ],
      reproSteps: ['Navigate to /login', 'Enter invalid credentials', 'Click Submit'],
      reproduced: true,
      notes: 'Bug reproduced consistently on step 2.',
      commentUrl: 'https://github.com/shaunnez/goose-hub/issues/42#issuecomment-9876543210',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid output with bug not reproducible', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [],
      gifPath: null,
      consoleErrors: [],
      reproSteps: ['Navigate to /login', 'Enter credentials'],
      reproduced: false,
      notes: 'Could not reproduce — login succeeded with provided credentials.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts output with null gifPath', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [{ path: 'evidence/issue-42/step-1.png', caption: 'Initial state', step: 1 }],
      gifPath: null,
      consoleErrors: [],
      reproSteps: ['Navigate to /dashboard'],
      reproduced: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts output with no notes (notes is optional)', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [],
      gifPath: null,
      consoleErrors: [],
      reproSteps: ['Navigate to /home'],
      reproduced: false,
    });
    expect(result.success).toBe(true);
  });

  it('accepts consoleErrors with url as optional', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [],
      gifPath: null,
      consoleErrors: [{ message: 'Warning: something deprecated', type: 'warning' }],
      reproSteps: ['Navigate to /settings'],
      reproduced: false,
    });
    expect(result.success).toBe(true);
  });

  it('accepts all console error types', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [],
      gifPath: null,
      consoleErrors: [
        { message: 'An error', type: 'error' },
        { message: 'A warning', type: 'warning' },
        { message: 'An info', type: 'info' },
      ],
      reproSteps: ['Navigate to /'],
      reproduced: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid console error type', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [],
      gifPath: null,
      consoleErrors: [{ message: 'Something', type: 'debug' }],
      reproSteps: ['Navigate to /'],
      reproduced: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required screenshots field', () => {
    const result = PlaywrightReproSchema.safeParse({
      gifPath: null,
      consoleErrors: [],
      reproSteps: ['Navigate to /'],
      reproduced: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing reproduced field', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [],
      gifPath: null,
      consoleErrors: [],
      reproSteps: ['Navigate to /'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects screenshot missing path', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [{ caption: 'Missing path', step: 1 }],
      gifPath: null,
      consoleErrors: [],
      reproSteps: ['Navigate to /'],
      reproduced: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects screenshot missing caption', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [{ path: '/tmp/step-1.png', step: 1 }],
      gifPath: null,
      consoleErrors: [],
      reproSteps: ['Navigate to /'],
      reproduced: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects screenshot missing step number', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [{ path: '/tmp/step-1.png', caption: 'Initial state' }],
      gifPath: null,
      consoleErrors: [],
      reproSteps: ['Navigate to /'],
      reproduced: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-URL githubUrl on a screenshot', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [
        { path: 'evidence/issue-42/step-1.png', caption: 'c', step: 1, githubUrl: 'not-a-url' },
      ],
      gifPath: null,
      consoleErrors: [],
      reproSteps: ['Navigate to /'],
      reproduced: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-URL commentUrl', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [],
      gifPath: null,
      consoleErrors: [],
      reproSteps: ['Navigate to /'],
      reproduced: true,
      commentUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('zod toJSONSchema roundtrip produces valid JSON Schema object', () => {
    const jsonSchema = toJSONSchema(PlaywrightReproSchema);
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
    expect(jsonSchema).toHaveProperty('properties');
  });
});

describe('playwright-repro skill config', () => {
  it('has role investigator', () => {
    expect(config.role).toBe('investigator');
  });

  it('uses validate tool bundle', () => {
    expect(config.toolBundles).toContain('validate');
  });

  it('is pinned to sonnet model', () => {
    expect(config.modelPin).toBe('sonnet');
  });

  it('does not require fresh context', () => {
    expect(config.freshContext).toBe(false);
  });

  it('has contextAllowlist defined', () => {
    expect(config.contextAllowlist).toBeDefined();
    expect(Array.isArray(config.contextAllowlist)).toBe(true);
  });

  it('contextAllowlist includes workItem fields', () => {
    expect(config.contextAllowlist).toContain('workItem.title');
    expect(config.contextAllowlist).toContain('workItem.body');
    expect(config.contextAllowlist).toContain('workItem.reproSteps');
    expect(config.contextAllowlist).toContain('workItem.number');
    expect(config.contextAllowlist).toContain('workItem.repo');
  });

  it('contextAllowlist includes the narrow repro packet', () => {
    expect(config.contextAllowlist).toContain('reproPacket');
  });

  it('contextSchema validates required workItem fields', () => {
    const valid = PlaywrightReproContextSchema.safeParse({
      appUrl: 'http://localhost:5173',
      workItem: {
        title: 'Login page crashes on submit',
        body: 'When I click submit the page crashes.',
        reproSteps: '1. Navigate to /login\n2. Click Submit',
        number: 42,
        repo: 'shaunnez/goose-hub',
      },
    });
    expect(valid.success).toBe(true);
  });

  it('contextSchema accepts optional url', () => {
    const valid = PlaywrightReproContextSchema.safeParse({
      appUrl: 'http://localhost:5173',
      workItem: {
        title: 'Dashboard broken',
        body: 'Dashboard shows nothing.',
        reproSteps: '1. Navigate to /dashboard',
        url: 'https://example.com/dashboard',
        number: 42,
        repo: 'shaunnez/goose-hub',
      },
    });
    expect(valid.success).toBe(true);
  });

  it('contextSchema rejects missing workItem.title', () => {
    const invalid = PlaywrightReproContextSchema.safeParse({
      workItem: {
        body: 'Some body.',
        reproSteps: '1. Navigate to /login',
        number: 42,
        repo: 'shaunnez/goose-hub',
      },
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema rejects missing workItem.body', () => {
    const invalid = PlaywrightReproContextSchema.safeParse({
      workItem: {
        title: 'Some title',
        reproSteps: '1. Navigate to /login',
        number: 42,
        repo: 'shaunnez/goose-hub',
      },
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema rejects missing workItem.reproSteps', () => {
    const invalid = PlaywrightReproContextSchema.safeParse({
      workItem: {
        title: 'Some title',
        body: 'Some body.',
        number: 42,
        repo: 'shaunnez/goose-hub',
      },
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema rejects missing workItem.number', () => {
    const invalid = PlaywrightReproContextSchema.safeParse({
      workItem: {
        title: 'Some title',
        body: 'Some body.',
        reproSteps: '1. Navigate to /login',
        repo: 'shaunnez/goose-hub',
      },
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema rejects missing workItem.repo', () => {
    const invalid = PlaywrightReproContextSchema.safeParse({
      workItem: {
        title: 'Some title',
        body: 'Some body.',
        reproSteps: '1. Navigate to /login',
        number: 42,
      },
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema rejects missing workItem entirely', () => {
    const invalid = PlaywrightReproContextSchema.safeParse({});
    expect(invalid.success).toBe(false);
  });
});

describe('playwright-repro prompt discipline', () => {
  it('leaves collector execution to the workflow', () => {
    expect(PROMPT).toContain('scripts/collect-playwright-evidence.ts');
    expect(PROMPT).toContain('workflow can run Playwright');
  });

  it('keeps the agent bounded to spec authoring', () => {
    expect(PROMPT).toContain('Your job stops at the spec plan');
    expect(PROMPT).toContain('run it at most once');
    expect(PROMPT).toContain('REPRO_EXPECTED_BUG');
  });

  it('does not instruct the agent to publish evidence or comment on GitHub', () => {
    expect(PROMPT).not.toMatch(/gh issue comment|git push|evidence\/issue-<N>|git worktree/i);
  });
});
