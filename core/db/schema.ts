import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const projectState = sqliteTable('project_state', {
  projectId: text('project_id').primaryKey(),
  activeMilestoneNumber: integer('active_milestone_number'),
  activeMilestoneSetAt: text('active_milestone_set_at'),
  activeMilestoneSetBy: text('active_milestone_set_by'),
  lastTickAt: text('last_tick_at'),
});

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: text('project_id').notNull(),
    workItemId: text('work_item_id'),
    kind: text('kind').notNull(),
    payload: text('payload').notNull(),
    runId: text('run_id'),
    personaId: text('persona_id'),
    createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (table) => ({
    projectCreatedIdx: index('events_project_created_idx').on(table.projectId, table.createdAt),
    workItemIdx: index('events_work_item_idx').on(table.workItemId, table.id),
  }),
);

export const governanceAudit = sqliteTable('governance_audit', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  prUrl: text('pr_url').notNull(),
  projectId: text('project_id').notNull(),
  ok: integer('ok').notNull(),
  violations: text('violations').notNull(),
  checkedAt: text('checked_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
});

export const inboxItems = sqliteTable('inbox_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  type: text('type').notNull().default('feature'), // feature | bug | chore | research
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
});

export const personaRouting = sqliteTable(
  'persona_routing',
  {
    projectId: text('project_id').notNull(),
    role: text('role').notNull(),
    lastIndex: integer('last_index').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.projectId, t.role] }) }),
);

export const personaStats = sqliteTable(
  'persona_stats',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    personaName: text('persona_name').notNull(),
    role: text('role').notNull(),
    runsTotal: integer('runs_total').notNull().default(0),
    runsSucceeded: integer('runs_succeeded').notNull().default(0),
    runsFailed: integer('runs_failed').notNull().default(0),
    avgQualityScore: real('avg_quality_score').notNull().default(1.0),
    lastRunAt: text('last_run_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (t) => ({
    personaRoleUniq: uniqueIndex('persona_stats_persona_role_uniq').on(t.personaName, t.role),
  }),
);

export const improvementCandidates = sqliteTable(
  'improvement_candidates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    personaName: text('persona_name').notNull(),
    sourceTaskId: text('source_task_id'),
    suggestionText: text('suggestion_text').notNull(),
    suggestionType: text('suggestion_type').notNull(),
    projectId: text('project_id').notNull().default(''),
    status: text('status').notNull().default('pending'), // pending | approved | rejected
    githubIssueUrl: text('github_issue_url'),
    errorNote: text('error_note'),
    proposedDiff: text('proposed_diff'),
    sourcePlaybookId: integer('source_playbook_id'),
    createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (t) => ({
    personaStatusIdx: index('improvement_candidates_persona_status_idx').on(
      t.personaName,
      t.status,
    ),
  }),
);

export const personaNames = sqliteTable(
  'persona_names',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: text('project_id').notNull(),
    role: text('role').notNull(),
    slotIndex: integer('slot_index').notNull(),
    codename: text('codename').notNull(),
  },
  (t) => ({
    personaNameSlotUniq: uniqueIndex('persona_names_slot_uniq').on(
      t.projectId,
      t.role,
      t.slotIndex,
    ),
  }),
);

export const archivedLifecycles = sqliteTable(
  'archived_lifecycles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: text('project_id').notNull(),
    workItemId: text('work_item_id').notNull(),
    closedAt: text('closed_at').notNull(),
    decisionSummaries: text('decision_summaries').notNull().default('[]'),
    learningEntries: text('learning_entries').notNull().default('[]'),
    qualityScores: text('quality_scores').notNull().default('[]'),
    costsUsd: real('costs_usd').notNull().default(0),
    runIds: text('run_ids').notNull().default('[]'),
  },
  (t) => ({
    projectWorkItemIdx: index('archived_lifecycles_project_work_item_idx').on(
      t.projectId,
      t.workItemId,
    ),
    projectClosedIdx: index('archived_lifecycles_project_closed_idx').on(t.projectId, t.closedAt),
  }),
);

export const decisionPatterns = sqliteTable(
  'decision_patterns',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: text('project_id').notNull(),
    kind: text('kind').notNull(),
    role: text('role').notNull(),
    actionSummary: text('action_summary').notNull(),
    reasonSummary: text('reason_summary').notNull().default(''),
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    consistencyScore: real('consistency_score').notNull().default(0),
    lastSeenAt: text('last_seen_at').notNull(),
    exampleWorkItemIds: text('example_work_item_ids').notNull().default('[]'),
  },
  (t) => ({
    projectKindRoleUniq: uniqueIndex('decision_patterns_project_kind_role_uniq').on(
      t.projectId,
      t.kind,
      t.role,
    ),
    projectIdx: index('decision_patterns_project_idx').on(t.projectId),
  }),
);

export const playbooks = sqliteTable(
  'playbooks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: text('project_id').notNull(),
    windowStartAt: text('window_start_at').notNull(),
    windowEndAt: text('window_end_at').notNull(),
    lifecycleCount: integer('lifecycle_count').notNull().default(0),
    manifest: text('manifest').notNull(),
    createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (t) => ({
    projectCreatedIdx: index('playbooks_project_created_idx').on(t.projectId, t.createdAt),
    projectWindowIdx: index('playbooks_project_window_idx').on(
      t.projectId,
      t.windowStartAt,
      t.windowEndAt,
    ),
  }),
);

// Per-WP iteration outcome (M19.03, ADR 0031). One row per (run, WP, iteration) triple.
// Carry-forward rule: a WP whose last status for this run_id is 'failed' stays in the
// retry set for iteration N+1. Only moves to 'ok' after a successful builder run + commit.
export const wpIterations = sqliteTable(
  'wp_iterations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: text('run_id').notNull(),
    wpId: text('wp_id').notNull(),
    iteration: integer('iteration').notNull(),
    status: text('status').notNull(), // 'in-progress' | 'ok' | 'failed'
    errorReason: text('error_reason'),
    createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (t) => ({
    runWpIterationUniq: uniqueIndex('wp_iterations_run_wp_iteration_uniq').on(
      t.runId,
      t.wpId,
      t.iteration,
    ),
    runWpIdx: index('wp_iterations_run_wp_idx').on(t.runId, t.wpId),
  }),
);

// One structured decision record per mid-run recordDecision() tool call (M19.06).
// Deduplication key: (run_id, kind, what) — second call with same key is a no-op.
// Reconciliation: at run end, orchestrator reads these rows (when flag on) instead
// of relying solely on the skill schema's decisionSummaries JSON field.
export const agentDecisions = sqliteTable(
  'agent_decisions',
  {
    id: text('id').primaryKey(), // crypto.randomUUID()
    runId: text('run_id').notNull(),
    iteration: integer('iteration').notNull().default(0),
    phase: text('phase').notNull().default(''),
    kind: text('kind').notNull(),
    what: text('what').notNull(),
    why: text('why').notNull(),
    ts: text('ts').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (t) => ({
    runKindWhatUniq: uniqueIndex('agent_decisions_run_kind_what_uniq').on(t.runId, t.kind, t.what),
    runIdx: index('agent_decisions_run_idx').on(t.runId),
  }),
);

// Per-run QualityScore (M19.08, issue #565; pipelineRunId added in M19.21 #697).
// One row per (run_id, iteration) pair. components_json holds the full
// QualityComponents object. audit_score from code-quality-audit (#564) is
// informational — does NOT feed the score formula. pipeline_run_id links the
// score to the PR lifecycle UUID generated by spec-author so retro,
// merge-decision and roster can look up by pipeline (not by per-skill runId).
export const runQualityScores = sqliteTable(
  'run_quality_scores',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: text('run_id').notNull(),
    pipelineRunId: text('pipeline_run_id'),
    projectId: text('project_id').notNull(),
    iteration: integer('iteration').notNull().default(0),
    score: real('score').notNull(),
    componentsJson: text('components_json').notNull(),
    auditScore: real('audit_score'),
    ts: text('ts').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (t) => ({
    runIterationUniq: uniqueIndex('run_quality_scores_run_iteration_uniq').on(t.runId, t.iteration),
    projectTsIdx: index('run_quality_scores_project_ts_idx').on(t.projectId, t.ts),
    pipelineRunIdx: index('run_quality_scores_pipeline_run_idx').on(t.pipelineRunId),
  }),
);

// Per-project configurable budget overrides (global caps). One row per project.
// Values here win over project.config.ts and take effect on the next agent dispatch.
export const projectSettings = sqliteTable('project_settings', {
  projectId: text('project_id').primaryKey(),
  perWorkflowMaxUsd: real('per_workflow_max_usd'),
  perAgentMaxUsd: real('per_agent_max_usd'),
  perAdvisorMaxUsd: real('per_advisor_max_usd'),
  dailyTokens: integer('daily_tokens'),
  maxParallelAgents: integer('max_parallel_agents'),
  maxScoutAgents: integer('max_scout_agents'),
  maxRetries: integer('max_retries'),
  perBashCommandMaxSeconds: integer('per_bash_command_max_seconds'),
  useMultiAgentPipeline: integer('use_multi_agent_pipeline'),
  useInvestigationSwarm: integer('use_investigation_swarm'),
  /** experimental.recordDecisionTool — gates decision-capture hook installation. Default false (0). */
  recordDecisionTool: integer('record_decision_tool'),
  updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  updatedBy: text('updated_by'),
});

// Per-project per-skill budget overrides. (project_id, skill_name) is the PK.
// Values here win over project.config.ts skillBudgetOverrides and SKILL_BUDGETS defaults.
export const projectSkillSettings = sqliteTable(
  'project_skill_settings',
  {
    projectId: text('project_id').notNull(),
    skillName: text('skill_name').notNull(),
    maxTurns: integer('max_turns'),
    maxBudgetUsd: real('max_budget_usd'),
    timeoutMs: integer('timeout_ms'),
    updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
    updatedBy: text('updated_by'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.skillName] }),
  }),
);

// Per-project per-role model overrides (M19.09). One row per (project_id, role).
// primary_model / fallback_model / advisor_model win over project.config.ts rolesModels
// and skill modelPin defaults. complexity_overrides_json stores a JSON object whose keys
// are "type:<T>", "priority:<P>", or "default" and whose values are ModelTier strings;
// these win over agentConfig.modelRouter.overrides for complexity-based tier selection.
export const projectModelSettings = sqliteTable(
  'project_model_settings',
  {
    projectId: text('project_id').notNull(),
    role: text('role').notNull(),
    primaryModel: text('primary_model'),
    fallbackModel: text('fallback_model'),
    advisorModel: text('advisor_model'),
    primaryProvider: text('primary_provider'),
    fallbackProvider: text('fallback_provider'),
    advisorProvider: text('advisor_provider'),
    complexityOverridesJson: text('complexity_overrides_json'),
    maxTurns: integer('max_turns'),
    timeoutMs: integer('timeout_ms'),
    updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
    updatedBy: text('updated_by'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.role] }),
  }),
);

// One row per agent run. `runId` is unique — the same run is never recorded twice.
// `costLabel`: 'exact' when the source provided authoritative usage metadata
// (direct API), 'estimated' when only the Claude CLI's reported totals are
// available. UI must surface this distinction (see M9.09).
export const agentRunCosts = sqliteTable(
  'agent_run_costs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: text('run_id').notNull(),
    projectId: text('project_id').notNull(),
    workItemId: text('work_item_id'),
    stage: text('stage').notNull(),
    skill: text('skill').notNull(),
    modelId: text('model_id').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    costLabel: text('cost_label').notNull().default('estimated'), // estimated | exact
    personaId: text('persona_id'),
    createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (t) => ({
    runIdUniq: uniqueIndex('agent_run_costs_run_id_uniq').on(t.runId),
    projectCreatedIdx: index('agent_run_costs_project_created_idx').on(t.projectId, t.createdAt),
    workItemIdx: index('agent_run_costs_work_item_idx').on(t.workItemId),
  }),
);

// One row per agent run. runId is unique — the same run is never recorded twice.
export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: text('run_id').notNull(),
    personaId: text('persona_id').notNull(),
    workItemId: text('work_item_id'),
    projectId: text('project_id').notNull(),
    role: text('role').notNull(),
    skill: text('skill').notNull(),
    outcome: text('outcome', { enum: ['success', 'failure'] }).notNull(),
    createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (t) => ({
    runIdUniq: uniqueIndex('agent_runs_run_id_uniq').on(t.runId),
    personaIdx: index('agent_runs_persona_idx').on(t.personaId),
    projectIdx: index('agent_runs_project_idx').on(t.projectId),
  }),
);

// Per-project dev-review advisor settings (M19.12). DB row wins over
// project.config.ts agentConfig.devReview when non-null.
export const projectDevReviewSettings = sqliteTable('project_dev_review_settings', {
  projectId: text('project_id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }),
  triggerOn: text('trigger_on'), // 'all' | 'priority:medium+' | 'priority:high+' | 'priority:critical'
  maxRevisionTurns: integer('max_revision_turns'),
  perCycleMaxUsd: real('per_cycle_max_usd'),
  timeoutMs: integer('timeout_ms'),
  updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  updatedBy: text('updated_by'),
});

// Per-project convergent-review settings (M19.20). `reviewer_slots` is a JSON
// array of {model, prompt} objects — length drives reviewer count (1 or 2).
export const projectReviewSettings = sqliteTable('project_review_settings', {
  projectId: text('project_id').primaryKey(),
  reviewerSlots: text('reviewer_slots'), // JSON: Array<{model:'claude'|'codex', prompt:'default'|'unconstrained'}>
  updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  updatedBy: text('updated_by'),
});

export const scoutReports = sqliteTable(
  'scout_reports',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: text('project_id').notNull(),
    workItemId: text('work_item_id').notNull(),
    investigationRunId: text('investigation_run_id').notNull(),
    scoutSkill: text('scout_skill').notNull(),
    report: text('report').notNull(), // JSON blob
    createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (t) => ({
    projectWorkItemRunSkillUniq: uniqueIndex('scout_reports_project_work_item_run_skill_uniq').on(
      t.projectId,
      t.workItemId,
      t.investigationRunId,
      t.scoutSkill,
    ),
    projectWorkItemRunIdx: index('scout_reports_project_work_item_run_idx').on(
      t.projectId,
      t.workItemId,
      t.investigationRunId,
    ),
  }),
);

export const agentArtifacts = sqliteTable(
  'agent_artifacts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    artifactKey: text('artifact_key').notNull(),
    projectId: text('project_id').notNull(),
    workItemId: text('work_item_id'),
    runId: text('run_id').notNull(),
    kind: text('kind').notNull(),
    summary: text('summary').notNull(),
    payloadJson: text('payload_json').notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
    expiresAt: text('expires_at'),
  },
  (t) => ({
    artifactKeyUniq: uniqueIndex('agent_artifacts_artifact_key_uniq').on(t.artifactKey),
    projectWorkItemIdx: index('agent_artifacts_project_work_item_idx').on(
      t.projectId,
      t.workItemId,
    ),
    runIdIdx: index('agent_artifacts_run_id_idx').on(t.runId),
    projectWorkItemRunKindIdx: index('agent_artifacts_project_work_item_run_kind_idx').on(
      t.projectId,
      t.workItemId,
      t.runId,
      t.kind,
    ),
  }),
);

export const engineeringSpecs = sqliteTable(
  'engineering_specs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: text('project_id').notNull(),
    workItemId: text('work_item_id').notNull(),
    pipelineRunId: text('pipeline_run_id').notNull(),
    spec: text('spec').notNull(), // JSON blob — EngineeringSpec
    createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (t) => ({
    projectWorkItemUniq: uniqueIndex('engineering_specs_project_work_item_uniq').on(
      t.projectId,
      t.workItemId,
    ),
    projectWorkItemIdx: index('engineering_specs_project_work_item_idx').on(
      t.projectId,
      t.workItemId,
    ),
  }),
);
