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
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
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
  checkedAt: text('checked_at').notNull().default(sql`(current_timestamp)`),
});

export const inboxItems = sqliteTable('inbox_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  type: text('type').notNull().default('feature'), // feature | bug | chore | research
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
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
    lastRunAt: text('last_run_at').notNull().default(sql`(current_timestamp)`),
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
    status: text('status').notNull().default('pending'), // pending | approved | rejected
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  },
  (t) => ({
    personaStatusIdx: index('improvement_candidates_persona_status_idx').on(t.personaName, t.status),
  }),
);
