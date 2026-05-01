import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
