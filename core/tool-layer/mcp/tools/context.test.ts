import { describe, expect, it } from 'vitest';
import { eventStore } from '../../../event-stream/store.js';
import type { FactoryContext } from '../context.js';
import {
  ToolDataMissingError,
  getProjectContext,
  getStackCommands,
  recordDecisionTool,
} from './context.js';

const REAL_PROJECT_SLUG = 'goose-hub-self';

function makeCtx(overrides: Partial<FactoryContext> = {}): FactoryContext {
  return {
    runId: `run-${Math.random().toString(36).slice(2, 12)}`,
    projectId: REAL_PROJECT_SLUG,
    workItemId: 'github:shaunnez/goose-hub#1',
    workspaceRoot: process.cwd(),
    serverPort: 3001,
    ...overrides,
  };
}

describe('getProjectContext', () => {
  it('returns the visible slice of an existing project config', async () => {
    const result = await getProjectContext(makeCtx());
    expect(result.slug).toBe(REAL_PROJECT_SLUG);
    expect(result.id).toBe(REAL_PROJECT_SLUG);
    expect(['interactive', 'supervised', 'autonomous']).toContain(result.mode);
    expect(Array.isArray(result.repos)).toBe(true);
  });

  it('omits keys outside the visible slice (no agentConfig, budgets, etc.)', async () => {
    const result = (await getProjectContext(makeCtx())) as unknown as Record<string, unknown>;
    expect(result).not.toHaveProperty('agentConfig');
    expect(result).not.toHaveProperty('budgets');
    expect(result).not.toHaveProperty('governance');
  });

  it('throws ToolDataMissingError when the project slug is unknown', async () => {
    await expect(
      getProjectContext(makeCtx({ projectId: 'no-such-project-zzz' })),
    ).rejects.toBeInstanceOf(ToolDataMissingError);
  });
});

describe('getStackCommands', () => {
  it('returns the project stack commands', async () => {
    const result = await getStackCommands(makeCtx());
    expect(result.packageManager).toBe('pnpm');
    expect(typeof result.testCommand).toBe('string');
    expect(result.testCommand?.length).toBeGreaterThan(0);
  });

  it('throws ToolDataMissingError for an unknown project slug', async () => {
    await expect(
      getStackCommands(makeCtx({ projectId: 'no-such-project-zzz' })),
    ).rejects.toBeInstanceOf(ToolDataMissingError);
  });
});

describe('recordDecisionTool', () => {
  it('persists a decision and emits a tool-call audit event', () => {
    const ctx = makeCtx();
    const result = recordDecisionTool(ctx, {
      kind: 'PLAN',
      what: `Picked option A ${ctx.runId}`,
      why: 'Smallest blast radius',
    });
    expect(result.recorded).toBe(true);
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);

    const events = eventStore.replay({ runId: ctx.runId, kind: 'agent.tool-call' });
    const audit = events.find((e) => (e.payload as { tool?: string }).tool === 'record_decision');
    expect(audit).toBeTruthy();
  });

  it('returns recorded=false with reason=duplicate for the same (runId,kind,what)', () => {
    const ctx = makeCtx();
    const what = `Same decision text ${ctx.runId}`;
    const first = recordDecisionTool(ctx, { kind: 'PLAN', what, why: 'first reason' });
    const second = recordDecisionTool(ctx, {
      kind: 'PLAN',
      what,
      why: 'different reason',
    });
    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(false);
    expect(second.reason).toBe('duplicate');
    expect(second.id).toBe(first.id);
  });
});
