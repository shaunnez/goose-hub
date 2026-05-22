/** @vitest-environment jsdom */
import { GATE_STATES } from '@/lib/constants';
import { parseDependencies } from '@/lib/dependency-parser';
import { renderMarkdownToHtml } from '@/lib/markdown';
import type { AgentEventDto, TriageResultDto, WorkItemDto } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverviewSection, buildOverviewWorkflowSummary } from './components/OverviewSection';
import { extractPlaywrightRepro } from './lib/playwright-capture';
import { SECTIONS } from './lib/sections';

afterEach(() => {
  vi.clearAllMocks();
});

vi.mock('@/lib/api', () => ({
  fetchEvents: vi.fn().mockResolvedValue([]),
  fetchIssueDiff: vi.fn().mockResolvedValue({ diff: null, runId: null }),
  fetchIssueCosts: vi.fn().mockResolvedValue({ rows: [], totalUsd: 0, hasEstimated: false }),
  fetchPersonaNames: vi.fn().mockResolvedValue([]),
  fetchTriageResult: vi.fn().mockResolvedValue(null),
}));

describe('detail page — sections config', () => {
  it('lists the 11 design sections in order (chat removed post-M20)', () => {
    expect(SECTIONS.map((s) => s.key)).toEqual([
      'overview',
      'repo',
      'investigation',
      'grill',
      'prd',
      'code',
      'qa',
      'review',
      'retrospective',
      'timeline',
      'costs',
    ]);
  });

  it('overview, investigation, code, and timeline are the available sections in M6', () => {
    const available = SECTIONS.filter((s) => s.available).map((s) => s.key);
    expect(available).toContain('overview');
    expect(available).toContain('investigation');
    expect(available).toContain('code');
    expect(available).toContain('timeline');
  });

  it('every deferred section carries a milestone tag', () => {
    for (const s of SECTIONS) {
      if (s.available) continue;
      expect(s.milestone).toBeTruthy();
    }
  });
});

describe('detail page — markdown sanitization', () => {
  it('escapes raw HTML tags in the body', () => {
    const html = renderMarkdownToHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders bold + inline code + links', () => {
    const html = renderMarkdownToHtml('**bold** `code` [link](https://example.com)');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code');
    expect(html).toContain('href="https://example.com"');
  });

  it('renders headings and lists', () => {
    const html = renderMarkdownToHtml('## Heading\n\n- one\n- two');
    expect(html).toContain('<h2');
    expect(html).toContain('<ul');
    expect(html).toContain('<li>one</li>');
  });
});

describe('GatePendingBanner — gate state map', () => {
  it('returns banner text for prd-review gate state', () => {
    expect(GATE_STATES['factory:prd-review']).toBe('PRD Review pending — human approval required');
  });

  it('does not include approved (approved shows no gate banner)', () => {
    expect(GATE_STATES['factory:approved']).toBeUndefined();
  });

  it('does not include needs-review because automated review is not a human gate', () => {
    expect(GATE_STATES['factory:needs-review']).toBeUndefined();
  });

  it('returns banner text for needs-human gate state', () => {
    expect(GATE_STATES['factory:needs-human']).toBe('Human intervention required');
  });

  it('returns banner text for gate-pending grill state', () => {
    expect(GATE_STATES['factory:gate-pending']).toBe('Question ready — grill');
  });

  it('does not include non-gate states', () => {
    expect(GATE_STATES['factory:in-progress']).toBeUndefined();
    expect(GATE_STATES['factory:triaging']).toBeUndefined();
    expect(GATE_STATES['factory:done']).toBeUndefined();
  });
});

// ─── M6.07: PlaywrightCaptureSection — extractPlaywrightRepro ────────────────

function makeInvestigationEvent(id: number, playwrightRepro?: unknown) {
  return {
    id,
    projectId: 'proj',
    workItemId: 'wi-1',
    kind: 'agent.investigation-complete',
    payload: { investigate: {}, ...(playwrightRepro != null ? { playwrightRepro } : {}) },
    createdAt: new Date().toISOString(),
  };
}

const FULL_REPRO = {
  screenshots: [{ path: 'evidence/issue-42/step-1.png', caption: 'Login page', step: 1 }],
  gifPath: 'evidence/issue-42/walkthrough.gif',
  consoleErrors: [{ message: 'TypeError: x is undefined', type: 'error' as const }],
  testErrors: ['REPRO_EXPECTED_BUG: error banner missing'],
  runnerErrors: ['Error: No tests found.'],
  reproSteps: ['Navigate to /login', 'Click submit'],
  reproduced: true,
};

describe('extractPlaywrightRepro', () => {
  it('returns null when no events are present', () => {
    expect(extractPlaywrightRepro([])).toBeNull();
  });

  it('returns null when no investigation-complete events are present', () => {
    const events = [
      { id: 1, projectId: 'p', workItemId: 'w', kind: 'agent.log', payload: {}, createdAt: '' },
    ];
    expect(extractPlaywrightRepro(events)).toBeNull();
  });

  it('returns null when investigation-complete has no playwrightRepro', () => {
    const events = [makeInvestigationEvent(1)];
    expect(extractPlaywrightRepro(events)).toBeNull();
  });

  it('returns the playwrightRepro payload when present', () => {
    const events = [makeInvestigationEvent(1, FULL_REPRO)];
    const result = extractPlaywrightRepro(events);
    expect(result).not.toBeNull();
    expect(result?.reproduced).toBe(true);
    expect(result?.reproSteps).toEqual(['Navigate to /login', 'Click submit']);
    expect(result?.screenshots).toHaveLength(1);
    expect(result?.consoleErrors).toHaveLength(1);
    expect(result?.testErrors).toEqual(['REPRO_EXPECTED_BUG: error banner missing']);
    expect(result?.runnerErrors).toEqual(['Error: No tests found.']);
    expect(result?.gifPath).toBe('evidence/issue-42/walkthrough.gif');
  });

  it('picks the latest investigation-complete event with a playwrightRepro', () => {
    const older = makeInvestigationEvent(1, { ...FULL_REPRO, reproduced: false, notes: 'old' });
    const newer = makeInvestigationEvent(2, { ...FULL_REPRO, reproduced: true, notes: 'new' });
    const result = extractPlaywrightRepro([older, newer]);
    expect(result?.reproduced).toBe(true);
    expect(result?.notes).toBe('new');
  });

  it('skips investigation events without playwrightRepro and returns the one that has it', () => {
    const noRepro = makeInvestigationEvent(1);
    const withRepro = makeInvestigationEvent(2, FULL_REPRO);
    const result = extractPlaywrightRepro([noRepro, withRepro]);
    expect(result?.reproduced).toBe(true);
  });

  it('returns reproduced: false payload without error', () => {
    const repro = { ...FULL_REPRO, reproduced: false, notes: 'Could not trigger the error' };
    const result = extractPlaywrightRepro([makeInvestigationEvent(1, repro)]);
    expect(result?.reproduced).toBe(false);
    expect(result?.notes).toBe('Could not trigger the error');
  });

  it('strips ANSI/control sequences from historical Playwright repro text', () => {
    const result = extractPlaywrightRepro([
      makeInvestigationEvent(1, {
        ...FULL_REPRO,
        testErrors: ['\u001b[31mREPRO_EXPECTED_BUG: error banner missing\u001b[0m'],
        runnerErrors: ['\u001b[2mError: No tests found.\u001b[0m\u0007'],
        notes: '\u001b[33mCould not trigger the error\u001b[0m',
      }),
    ]);

    expect(result?.testErrors).toEqual(['REPRO_EXPECTED_BUG: error banner missing']);
    expect(result?.runnerErrors).toEqual(['Error: No tests found.']);
    expect(result?.notes).toBe('Could not trigger the error');
  });
});

// ---------------------------------------------------------------------------
// dependency-parser (web lib)
// ---------------------------------------------------------------------------

describe('dependency-parser — web lib', () => {
  it('returns empty array for a body with no dep declarations', () => {
    expect(parseDependencies('See #42 for context')).toEqual([]);
  });

  it('parses "Depends on #N" as depends-on', () => {
    expect(parseDependencies('Depends on #286')).toEqual([
      { type: 'depends-on', repoRef: null, issueNumber: 286 },
    ]);
  });

  it('parses "Blocks #N" as blocks', () => {
    expect(parseDependencies('Blocks #291')).toEqual([
      { type: 'blocks', repoRef: null, issueNumber: 291 },
    ]);
  });

  it('parses cross-repo ref', () => {
    expect(parseDependencies('Depends on shaunnez/other-repo#12')).toEqual([
      { type: 'depends-on', repoRef: 'shaunnez/other-repo', issueNumber: 12 },
    ]);
  });

  it('rejects alphanumeric suffix — #123abc must not match', () => {
    expect(parseDependencies('Depends on #123abc')).toEqual([]);
  });

  it('handles multiple dep lines', () => {
    const body = 'Depends on #286\nDepends on #291\nBlocks #300';
    expect(parseDependencies(body)).toEqual([
      { type: 'depends-on', repoRef: null, issueNumber: 286 },
      { type: 'depends-on', repoRef: null, issueNumber: 291 },
      { type: 'blocks', repoRef: null, issueNumber: 300 },
    ]);
  });
});

const BASE_ITEM: WorkItemDto = {
  id: 'wi-42',
  externalId: '42',
  repoRef: 'shaunnez/goose-hub',
  title: 'Workflow snapshot grid',
  body: 'Body',
  type: 'bug',
  priority: 'medium',
  mode: 'manual',
  state: 'factory:triaging',
  authorIsOwner: false,
  schedule: 'queued',
  exec: 'todo',
  dependsOn: [],
  blocks: [],
  createdAt: '2026-05-23T00:00:00.000Z',
  lastPersonaId: null,
};

const TRIAGE_RESULT: TriageResultDto = {
  priority: 'high',
  type: 'bug',
  candidates: [
    { repo: 'shaunnez/goose-hub', confidence: 88, evidence: 'matched', tier: 1 },
    { repo: 'shaunnez/other-repo', confidence: 41, evidence: 'fallback', tier: 2 },
  ],
  overrideRepo: 'shaunnez/goose-hub',
};

function makeEvent(
  id: number,
  kind: string,
  payload: unknown,
  extras: Partial<AgentEventDto> = {},
): AgentEventDto {
  return {
    id,
    projectId: 'proj',
    workItemId: 'github:shaunnez/goose-hub#42',
    kind,
    payload,
    runId: extras.runId ?? null,
    personaId: extras.personaId ?? null,
    createdAt: extras.createdAt ?? `2026-05-23T00:00:0${id}.000Z`,
  };
}

describe('overview workflow summary', () => {
  it('returns six cards in order with safe defaults when events are empty', () => {
    const cards = buildOverviewWorkflowSummary({ item: BASE_ITEM, events: [] });
    expect(cards.map((card) => card.title)).toEqual([
      'Triage',
      'Investigation',
      'Grill',
      'PRD',
      'Review',
      'Retro',
    ]);
    expect(cards[0].status).toBe('Not run');
    expect(cards[2].status).toBe('N/A');
    expect(cards[2].statusTone).toBe('muted');
    expect(cards[3].status).toBe('N/A');
    expect(cards[3].statusTone).toBe('muted');
  });

  it('uses canonical triage data for triage metrics', () => {
    const cards = buildOverviewWorkflowSummary({
      item: BASE_ITEM,
      events: [],
      triage: TRIAGE_RESULT,
    });
    const triageCard = cards[0];
    expect(triageCard.metrics.map((entry) => entry.label)).toEqual([
      'Priority',
      'Type',
      'Repo',
      'Conf',
      'Candidates',
      'Override',
    ]);
    expect(triageCard.metrics.map((entry) => entry.value)).toContain('high');
    expect(triageCard.metrics.map((entry) => entry.value)).toContain('bug');
    expect(triageCard.metrics.map((entry) => entry.value)).toContain('shaunnez/goose-hub');
    expect(triageCard.metrics.map((entry) => entry.value)).toContain('88%');
    expect(triageCard.metrics.map((entry) => entry.value)).toContain('2');
    expect(triageCard.metrics.map((entry) => entry.value)).toContain('Yes');
  });

  it('falls back to triage-complete events and latest investigation/review outputs', () => {
    const events = [
      makeEvent(1, 'agent.triage-complete', {
        priority: 'low',
        type: 'bug',
        overrideRepo: null,
        pickedRepo: 'shaunnez/goose-hub',
        confidence: 67,
        candidates: [{ repo: 'shaunnez/goose-hub', confidence: 67 }],
      }),
      makeEvent(
        2,
        'agent.investigation-complete',
        {
          investigate: {
            findings: 'old',
            keyFiles: [],
            confidence: 'low',
            openQuestions: [],
            decisionSummaries: [],
          },
        },
        { runId: 'run-old' },
      ),
      makeEvent(
        3,
        'agent.investigation-complete',
        {
          investigate: {
            findings: 'new',
            keyFiles: [
              { path: 'src/a.ts', reason: 'entry' },
              { path: 'src/b.ts', reason: 'helper' },
            ],
            confidence: 'high',
            openQuestions: ['why'],
            decisionSummaries: [],
          },
          playwrightRepro: { reproduced: true },
        },
        { runId: 'run-new' },
      ),
      makeEvent(4, 'agent.tool-call', { tool_name: 'Read' }, { runId: 'run-new' }),
      makeEvent(5, 'agent.tool-call', { tool_name: 'rg' }, { runId: 'run-new' }),
      makeEvent(6, 'review.completed', {
        verdict: 'needs-fix',
        confidence: 0.51,
        criteriaChecks: [{ criterion: 'A', status: 'unmet' }],
        findings: [{ severity: 'major', description: 'Issue' }],
      }),
      makeEvent(7, 'review.completed', {
        verdict: 'approved',
        confidence: 0.91,
        criteriaChecks: [
          { criterion: 'A', status: 'met' },
          { criterion: 'B', status: 'met' },
        ],
        findings: [
          { severity: 'blocker', description: 'Fixed' },
          { severity: 'major', description: 'Tracked' },
        ],
      }),
      makeEvent(8, 'pr.opened', { prNumber: 123 }),
    ];

    const cards = buildOverviewWorkflowSummary({ item: BASE_ITEM, events });
    const triageCard = cards[0];
    const investigationCard = cards[1];
    const reviewCard = cards[4];

    expect(triageCard.metrics.find((entry) => entry.label === 'Conf')?.value).toBe('67%');
    expect(investigationCard.metrics.find((entry) => entry.label === 'Key files')?.value).toBe('2');
    expect(investigationCard.metrics.find((entry) => entry.label === 'Reads')?.value).toBe('1');
    expect(investigationCard.metrics.find((entry) => entry.label === 'Searches')?.value).toBe('1');
    expect(investigationCard.metrics.find((entry) => entry.label === 'Repro')?.value).toBe('Yes');
    expect(reviewCard.status).toBe('approved');
    expect(reviewCard.metrics.find((entry) => entry.label === 'Checks')?.value).toBe('2/2');
    expect(reviewCard.metrics.find((entry) => entry.label === 'PR')?.value).toBe('#123');
  });

  it('treats discover lane cards as applicable for feature work and counts PRD/retro details', () => {
    const item = { ...BASE_ITEM, type: 'feature', state: 'factory:prd-review' };
    const events = [
      makeEvent(1, 'grill.question-posted', { question: 'First?' }),
      makeEvent(2, 'grill.question-posted', { question: 'Second?' }),
      makeEvent(3, 'grill.completed', { rounds: 2, forcedCompletion: false }),
      makeEvent(4, 'prd.drafted', {
        prd: {
          estimatedComplexity: 'medium',
          acceptanceCriteria: [
            { id: 'AC-1', statement: 'One' },
            { id: 'AC-2', statement: 'Two' },
          ],
          journeys: [
            {
              id: 'J-1',
              persona: 'Dev',
              trigger: 'Open',
              steps: [],
              successState: 'Done',
              errorStates: [],
              edgeCases: [],
            },
          ],
          verticalSlices: [
            { title: 'Slice', goal: 'Goal', estimatedSize: 'M', journeyRefs: ['J-1'] },
          ],
        },
        advisorConcerns: ['Need analytics'],
      }),
      makeEvent(5, 'retrospective.completed', {
        tier: 'deep',
        output: {
          outcome: 'partial',
          workItemNumber: 42,
          summary: { wentWell: 'a', didNotGoWell: 'b', architecturalTakeaway: 'c' },
          improvementCandidates: [
            { kind: 'workflow', targetPath: 'a', suggestionText: 'x', confidence: 'high' },
            { kind: 'skill-prompt', targetPath: 'b', suggestionText: 'y', confidence: 'medium' },
          ],
          decisionSummaries: [],
          triggerReasons: ['many-failures'],
          personaQualityScores: [],
          learningEntries: [
            {
              observation: 'obs',
              rationale: 'rat',
              improvementKind: 'workflow',
              confidence: 'high',
            },
          ],
          decisionPatterns: [{ pattern: 'pattern', occurrences: 2, confidence: 'medium' }],
        },
      }),
    ];

    const cards = buildOverviewWorkflowSummary({ item, events });
    const grillCard = cards[2];
    const prdCard = cards[3];
    const retroCard = cards[5];

    expect(grillCard.status).toBe('Complete');
    expect(grillCard.metrics.find((entry) => entry.label === 'Questions')?.value).toBe('2');
    expect(prdCard.status).toBe('In review');
    expect(prdCard.metrics.find((entry) => entry.label === 'ACs')?.value).toBe('2');
    expect(prdCard.metrics.find((entry) => entry.label === 'Journeys')?.value).toBe('1');
    expect(prdCard.metrics.find((entry) => entry.label === 'Slices')?.value).toBe('1');
    expect(prdCard.metrics.find((entry) => entry.label === 'Concerns')?.value).toBe('1');
    expect(retroCard.metrics.find((entry) => entry.label === 'Tier')?.value).toBe('deep');
    expect(retroCard.metrics.find((entry) => entry.label === 'Patterns')?.value).toBe('1');
    expect(retroCard.metrics.find((entry) => entry.label === 'Learnings')?.value).toBe('1');
  });
});

describe('OverviewSection workflow grid', () => {
  it('renders six readable cards with section links even when event data is partial', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(
      ['events', 'proj', '42'],
      [
        makeEvent(1, 'agent.investigation-complete', {
          investigate: {
            findings: '',
            keyFiles: [],
            confidence: 'medium',
            openQuestions: [],
            decisionSummaries: [],
          },
        }),
      ],
    );
    queryClient.setQueryData(['issue-diff', 'proj', '42'], { diff: null, runId: null });
    queryClient.setQueryData(['issue-costs', 'proj', '42'], {
      rows: [],
      totalUsd: 0,
      hasEstimated: false,
    });
    queryClient.setQueryData(['triage', 'proj', '42'], TRIAGE_RESULT);
    queryClient.setQueryData(['persona-names'], []);

    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          MemoryRouter,
          { initialEntries: ['/projects/proj/items/42'] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/projects/:slug/items/:id',
              element: createElement(OverviewSection, { item: BASE_ITEM, projectSlug: 'proj' }),
            }),
          ),
        ),
      ),
    );

    expect(html).toContain('data-testid="overview-workflow-grid"');
    expect(html).toContain('>Triage<');
    expect(html).toContain('>Investigation<');
    expect(html).toContain('>Grill<');
    expect(html).toContain('>PRD<');
    expect(html).toContain('>Review<');
    expect(html).toContain('>Retro<');
    expect(html).toContain('href="/projects/proj/items/42/repo"');
    expect(html).toContain('href="/projects/proj/items/42/investigation"');
    expect(html).toContain('href="/projects/proj/items/42/grill"');
    expect(html).toContain('href="/projects/proj/items/42/prd"');
    expect(html).toContain('href="/projects/proj/items/42/review"');
    expect(html).toContain('href="/projects/proj/items/42/retrospective"');
  });
});
