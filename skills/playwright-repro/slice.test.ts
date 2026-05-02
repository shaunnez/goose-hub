import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import config, { PlaywrightReproContextSchema } from './config.js';
import { PlaywrightReproSchema } from './schema.js';

describe('playwright-repro schema', () => {
  it('accepts valid output with bug reproduced', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [
        {
          path: '/tmp/repro/step-1.png',
          caption: 'Step 1: Login form with validation error visible',
          step: 1,
        },
        {
          path: '/tmp/repro/step-2.png',
          caption: 'Step 2: Dashboard with missing data',
          step: 2,
        },
      ],
      videoPath: '/tmp/repro/session.webm',
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
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid output with bug not reproducible', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [],
      videoPath: null,
      consoleErrors: [],
      reproSteps: ['Navigate to /login', 'Enter credentials'],
      reproduced: false,
      notes: 'Could not reproduce — login succeeded with provided credentials.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts output with null videoPath', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [{ path: '/tmp/repro/step-1.png', caption: 'Initial state', step: 1 }],
      videoPath: null,
      consoleErrors: [],
      reproSteps: ['Navigate to /dashboard'],
      reproduced: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts output with no notes (notes is optional)', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [],
      videoPath: null,
      consoleErrors: [],
      reproSteps: ['Navigate to /home'],
      reproduced: false,
    });
    expect(result.success).toBe(true);
  });

  it('accepts consoleErrors with url as optional', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [],
      videoPath: null,
      consoleErrors: [{ message: 'Warning: something deprecated', type: 'warning' }],
      reproSteps: ['Navigate to /settings'],
      reproduced: false,
    });
    expect(result.success).toBe(true);
  });

  it('accepts all console error types', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [],
      videoPath: null,
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
      videoPath: null,
      consoleErrors: [{ message: 'Something', type: 'debug' }],
      reproSteps: ['Navigate to /'],
      reproduced: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required screenshots field', () => {
    const result = PlaywrightReproSchema.safeParse({
      videoPath: null,
      consoleErrors: [],
      reproSteps: ['Navigate to /'],
      reproduced: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing reproduced field', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [],
      videoPath: null,
      consoleErrors: [],
      reproSteps: ['Navigate to /'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects screenshot missing path', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [{ caption: 'Missing path', step: 1 }],
      videoPath: null,
      consoleErrors: [],
      reproSteps: ['Navigate to /'],
      reproduced: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects screenshot missing caption', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [{ path: '/tmp/step-1.png', step: 1 }],
      videoPath: null,
      consoleErrors: [],
      reproSteps: ['Navigate to /'],
      reproduced: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects screenshot missing step number', () => {
    const result = PlaywrightReproSchema.safeParse({
      screenshots: [{ path: '/tmp/step-1.png', caption: 'Initial state' }],
      videoPath: null,
      consoleErrors: [],
      reproSteps: ['Navigate to /'],
      reproduced: true,
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

  it('has validate tool bundle', () => {
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
  });

  it('contextSchema validates required workItem fields', () => {
    const valid = PlaywrightReproContextSchema.safeParse({
      workItem: {
        title: 'Login page crashes on submit',
        body: 'When I click submit the page crashes.',
        reproSteps: '1. Navigate to /login\n2. Click Submit',
      },
    });
    expect(valid.success).toBe(true);
  });

  it('contextSchema accepts optional url', () => {
    const valid = PlaywrightReproContextSchema.safeParse({
      workItem: {
        title: 'Dashboard broken',
        body: 'Dashboard shows nothing.',
        reproSteps: '1. Navigate to /dashboard',
        url: 'https://example.com/dashboard',
      },
    });
    expect(valid.success).toBe(true);
  });

  it('contextSchema rejects missing workItem.title', () => {
    const invalid = PlaywrightReproContextSchema.safeParse({
      workItem: {
        body: 'Some body.',
        reproSteps: '1. Navigate to /login',
      },
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema rejects missing workItem.body', () => {
    const invalid = PlaywrightReproContextSchema.safeParse({
      workItem: {
        title: 'Some title',
        reproSteps: '1. Navigate to /login',
      },
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema rejects missing workItem.reproSteps', () => {
    const invalid = PlaywrightReproContextSchema.safeParse({
      workItem: {
        title: 'Some title',
        body: 'Some body.',
      },
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema rejects missing workItem entirely', () => {
    const invalid = PlaywrightReproContextSchema.safeParse({});
    expect(invalid.success).toBe(false);
  });
});
