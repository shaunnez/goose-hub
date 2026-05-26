import type { ScoutReport } from '@goose-hub/core/agent-runtime/swarm.js';
import { describe, expect, it } from 'vitest';
import { planInvestigation } from './investigation-planner.js';

function report(scoutName: string, file = 'apps/web/src/Login.tsx'): ScoutReport {
  return {
    scoutName,
    status: 'ok',
    findings: [{ file, fact: 'Localized root cause found', confidence: 'high' }],
    decisionSummaries: [],
    runId: `run:${scoutName}`,
  };
}

describe('investigation planner', () => {
  it('selects a focused scout set for a localized UI bug', () => {
    const plan = planInvestigation({
      swarmEnabled: true,
      workItem: {
        type: 'bug',
        title: 'Login modal submit button is disabled',
        body: 'The regression is in apps/web/src/LoginModal.tsx. Check the component and tests.',
      },
    });

    expect(plan.mode).toBe('swarm');
    expect(plan.selectedWave1Scouts.map((scout) => scout.scoutName).sort()).toEqual([
      'scout-code-path',
      'scout-test-inventory',
      'scout-user-journey',
    ]);
    expect(plan.minSuccessfulScouts).toBe(3);
    expect(plan.scoutEffortHints['scout-code-path']).toBe('low');
  });

  it('adds schema scout for API/schema contract issues', () => {
    const plan = planInvestigation({
      swarmEnabled: true,
      workItem: {
        type: 'feature',
        title: 'Add billing export API contract',
        body: 'Define the endpoint response schema and Zod payload contract.',
      },
    });

    expect(plan.selectedWave1Scouts.map((scout) => scout.scoutName).sort()).toEqual([
      'scout-code-path',
      'scout-pattern',
      'scout-schema',
      'scout-test-inventory',
    ]);
  });

  it('does not add schema scout for UI state wording without boundary signals', () => {
    const plan = planInvestigation({
      swarmEnabled: true,
      workItem: {
        type: 'bug',
        title: 'Timeline empty state button is misaligned',
        body: 'The UI state on apps/web/src/components/detail/Timeline.tsx overlaps the button.',
      },
    });

    expect(plan.selectedWave1Scouts.map((scout) => scout.scoutName)).not.toContain('scout-schema');
    expect(plan.selectedWave1Scouts.map((scout) => scout.scoutName).sort()).toEqual([
      'scout-code-path',
      'scout-test-inventory',
      'scout-user-journey',
    ]);
  });

  it('uses a broader scout set for vague cross-module issues', () => {
    const plan = planInvestigation({
      swarmEnabled: true,
      workItem: {
        type: 'bug',
        title: 'Runtime behavior is flaky across server and web',
        body: 'Unknown high-risk issue crossing apps/server, apps/web, and runtime settings.',
      },
    });

    expect(plan.selectedWave1Scouts.map((scout) => scout.scoutName).sort()).toEqual([
      'scout-code-path',
      'scout-dependency',
      'scout-pattern',
      'scout-schema',
      'scout-test-inventory',
      'scout-user-journey',
    ]);
  });

  it('preserves the legacy single investigator path when swarm is disabled', () => {
    const plan = planInvestigation({
      swarmEnabled: false,
      workItem: {
        type: 'bug',
        title: 'Any issue',
        body: 'Swarm disabled at project level.',
      },
    });

    expect(plan).toMatchObject({
      mode: 'single',
      selectedWave1Scouts: [],
      wave2Needed: false,
      selectedWave2Scouts: [],
      minSuccessfulScouts: 1,
      scoutEffortHints: {},
    });
  });

  it('skips Wave 2 when Wave 1 gives high-confidence localized facts', () => {
    const plan = planInvestigation({
      swarmEnabled: true,
      workItem: {
        type: 'bug',
        title: 'Fix apps/web/src/LoginModal.tsx disabled button',
        body: 'Localized component bug with known path.',
      },
      wave1Reports: [report('scout-code-path'), report('scout-test-inventory')],
      contradictions: [],
      scoutDigestContext: { reports: [] },
    });

    expect(plan.wave2Needed).toBe(false);
    expect(plan.selectedWave2Scouts).toEqual([]);
  });

  it('selects Wave 2 scouts only for contract and risk signals', () => {
    const plan = planInvestigation({
      swarmEnabled: true,
      workItem: {
        type: 'feature',
        title: 'Change auth session API contract',
        body: 'The endpoint response schema changes and auth state migration is high risk.',
      },
      wave1Reports: [
        report('scout-code-path', 'apps/server/src/auth.ts'),
        report('scout-schema', 'apps/server/src/auth/schema.ts'),
      ],
      contradictions: [{ file: 'apps/server/src/auth.ts', facts: ['conflict'] }],
      scoutDigestContext: { reports: [] },
    });

    expect(plan.wave2Needed).toBe(true);
    expect(plan.selectedWave2Scouts.map((scout) => scout.scoutName).sort()).toEqual([
      'wave2-interface-designer',
      'wave2-risk-analyst',
    ]);
    expect(plan.scoutEffortHints['wave2-interface-designer']).toBe('medium');
    expect(plan.scoutEffortHints['wave2-risk-analyst']).toBe('medium');
  });

  it('detects Wave 2 signals from mixed-case scout findings', () => {
    const plan = planInvestigation({
      swarmEnabled: true,
      workItem: {
        type: 'bug',
        title: 'Unexpected behavior',
        body: 'Needs another look.',
      },
      wave1Reports: [
        {
          ...report('scout-code-path', 'apps/server/src/auth.ts'),
          findings: [
            {
              file: 'apps/server/src/auth.ts',
              fact: 'Auth Session API contract changed',
              confidence: 'high',
            },
          ],
        },
      ],
      contradictions: [],
      scoutDigestContext: { reports: [] },
    });

    expect(plan.selectedWave2Scouts.map((scout) => scout.scoutName).sort()).toEqual([
      'wave2-interface-designer',
      'wave2-risk-analyst',
    ]);
  });
});
