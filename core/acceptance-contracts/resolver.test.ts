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
        executableChecks: [
          {
            id: 'AC-1-check-1',
            command: 'pnpm vitest run apps/web/src/lib/lanes.config.test.ts',
            outputExpectation: { mode: 'exact', value: 'pass' },
          },
        ],
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
            executableChecks: [
              {
                id: 'AC-S-check-1',
                command: 'pnpm test',
                outputExpectation: { mode: 'exact', value: 'pass' },
              },
            ],
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
          executableChecks: [{ command: 'pnpm test' }],
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

  it('converts executable checks into verification commands with default exit code', () => {
    expect(
      acceptanceCriteriaToVerifyCommands([
        {
          id: 'AC-1',
          statement: 'Runs test',
          executableChecks: [{ id: 'AC-1-check-1', command: 'pnpm test', timeoutMs: 30_000 }],
        },
        { id: 'AC-2', statement: 'No command' },
      ]),
    ).toEqual([
      {
        criterionId: 'AC-1',
        checkId: 'AC-1-check-1',
        ac: 'Runs test',
        command: 'pnpm test',
        expectedExitCodes: [0],
        timeoutMs: 30_000,
      },
    ]);
  });

  it('preserves criteria when an optional executable check has empty expectedExitCodes', () => {
    getEngineeringSpec.mockReturnValue({
      pipelineRunId: 'spec-run',
      updatedAt: '2026-05-21T01:00:00Z',
      spec: {
        acceptanceCriteria: [
          {
            id: 'AC-S',
            statement: 'Spec criterion',
            executableChecks: [{ id: 'AC-S-check-1', command: 'pnpm test', expectedExitCodes: [] }],
          },
        ],
      },
    });

    expect(
      resolveAcceptanceContract({ projectId: 'p', workItemId: 'w', issueBody: '' }),
    ).toMatchObject({
      source: 'engineering-spec',
      criteria: [
        {
          id: 'AC-S',
          statement: 'Spec criterion',
          executableChecks: [{ id: 'AC-S-check-1', command: 'pnpm test' }],
        },
      ],
    });
  });
});
