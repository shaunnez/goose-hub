import type { AgentEventDto } from '@/lib/types';
/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderTimelineItem } from '../TimelineEvents';

afterEach(cleanup);

function makeEvent(kind: string, payload: unknown, id = 1): AgentEventDto {
  return {
    id,
    kind,
    payload,
    runId: 'e3bb94b3-4bf6-4c93-9407-9a2dc30c760d',
    createdAt: '2026-05-14T02:41:57Z',
    workItemId: 'github:shaunnez/goose-hub#782',
    projectId: 'goose-hub-self',
  } as AgentEventDto;
}

function withRawProbe(payload: unknown): unknown {
  if (typeof payload === 'string') {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return JSON.stringify({ ...parsed, rawProbeKey: 'raw-value' });
  }
  return { ...(payload as Record<string, unknown>), rawProbeKey: 'raw-value' };
}

describe('Misc timeline events', () => {
  it('renders dogfood.seed-applied as base metadata instead of raw JSON', () => {
    const event = makeEvent('dogfood.seed-applied', {
      seedId: 'seed-issue-1061',
      baseBranch: 'main',
      seedCommit: 'df129a7113e7344f045166b5e5dc0b7214632c8d',
      truthSignal: {
        testFile: 'apps/web/src/lib/logger.test.ts',
        testName: 'drops metadata from browser logs',
      },
      rawProbeKey: 'raw-value',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Dogfood seed applied')).toBeTruthy();
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('seed-issue-1061');
    expect(rendered).toContain('main');
    expect(rendered).toContain('df129a71');
    expect(rendered).toContain('truth drops metadata from browser logs');
    expect(rendered).toContain('apps/web/src/lib/logger.test.ts');
    expect(rendered).not.toContain('"seedCommit"');
    expect(rendered).not.toContain('[object Object]');
    expect(rendered).not.toContain('rawProbeKey');
    expect(rendered).not.toContain('raw-value');
  });

  it('renders agent.budget-exceeded as summary text instead of raw JSON', () => {
    const event = makeEvent('agent.budget-exceeded', {
      runId: 'e3bb94b3-4bf6-4c93-9407-9a2dc30c760d',
      skill: 'implement',
      modelId: 'gpt-5.4-mini',
      costUsd: 11.234089500000001,
      budgetUsd: 6,
      inputTokens: 14593982,
      outputTokens: 64134,
      overByUsd: 5.23409,
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Agent budget exceeded')).toBeTruthy();
    expect(screen.getByText('Spent $11.23')).toBeTruthy();
    expect(screen.getByText('Budget $6.00')).toBeTruthy();
    expect(screen.getByText('Over by $5.23')).toBeTruthy();
    expect(screen.getByText('14.7M tokens (14.6M in / 64k out)')).toBeTruthy();
    expect(screen.getByText('gpt-5.4-mini')).toBeTruthy();
    expect(screen.getByText('implement')).toBeTruthy();
    expect(screen.getByText('run e3bb94b3')).toBeTruthy();
    expect(document.body.textContent).not.toContain('"costUsd"');
  });

  it('renders agent.tool-intensity-anomaly as a compact warning', () => {
    const event = makeEvent('agent.tool-intensity-anomaly', {
      runId: 'e3bb94b3-4bf6-4c93-9407-9a2dc30c760d',
      skill: 'investigate',
      readCount: 34,
      p95ReadCount: 12,
      thresholdReadCount: 24,
      bytesRead: 8192,
      redundantReads: 5,
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Tool intensity anomaly')).toBeTruthy();
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('investigate');
    expect(rendered).toContain('34 reads');
    expect(rendered).toContain('p95 12 reads');
    expect(rendered).toContain('threshold 24 reads');
    expect(rendered).toContain('8.0 KB read');
    expect(rendered).toContain('5 redundant reads');
    expect(rendered).toContain('run e3bb94b3');
    expect(rendered).not.toContain('"readCount"');
  });

  it('renders tool.violation as a compact blocked-context warning', () => {
    const event = makeEvent('tool.violation', {
      role: 'scout',
      disallowedKey: 'scoutDigest',
      runId: 'a43c3f8f-c568-41d0-baab-4618658e7154:scout:wave2-interface-designer:0',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Tool violation')).toBeTruthy();
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('scout');
    expect(rendered).toContain('blocked key scoutDigest');
    expect(rendered).toContain('run a43c3f8f');
    expect(rendered).not.toContain('"disallowedKey"');
  });

  it('renders agent.investigation-seed-built as seed counts instead of raw JSON', () => {
    const event = makeEvent('agent.investigation-seed-built', {
      candidateFileCount: 0,
      candidateSymbolCount: 3,
      recentlyChangedCount: 2,
      priorInvestigationCount: 1,
      builtMs: 12,
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Investigation seed built')).toBeTruthy();
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('0 candidate files');
    expect(rendered).toContain('3 symbol hints');
    expect(rendered).toContain('2 recent changes');
    expect(rendered).toContain('1 prior investigation');
    expect(rendered).toContain('12 ms');
    expect(rendered).not.toContain('"candidateFileCount"');
  });

  it('renders agent.bug-enhance-lazy as seed counts instead of raw JSON', () => {
    const event = makeEvent('agent.bug-enhance-lazy', {
      hadExistingSeed: false,
      producedSeed: true,
      candidateFileCount: 4,
      candidateComponentCount: 3,
      candidateRouteCount: 0,
      ranMs: 41636,
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Bug grounding seed')).toBeTruthy();
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('Produced seed');
    expect(rendered).toContain('lazy run');
    expect(rendered).toContain('4 candidate files');
    expect(rendered).toContain('3 components');
    expect(rendered).toContain('0 routes');
    expect(rendered).toContain('41.6 s');
    expect(rendered).not.toContain('"hadExistingSeed"');
  });

  it('renders feature grounding events as focused cards instead of raw JSON', () => {
    const event = makeEvent('feature.grounding-enhanced', {
      groundingRunId: '9e0d7d75-1124-4977-bbc1-f5ffb65c0651',
      enhanceRunId: '9e0d7d75-1124-4977-bbc1-f5ffb65c0651:feature-enhance',
      candidateFiles: [
        {
          path: 'apps/web/src/components/chrome/TopBar.tsx',
          confidence: 'high',
          source: 'tool-verified',
          reason: 'Header component owns capture and search buttons.',
        },
      ],
      existingSurfaces: ['apps/web/src/components/chrome/TopBar.tsx'],
      reusablePatterns: ['Modal state managed in TopBar via useState.'],
      acceptanceHints: ['Pressing Cmd+J opens capture modal.'],
      confidence: 'high',
      routeTier: 'T0',
      selectedStages: ['triage', 'implement', 'qa', 'review', 'retro'],
      budgetCaps: { maxUsd: 0.3, maxScouts: 0, allowWave2: false, reviewerSlots: 1 },
      baseBranch: 'main',
      investigationSeed: {
        candidateFiles: [{ path: 'apps/web/src/components/chrome/TopBar.tsx', root: 'worktree' }],
        candidateSymbols: [],
        testFiles: [],
      },
      rawProbeKey: 'raw-value',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Feature grounding enhanced')).toBeTruthy();
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('apps/web/src/components/chrome/TopBar.tsx');
    expect(rendered).toContain('Header component owns capture and search buttons.');
    expect(rendered).toContain('T0');
    expect(rendered).toContain('$0.30 cap');
    expect(rendered).toContain('stages triage → implement → qa → review → retro');
    expect(rendered).toContain('Modal state managed in TopBar');
    expect(rendered).toContain('Pressing Cmd+J opens capture modal.');
    expect(rendered).not.toContain('"candidateFiles"');
    expect(rendered).not.toContain('rawProbeKey');
    expect(rendered).not.toContain('raw-value');
  });

  it('renders agent.redundant-read as a compact warning instead of raw JSON', () => {
    const event = makeEvent('agent.redundant-read', {
      path: 'apps/web/src/components/chat/components/ChatPanel.tsx',
      count: 4,
      guidance:
        'Subsequent reads of the same file re-inject identical bytes into the kv-cache. Reuse what is already loaded or widen the line range in a single call.',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Redundant file read')).toBeTruthy();
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('4 reads');
    expect(rendered).toContain('apps/web/src/components/chat/components/ChatPanel.tsx');
    expect(rendered).toContain('Reuse what is already loaded');
    expect(rendered).not.toContain('"guidance"');
  });

  it('renders operational timeline events as JSX cards instead of raw JSON', () => {
    const cases: Array<{ kind: string; title: string; payload: unknown }> = [
      {
        kind: 'agent.fallback-triggered',
        title: 'Fallback triggered',
        payload: { skill: 'implement', modelId: 'gpt-5.5', fallbackModel: 'gpt-5.4' },
      },
      { kind: 'agent.repo-override', title: 'Repository override', payload: { repo: 'web' } },
      { kind: 'merge.conflict', title: 'Merge conflict', payload: { prNumber: 123 } },
      {
        kind: 'merge.conflict-resolved',
        title: 'Merge conflict resolved',
        payload: { prNumber: 123, sha: 'abc123' },
      },
      {
        kind: 'merge.conflict-unresolvable',
        title: 'Merge conflict unresolved',
        payload: { prNumber: 123, error: 'manual resolution required' },
      },
      {
        kind: 'qa.tier-disagreement',
        title: 'QA tier disagreement',
        payload: { runId: 'qa-run', disagreements: [{ tier: 'functional' }] },
      },
      {
        kind: 'project.budget-exceeded',
        title: 'Project budget exceeded',
        payload: { totalTokens: 114216854, limitTokens: 100000000, totalCostUsd: 253.64 },
      },
      {
        kind: 'coach.completed',
        title: 'Coach completed',
        payload: { targetSkillName: 'investigate', candidateId: 42, hasPatch: true },
      },
      {
        kind: 'coach.dispatch-triggered',
        title: 'Coach dispatch triggered',
        payload: { targetSkillName: 'investigate', playbookId: 'playbook-1', patternCount: 2 },
      },
      {
        kind: 'coach.skipped-forbidden-target',
        title: 'Coach skipped forbidden target',
        payload: { targetSkillName: 'qa', reason: 'forbidden-target' },
      },
      {
        kind: 'coach.dispatch-failed',
        title: 'Coach dispatch failed',
        payload: { targetSkillName: 'investigate', error: 'runtime failed' },
      },
      {
        kind: 'workflow.smoke-failed',
        title: 'Workflow smoke failed',
        payload: JSON.stringify({ failedCheck: 'gh auth status', reason: 'not logged in' }),
      },
      {
        kind: 'agent.cancelled',
        title: 'Agent cancelled',
        payload: { runId: 'cancelled-run', reason: 'timeout', elapsedMs: 120000 },
      },
      {
        kind: 'spec.wp-issues-created',
        title: 'Work package issues created',
        payload: { pipelineRunId: 'pipeline-1', count: 3 },
      },
      {
        kind: 'merge-decision.completed',
        title: 'Merge decision completed',
        payload: { passed: false, prNumber: 123, reason: 'score-below-threshold', score: 70 },
      },
      {
        kind: 'audit.completed',
        title: 'Audit completed',
        payload: { trigger: 'nightly', rating: 'strong', auditScore: 87 },
      },
      {
        kind: 'audit.failed',
        title: 'Audit failed',
        payload: { trigger: 'nightly', pipelineRunId: 'pipeline-1', error: 'schema failed' },
      },
      {
        kind: 'audit.autonomy-gate-fired',
        title: 'Audit autonomy gate fired',
        payload: { trigger: 'nightly', auditScore: 55, threshold: 70 },
      },
      {
        kind: 'agent.investigation-seed-empty',
        title: 'Investigation seed empty',
        payload: { reason: 'No grounded seed artifact.' },
      },
      {
        kind: 'state.transition-deferred',
        title: 'State transition deferred',
        payload: { from: 'factory:investigating', to: 'factory:needs-prd', error: 'retry failed' },
      },
      {
        kind: 'agent.bug-enhance-hallucinated',
        title: 'Bug grounding pruned',
        payload: { runId: 'bug-run', droppedCount: 3, originalCount: 3 },
      },
      {
        kind: 'agent.bug-enhance-empty',
        title: 'Bug grounding empty',
        payload: {
          source: 'promotion',
          runId: 'bug-run',
          reasons: ['no-tool-call-made', 'empty-enhanced-content', 'no-grounded-hints'],
          repoIntelCallCount: 0,
          blockedToolCallCount: 0,
        },
      },
      {
        kind: 'agent.feature-enhance-empty',
        title: 'Feature grounding empty',
        payload: {
          enhanceRunId: 'grounding-run:feature-enhance',
          reasons: ['tool-call-blocked', 'no-grounded-output'],
          repoIntelCallCount: 1,
          blockedToolCallCount: 1,
          blockedToolNames: ['search_text'],
          validationIssues: [{ path: 'candidateFiles.0.source', message: 'Invalid source' }],
        },
      },
      {
        kind: 'agent.bug-enhance-workspace-empty',
        title: 'Bug grounding workspace missing',
        payload: { workspaceDir: '/tmp/missing', runId: 'bug-run' },
      },
      {
        kind: 'agent.run-aborted',
        title: 'Agent run aborted',
        payload: { reason: 'excessive-redundant-reads', redundantReads: 5, totalReads: 10 },
      },
      {
        kind: 'workflow.route-selected',
        title: 'Workflow route selected',
        payload: {
          tier: 'T1',
          source: 'lazy-enhance',
          budgetCaps: {
            maxUsd: 0.8,
            maxScouts: 1,
            allowWave2: false,
            reviewerSlots: 1,
          },
          evidence: {
            reasons: ['bug with <=3 seed files (1)', 'no investigation'],
          },
          selectedStages: ['triage', 'investigate', 'implement', 'qa', 'review', 'retro'],
        },
      },
      {
        kind: 'workflow.route-confirmed',
        title: 'Workflow route confirmed',
        payload: {
          tier: 'T2',
          source: 'investigation',
          budgetCaps: {
            maxUsd: 2,
            maxScouts: 3,
            allowWave2: false,
            reviewerSlots: 1,
          },
          evidence: {
            reasons: ['bug with no seed - fail-safe up to T2', '2 non-test files'],
          },
          selectedStages: [
            'triage',
            'investigate',
            'spec-author',
            'implement',
            'qa',
            'review',
            'retro',
          ],
        },
      },
      {
        kind: 'workflow.route-escalation-proposed',
        title: 'Workflow route escalation proposed',
        payload: {
          tier: 'T3',
          source: 'investigation',
          interventionId: 'intervention-1',
          escalationTriggers: ['schema signal'],
        },
      },
      {
        kind: 'workflow.route-cap-applied',
        title: 'Workflow route cap applied',
        payload: {
          requiredTier: 'T3',
          effectiveTier: 'T2',
          cappedBy: 'budget',
          reason: 'project cap',
        },
      },
    ];

    render(
      <ul>
        {cases.map((item, index) =>
          renderTimelineItem(
            {
              kind: 'event',
              event: makeEvent(item.kind, withRawProbe(item.payload), index),
            },
            index,
          ),
        )}
      </ul>,
    );

    const rendered = document.body.textContent ?? '';
    for (const item of cases) {
      expect(screen.getByText(item.title)).toBeTruthy();
      expect(document.querySelector(`[data-event-kind="${item.kind}"]`)).toBeTruthy();
    }
    expect(rendered).toContain('$0.80 cap');
    expect(rendered).toContain('stages triage → investigate → implement → qa → review → retro');
    expect(rendered).toContain('bug with no seed - fail-safe up to T2');
    expect(rendered).toContain('grounding-run:feature-enhance');
    expect(rendered).toContain('1 repo-intel calls');
    expect(rendered).toContain('search_text');
    expect(rendered).toContain('1 blocked tools');
    expect(rendered).toContain('1 validation issues');
    expect(rendered).toContain('tool-call-blocked, no-grounded-output');
    expect(rendered).not.toContain('"rawProbeKey"');
    expect(rendered).not.toContain('raw-value');
    expect(rendered).not.toContain('"selectedStages"');
  });

  it('renders agent.runtime-advisory as a compact warning instead of raw JSON', () => {
    const event = makeEvent('agent.runtime-advisory', {
      runId: '706dcce3-efc7-409e-9f85-6b892b27f092',
      skill: 'bug-enhance',
      surface: 'resources/read failed',
      stderr:
        "2026-05-24T23:17:27.555260Z ERROR codex_core::tools::router: error=resources/read failed: resources/read failed for `factory-tools` (factory://core/agent-runtime/logger.ts): Mcp error: -32603: ENOENT: no such file or directory, open '/Users/shaunnesbitt/.factory/workspaces/388033da-91c0-4b27-bf19-83c02f667308/core/agent-runtime/logger.ts'",
      toolName: 'resources/read',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Runtime advisory')).toBeTruthy();
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('bug-enhance');
    expect(rendered).toContain('resources/read');
    expect(rendered).toContain('resources/read failed');
    expect(rendered).toContain('factory://core/agent-runtime/logger.ts');
    expect(rendered).toContain('706dcce3-efc7-409e-9f85-6b892b27f092');
    expect(rendered).toContain('Runtime surfaced a tool access warning');
    expect(rendered).not.toContain('"stderr"');
    expect(rendered).not.toContain('codex_core::tools::router');
  });

  it('renders agent.investigation-context-injected as summary text instead of raw JSON', () => {
    const event = makeEvent('agent.investigation-context-injected', {
      skill: 'implement-wp',
      wpId: 'WP1',
      investigationRunId: 'c8a6cf90-202a-4ee8-a903-04fbbb67ecc2',
      keyFiles: ['apps/server/src/domains/workflows/triage-batch.ts'],
      keyFileCount: 1,
      openQuestionCount: 2,
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Investigation context injected')).toBeTruthy();
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('implement-wp');
    expect(rendered).toContain('WP1');
    expect(rendered).toContain('1 key file');
    expect(rendered).toContain('2 open questions');
    expect(rendered).toContain('apps/server/src/domains/workflows/triage-batch.ts');
    expect(rendered).not.toContain('"keyFiles"');
  });

  it('renders investigation.digest-applied as digest savings instead of raw JSON', () => {
    const event = makeEvent('investigation.digest-applied', {
      wave: 'wave-1-to-synthesis',
      scoutCount: 4,
      rawBytes: 8192,
      digestBytes: 2048,
      bytesSaved: 6144,
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Investigation digest applied')).toBeTruthy();
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('wave-1-to-synthesis');
    expect(rendered).toContain('4 scouts');
    expect(rendered).toContain('8.0 KB raw');
    expect(rendered).toContain('2.0 KB digest');
    expect(rendered).toContain('6.0 KB saved (75%)');
    expect(rendered).not.toContain('"rawBytes"');
  });

  it('renders agent.related-surface-manifest-created as summary text instead of raw JSON', () => {
    const event = makeEvent('agent.related-surface-manifest-created', {
      runId: 'ec9bd51c-5ab2-4b43-9c34-b81b18287fdb',
      skill: 'implement',
      keyFileCount: 3,
      packageRootCount: 1,
      existingTestCount: 1,
      testCandidateCount: 8,
      checkedAbsentCount: 8,
      evidenceSpecPath: 'apps/web/e2e/issue-896.spec.ts',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Related surface manifest')).toBeTruthy();
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('implement');
    expect(rendered).toContain('3 key files');
    expect(rendered).toContain('1 existing test');
    expect(rendered).toContain('8 candidates');
    expect(rendered).toContain('8 absent checked');
    expect(rendered).toContain('apps/web/e2e/issue-896.spec.ts');
    expect(rendered).not.toContain('"keyFileCount"');
  });

  it('renders agent.discovery-budget-exceeded as a compact warning', () => {
    const event = makeEvent('agent.discovery-budget-exceeded', {
      runId: 'ec9bd51c-5ab2-4b43-9c34-b81b18287fdb',
      skill: 'implement',
      checkedAbsentCount: 8,
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Discovery budget exceeded')).toBeTruthy();
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('implement repeated discovery for manifest-resolved paths');
    expect(rendered).toContain('8 absent paths were already checked');
    expect(rendered).toContain('run ec9bd51c');
    expect(rendered).not.toContain('"checkedAbsentCount"');
  });

  it('renders agent.wrong-surface-guard as summary text instead of raw JSON', () => {
    const event = makeEvent('agent.wrong-surface-guard', {
      skill: 'parallel-implement',
      reason: 'engineering-spec-missed-investigation-surface',
      expectedKeyFiles: ['apps/server/src/domains/workflows/triage-batch.ts'],
      touchedPaths: ['slices/parallel-implement/workflow.ts'],
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Wrong surface guard')).toBeTruthy();
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('parallel-implement');
    expect(rendered).toContain('engineering-spec-missed-investigation-surface');
    expect(rendered).toContain('apps/server/src/domains/workflows/triage-batch.ts');
    expect(rendered).toContain('slices/parallel-implement/workflow.ts');
    expect(rendered).not.toContain('"expectedKeyFiles"');
  });

  it('renders path-normalized and contract drift events as compact operational facts', () => {
    const normalized = makeEvent(
      'agent.path-normalized',
      {
        skill: 'parallel-implement',
        fields: [
          {
            field: 'workPackages[0].filesOwned[0]',
            from: 'src/Button.tsx',
            to: 'apps/web/src/Button.tsx',
          },
        ],
      },
      11,
    );
    const mismatch = makeEvent(
      'agent.output-fact-mismatch',
      {
        skill: 'implement',
        observedChangedFiles: { count: 1, paths: ['apps/web/src/Button.tsx'] },
        observedWriteFiles: { count: 1, paths: ['apps/web/src/Button.tsx'] },
        modelDeclaredFiles: { count: 1, paths: ['src/Button.tsx'] },
        mismatches: {
          observedNotDeclared: { count: 1, paths: ['apps/web/src/Button.tsx'] },
          declaredNotObserved: { count: 1, paths: ['src/Button.tsx'] },
        },
      },
      12,
    );
    const blocked = makeEvent(
      'agent.contract-gate-blocked',
      {
        skill: 'implement-wp',
        gate: 'implement-wp-ownership',
        reason: 'ambiguous-files-owned',
      },
      13,
    );
    const repairFailed = makeEvent(
      'agent.output-repair-failed',
      {
        skill: 'implement',
        reason: 'terminal-output-validation-failed-after-repair-retry',
        message:
          'Implementation/tool execution may have succeeded; the failure is terminal JSON output validation.',
      },
      14,
    );

    render(
      <ul>
        {renderTimelineItem({ kind: 'event', event: normalized }, 0)}
        {renderTimelineItem({ kind: 'event', event: mismatch }, 1)}
        {renderTimelineItem({ kind: 'event', event: blocked }, 2)}
        {renderTimelineItem({ kind: 'event', event: repairFailed }, 3)}
      </ul>,
    );

    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('Path normalized');
    expect(rendered).toContain('src/Button.tsx');
    expect(rendered).toContain('apps/web/src/Button.tsx');
    expect(rendered).toContain('Operational fact mismatch');
    expect(rendered).toContain('Git observed changed');
    expect(rendered).toContain('Tool observed writes');
    expect(rendered).toContain('Observed not declared');
    expect(rendered).toContain('Contract gate blocked');
    expect(rendered).toContain('ambiguous-files-owned');
    expect(rendered).toContain('Output repair failed');
    expect(rendered).toContain('terminal-output-validation-failed-after-repair-retry');
    expect(rendered).not.toContain('"observedChangedFiles"');
  });

  it('renders agent.disclosure as summarized input metadata', () => {
    const event = makeEvent('agent.disclosure', {
      kind: 'diff_summarized',
      skill: 'dev-review',
      bytesSaved: 4096,
      artifactKeys: ['pr-diff:abc'],
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('Input summarized')).toBeTruthy();
    expect(screen.getByText('diff_summarized')).toBeTruthy();
    expect(screen.getByText('dev-review')).toBeTruthy();
    expect(screen.getByText('pr-diff:abc')).toBeTruthy();
    expect(screen.getByText('4.0 KB saved')).toBeTruthy();
  });

  it('links state transitions back to the intervention that caused them', () => {
    const event = makeEvent('state.transitioned', {
      from: 'factory:needs-human',
      to: 'factory:dev-ready',
      by: 'operator',
      causedByInterventionId: 'intervention-abcdef123456',
    });

    render(<ul>{renderTimelineItem({ kind: 'event', event }, 0)}</ul>);

    expect(screen.getByText('State transitioned')).toBeTruthy();
    expect(screen.getByText('factory:needs-human → factory:dev-ready (by operator)')).toBeTruthy();
    expect(document.body.textContent).toContain('Caused by intervention');
    expect(document.body.textContent).toContain('interven');
  });
});
