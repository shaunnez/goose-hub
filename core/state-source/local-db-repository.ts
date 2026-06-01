import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { db as defaultDb } from '../db/db.js';
import {
  projectState,
  workItemComments,
  workItemCounters,
  workItemExternalRefs,
  workItemLabels,
  workItemMilestones,
  workItemRepoLinks,
  workItemStateEvents,
  workItems,
} from '../db/schema.js';
import type { StateName } from '../state-machine/states.js';
import type {
  ExecMode,
  IssueComment,
  Mode,
  Priority,
  Schedule,
  WorkItemExternalRef,
  WorkItemType,
} from './interface.js';

export type LocalDbDatabase = typeof defaultDb;
export type LocalDbWorkItemRow = typeof workItems.$inferSelect;
export type LocalDbMilestoneRow = typeof workItemMilestones.$inferSelect;
export type LocalDbRepoLinkRow = typeof workItemRepoLinks.$inferSelect;
export type LocalDbExternalRefRow = typeof workItemExternalRefs.$inferSelect;
export type LocalDbStateEventRow = typeof workItemStateEvents.$inferSelect;
export type LocalDbExternalRefReadModel = WorkItemExternalRef;

export interface LocalDbCreateWorkItemInput {
  projectId: string;
  title: string;
  body?: string;
  state?: StateName;
  type?: WorkItemType;
  priority?: Priority;
  mode?: Mode;
  schedule?: Schedule;
  exec?: ExecMode;
  parentId?: string | null;
  authorIsOwner?: boolean;
  milestoneId?: string | null;
  milestoneTitle?: string | null;
}

export interface LocalDbRepositoryOptions {
  db?: LocalDbDatabase;
  now?: () => Date;
}

function canonicalLocalWorkItemId(projectId: string, externalId: string): string {
  return `local:${projectId}#${externalId}`;
}

function closedAtForState(state: StateName, nowIso: string): string | null {
  return state === 'factory:done' || state === 'factory:archived' ? nowIso : null;
}

function externalIdFromItemId(projectId: string, itemId: string): string {
  const localPrefix = `local:${projectId}#`;
  if (itemId.startsWith(localPrefix)) return itemId.slice(localPrefix.length);
  return itemId.match(/#([^#]+)$/)?.[1] ?? itemId;
}

export function parseExternalRefMetadata(row: LocalDbExternalRefRow): unknown | null {
  if (row.metadataJson == null) return null;
  try {
    return JSON.parse(row.metadataJson) as unknown;
  } catch {
    return null;
  }
}

export function toExternalRefReadModel(row: LocalDbExternalRefRow): LocalDbExternalRefReadModel {
  return {
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    repoRef: row.repoRef,
    externalId: row.externalId,
    url: row.url,
    metadata: parseExternalRefMetadata(row),
    createdAt: row.createdAt,
  };
}

export class LocalDbWorkItemRepository {
  private readonly db: LocalDbDatabase;
  private readonly now: () => Date;

  constructor(options: LocalDbRepositoryOptions = {}) {
    this.db = options.db ?? defaultDb;
    this.now = options.now ?? (() => new Date());
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  private nextMilestoneNumber(projectId: string): number {
    const row = this.db
      .select({
        max: sql<number>`coalesce(max(${workItemMilestones.number}), 0)`,
      })
      .from(workItemMilestones)
      .where(eq(workItemMilestones.projectId, projectId))
      .get();
    return (row?.max ?? 0) + 1;
  }

  createWorkItem(input: LocalDbCreateWorkItemInput): LocalDbWorkItemRow {
    return this.db.transaction((tx) => {
      const now = this.nowIso();
      const state = input.state ?? 'factory:triaging';
      const counter = tx
        .insert(workItemCounters)
        .values({
          projectId: input.projectId,
          lastExternalId: 1,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: workItemCounters.projectId,
          set: {
            lastExternalId: sql`${workItemCounters.lastExternalId} + 1`,
            updatedAt: now,
          },
        })
        .returning({ externalId: workItemCounters.lastExternalId })
        .get();
      const externalId = String(counter.externalId);
      const row = tx
        .insert(workItems)
        .values({
          id: canonicalLocalWorkItemId(input.projectId, externalId),
          projectId: input.projectId,
          externalId,
          title: input.title,
          body: input.body ?? '',
          state,
          type: input.type ?? 'feature',
          priority: input.priority ?? 'medium',
          mode: input.mode ?? 'supervised',
          schedule: input.schedule ?? 'current',
          exec: input.exec ?? 'serial',
          parentId: input.parentId ?? null,
          authorIsOwner: input.authorIsOwner ?? true,
          milestoneId: input.milestoneId ?? null,
          milestoneTitle: input.milestoneTitle ?? null,
          createdAt: now,
          updatedAt: now,
          closedAt: closedAtForState(state, now),
        })
        .returning()
        .get();
      tx.insert(workItemStateEvents)
        .values({
          projectId: input.projectId,
          workItemId: row.id,
          fromState: null,
          toState: state,
          mode: 'forced',
          actor: 'goose-hub',
          createdAt: now,
        })
        .run();
      return row;
    });
  }

  getWorkItem(projectId: string, itemId: string): LocalDbWorkItemRow | null {
    const externalId = externalIdFromItemId(projectId, itemId);
    return (
      this.db
        .select()
        .from(workItems)
        .where(
          and(
            eq(workItems.projectId, projectId),
            or(eq(workItems.id, itemId), eq(workItems.externalId, externalId)),
          ),
        )
        .get() ?? null
    );
  }

  requireWorkItem(projectId: string, itemId: string): LocalDbWorkItemRow {
    const row = this.getWorkItem(projectId, itemId);
    if (row == null) throw new Error(`LocalDbStateSource: work item '${itemId}' not found`);
    return row;
  }

  listOpenWorkItems(projectId: string, milestoneNumber?: number): LocalDbWorkItemRow[] {
    return this.listWorkItems(projectId, milestoneNumber).filter(
      (item) => item.state !== 'factory:done' && item.state !== 'factory:archived',
    );
  }

  listClosedWorkItemsByMilestone(projectId: string, milestoneNumber: number): LocalDbWorkItemRow[] {
    return this.listWorkItems(projectId, milestoneNumber).filter(
      (item) => item.state === 'factory:done' || item.state === 'factory:archived',
    );
  }

  listWorkItems(projectId: string, milestoneNumber?: number): LocalDbWorkItemRow[] {
    const base = this.db
      .select()
      .from(workItems)
      .where(eq(workItems.projectId, projectId))
      .orderBy(asc(workItems.createdAt), asc(workItems.externalId))
      .all();
    if (milestoneNumber == null) return base;
    return base.filter((item) => item.milestoneId === String(milestoneNumber));
  }

  updateState(input: {
    projectId: string;
    itemId: string;
    to: StateName;
    from?: StateName;
    mode: 'legal' | 'forced';
    note?: string | null;
    actor?: string | null;
  }): void {
    this.db.transaction((tx) => {
      const current = this.requireWorkItem(input.projectId, input.itemId);
      if (input.from != null && current.state !== input.from) {
        throw new Error(
          `LocalDbStateSource: expected state ${input.from} but found ${current.state} for work item '${input.itemId}'`,
        );
      }
      const now = this.nowIso();
      const result = tx
        .update(workItems)
        .set({
          state: input.to,
          updatedAt: now,
          closedAt: closedAtForState(input.to, now),
        })
        .where(eq(workItems.id, current.id))
        .run();
      if (result.changes !== 1) {
        throw new Error(`LocalDbStateSource: failed to update state for '${input.itemId}'`);
      }
      tx.insert(workItemStateEvents)
        .values({
          projectId: input.projectId,
          workItemId: current.id,
          fromState: current.state,
          toState: input.to,
          mode: input.mode,
          note: input.note ?? null,
          actor: input.actor ?? 'goose-hub',
          createdAt: now,
        })
        .run();
    });
  }

  setMetadata(
    projectId: string,
    itemId: string,
    group: 'priority' | 'schedule' | 'type',
    value: string,
  ): void {
    const item = this.requireWorkItem(projectId, itemId);
    const now = this.nowIso();
    this.db
      .update(workItems)
      .set({ [group]: value, updatedAt: now })
      .where(eq(workItems.id, item.id))
      .run();
  }

  updateWorkItem(
    projectId: string,
    itemId: string,
    patch: Partial<{
      title: string;
      body: string;
      state: StateName;
      type: WorkItemType;
      priority: Priority;
      mode: Mode;
      schedule: Schedule;
      exec: ExecMode;
      milestoneId: string | null;
      milestoneTitle: string | null;
    }>,
  ): LocalDbWorkItemRow {
    const item = this.requireWorkItem(projectId, itemId);
    const now = this.nowIso();
    return this.db
      .update(workItems)
      .set({
        ...patch,
        updatedAt: now,
        ...(patch.state != null ? { closedAt: closedAtForState(patch.state, now) } : {}),
      })
      .where(eq(workItems.id, item.id))
      .returning()
      .get();
  }

  addLabel(projectId: string, itemId: string, label: string): void {
    const item = this.requireWorkItem(projectId, itemId);
    this.db
      .insert(workItemLabels)
      .values({
        projectId,
        workItemId: item.id,
        label,
        createdAt: this.nowIso(),
      })
      .onConflictDoNothing({ target: [workItemLabels.workItemId, workItemLabels.label] })
      .run();
  }

  removeLabel(projectId: string, itemId: string, label: string): void {
    const item = this.requireWorkItem(projectId, itemId);
    this.db
      .delete(workItemLabels)
      .where(and(eq(workItemLabels.workItemId, item.id), eq(workItemLabels.label, label)))
      .run();
  }

  listLabels(projectId: string, itemId: string): string[] {
    const item = this.requireWorkItem(projectId, itemId);
    return this.db
      .select({ label: workItemLabels.label })
      .from(workItemLabels)
      .where(eq(workItemLabels.workItemId, item.id))
      .orderBy(asc(workItemLabels.id))
      .all()
      .map((row) => row.label);
  }

  createComment(projectId: string, itemId: string, body: string): IssueComment {
    const item = this.requireWorkItem(projectId, itemId);
    const row = this.db
      .insert(workItemComments)
      .values({
        projectId,
        workItemId: item.id,
        body,
        authorLogin: 'goose-hub',
        createdAt: this.nowIso(),
      })
      .returning()
      .get();
    return {
      id: row.id,
      body: row.body,
      authorLogin: row.authorLogin,
      createdAt: row.createdAt,
    };
  }

  listComments(projectId: string, itemId: string): IssueComment[] {
    const item = this.requireWorkItem(projectId, itemId);
    return this.db
      .select()
      .from(workItemComments)
      .where(
        and(eq(workItemComments.projectId, projectId), eq(workItemComments.workItemId, item.id)),
      )
      .orderBy(asc(workItemComments.id))
      .all()
      .map((row) => ({
        id: row.id,
        body: row.body,
        authorLogin: row.authorLogin,
        createdAt: row.createdAt,
      }));
  }

  createRepoLink(input: {
    projectId: string;
    itemId: string;
    repoRef: string;
    role?: string;
    confidence?: number | null;
    source?: string;
  }): LocalDbRepoLinkRow {
    const item = this.requireWorkItem(input.projectId, input.itemId);
    this.db
      .insert(workItemRepoLinks)
      .values({
        projectId: input.projectId,
        workItemId: item.id,
        repoRef: input.repoRef,
        role: input.role ?? 'unknown',
        confidence: input.confidence ?? null,
        source: input.source ?? 'manual',
        createdAt: this.nowIso(),
      })
      .onConflictDoNothing({
        target: [workItemRepoLinks.workItemId, workItemRepoLinks.repoRef, workItemRepoLinks.role],
      })
      .run();
    return this.db
      .select()
      .from(workItemRepoLinks)
      .where(
        and(
          eq(workItemRepoLinks.workItemId, item.id),
          eq(workItemRepoLinks.repoRef, input.repoRef),
          eq(workItemRepoLinks.role, input.role ?? 'unknown'),
        ),
      )
      .get() as LocalDbRepoLinkRow;
  }

  listRepoLinks(projectId: string, itemId: string): LocalDbRepoLinkRow[] {
    const item = this.requireWorkItem(projectId, itemId);
    return this.db
      .select()
      .from(workItemRepoLinks)
      .where(eq(workItemRepoLinks.workItemId, item.id))
      .orderBy(asc(workItemRepoLinks.id))
      .all();
  }

  upsertExternalRef(input: {
    projectId: string;
    itemId: string;
    provider: string;
    kind: string;
    repoRef?: string | null;
    externalId: string;
    url?: string | null;
    metadata?: unknown;
  }): LocalDbExternalRefRow {
    const item = this.requireWorkItem(input.projectId, input.itemId);
    const existing = this.getExternalRef({
      projectId: input.projectId,
      provider: input.provider,
      kind: input.kind,
      repoRef: input.repoRef ?? null,
      externalId: input.externalId,
    });
    if (existing != null) {
      return this.db
        .update(workItemExternalRefs)
        .set({
          workItemId: item.id,
          url: input.url ?? existing.url,
          metadataJson:
            input.metadata == null ? existing.metadataJson : JSON.stringify(input.metadata),
        })
        .where(eq(workItemExternalRefs.id, existing.id))
        .returning()
        .get();
    }
    return this.db
      .insert(workItemExternalRefs)
      .values({
        projectId: input.projectId,
        workItemId: item.id,
        provider: input.provider,
        kind: input.kind,
        repoRef: input.repoRef ?? null,
        externalId: input.externalId,
        url: input.url ?? null,
        metadataJson: input.metadata == null ? null : JSON.stringify(input.metadata),
        createdAt: this.nowIso(),
      })
      .returning()
      .get();
  }

  createExternalRef(
    input: Parameters<LocalDbWorkItemRepository['upsertExternalRef']>[0],
  ): LocalDbExternalRefRow {
    return this.upsertExternalRef(input);
  }

  getExternalRef(input: {
    projectId: string;
    provider: string;
    kind: string;
    repoRef?: string | null;
    externalId: string;
  }): LocalDbExternalRefRow | null {
    return (
      this.db
        .select()
        .from(workItemExternalRefs)
        .where(
          and(
            eq(workItemExternalRefs.projectId, input.projectId),
            eq(workItemExternalRefs.provider, input.provider),
            eq(workItemExternalRefs.kind, input.kind),
            input.repoRef == null
              ? isNull(workItemExternalRefs.repoRef)
              : eq(workItemExternalRefs.repoRef, input.repoRef),
            eq(workItemExternalRefs.externalId, input.externalId),
          ),
        )
        .get() ?? null
    );
  }

  getWorkItemByExternalRef(input: {
    projectId: string;
    provider: string;
    kind: string;
    repoRef?: string | null;
    externalId: string;
  }): LocalDbWorkItemRow | null {
    const ref = this.getExternalRef(input);
    if (ref == null) return null;
    return this.getWorkItem(input.projectId, ref.workItemId);
  }

  listExternalRefsByKind(input: {
    projectId: string;
    provider?: string;
    kind?: string;
  }): LocalDbExternalRefRow[] {
    const clauses = [eq(workItemExternalRefs.projectId, input.projectId)];
    if (input.provider != null) clauses.push(eq(workItemExternalRefs.provider, input.provider));
    if (input.kind != null) clauses.push(eq(workItemExternalRefs.kind, input.kind));
    return this.db
      .select()
      .from(workItemExternalRefs)
      .where(and(...clauses))
      .orderBy(asc(workItemExternalRefs.id))
      .all();
  }

  listExternalRefReadModelsByKind(input: {
    projectId: string;
    provider?: string;
    kind?: string;
  }): LocalDbExternalRefReadModel[] {
    return this.listExternalRefsByKind(input).map(toExternalRefReadModel);
  }

  listExternalRefs(projectId: string, itemId: string): LocalDbExternalRefRow[] {
    const item = this.requireWorkItem(projectId, itemId);
    return this.db
      .select()
      .from(workItemExternalRefs)
      .where(eq(workItemExternalRefs.workItemId, item.id))
      .orderBy(asc(workItemExternalRefs.id))
      .all();
  }

  listExternalRefReadModels(projectId: string, itemId: string): LocalDbExternalRefReadModel[] {
    return this.listExternalRefs(projectId, itemId).map(toExternalRefReadModel);
  }

  listStateEvents(projectId: string, itemId: string): LocalDbStateEventRow[] {
    const item = this.requireWorkItem(projectId, itemId);
    return this.db
      .select()
      .from(workItemStateEvents)
      .where(eq(workItemStateEvents.workItemId, item.id))
      .orderBy(asc(workItemStateEvents.id))
      .all();
  }

  createMilestone(projectId: string, title: string): LocalDbMilestoneRow {
    const now = this.nowIso();
    return this.db
      .insert(workItemMilestones)
      .values({
        projectId,
        number: this.nextMilestoneNumber(projectId),
        title,
        state: 'open',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  }

  listMilestones(projectId: string): LocalDbMilestoneRow[] {
    return this.db
      .select()
      .from(workItemMilestones)
      .where(eq(workItemMilestones.projectId, projectId))
      .orderBy(asc(workItemMilestones.number))
      .all();
  }

  getMilestone(projectId: string, number: number): LocalDbMilestoneRow | null {
    return (
      this.db
        .select()
        .from(workItemMilestones)
        .where(
          and(eq(workItemMilestones.projectId, projectId), eq(workItemMilestones.number, number)),
        )
        .get() ?? null
    );
  }

  getActiveMilestoneNumber(projectId: string): number | null {
    const row = this.db
      .select({ activeMilestoneNumber: projectState.activeMilestoneNumber })
      .from(projectState)
      .where(eq(projectState.projectId, projectId))
      .get();
    return row?.activeMilestoneNumber ?? null;
  }

  updateMilestone(
    projectId: string,
    number: number,
    patch: { title?: string; state?: 'open' | 'closed' },
  ): LocalDbMilestoneRow {
    const existing = this.getMilestone(projectId, number);
    if (existing == null) throw new Error(`LocalDbStateSource: milestone ${number} not found`);
    return this.db
      .update(workItemMilestones)
      .set({
        title: patch.title ?? existing.title,
        state: patch.state ?? existing.state,
        updatedAt: this.nowIso(),
      })
      .where(
        and(eq(workItemMilestones.projectId, projectId), eq(workItemMilestones.number, number)),
      )
      .returning()
      .get();
  }

  deleteMilestone(projectId: string, number: number): void {
    this.db.transaction((tx) => {
      tx.delete(workItemMilestones)
        .where(
          and(eq(workItemMilestones.projectId, projectId), eq(workItemMilestones.number, number)),
        )
        .run();
      tx.update(workItems)
        .set({ milestoneId: null, milestoneTitle: null, updatedAt: this.nowIso() })
        .where(and(eq(workItems.projectId, projectId), eq(workItems.milestoneId, String(number))))
        .run();
    });
  }

  setMilestone(projectId: string, itemId: string, milestoneNumber: number | null): void {
    const item = this.requireWorkItem(projectId, itemId);
    const milestone =
      milestoneNumber == null ? null : this.getMilestone(projectId, milestoneNumber);
    if (milestoneNumber != null && milestone == null) {
      throw new Error(`LocalDbStateSource: milestone ${milestoneNumber} not found`);
    }
    this.db
      .update(workItems)
      .set({
        milestoneId: milestone == null ? null : String(milestone.number),
        milestoneTitle: milestone?.title ?? null,
        updatedAt: this.nowIso(),
      })
      .where(eq(workItems.id, item.id))
      .run();
  }
}
