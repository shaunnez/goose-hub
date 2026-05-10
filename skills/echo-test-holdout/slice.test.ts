import { assembleSpawnContext } from '@goose-hub/core/agent-runtime/context-assembly.js';
import type { AgentSpec } from '@goose-hub/core/agent-runtime/interface.js';
import { redactSecrets } from '@goose-hub/core/tool-layer/secret-redaction.js';
import { describe, expect, it } from 'vitest';
import { EchoOutputSchema } from './schema.js';
import config from './skill.config.js';

// ─── holdout context filtering ────────────────────────────────────────────────

describe('echo-test-holdout — holdout context enforcement', () => {
  const holdoutSpec: AgentSpec = {
    runId: 'holdout-test-run',
    role: 'qa',
    skill: 'echo-test-holdout',
    context: { message: 'hi', secret: 'tok_abc123' },
    contextAllowlist: config.contextAllowlist ?? ['message'],
    freshContext: true,
    toolBundles: [],
    toolExtras: [],
    budgets: { maxTurns: 5, maxBudgetUsd: 0.1, timeoutMs: 30_000 },
  };

  it('assembled context includes the message field', () => {
    const { contextXml } = assembleSpawnContext(holdoutSpec);
    expect(contextXml).toContain('message');
    expect(contextXml).toContain('hi');
  });

  it('assembled context excludes the secret field', () => {
    const { contextXml } = assembleSpawnContext(holdoutSpec);
    expect(contextXml).not.toContain('secret');
    expect(contextXml).not.toContain('tok_abc123');
  });

  it('redactSecrets confirms secret value is absent from assembled context', () => {
    const { contextXml } = assembleSpawnContext(holdoutSpec);
    const redacted = redactSecrets(contextXml) as string;
    // tok_abc123 does not match any secret pattern, but it should be absent anyway
    expect(redacted).not.toContain('tok_abc123');
  });
});

// ─── skill config ─────────────────────────────────────────────────────────────

describe('echo-test-holdout skill config', () => {
  it('has role: qa', () => {
    expect(config.role).toBe('qa');
  });

  it('has freshContext: true', () => {
    expect(config.freshContext).toBe(true);
  });

  it('contextAllowlist includes message but not secret', () => {
    const allowlist = config.contextAllowlist ?? [];
    expect(allowlist).toContain('message');
    expect(allowlist).not.toContain('secret');
  });
});

// ─── schema ───────────────────────────────────────────────────────────────────

describe('echo-test-holdout schema', () => {
  it('accepts valid output shape', () => {
    const result = EchoOutputSchema.safeParse({
      echo: 'hi',
      decisionSummaries: [{ kind: 'PLAN', summary: 'Echoed input message (holdout)' }],
    });
    expect(result.success).toBe(true);
  });
});

// ─── TypeScript compile-time enforcement ──────────────────────────────────────
// The following would fail to compile if uncommented:
//
// import type { HoldoutRoleKind } from '@goose-hub/core/agent-runtime/interface.js';
// type QARole = { kind: 'qa'; requiresFreshContext: true; allowsAdvisor: false };
// @ts-expect-error freshContext must be true for holdout roles
// const _invalid: AgentSpec<QARole> = { ...holdoutSpec, freshContext: false };
