import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acceptanceCriteriaToVerifyCommands,
  parseIssueBodyAcceptanceCriteria,
} from './issue-body.js';
import { resolveAcceptanceContract } from './resolver.js';

const { getEngineeringSpec, replay } = vi.hoisted(() => ({
  getEngineeringSpec: vi.fn(),
  replay: vi.fn(),
}));

vi.mock('../event-stream/store.js', () => ({
  eventStore: { replay },
}));

vi.mock('../engineering-specs/repository.js', () => ({
  getEngineeringSpec,
}));

describe('acceptance contracts', () => {
  beforeEach(() => {
    replay.mockReturnValue([]);
    getEngineeringSpec.mockReturnValue(null);
  });

  it('parses issue-body checkbox ACs with optional verify blocks', () => {
    const criteria = parseIssueBodyAcceptanceCriteria(`## Acceptance criteria

- [ ] Lane order is newest first
      Verify: pnpm vitest run apps/web/src/lib/lanes.config.test.ts
      Expected: pass
      Tolerance: exact

- [x] Existing cards keep their lane`);

    expect(criteria).toEqual([
      {
        id: 'AC-1',
        statement: 'Lane order is newest first',
        verifyCommand: 'pnpm vitest run apps/web/src/lib/lanes.config.test.ts',
        expected: 'pass',
        tolerance: 'exact',
        sourceRef: 'workItem.body',
      },
      {
        id: 'AC-2',
        statement: 'Existing cards keep their lane',
        sourceRef: 'workItem.body',
      },
    ]);
  });

  it('uses normalized event before engineering spec, PRD, and issue body', () => {
    replay.mockImplementation((filter: { kind?: string }) =>
      filter.kind === 'acceptance.contract-authored'
        ? [
            {
              id: 7,
              runId: 'run-normalized',
              createdAt: '2026-05-21T00:00:00Z',
              payload: {
                contract: {
                  source: 'normalized',
                  criteria: [{ id: 'AC-1', statement: 'Normalized criterion' }],
                },
              },
            },
          ]
        : [],
    );
    getEngineeringSpec.mockReturnValue({
      pipelineRunId: 'spec-run',
      updatedAt: '2026-05-21T01:00:00Z',
      spec: { acceptanceCriteria: [{ id: 'AC-S', statement: 'Spec criterion' }] },
    });

    expect(
      resolveAcceptanceContract({
        projectId: 'p',
        workItemId: 'w',
        issueBody: '- [ ] Issue criterion',
      }),
    ).toMatchObject({
      source: 'normalized',
      runId: 'run-normalized',
      eventId: 7,
      criteria: [{ id: 'AC-1', statement: 'Normalized criterion' }],
    });
  });

  it('falls back in precedence order: engineering spec, PRD, issue body', () => {
    getEngineeringSpec.mockReturnValue({
      pipelineRunId: 'spec-run',
      updatedAt: '2026-05-21T01:00:00Z',
      spec: {
        acceptanceCriteria: [
          {
            id: 'AC-S',
            statement: 'Spec criterion',
            verifyCommand: 'pnpm test',
            tolerance: 'exact',
            crossCutting: true,
          },
        ],
      },
    });

    expect(
      resolveAcceptanceContract({ projectId: 'p', workItemId: 'w', issueBody: '- [ ] Issue' }),
    ).toMatchObject({
      source: 'engineering-spec',
      runId: 'spec-run',
      criteria: [
        {
          id: 'AC-S',
          statement: 'Spec criterion',
          verifyCommand: 'pnpm test',
          tolerance: 'exact',
          crossCutting: true,
        },
      ],
    });

    getEngineeringSpec.mockReturnValue(null);
    replay.mockImplementation((filter: { kind?: string }) =>
      filter.kind === 'prd.drafted'
        ? [
            {
              id: 8,
              runId: 'prd-run',
              createdAt: '2026-05-21T02:00:00Z',
              payload: {
                prd: { acceptanceCriteria: [{ id: 'AC-P', statement: 'PRD criterion' }] },
              },
            },
          ]
        : [],
    );

    expect(
      resolveAcceptanceContract({ projectId: 'p', workItemId: 'w', issueBody: '- [ ] Issue' }),
    ).toMatchObject({ source: 'prd', runId: 'prd-run' });

    replay.mockReturnValue([]);
    expect(
      resolveAcceptanceContract({ projectId: 'p', workItemId: 'w', issueBody: '- [ ] Issue' }),
    ).toMatchObject({ source: 'issue-body', criteria: [{ statement: 'Issue' }] });
  });

  it('converts only fully verifiable criteria into verifyCommands', () => {
    expect(
      acceptanceCriteriaToVerifyCommands([
        {
          id: 'AC-1',
          statement: 'Runs test',
          verifyCommand: 'pnpm test',
          expected: 'pass',
          tolerance: 'exact',
        },
        { id: 'AC-2', statement: 'No command' },
      ]),
    ).toEqual([{ ac: 'Runs test', command: 'pnpm test', expected: 'pass', tolerance: 'exact' }]);
  });
});
