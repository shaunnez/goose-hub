import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvokeSkill = vi.fn();
const mockAppendEvent = vi.fn();
const mockUpdateByPipeline = vi.fn();
const mockInsertAuditOnly = vi.fn();

vi.mock('../agent-runtime/invoke-skill.js', async () => {
  const actual = await vi.importActual<typeof import('../agent-runtime/invoke-skill.js')>(
    '../agent-runtime/invoke-skill.js',
  );
  return {
    ...actual,
    invokeSkill: (...args: unknown[]) => mockInvokeSkill(...args),
  };
});

vi.mock('../event-stream/store.js', () => ({
  eventStore: { appendEvent: mockAppendEvent, replay: vi.fn(() => []) },
}));

vi.mock('../quality-score/repository.js', () => ({
  updateAuditScoreByPipelineRun: mockUpdateByPipeline,
  insertAuditOnlyRow: mockInsertAuditOnly,
  listProjectQualityTrend: vi.fn(() => []),
  getLatestQualityScoreByPipelineRun: vi.fn(() => null),
  persistRunQualityScore: vi.fn(),
}));

const {
  AUDIT_AUTONOMY_THRESHOLD,
  buildImprovementCandidates,
  computeAuditScore,
  mapPrincipleToKind,
  runCodeQualityAudit,
} = await import('./run-audit.js');

type AuditOutput = import('../../skills/code-quality-audit/schema.js').CodeQualityAuditOutput;

// Helper: a valid CodeQualityAuditOutput with adjustable scorecard totals.
function buildOutput(
  opts: { totalScore: number; recommendations?: number } = { totalScore: 82 },
): AuditOutput {
  // Distribute totalScore across 8 cats — scale of (20,15,15,15,10,10,10,5)
  const maxes = [20, 15, 15, 15, 10, 10, 10, 5];
  const target = opts.totalScore;
  const scores: number[] = [];
  let remaining = target;
  for (let i = 0; i < 8; i++) {
    const cap = maxes[i];
    const v = Math.min(cap, Math.max(0, Math.min(remaining, cap)));
    scores.push(v);
    remaining -= v;
  }
  const names = [
    'Open/Closed Compliance',
    'Concept Count',
    'Time-to-New-Capability',
    'Complecting Score',
    'LOC Discipline',
    'Coupling / Fan-Out',
    "Gall's Law Compliance",
    'Cyclomatic Complexity',
  ];
  const scorecard = scores.map((s, i) => ({
    category: (i + 1) as 1,
    name: names[i],
    score: s,
    max: maxes[i],
    evidence: [{ file: 'src/x.ts', line: 1, note: 'note' }],
  }));
  const total = scores.reduce((a, b) => a + b, 0);
  const rating =
    total >= 90
      ? 'Exemplary'
      : total >= 75
        ? 'Good'
        : total >= 55
          ? 'NeedsWork'
          : total >= 35
            ? 'Concerning'
            : 'Redesign';

  const recs = opts.recommendations ?? 5;
  const recommendations = Array.from({ length: recs }, (_, i) => ({
    priority: i === 0 ? 'P0' : i === 1 ? 'P1' : 'P2',
    principle: i === 0 ? 'Workflow simplification' : i === 1 ? 'Skill prompt clarity' : 'Cohesion',
    file: `src/file-${i}.ts`,
    line: i + 1,
    fix: `Fix ${i}`,
    effort: 'Medium',
    impactPoints: 10 - i,
  }));

  return {
    scorecard,
    rating: rating as AuditOutput['rating'],
    strengths: ['Good naming'],
    recommendations: recommendations as AuditOutput['recommendations'],
    mcIlroyQuestion: 'Can these components be independently piped?',
    projectedScoreAfterTop3: Math.min(100, total + 5),
    decisionSummaries: [{ kind: 'SELF_SCORE', summary: 'Synthesised from rubric' }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateByPipeline.mockReturnValue(1);
});

describe('computeAuditScore', () => {
  it('sums the 8 category scores', () => {
    const out = buildOutput({ totalScore: 82 });
    expect(computeAuditScore(out)).toBe(82);
  });
});

describe('mapPrincipleToKind', () => {
  it('routes "prompt" to skill-prompt', () => {
    expect(mapPrincipleToKind('Skill prompt clarity')).toBe('skill-prompt');
  });
  it('routes "config" to skill-config', () => {
    expect(mapPrincipleToKind('Project config simplification')).toBe('skill-config');
  });
  it('routes "schema" to skill-schema', () => {
    expect(mapPrincipleToKind('Output schema convergence')).toBe('skill-schema');
  });
  it('routes "governance" to governance-suggestion', () => {
    expect(mapPrincipleToKind('Governance perimeter tightening')).toBe('governance-suggestion');
  });
  it('falls back to workflow for architectural fixes', () => {
    expect(mapPrincipleToKind('McIlroy: small is beautiful')).toBe('workflow');
  });
});

describe('buildImprovementCandidates — top-3 emission', () => {
  it('selects top 3 by (priority asc, impactPoints desc)', () => {
    const out = buildOutput({ totalScore: 80, recommendations: 5 });
    const cs = buildImprovementCandidates(out);
    expect(cs).toHaveLength(3);
    // First should be P0
    expect(cs[0].confidence).toBe('high'); // P0 → high
    expect(cs[1].confidence).toBe('medium'); // P1 → medium
  });
  it('returns fewer than 3 when recommendations are short', () => {
    const out = buildOutput({ totalScore: 80, recommendations: 2 });
    const cs = buildImprovementCandidates(out);
    expect(cs).toHaveLength(2);
  });
  it('returns empty when no recommendations', () => {
    const out = buildOutput({ totalScore: 80, recommendations: 0 });
    expect(buildImprovementCandidates(out)).toEqual([]);
  });
});

describe('runCodeQualityAudit — happy path', () => {
  it('in-PR audit (deep-retro) updates audit_score in place by pipelineRunId without writing score=0', async () => {
    mockInvokeSkill.mockResolvedValueOnce({
      output: buildOutput({ totalScore: 82 }),
      decisionSummaries: [],
      events: [],
    });

    const result = await runCodeQualityAudit({
      projectId: 'proj-1',
      worktreePath: '/tmp/wt',
      pipelineRunId: 'pipe-1',
      trigger: 'deep-retro',
      mode: 'supervised',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auditScore).toBe(82);
      expect(result.improvementCandidates.length).toBeGreaterThan(0);
      expect(result.autonomyGateFired).toBe(false);
    }

    expect(mockUpdateByPipeline).toHaveBeenCalledOnce();
    expect(mockUpdateByPipeline.mock.calls[0][0]).toEqual({
      pipelineRunId: 'pipe-1',
      auditScore: 82,
    });
    expect(mockInsertAuditOnly).not.toHaveBeenCalled();

    const eventKinds = mockAppendEvent.mock.calls.map((c) => (c[0] as { kind: string }).kind);
    expect(eventKinds).toContain('audit.completed');
    expect(eventKinds).not.toContain('audit.autonomy-gate-fired');
  });

  it('convergent-review audit does not pollute trend when no row exists yet — update is no-op until merge-decision runs', async () => {
    mockUpdateByPipeline.mockReturnValueOnce(0); // simulate: no row found
    mockInvokeSkill.mockResolvedValueOnce({
      output: buildOutput({ totalScore: 78 }),
      decisionSummaries: [],
      events: [],
    });

    await runCodeQualityAudit({
      projectId: 'proj-1',
      worktreePath: '/tmp/wt',
      pipelineRunId: 'pipe-2',
      trigger: 'convergent-review',
      mode: 'supervised',
    });

    // Update was attempted; no synthetic insert happened.
    expect(mockUpdateByPipeline).toHaveBeenCalledOnce();
    expect(mockInsertAuditOnly).not.toHaveBeenCalled();

    // The audit.completed event carries the auditScore so merge-decision can
    // later persist it as part of its own row write.
    const completedEvent = mockAppendEvent.mock.calls
      .map((c) => c[0] as { kind: string; payload: { auditScore?: number } })
      .find((e) => e.kind === 'audit.completed');
    expect(completedEvent?.payload.auditScore).toBe(78);
  });

  it('nightly audit inserts an audit-only row with the synthetic nightly pipelineRunId', async () => {
    mockInvokeSkill.mockResolvedValueOnce({
      output: buildOutput({ totalScore: 72 }),
      decisionSummaries: [],
      events: [],
    });

    const result = await runCodeQualityAudit({
      projectId: 'proj-nightly',
      worktreePath: '/tmp/wt',
      trigger: 'nightly',
      mode: 'supervised',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pipelineRunId).toMatch(/^nightly-proj-nightly-\d{4}-\d{2}-\d{2}$/);
    }
    expect(mockInsertAuditOnly).toHaveBeenCalledOnce();
    expect(mockUpdateByPipeline).not.toHaveBeenCalled();
    const insertCall = mockInsertAuditOnly.mock.calls[0][0] as {
      pipelineRunId: string;
      auditScore: number;
    };
    expect(insertCall.auditScore).toBe(72);
    expect(insertCall.pipelineRunId).toMatch(/^nightly-/);
  });
});

describe('runCodeQualityAudit — autonomy gate', () => {
  it('fires when audit_score < 60 AND mode === autonomous', async () => {
    mockInvokeSkill.mockResolvedValueOnce({
      output: buildOutput({ totalScore: 50 }),
      decisionSummaries: [],
      events: [],
    });

    const result = await runCodeQualityAudit({
      projectId: 'proj-1',
      worktreePath: '/tmp/wt',
      pipelineRunId: 'pipe-3',
      trigger: 'deep-retro',
      mode: 'autonomous',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.autonomyGateFired).toBe(true);

    const eventKinds = mockAppendEvent.mock.calls.map((c) => (c[0] as { kind: string }).kind);
    expect(eventKinds).toContain('audit.autonomy-gate-fired');
  });

  it('does NOT fire in supervised mode even when score is well below threshold', async () => {
    mockInvokeSkill.mockResolvedValueOnce({
      output: buildOutput({ totalScore: 30 }),
      decisionSummaries: [],
      events: [],
    });

    const result = await runCodeQualityAudit({
      projectId: 'proj-1',
      worktreePath: '/tmp/wt',
      pipelineRunId: 'pipe-4',
      trigger: 'nightly',
      mode: 'supervised',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.autonomyGateFired).toBe(false);
  });

  it('does NOT fire when score >= threshold even in autonomous mode', async () => {
    mockInvokeSkill.mockResolvedValueOnce({
      output: buildOutput({ totalScore: AUDIT_AUTONOMY_THRESHOLD + 5 }),
      decisionSummaries: [],
      events: [],
    });

    const result = await runCodeQualityAudit({
      projectId: 'proj-1',
      worktreePath: '/tmp/wt',
      pipelineRunId: 'pipe-5',
      trigger: 'nightly',
      mode: 'autonomous',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.autonomyGateFired).toBe(false);
  });
});

describe('runCodeQualityAudit — failure path', () => {
  it('returns ok:false and emits audit.failed when invokeSkill throws', async () => {
    mockInvokeSkill.mockRejectedValueOnce(new Error('LLM context window exceeded'));

    const result = await runCodeQualityAudit({
      projectId: 'proj-1',
      worktreePath: '/tmp/wt',
      pipelineRunId: 'pipe-6',
      trigger: 'deep-retro',
      mode: 'autonomous',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('LLM context window exceeded');

    const eventKinds = mockAppendEvent.mock.calls.map((c) => (c[0] as { kind: string }).kind);
    expect(eventKinds).toContain('audit.failed');
    // No audit_score persisted on failure
    expect(mockUpdateByPipeline).not.toHaveBeenCalled();
    expect(mockInsertAuditOnly).not.toHaveBeenCalled();
  });

  it('synthesises a nightly pipelineRunId when none is supplied', async () => {
    mockInvokeSkill.mockResolvedValueOnce({
      output: buildOutput({ totalScore: 72 }),
      decisionSummaries: [],
      events: [],
    });

    const result = await runCodeQualityAudit({
      projectId: 'proj-nightly',
      worktreePath: '/tmp/wt',
      trigger: 'nightly',
      mode: 'supervised',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pipelineRunId).toMatch(/^nightly-proj-nightly-\d{4}-\d{2}-\d{2}$/);
    }
  });
});
