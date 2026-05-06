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

// Archived lifecycle data from completed work items
// JSON fields store serialized decision summaries, learning entries, and quality scores
export const archivedLifecycles = sqliteTable(
  'archived_lifecycles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: text('project_id').notNull(),
    workItemId: text('work_item_id').notNull(),
    closedAt: text('closed_at').notNull(),
    decisionSummaries: text('decision_summaries').notNull(), // JSON serialized
    learningEntries: text('learning_entries').notNull(), // JSON serialized
    qualityScores: text('quality_scores').notNull(), // JSON serialized
    costsUsd: real('costs_usd').notNull().default(0),
    runIds: text('run_ids').notNull(), // JSON array of run IDs
  },
  (t) => ({
    projectIdx: index('archived_lifecycles_project_idx').on(t.projectId, t.closedAt),
    workItemIdx: index('archived_lifecycles_work_item_idx').on(t.workItemId),
  }),
);

// Aggregated decision patterns mined from archived lifecycles
// Tracks recurring decision patterns, consistency, and trend
export const decisionPatterns = sqliteTable(
  'decision_patterns',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: text('project_id').notNull(),
    kind: text('kind').notNull(), // DecisionKind enum value (PLAN, RED, GREEN, etc)
    role: text('role').notNull(), // Agent role (developer, qa, reviewer)
    actionSummary: text('action_summary').notNull(),
    reasonSummary: text('reason_summary').notNull(),
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    consistencyScore: real('consistency_score').notNull().default(0), // 0..1
    lastSeenAt: text('last_seen_at').notNull(),
    exampleWorkItemIds: text('example_work_item_ids').notNull(), // JSON array, max 5
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
