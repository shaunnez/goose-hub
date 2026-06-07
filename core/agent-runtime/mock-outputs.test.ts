import { describe, expect, it } from 'vitest';
import { ResearchSchema } from '@goose-hub/skills/research/schema.js';
import type { AgentSpec } from './interface.js';
import { resolveMockOutput } from './mock-outputs.js';

function makeSpec(overrides: Partial<AgentSpec> & { skill: string }): AgentSpec {
  return {
    runId: 'run-1',
    role: 'triager',
    context: {},
    contextAllowlist: [],
    freshContext: false,
    toolBundles: [],
    toolExtras: [],
    budgets: { maxTurns: 1, maxBudgetUsd: 0.01, timeoutMs: 30_000 },
    personaId: 'mock/triager/0',
    ...overrides,
  } as AgentSpec;
}

describe('resolveMockOutput — triage', () => {
  it('passes through bug/research/feature workItem.type', () => {
    for (const incoming of ['bug', 'research', 'feature'] as const) {
      const result = resolveMockOutput(
        makeSpec({ skill: 'triage', context: { workItem: { type: incoming } } }),
      );
      const out = result.output as { type: string };
      expect(out.type).toBe(incoming);
    }
  });

  it('falls back to "chore" when type is unknown or absent', () => {
    const unknown = resolveMockOutput(
      makeSpec({ skill: 'triage', context: { workItem: { type: 'gibberish' } } }),
    );
    expect((unknown.output as { type: string }).type).toBe('chore');

    const missingWorkItem = resolveMockOutput(makeSpec({ skill: 'triage', context: {} }));
    expect((missingWorkItem.output as { type: string }).type).toBe('chore');
  });

  it('emits a PLAN decision summary that mirrors the resolved type', () => {
    const r = resolveMockOutput(
      makeSpec({ skill: 'triage', context: { workItem: { type: 'bug' } } }),
    );
    expect(r.decisionSummaries).toHaveLength(1);
    expect(r.decisionSummaries[0]).toMatchObject({
      kind: 'PLAN',
      summary: 'Classified as bug for e2e',
    });
  });
});

describe('resolveMockOutput — repo-match', () => {
  it('returns a single shaunnez/goose-hub candidate at confidence 95', () => {
    const r = resolveMockOutput(makeSpec({ skill: 'repo-match' }));
    const out = r.output as { candidates: Array<{ repo: string; confidence: number }> };
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].repo).toBe('shaunnez/goose-hub');
    expect(out.candidates[0].confidence).toBe(95);
  });
});

describe('resolveMockOutput — feature-enhance', () => {
  it('returns tool-verified grounding with a matching repo-intel tool event', () => {
    const r = resolveMockOutput(
      makeSpec({
        skill: 'feature-enhance',
        runId: 'grounding-run:feature-enhance',
        context: { projectId: 'goose-hub-self', workItemId: 'github:owner/repo#42' },
        workItemId: 'github:owner/repo#42',
      }),
    );
    const out = r.output as {
      candidateFiles: Array<{ source?: string }>;
    };

    expect(out.candidateFiles).toEqual([expect.objectContaining({ source: 'tool-verified' })]);
    expect(r.events).toEqual([
      expect.objectContaining({
        kind: 'agent.tool-call',
        projectId: 'goose-hub-self',
        workItemId: 'github:owner/repo#42',
        runId: 'grounding-run:feature-enhance',
        payload: expect.objectContaining({
          tool_name: 'repo_intel.query',
          status: 'ok',
          blocked: false,
        }),
      }),
    ]);
  });
});

describe('resolveMockOutput — implement', () => {
  it('returns a deterministic implement plan with a mock PR url', () => {
    const r = resolveMockOutput(makeSpec({ skill: 'implement' }));
    const out = r.output as { prUrl: string; confidence: string; filesWritten: unknown[] };
    expect(out.prUrl).toBe('https://github.com/shaunnez/goose-hub/pull/999');
    expect(out.confidence).toBe('high');
    expect(out.filesWritten).toHaveLength(1);
  });
});

describe('resolveMockOutput — investigate', () => {
  it('returns a high-confidence findings stub', () => {
    const r = resolveMockOutput(makeSpec({ skill: 'investigate' }));
    const out = r.output as { confidence: string; findings: string };
    expect(out.confidence).toBe('high');
    expect(out.findings).toBe('E2E mock findings');
  });
});

describe('resolveMockOutput — research', () => {
  it('returns a schema-valid directly actionable research artifact', () => {
    const r = resolveMockOutput(makeSpec({ skill: 'research' }));
    expect(ResearchSchema.safeParse(r.output).success).toBe(true);
    const out = r.output as { actionability: string; followUpWork: Array<{ actionable: boolean }> };
    expect(out.actionability).toBe('directly-actionable');
    expect(out.followUpWork.filter((candidate) => candidate.actionable)).toHaveLength(1);
  });
});

describe('resolveMockOutput — qa', () => {
  it('returns a passing verdict with tierResults', () => {
    const r = resolveMockOutput(makeSpec({ skill: 'qa' }));
    const out = r.output as { verdict: string; overallScore: number; tierResults: object };
    expect(out.verdict).toBe('pass');
    expect(out.overallScore).toBeGreaterThan(70);
    expect(out.tierResults).toBeDefined();
  });
});

describe('resolveMockOutput — review', () => {
  it('returns an "approved" verdict with confidence', () => {
    const r = resolveMockOutput(makeSpec({ skill: 'review' }));
    const out = r.output as { verdict: string; confidence: number };
    expect(out.verdict).toBe('approved');
    expect(out.confidence).toBeGreaterThan(0);
  });
});

describe('resolveMockOutput — unknown skill', () => {
  it('throws when no preset matches', () => {
    expect(() => resolveMockOutput(makeSpec({ skill: 'made-up-skill' }))).toThrow(
      /no preset for skill "made-up-skill"/,
    );
  });
});
