import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import { toJsonSchema } from '../../core/agent-runtime/schema-bridge.js';
import { PRDOutputSchema } from './schema.js';
import config, { WritePRDContextSchema } from './skill.config.js';

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const baseJourney = {
  id: 'j1',
  persona: 'admin',
  trigger: 'Admin opens the audit-log page',
  steps: [
    {
      userAction: 'Click "Export CSV"',
      systemResponse: 'Modal opens with date-range picker',
      dataShown: 'Default range is last 30 days',
      stateChange: 'modal:open',
    },
  ],
  successState: 'CSV file downloaded',
  errorStates: [
    { error: 'Date range exceeds 1 year', recovery: 'Show inline validation, keep modal open' },
  ],
  edgeCases: ['Empty result set still produces a header-only CSV'],
};

const baseFunctionalSpec = {
  behaviors: [
    {
      when: 'Admin clicks Export CSV',
      given: 'Audit log page is loaded',
      // biome-ignore lint/suspicious/noThenProperty: matches FunctionalSpecBehaviorSchema (when/given/then)
      then: 'Date-range picker modal is shown',
    },
  ],
  stateModel: [
    {
      state: 'idle',
      entryCondition: 'Page loaded',
      behaviorsAvailable: ['open-modal'],
      exitTransitions: ['modal-open'],
    },
  ],
  invalidTransitions: [
    { from: 'idle', to: 'exporting', reason: 'Must open modal first to choose date range' },
  ],
  dataConstraints: [
    { type: 'dateRange', validation: 'Range must be <= 365 days and end >= start' },
  ],
};

const baseSlice = {
  title: 'Admin CSV export of audit log',
  goal: 'Allow an admin to download a CSV of the audit log filtered by date range',
  estimatedSize: 'M' as const,
  journeyRefs: ['j1'],
};

const baseDecisionSummary = {
  kind: 'PLAN' as const,
  summary: 'Decomposed into one vertical slice anchored on the admin export journey',
  evidence: 'Refined intent calls for CSV-only output',
};

const validPRD = {
  title: 'Admin CSV export of audit log',
  problem: 'Admins cannot extract audit data for offline analysis.',
  proposedSolution: 'Add a date-range CSV export endpoint behind the existing admin gate.',
  outOfScope: ['JSON export', 'Bulk re-import', 'Export scheduling'],
  successCriteria: ['Admin can export 30 days of audit data in under 5 seconds'],
  acceptanceCriteria: [
    {
      id: 'ac1',
      statement: 'Admin sees the date-range modal when clicking Export CSV',
      journeyId: 'j1',
      stepIdx: 0,
    },
  ],
  journeys: [baseJourney],
  functionalSpec: baseFunctionalSpec,
  verticalSlices: [baseSlice],
  estimatedComplexity: 'medium' as const,
  implementationDecisions: [
    {
      decision: 'Stream CSV via existing admin route',
      rationale: 'Follows admin gateway pattern in CONTEXT.md',
      moduleRef: 'apps/server/src/domains/admin/',
    },
  ],
  testingDecisions: {
    approach: 'Verify admin endpoint returns correct CSV rows for date range',
    modulesToTest: ['slices/admin-csv-export/slice.test.ts'],
  },
  decisionSummaries: [baseDecisionSummary],
};

// ─── Schema tests ──────────────────────────────────────────────────────────────

describe('PRD schema', () => {
  it('accepts a valid full PRD with one journey, one slice, one journey-anchored AC', () => {
    const result = PRDOutputSchema.safeParse(validPRD);
    expect(result.success).toBe(true);
  });

  it('accepts a PRD with one cross-cutting AC (no journeyId, crossCutting: true)', () => {
    const result = PRDOutputSchema.safeParse({
      ...validPRD,
      acceptanceCriteria: [
        {
          id: 'ac-cc1',
          statement: 'All admin endpoints respond within 500ms p95',
          crossCutting: true,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an AC missing journeyId AND not marked crossCutting (superRefine)', () => {
    const result = PRDOutputSchema.safeParse({
      ...validPRD,
      acceptanceCriteria: [
        {
          id: 'ac-orphan',
          statement: 'Some testable thing with no anchor',
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' | ');
      expect(messages).toContain('crossCutting');
    }
  });

  it('rejects an AC with crossCutting: false and no journeyId (superRefine)', () => {
    // crossCutting must be strictly true to satisfy the rule.
    const result = PRDOutputSchema.safeParse({
      ...validPRD,
      acceptanceCriteria: [
        {
          id: 'ac-orphan-explicit',
          statement: 'Another orphan',
          crossCutting: false,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty journeys array (cardinality < 1)', () => {
    const result = PRDOutputSchema.safeParse({ ...validPRD, journeys: [] });
    expect(result.success).toBe(false);
  });

  it('rejects empty verticalSlices array (cardinality < 1)', () => {
    const result = PRDOutputSchema.safeParse({ ...validPRD, verticalSlices: [] });
    expect(result.success).toBe(false);
  });

  it('accepts an empty acceptanceCriteria array', () => {
    // The orphan-AC superRefine fires per-element; with no entries there is
    // nothing to check, and the issue does not mandate a min-1 cardinality on
    // acceptanceCriteria itself. So an empty array is intentionally allowed.
    const result = PRDOutputSchema.safeParse({ ...validPRD, acceptanceCriteria: [] });
    expect(result.success).toBe(true);
  });

  it('rejects missing decisionSummaries', () => {
    const { decisionSummaries: _omit, ...withoutDS } = validPRD;
    const result = PRDOutputSchema.safeParse(withoutDS);
    expect(result.success).toBe(false);
  });

  it('rejects empty decisionSummaries array (FACTORY_RULES rule 6)', () => {
    const result = PRDOutputSchema.safeParse({ ...validPRD, decisionSummaries: [] });
    expect(result.success).toBe(false);
  });

  it('rejects invalid estimatedComplexity value', () => {
    const result = PRDOutputSchema.safeParse({ ...validPRD, estimatedComplexity: 'extreme' });
    expect(result.success).toBe(false);
  });

  it('accepts optional engineeringSpecRef when present', () => {
    const result = PRDOutputSchema.safeParse({
      ...validPRD,
      engineeringSpecRef: 'docs/eng-specs/audit-export.md',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an AC with verifyCommand set', () => {
    const result = PRDOutputSchema.safeParse({
      ...validPRD,
      acceptanceCriteria: [
        {
          id: 'ac1',
          statement: 'Modal opens on click',
          journeyId: 'j1',
          stepIdx: 0,
          verifyCommand: 'pnpm vitest run slices/0042/',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('zod toJSONSchema roundtrip yields object with properties', () => {
    const jsonSchema = toJSONSchema(PRDOutputSchema);
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
    expect(jsonSchema).toHaveProperty('properties');
  });

  it('generated Codex response schema allows AC cross-reference fields', () => {
    if (config.outputSchema == null) throw new Error('write-prd outputSchema is required');

    const jsonSchema = toJsonSchema(config.outputSchema);
    const properties = jsonSchema.properties as Record<string, unknown>;
    const acceptanceCriteria = properties.acceptanceCriteria as { items?: unknown };
    const acceptanceCriterion = acceptanceCriteria.items as {
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };

    expect(acceptanceCriterion.properties).toMatchObject({
      id: expect.any(Object),
      statement: expect.any(Object),
      journeyId: expect.any(Object),
      crossCutting: expect.any(Object),
      stepIdx: expect.any(Object),
      verifyCommand: expect.any(Object),
    });
    expect(acceptanceCriterion.properties?.journeyId).toEqual({ type: ['string', 'null'] });
    expect(acceptanceCriterion.properties?.crossCutting).toEqual({ type: ['boolean', 'null'] });
    expect(acceptanceCriterion.properties?.stepIdx).toMatchObject({ type: ['integer', 'null'] });
    expect(acceptanceCriterion.properties?.verifyCommand).toEqual({ type: ['string', 'null'] });
    expect(acceptanceCriterion.required).toEqual([
      'id',
      'statement',
      'journeyId',
      'stepIdx',
      'crossCutting',
      'verifyCommand',
    ]);
    expect(acceptanceCriterion.additionalProperties).toBe(false);
  });
});

// ─── Skill config tests ────────────────────────────────────────────────────────

describe('write-prd skill config', () => {
  it('has role prd-writer', () => {
    expect(config.role).toBe('prd-writer');
  });

  it('is pinned to opus model (PRD writing is reasoning-heavy)', () => {
    expect(config.modelPin).toBe('opus');
  });

  it('requires fresh context (PRD must be derivable from refined intent alone)', () => {
    expect(config.freshContext).toBe(true);
  });

  it('toolBundles include read and core', () => {
    expect(config.toolBundles).toContain('read');
    expect(config.toolBundles).toContain('core');
  });

  it('contextAllowlist includes the expected leaf paths', () => {
    expect(config.contextAllowlist).toContain('workItem.title');
    expect(config.contextAllowlist).toContain('workItem.body');
    expect(config.contextAllowlist).toContain('workItem.number');
    expect(config.contextAllowlist).toContain('refinedIntent');
    expect(config.contextAllowlist).toContain('priority');
  });

  const validProjectContext = {
    stackSummary: 'runtime: node',
    contextMd: '',
    adrSummaries: [],
    claudeMd: '',
  };

  it('contextSchema validates a fully-populated valid input', () => {
    const result = WritePRDContextSchema.safeParse({
      workItem: { title: 'Admin CSV export', body: 'Allow CSV download.', number: 314 },
      refinedIntent: 'Admin can download a date-ranged CSV of the audit log.',
      priority: 'medium',
      projectContext: validProjectContext,
    });
    expect(result.success).toBe(true);
  });

  it('contextSchema rejects missing workItem', () => {
    const result = WritePRDContextSchema.safeParse({
      refinedIntent: 'something',
      priority: 'low',
    });
    expect(result.success).toBe(false);
  });

  it('contextSchema rejects missing workItem.number', () => {
    const result = WritePRDContextSchema.safeParse({
      workItem: { title: 't', body: 'b' },
      refinedIntent: 'x',
      priority: 'low',
    });
    expect(result.success).toBe(false);
  });

  it('contextSchema rejects missing refinedIntent', () => {
    const result = WritePRDContextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 1 },
      priority: 'low',
    });
    expect(result.success).toBe(false);
  });

  it('contextSchema rejects invalid priority value', () => {
    const result = WritePRDContextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 1 },
      refinedIntent: 'x',
      priority: 'p1',
    });
    expect(result.success).toBe(false);
  });

  it('contextSchema accepts each valid priority value', () => {
    for (const priority of ['low', 'medium', 'high', 'critical'] as const) {
      const result = WritePRDContextSchema.safeParse({
        workItem: { title: 't', body: 'b', number: 1 },
        refinedIntent: 'x',
        priority,
        projectContext: validProjectContext,
      });
      expect(result.success).toBe(true);
    }
  });
});
