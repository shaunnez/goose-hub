import type { AgentResult, AgentSpec } from './interface.js';
import { getNextOutcome } from './mock-test-registry.js';

export function resolveMockOutput(spec: AgentSpec): AgentResult {
  const workItemId = (spec.context.workItemId as string | undefined) ?? spec.workItemId;
  const testOutcome =
    getNextOutcome(workItemId, spec.skill) ?? (spec.context.testOutcome as string | undefined);

  switch (spec.skill) {
    case 'triage': {
      if (testOutcome === 'reject') {
        return {
          output: {
            type: 'chore',
            priority: 'p3',
            labels: [],
            reasoning: 'e2e reject fixture',
            decisionSummaries: [{ kind: 'VERDICT', summary: 'Rejected for e2e test' }],
          },
          decisionSummaries: [{ kind: 'VERDICT', summary: 'Rejected for e2e test' }],
          events: [],
        };
      }
      const workItem = (spec.context?.workItem ?? {}) as { type?: string };
      const incoming = workItem.type;
      const type =
        incoming === 'bug' || incoming === 'research' || incoming === 'feature'
          ? incoming
          : 'chore';
      return {
        output: {
          type,
          priority: 'p3',
          labels: [],
          reasoning: 'e2e fixture',
          decisionSummaries: [{ kind: 'PLAN', summary: `Classified as ${type} for e2e` }],
        },
        decisionSummaries: [{ kind: 'PLAN', summary: `Classified as ${type} for e2e` }],
        events: [],
      };
    }

    case 'repo-match':
      return {
        output: {
          candidates: [
            { repo: 'shaunnez/goose-hub', confidence: 95, evidence: 'name match', tier: 1 },
          ],
          decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock repo match for e2e test' }],
        },
        decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock repo match for e2e test' }],
        events: [],
      };

    case 'implement':
      return {
        output: {
          plan: 'E2E mock plan',
          filesWritten: [{ path: 'e2e-mock.ts', reason: 'e2e fixture' }],
          testsWritten: [],
          testsRun: { command: 'pnpm test ', paths: [] },
          prUrl: 'https://github.com/shaunnez/goose-hub/pull/999',
          evidenceSpecPath: null,
          confidence: 'high',
          decisionSummaries: [{ kind: 'GREEN', summary: 'Mock implementation for e2e test' }],
        },
        decisionSummaries: [{ kind: 'GREEN', summary: 'Mock implementation for e2e test' }],
        events: [],
      };

    case 'investigate': {
      const confidence =
        testOutcome === 'low-confidence'
          ? 'low'
          : testOutcome === 'medium-confidence'
            ? 'medium'
            : 'high';
      return {
        output: {
          findings: 'E2E mock findings',
          keyFiles: [],
          confidence,
          openQuestions: [],
          requiresBrowserRepro: false,
          decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock investigation for e2e test' }],
        },
        decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock investigation for e2e test' }],
        events: [],
      };
    }

    case 'research':
      return {
        output: {
          summary: 'E2E mock research summary',
          answer: 'E2E mock research answer with one directly actionable follow-up.',
          evidence: [],
          options: [],
          followUpWork: [
            {
              type: 'feature',
              title: 'Mock directly actionable follow-up',
              rationale: 'Mock research found one implementation-ready follow-up.',
              actionable: true,
            },
          ],
          actionability: 'directly-actionable',
          openQuestions: [],
          decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock research for e2e test' }],
        },
        decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock research for e2e test' }],
        events: [],
      };

    case 'qa': {
      if (testOutcome === 'fail') {
        const emptyTier = { passed: false, findings: [] };
        const finding = {
          tier: 'functional' as const,
          severity: 'error' as const,
          description: 'mock qa failure',
          disposition: 'needs-fix' as const,
          dispositionRef: 'e2e-test',
        };
        return {
          output: {
            verdict: 'fail',
            overallScore: 20,
            threshold: 70,
            tierResults: {
              structural: emptyTier,
              functional: {
                passed: false,
                findings: [finding],
              },
              regression: emptyTier,
            },
            qualityScores: {
              openClosed: 5,
              conceptCount: 5,
              timeToCapability: 5,
              complecting: 5,
              loc: 0,
              coupling: 0,
              gallsLaw: 0,
              cyclomaticComplexity: 0,
            },
            findings: [finding],
            decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock QA fail for e2e test' }],
          },
          decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock QA fail for e2e test' }],
          events: [],
        };
      }
      const emptyTierPass = { passed: true, findings: [] };
      return {
        output: {
          verdict: 'pass',
          overallScore: 85,
          threshold: 70,
          tierResults: {
            structural: emptyTierPass,
            functional: emptyTierPass,
            regression: emptyTierPass,
          },
          qualityScores: {
            openClosed: 18,
            conceptCount: 12,
            timeToCapability: 12,
            complecting: 12,
            loc: 8,
            coupling: 8,
            gallsLaw: 8,
            cyclomaticComplexity: 5,
          },
          findings: [],
          decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock QA pass for e2e test' }],
        },
        decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock QA pass for e2e test' }],
        events: [],
      };
    }

    case 'dev-review': {
      // Default: no-blockers (matches the "Static no-blockers default + per-test overrides"
      // mock policy agreed for M19.10–M19.12). Tests that need findings or a
      // blockers-found verdict opt in via mock-test-registry's setNextOutcome().
      if (testOutcome === 'blockers-found') {
        const finding = {
          severity: 'P1' as const,
          category: 'correctness' as const,
          file: 'mock/file.ts',
          line: 42,
          summary: 'Mock blocker for e2e test',
          suggestion: 'Mock suggestion',
        };
        return {
          output: {
            verdict: 'blockers-found',
            findings: [finding],
            decisionSummaries: [
              { kind: 'VERDICT', summary: 'Mock dev-review blockers-found for e2e test' },
            ],
          },
          decisionSummaries: [
            { kind: 'VERDICT', summary: 'Mock dev-review blockers-found for e2e test' },
          ],
          events: [],
        };
      }
      return {
        output: {
          verdict: 'no-blockers',
          findings: [],
          decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock dev-review no-blockers' }],
        },
        decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock dev-review no-blockers' }],
        events: [],
      };
    }

    case 'review': {
      const acceptanceCriteria =
        (
          spec.context.acceptanceContract as
            | { criteria?: Array<{ id?: string; statement?: string }> }
            | undefined
        )?.criteria ?? [];
      const criteriaChecks = acceptanceCriteria.map((criterion) => ({
        criterionId: criterion.id,
        criterion: criterion.statement ?? criterion.id ?? 'Mock acceptance criterion',
        status: 'met' as const,
        notes: 'Mock review checked canonical acceptance criterion',
      }));
      if (testOutcome === 'needs-fix') {
        return {
          output: {
            verdict: 'needs-fix',
            confidence: 0.4,
            criteriaChecks,
            findings: [],
            decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock review needs-fix for e2e test' }],
          },
          decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock review needs-fix for e2e test' }],
          events: [],
        };
      }
      return {
        output: {
          verdict: 'approved',
          confidence: 0.95,
          criteriaChecks,
          findings: [],
          decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock review approval for e2e test' }],
        },
        decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock review approval for e2e test' }],
        events: [],
      };
    }

    case 'retrospective-light':
    case 'retrospective-deep': {
      const workItemCtx = (spec.context?.workItem ?? {}) as { number?: number };
      const workItemNumber = workItemCtx.number ?? 0;
      const base = {
        outcome: 'success' as const,
        workItemNumber,
        summary: {
          wentWell: 'E2E mock run completed successfully',
          didNotGoWell: 'Nothing — this is a mock',
          architecturalTakeaway: 'MOCK_AGENTS=true bypasses real model calls',
        },
        improvementCandidates: [],
        decisionSummaries: [{ kind: 'INSIGHT' as const, summary: 'Mock retro for e2e test' }],
      };
      if (spec.skill === 'retrospective-deep') {
        return {
          output: {
            ...base,
            triggerReasons: ['e2e-mock'],
            personaQualityScores: [],
            learningEntries: [],
            decisionPatterns: [],
          },
          decisionSummaries: base.decisionSummaries,
          events: [],
        };
      }
      return {
        output: base,
        decisionSummaries: base.decisionSummaries,
        events: [],
      };
    }

    case 'resolve-conflict': {
      if (testOutcome === 'unresolvable') {
        return {
          output: {
            resolved: [],
            unresolvable: ['mock-conflict.ts'],
            confidence: 'low',
            decisionSummaries: [
              { kind: 'VERDICT', summary: 'Mock resolve-conflict unresolvable for e2e test' },
            ],
          },
          decisionSummaries: [
            { kind: 'VERDICT', summary: 'Mock resolve-conflict unresolvable for e2e test' },
          ],
          events: [],
        };
      }
      return {
        output: {
          resolved: ['mock-conflict.ts'],
          unresolvable: [],
          confidence: 'high',
          decisionSummaries: [
            { kind: 'VERDICT', summary: 'Mock resolve-conflict resolved for e2e test' },
          ],
        },
        decisionSummaries: [
          { kind: 'VERDICT', summary: 'Mock resolve-conflict resolved for e2e test' },
        ],
        events: [],
      };
    }

    case 'grill-me': {
      // Round 1 → ask one question. From round 2 onward → readyForPRD.
      const roundNumber = (spec.context.roundNumber as number | undefined) ?? 1;
      if (roundNumber <= 1) {
        return {
          output: {
            questions: [{ text: 'What problem are you actually trying to solve?' }],
            refinedIntent: '',
            readyForPRD: false,
            decisionSummaries: [
              { kind: 'PLAN', summary: 'Mock grill-me round 1 — one clarifying question' },
            ],
          },
          decisionSummaries: [
            { kind: 'PLAN', summary: 'Mock grill-me round 1 — one clarifying question' },
          ],
          events: [],
        };
      }
      return {
        output: {
          questions: [],
          refinedIntent:
            'Mock refined intent: improve search relevance to surface keyword matches.',
          readyForPRD: true,
          decisionSummaries: [
            { kind: 'VERDICT', summary: 'Mock grill-me complete — proceeding to write-prd' },
          ],
        },
        decisionSummaries: [
          { kind: 'VERDICT', summary: 'Mock grill-me complete — proceeding to write-prd' },
        ],
        events: [],
      };
    }

    case 'write-prd':
      return {
        output: {
          title: 'Mock PRD',
          problem: 'Mock problem statement.',
          proposedSolution: 'Mock proposed solution.',
          outOfScope: [],
          successCriteria: ['Mock success criterion 1'],
          acceptanceCriteria: [
            { id: 'AC-1', statement: 'Mock acceptance criterion', journeyId: 'J-1' },
          ],
          journeys: [
            {
              id: 'J-1',
              persona: 'Mock user',
              trigger: 'Mock trigger',
              steps: [
                {
                  userAction: 'mock action',
                  systemResponse: 'mock response',
                  dataShown: 'mock data',
                  stateChange: 'mock change',
                },
              ],
              successState: 'success',
              errorStates: [],
              edgeCases: [],
            },
          ],
          functionalSpec: {
            // biome-ignore lint/suspicious/noThenProperty: schema mandates the field name
            behaviors: [{ when: 'mock', given: 'mock', then: 'mock' }],
            stateModel: [],
            invalidTransitions: [],
            dataConstraints: [],
          },
          verticalSlices: [
            { title: 'Mock slice 1', goal: 'Mock goal', estimatedSize: 'S', journeyRefs: ['J-1'] },
          ],
          estimatedComplexity: 'low',
          implementationDecisions: [{ decision: 'Use existing patterns from CONTEXT.md' }],
          testingDecisions: {
            approach: 'Verify mock behavior end-to-end via slice.test.ts',
            modulesToTest: ['slices/grill-and-prd/slice.test.ts'],
          },
          decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock write-prd complete' }],
        },
        decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock write-prd complete' }],
        events: [],
      };

    case 'advise-on-prd':
      return {
        output: {
          verdict: 'approve',
          concerns: [],
          revisedSections: {},
          decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock advise-on-prd approved' }],
        },
        decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock advise-on-prd approved' }],
        events: [],
      };

    case 'decompose-issues':
      return {
        output: {
          issues: [
            {
              title: 'Mock decomposed slice 1',
              body: '## Context\n\nMock context.\n\n## Acceptance criteria\n\n- [ ] AC-1\n\n## Depends on\n\n_(none)_',
              labels: ['type:feature', 'priority:medium', 'schedule:current'],
              dependsOn: [],
            },
          ],
          decisionSummaries: [
            { kind: 'VERDICT', summary: 'Mock decompose-issues produced 1 slice' },
          ],
        },
        decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock decompose-issues produced 1 slice' }],
        events: [],
      };

    case 'sprint-review':
      return {
        output: {
          milestoneTitle: 'Mock Milestone',
          shipped: ['#1: Mock shipped item'],
          deferred: [],
          retroThemes: ['Mock retro theme'],
          nextSprintSuggestions: ['Mock next sprint suggestion'],
          decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock sprint-review complete' }],
        },
        decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock sprint-review complete' }],
        events: [],
      };

    // Wave-1 scouts (M19.01) — canonical empty-findings success keeps the
    // investigate workflow flowing in MOCK_AGENTS=true. Each scout shares the
    // ScoutOutputSchema shape; findings can legitimately be empty.
    case 'scout-schema':
    case 'scout-code-path':
    case 'scout-pattern':
    case 'scout-test-inventory':
    case 'scout-dependency':
    case 'scout-user-journey': {
      const scoutSummary = `Mock ${spec.skill} for e2e test`;
      return {
        output: {
          findings: [
            {
              file: 'apps/web/e2e/pipeline/README.md',
              line: 1,
              fact: scoutSummary,
              confidence: 'high' as const,
            },
          ],
          status: 'ok' as const,
          decisionSummaries: [{ kind: 'INSIGHT', summary: scoutSummary }],
        },
        decisionSummaries: [{ kind: 'INSIGHT', summary: scoutSummary }],
        events: [],
      };
    }

    case 'wave2-interface-designer':
      return {
        output: {
          artefacts: [],
          openQuestions: [],
          decisionSummaries: [
            { kind: 'INSIGHT', summary: 'Mock wave2-interface-designer for e2e test' },
          ],
        },
        decisionSummaries: [
          { kind: 'INSIGHT', summary: 'Mock wave2-interface-designer for e2e test' },
        ],
        events: [],
      };

    case 'wave2-risk-analyst':
      return {
        output: {
          risks: [],
          openQuestions: [],
          decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock wave2-risk-analyst for e2e test' }],
        },
        decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock wave2-risk-analyst for e2e test' }],
        events: [],
      };

    // M19.02 — spec-author. Single-WP spec that passes validateEngineeringSpec
    // (no repoRoot, so filesystem checks are skipped; issueType defaults to
    // 'feature' for non-bug work items, so journey coverage is enforced).
    case 'spec-author':
      return {
        output: {
          objective: 'E2E mock engineering spec',
          userJourneys: [
            {
              id: 'J-1',
              actor: 'Developer',
              steps: [{ idx: 0, description: 'Implement the feature end-to-end' }],
            },
          ],
          functionalRequirements: [{ id: 'FR-1', statement: 'Feature works as specified' }],
          architecture: {
            current: 'Existing codebase',
            new: 'No structural changes — mock',
            decisionRationale: 'Mock spec for e2e test harness',
          },
          schemaChanges: { ddl: [], migrations: [] },
          interfaceContracts: [],
          workPackages: [
            {
              id: 'wp-1',
              filesOwned: ['slices/mock-e2e/mock.ts'],
              changes: 'Add mock e2e fixture file for parallel pipeline test',
              dependsOn: [],
              builderTier: 'sonnet',
            },
          ],
          executionOrder: [{ batch: 0, wpIds: ['wp-1'] }],
          verificationTooling: [],
          acceptanceCriteria: [
            {
              id: 'AC-1',
              statement: 'Mock fixture file is created',
              journeyRef: 'J-1',
              stepIdx: 0,
              executableChecks: [{ id: 'AC-1-check-1', command: 'pnpm test' }],
            },
          ],
          constraints: [],
          riskRegister: [],
          decisionSummaries: [{ kind: 'PLAN', summary: 'Mock spec-author for e2e test' }],
        },
        decisionSummaries: [{ kind: 'PLAN', summary: 'Mock spec-author for e2e test' }],
        events: [],
      };

    // M19.03 — implement-wp. Returns empty filesWritten so the serial commit
    // phase skips the copyFileSync step (no scratch worktree files to copy).
    case 'implement-wp': {
      const wpCtx = spec.context.wp as { id?: string } | undefined;
      const wpId = wpCtx?.id ?? 'wp-1';
      return {
        output: {
          wpId,
          plan: 'E2E mock WP implementation plan',
          filesWritten: [],
          testsWritten: [],
          testsRun: { command: 'pnpm test', paths: [] },
          confidence: 'high' as const,
          decisionSummaries: [{ kind: 'GREEN', summary: `Mock implement-wp ${wpId} for e2e test` }],
        },
        decisionSummaries: [{ kind: 'GREEN', summary: `Mock implement-wp ${wpId} for e2e test` }],
        events: [],
      };
    }

    // M19.12 — dev-review-response. Addresses every finding from context.
    case 'dev-review-response': {
      const findings =
        (spec.context.devReviewFindings as
          | Array<{ file?: string; line?: number; severity?: string }>
          | undefined) ?? [];
      const findingDispositions = findings.map((f) => ({
        findingRef: `${f.file ?? 'unknown'}:${f.line ?? 0}`,
        severity: (f.severity ?? 'P1') as 'P0' | 'P1' | 'P2' | 'P3',
        disposition: 'addressed' as const,
        commitSha: 'mock-abc1234',
      }));
      return {
        output: {
          findingDispositions,
          decisionSummaries: [
            {
              kind: 'VERDICT',
              summary: 'Mock dev-review-response: all findings addressed',
            },
          ],
        },
        decisionSummaries: [
          { kind: 'VERDICT', summary: 'Mock dev-review-response: all findings addressed' },
        ],
        events: [],
      };
    }

    // evidence-post (#234) — best-effort step in fix-issue. Provides a
    // commentUrl so the workflow's non-null check passes.
    case 'evidence-post':
      return {
        output: {
          screenshots: [],
          gifPath: null,
          commentUrl: 'https://github.com/mock/repo/issues/999#issuecomment-evidence-mock',
          decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock evidence-post for e2e test' }],
        },
        decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock evidence-post for e2e test' }],
        events: [],
      };

    // playwright-repro — only fires when requiresBrowserRepro=true (mock
    // investigate always returns false, so this is defensive only).
    case 'playwright-repro':
      return {
        output: {
          screenshots: [],
          gifPath: null,
          consoleErrors: [],
          reproSteps: ['Mock repro step'],
          reproduced: true,
          commentUrl: 'https://github.com/mock/repo/issues/999#issuecomment-before-state-mock',
        },
        decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock playwright-repro for e2e test' }],
        events: [],
      };

    // bug-enhance — called from inbox enhance endpoint (not standard pipeline).
    case 'bug-enhance':
      return {
        output: {
          enhancedContent:
            '## Steps to Reproduce\n\n1. Mock step\n\n## Expected vs Actual\n\nMock e2e enhancement',
          decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock bug-enhance for e2e test' }],
        },
        decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock bug-enhance for e2e test' }],
        events: [],
      };

    case 'feature-enhance':
      return {
        output: {
          candidateFiles: [
            {
              path: 'apps/web/src/components/detail/IssueDetailPage.tsx',
              confidence: 'medium',
              source: 'tool-verified',
              reason: 'Mock feature-enhance anchors detail-page feature work.',
            },
          ],
          existingSurfaces: ['apps/web/src/components/detail/IssueDetailPage.tsx'],
          similarPatterns: ['Mock detail-page feature pattern'],
          testSurfaces: ['apps/web/src/components/detail/lib/timeline.test.ts'],
          acceptanceHints: ['Mock acceptance hint'],
          openQuestions: [],
          confidence: 'medium',
          escalationSignals: [],
        },
        decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock feature-enhance for e2e test' }],
        events: [
          {
            id: 1,
            projectId: (spec.context.projectId as string | undefined) ?? 'mock-project',
            workItemId: workItemId ?? null,
            kind: 'agent.tool-call',
            payload: {
              tool_name: 'repo_intel.query',
              status: 'ok',
              blocked: false,
            },
            runId: spec.runId,
            personaId: spec.personaId,
            createdAt: new Date(0).toISOString(),
          },
        ],
      };

    // retrospective-cross-run — triggered by the nightly playbook service.
    case 'retrospective-cross-run': {
      const now = new Date().toISOString();
      return {
        output: {
          outcome: 'success' as const,
          workItemNumber: 0,
          summary: {
            wentWell: 'Mock cross-run retro completed',
            didNotGoWell: 'Nothing — mock',
            architecturalTakeaway: 'MOCK_AGENTS=true bypasses real model calls',
          },
          improvementCandidates: [],
          decisionSummaries: [
            { kind: 'INSIGHT', summary: 'Mock retrospective-cross-run for e2e test' },
          ],
          windowStartAt: now,
          windowEndAt: now,
          lifecycleCount: 0,
          aggregatedLearnings: [],
          topPatterns: [],
          gateThresholds: [],
          costBaselines: [],
        },
        decisionSummaries: [
          { kind: 'INSIGHT', summary: 'Mock retrospective-cross-run for e2e test' },
        ],
        events: [],
      };
    }

    // skill-coach — triggered via the /coach endpoint.
    case 'skill-coach':
      return {
        output: {
          skillName: (spec.context.targetSkillName as string | undefined) ?? 'unknown-skill',
          diagnosis: 'Mock diagnosis: no real patterns analysed in MOCK_AGENTS mode',
          proposedPatch: '',
          rationale: 'Mock rationale for e2e test',
          evidencePatternIds: [],
          confidence: 'low' as const,
          decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock skill-coach for e2e test' }],
        },
        decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock skill-coach for e2e test' }],
        events: [],
      };

    // advise-on-plan — advisor pattern (proceed verdict, no concerns).
    case 'advise-on-plan':
      return {
        output: {
          verdict: 'proceed' as const,
          confidence: 'high' as const,
          decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock advise-on-plan: proceed' }],
        },
        decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock advise-on-plan: proceed' }],
        events: [],
      };

    // hub-chat — M20 default chat assistant. E2E spec needs deterministic
    // replies including a read-only auto-run, a mutating proposal, and an
    // open_url proposal to exercise the panel's full lifecycle.
    case 'hub-chat': {
      const lastUserMessage = extractLastUserMessage(spec.context);
      const text = lastUserMessage.toLowerCase();

      if (text.includes('open the kanban')) {
        return mockChatReply({
          say: 'Opening the kanban now.',
          proposals: [
            {
              toolName: 'open_url',
              input: '{"path":"/projects/goose-hub-self","rationale":"navigate to kanban"}',
              rationale: 'If you approve, the panel will navigate to the kanban.',
            },
          ],
        });
      }
      if (text.includes('list projects')) {
        return mockChatReply({
          say: 'Listing the registered projects for you.',
          proposals: [
            {
              toolName: 'list_projects',
              input: '{}',
              rationale: 'Auto-running list_projects to answer your question.',
            },
          ],
        });
      }
      if (text.includes('comment')) {
        return mockChatReply({
          say: 'I can post that comment if you approve.',
          proposals: [
            {
              toolName: 'comment_on_issue',
              input:
                '{"projectSlug":"goose-hub-self","issueNumber":1,"body":"mock comment from e2e"}',
              rationale: 'If you approve, the chat will post a comment on issue #1.',
            },
          ],
        });
      }
      return mockChatReply({
        say: 'Mock hub-chat reply (MOCK_AGENTS=true).',
        proposals: [],
      });
    }

    // echo-test / echo-test-holdout — debug/smoke skills.
    case 'echo-test':
    case 'echo-test-holdout':
      return {
        output: {
          echo: 'mock-echo',
          decisionSummaries: [{ kind: 'INSIGHT', summary: `Mock ${spec.skill} for e2e test` }],
        },
        decisionSummaries: [{ kind: 'INSIGHT', summary: `Mock ${spec.skill} for e2e test` }],
        events: [],
      };

    // M19.22 (#698) — code-quality-audit. Defensive mock for the nightly
    // scheduler in case its existsSync gate is ever bypassed. Canonical
    // 'Good' rating with no recommendations and minimum-valid scorecard.
    case 'code-quality-audit': {
      const maxes = [20, 15, 15, 15, 10, 10, 10, 5] as const;
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
      // Distribute 80 points across the 8 categories so the rating is 'Good'.
      const scores = [16, 12, 12, 12, 8, 8, 8, 4];
      return {
        output: {
          scorecard: scores.map((score, i) => ({
            category: (i + 1) as 1,
            name: names[i],
            score,
            max: maxes[i],
            evidence: [{ file: 'mock-file.ts', line: 1, note: 'mock evidence' }],
          })),
          rating: 'Good' as const,
          strengths: ['Mock audit passed'],
          recommendations: [],
          mcIlroyQuestion: 'Mock audit: no architectural questions raised.',
          projectedScoreAfterTop3: 80,
          decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock code-quality-audit for e2e' }],
        },
        decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock code-quality-audit for e2e' }],
        events: [],
      };
    }

    default:
      throw new Error(`resolveMockOutput: no preset for skill "${spec.skill}"`);
  }
}

function extractLastUserMessage(context: AgentSpec['context']): string {
  const messages = (context.priorMessages ?? []) as Array<{ role: string; content: string }>;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && typeof messages[i].content === 'string') {
      return messages[i].content;
    }
  }
  return '';
}

function mockChatReply(opts: {
  say: string;
  proposals: Array<{ toolName: string; input: string; rationale: string }>;
}): AgentResult {
  const decisionSummaries = [
    { kind: 'PLAN' as const, summary: 'Mock hub-chat reply for e2e test' },
  ];
  return {
    output: {
      say: opts.say,
      proposals: opts.proposals,
      done: false,
      decisionSummaries,
    },
    decisionSummaries,
    events: [],
  };
}
