import type { ProjectConfig } from '../../core/types.js';

const config: ProjectConfig = {
  id: 'goose-hub-self',
  name: 'Goose Hub (self)',
  slug: 'goose-hub-self',
  source: {
    kind: 'github',
    repo: 'shaunnez/goose-hub',
    stateMachine: 'labels',
  },
  targetRepo: {
    cloneUrl: 'git@github.com:shaunnez/goose-hub.git',
    defaultBranch: 'main',
    localPath: '/Users/shaunnesbitt/projects/goose-hub',
  },
  stack: {
    runtime: 'node',
    packageManager: 'pnpm',
    buildCommand: 'pnpm build',
    testCommand: 'pnpm test --reporter=json',
    lintCommand: 'pnpm lint',
    typecheckCommand: 'pnpm typecheck',
    e2eCommand: 'pnpm test:e2e:pipeline',
    detectedAt: '2026-04-30T00:00:00Z',
  },
  mode: 'supervised',
  storage: { kind: 'local', path: '~/.factory/data/goose-hub-self' },
  repos: ['shaunnez/goose-hub'],
  agentConfig: {
    runtime: 'auto',
    allowHoldoutOverride: true,
    rolesModels: {
      triager: { primary: 'haiku', fallback: 'haiku', advisor: null },
      griller: { primary: 'opus', fallback: 'sonnet', advisor: null },
      'prd-writer': { primary: 'opus', fallback: 'sonnet', advisor: 'opus' },
      decomposer: { primary: 'sonnet', fallback: 'haiku', advisor: null },
      investigator: { primary: 'opus', fallback: 'sonnet', advisor: null },
      developer: { primary: 'haiku', fallback: 'sonnet', advisor: 'opus' },
      qa: { primary: 'sonnet', fallback: null, advisor: null },
      reviewer: { primary: 'sonnet', fallback: null, advisor: null },
      retrospector: { primary: 'sonnet', fallback: 'haiku', advisor: null },
      researcher: { primary: 'opus', fallback: 'sonnet', advisor: null },
      auditor: { primary: 'opus', fallback: 'sonnet', advisor: null },
      // M20.17 — Hub Chat assistant. Sonnet baseline; chat budgets cap below
      // $0.4 per turn so a runaway conversation can't spike spend.
      assistant: { primary: 'sonnet', fallback: 'haiku', advisor: null },
    },
    fallbackPolicy: {
      critical: 'same-tier-only',
      high: 'same-tier-only',
      medium: 'allow-down-tier',
      low: 'allow-down-tier',
    },
    advisorMode: {
      enabled: true,
      triggerOn: { priorities: ['critical', 'high'] },
      maxAdvisorBudgetUsd: 1,
      disableInAutonomous: true,
    },
    retrospectivePolicy: {
      defaultTier: 'light',
      deepTriggers: [
        'qa-failed',
        'retries-ge-2',
        'budget-exceeded',
        'needs-human',
        'priority-high',
        'priority-critical',
        'first-run-of-skill',
      ],
    },
    coachPolicy: {
      enabled: false,
      consistencyThreshold: 0.8,
      minLifecycles: 3,
    },
  },
  budgets: {
    dailyTokens: 50_000_000,
    maxParallelAgents: 3,
    maxRetries: 2,
    perBashCommandMaxSeconds: 120,
    perWorkflowMaxUsd: 10,
    perAgentMaxUsd: 10,
    perAdvisorMaxUsd: 2,
    skillBudgetOverrides: {
      // Baseline grill-me budget is sized for Sonnet; this project runs Opus
      // (griller.primary = 'opus') which is ~5× the price.
      'grill-me': { maxBudgetUsd: 1.5 },
    },
  },
  governance: {
    immutablePaths: [
      'MISSION.md',
      'FACTORY_RULES.md',
      'CLAUDE.md',
      'target-projects/**/MISSION.md',
      'target-projects/**/FACTORY_RULES.md',
      'target-projects/**/project.config.ts',
      'target-projects/**/personas/**',
    ],
  },
  isolation: { mode: 'native' },
  archiveAfterDays: 7,
  visibility: 'always_visible',
  machineScope: undefined,
  colorStripe: '#7c3aed',
  activeMilestone: 'M19: Multi-Agent Orchestration',
  qaE2eMode: 'ui-changed',
  playwrightReproEnabled: true,
  evidencePostEnabled: true,
};

export default config;
