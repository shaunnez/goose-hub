import { describe, expect, it } from 'vitest';
import type { AgentResult, AgentRuntime, AgentSpec } from './interface.js';
import { ContextValidationError, OutputValidationError, invokeSkill } from './invoke-skill.js';

const uid = () => `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Valid echo-test context
const VALID_ECHO_CTX = { message: 'hello' };

// Valid echo-test output (satisfies EchoOutputSchema)
const VALID_ECHO_OUTPUT = {
  echo: 'hello',
  decisionSummaries: [{ kind: 'PLAN', summary: 'test run' }],
};

function mockRuntime(output: unknown = VALID_ECHO_OUTPUT): AgentRuntime & { calls: AgentSpec[] } {
  const calls: AgentSpec[] = [];
  return {
    calls,
    async run(spec: AgentSpec): Promise<AgentResult> {
      calls.push(spec);
      return { output, decisionSummaries: [], events: [] };
    },
  };
}

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
});
