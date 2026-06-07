import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db.js';
import { agentRuns } from '../db/schema.js';
import type { ProjectConfig } from '../types.js';
import type { AgentResult, AgentRuntime, AgentSpec } from './interface.js';
import { ContextValidationError, OutputValidationError, invokeSkill } from './invoke-skill.js';
import { recordAgentRun } from './run-record.js';

const uid = () => `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Valid echo-test context
const VALID_ECHO_CTX = { message: 'hello' };

// Valid echo-test output (satisfies EchoOutputSchema)
const VALID_ECHO_OUTPUT = {
  echo: 'hello',
  decisionSummaries: [{ kind: 'PLAN', summary: 'test run' }],
};

function mockRuntime(
  output: unknown = VALID_ECHO_OUTPUT,
  events: AgentResult['events'] = [],
): AgentRuntime & { calls: AgentSpec[] } {
  const calls: AgentSpec[] = [];
  return {
    calls,
    async run(spec: AgentSpec): Promise<AgentResult> {
      calls.push(spec);
      return { output, decisionSummaries: [], events };
    },
  };
}

beforeEach(() => {
  db.run(sql`CREATE TABLE IF NOT EXISTS agent_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    persona_id TEXT NOT NULL,
    work_item_id TEXT,
    project_id TEXT NOT NULL,
    role TEXT NOT NULL,
    skill TEXT NOT NULL,
    outcome TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )`);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_run_id_uniq ON agent_runs (run_id)`);
});

describe('invokeSkill', () => {
  it('rejects invalid context without spawning runtime', async () => {
    const runtime = mockRuntime();
    await expect(
      invokeSkill({
        skillName: 'echo-test',
        projectId: uid(),
        runId: uid(),
        context: { notMessage: 'wrong' },
        overrides: { runtimeOverride: runtime },
      }),
    ).rejects.toBeInstanceOf(ContextValidationError);
    expect(runtime.calls).toHaveLength(0);
  });

  it('context validation error includes Zod issue path', async () => {
    const runtime = mockRuntime();
    let caught: unknown;
    try {
      await invokeSkill({
        skillName: 'echo-test',
        projectId: uid(),
        runId: uid(),
        context: { message: 123 },
        overrides: { runtimeOverride: runtime },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ContextValidationError);
    const err = caught as ContextValidationError;
    expect(err.issues.some((i) => i.path.includes('message'))).toBe(true);
  });

  it('happy path: spec carries contextAllowlist, personaId, appendSystemPrompt', async () => {
    const runtime = mockRuntime();
    const projectId = uid();
    await invokeSkill({
      skillName: 'echo-test',
      projectId,
      runId: 'run-happy',
      context: VALID_ECHO_CTX,
      overrides: { runtimeOverride: runtime },
    });
    expect(runtime.calls).toHaveLength(1);
    const spec = runtime.calls[0];
    expect(spec.contextAllowlist).toContain('message');
    expect(spec.personaId).toMatch(new RegExp(`^${projectId}/`));
    expect(typeof spec.appendSystemPrompt).toBe('string');
    expect(spec.appendSystemPrompt?.length).toBeGreaterThan(0);
  });

  it('adds projectId and workItemId to runtime context after validation', async () => {
    const runtime = mockRuntime();
    const projectId = uid();
    await invokeSkill({
      skillName: 'echo-test',
      projectId,
      workItemId: 'github:owner/repo#123',
      runId: 'run-system-context',
      context: VALID_ECHO_CTX,
      overrides: { runtimeOverride: runtime },
    });

    expect(runtime.calls[0].context).toMatchObject({
      message: 'hello',
      projectId,
      workItemId: 'github:owner/repo#123',
    });
  });

  it('runtimeOverride short-circuits runtime selection', async () => {
    const overrideRuntime = mockRuntime();
    await invokeSkill({
      skillName: 'echo-test',
      projectId: uid(),
      runId: uid(),
      context: VALID_ECHO_CTX,
      overrides: { runtimeOverride: overrideRuntime },
    });
    expect(overrideRuntime.calls).toHaveLength(1);
  });

  it('output validation failure surfaces as OutputValidationError', async () => {
    const badOutputRuntime = mockRuntime({ notEcho: true });
    await expect(
      invokeSkill({
        skillName: 'echo-test',
        projectId: uid(),
        runId: uid(),
        context: VALID_ECHO_CTX,
        overrides: { runtimeOverride: badOutputRuntime },
      }),
    ).rejects.toBeInstanceOf(OutputValidationError);
  });

  it('rejects repo-grounded skills that return after zero successful Factory tool calls', async () => {
    const output = {
      plan: 'Add helper at core/foo/bar.ts.',
      filesWritten: [{ path: 'core/foo/bar.ts', reason: 'new helper' }],
      testsWritten: [],
      testsRun: { command: 'pnpm test ', paths: [] },
      prUrl: 'https://github.com/owner/repo/pull/123',
      evidenceSpecPath: null,
      confidence: 'high',
      decisionSummaries: [{ kind: 'PLAN', summary: 'Add helper' }],
    };

    await expect(
      invokeSkill({
        skillName: 'implement',
        projectId: uid(),
        runId: uid(),
        context: {
          workItem: { title: 'T', body: 'B', number: 1, priority: 'medium' },
          stack: { testCommand: 'pnpm test' },
        },
        overrides: {
          runtimeOverride: mockRuntime(output, [
            {
              id: 1,
              projectId: 'p',
              workItemId: 'w',
              kind: 'agent.tool-call',
              payload: { tool_name: 'resources/list', status: 'failed' },
              runId: 'r',
              personaId: null,
              createdAt: '2026-06-08T00:00:00.000Z',
            },
          ]),
        },
      }),
    ).rejects.toMatchObject({
      diagnostics: expect.objectContaining({
        outputPreview: expect.any(String),
      }),
    });
  });

  it('allows explicit noToolSafe grounded runs', async () => {
    const output = {
      plan: 'Docs-only no-tool-safe output.',
      filesWritten: [],
      testsWritten: [],
      testsRun: { command: 'not run', paths: [] },
      prUrl: 'https://github.com/owner/repo/pull/123',
      evidenceSpecPath: null,
      confidence: 'high',
      decisionSummaries: [{ kind: 'SKIP_GATE', summary: 'No repo inspection required' }],
    };
    const result = await invokeSkill({
      skillName: 'implement',
      projectId: uid(),
      runId: uid(),
      context: {
        workItem: { title: 'T', body: 'B', number: 1, priority: 'medium' },
        stack: { testCommand: 'pnpm test' },
      },
      overrides: { runtimeOverride: mockRuntime(output), noToolSafe: true },
    });

    expect(result.output).toMatchObject({ confidence: 'high' });
  });

  it('marks an already-completed run as failed when output validation fails', async () => {
    const projectId = uid();
    const runId = uid();
    recordAgentRun({
      runId,
      personaId: `${projectId}/developer/0`,
      workItemId: null,
      projectId,
      role: 'developer',
      skill: 'echo-test',
      outcome: 'success',
    });

    await expect(
      invokeSkill({
        skillName: 'echo-test',
        projectId,
        runId,
        context: VALID_ECHO_CTX,
        overrides: { runtimeOverride: mockRuntime({ notEcho: true }) },
      }),
    ).rejects.toBeInstanceOf(OutputValidationError);

    const [found] = db.select().from(agentRuns).where(eq(agentRuns.runId, runId)).all();
    expect(found.outcome).toBe('failure');
  });

  it('normalizes null object properties before output validation', async () => {
    const runtime = mockRuntime({
      echo: 'hello',
      decisionSummaries: [{ kind: 'PLAN', summary: 'test run', evidence: null }],
    });

    const result = await invokeSkill({
      skillName: 'echo-test',
      projectId: uid(),
      runId: uid(),
      context: VALID_ECHO_CTX,
      overrides: { runtimeOverride: runtime },
    });

    expect(result.output).toEqual(VALID_ECHO_OUTPUT);
  });

  it('OutputValidationError includes runId in telemetry', async () => {
    const runId = uid();
    const badOutputRuntime = mockRuntime({ notEcho: true });
    let caught: unknown;
    try {
      await invokeSkill({
        skillName: 'echo-test',
        projectId: uid(),
        runId,
        context: VALID_ECHO_CTX,
        overrides: { runtimeOverride: badOutputRuntime },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutputValidationError);
    const err = caught as OutputValidationError;
    expect(err.runTelemetry.runId).toBe(runId);
    expect(err.runTelemetry.skill).toBe('echo-test');
  });

  it('persona round-robin advances on successive calls', async () => {
    const runtime = mockRuntime();
    const projectId = uid();
    await invokeSkill({
      skillName: 'echo-test',
      projectId,
      runId: uid(),
      context: VALID_ECHO_CTX,
      overrides: { runtimeOverride: runtime },
    });
    await invokeSkill({
      skillName: 'echo-test',
      projectId,
      runId: uid(),
      context: VALID_ECHO_CTX,
      overrides: { runtimeOverride: runtime },
    });
    const [call1, call2] = runtime.calls;
    expect(call1.personaId).not.toBe(call2.personaId);
  });

  it('modelOverride in overrides propagates to spec', async () => {
    const runtime = mockRuntime();
    const modelOverride = 'claude-haiku-4-5-20251001';
    await invokeSkill({
      skillName: 'echo-test',
      projectId: uid(),
      runId: uid(),
      context: VALID_ECHO_CTX,
      overrides: { runtimeOverride: runtime, modelOverride },
    });
    expect(runtime.calls[0].modelOverride).toBe(modelOverride);
  });

  it('skill-tier default used when no project config or modelOverride override', async () => {
    const runtime = mockRuntime();
    await invokeSkill({
      skillName: 'echo-test',
      projectId: uid(),
      runId: uid(),
      context: VALID_ECHO_CTX,
      overrides: { runtimeOverride: runtime },
    });
    // echo-test modelPin is 'sonnet' — resolved model should contain 'sonnet'
    expect(runtime.calls[0].modelOverride).toMatch(/sonnet/i);
  });

  it('runtimeOverride suppresses DB provider model — modelOverride stays on skill-budget default', async () => {
    // Guard against a DB row with primary_provider:'codex' leaking a Codex model into a
    // ClaudeCliRuntime call when the caller has provided runtimeOverride.
    const runtime = mockRuntime();
    await invokeSkill({
      skillName: 'echo-test',
      projectId: uid(),
      runId: uid(),
      context: VALID_ECHO_CTX,
      overrides: { runtimeOverride: runtime },
    });
    expect(runtime.calls[0].modelOverride).not.toMatch(/codex/i);
    expect(runtime.calls[0].modelOverride).toMatch(/sonnet/i);
  });

  it('ignores role-model config for normal skill dispatch', async () => {
    const runtime = mockRuntime();
    const projectId = uid();

    await invokeSkill({
      skillName: 'echo-test',
      projectId,
      runId: uid(),
      context: VALID_ECHO_CTX,
      overrides: {
        runtimeOverride: runtime,
        projectConfigOverride: {
          agentConfig: {
            runtime: 'auto',
            allowHoldoutOverride: false,
            rolesModels: {
              developer: { primary: 'haiku', primaryProvider: 'codex' },
            },
          } as ProjectConfig['agentConfig'],
        },
      },
    });

    expect(runtime.calls[0].modelOverride).toMatch(/sonnet/i);
    expect(runtime.calls[0].modelOverride).not.toMatch(/^gpt-/);
  });
});
