import { eq } from 'drizzle-orm';
import { logger } from '../../logger.js';
import { db } from '../db.js';
import { projectReviewSettings } from '../schema.js';

export type ProjectReviewSettingsRow = typeof projectReviewSettings.$inferSelect;

export type ReviewerSlot = {
  model: 'claude' | 'codex';
  prompt: 'default' | 'unconstrained';
};

export type ReviewSettingsPatch = {
  reviewerSlots?: ReviewerSlot[] | null;
};

export function readProjectReviewSettings(projectId: string): ProjectReviewSettingsRow | null {
  const rows = db
    .select()
    .from(projectReviewSettings)
    .where(eq(projectReviewSettings.projectId, projectId))
    .all();
  return rows[0] ?? null;
}

export function parseReviewerSlots(row: ProjectReviewSettingsRow | null): ReviewerSlot[] | null {
  if (!row?.reviewerSlots) return null;
  try {
    return JSON.parse(row.reviewerSlots) as ReviewerSlot[];
  } catch {
    logger.warn('parseReviewerSlots: invalid JSON, ignoring', { projectId: row.projectId });
    return null;
  }
}

export function writeProjectReviewSettings(
  projectId: string,
  patch: ReviewSettingsPatch,
  by: string,
): void {
  const now = new Date().toISOString();
  const serialized = {
    reviewerSlots: patch.reviewerSlots != null ? JSON.stringify(patch.reviewerSlots) : undefined,
  };
  const existing = db
    .select()
    .from(projectReviewSettings)
    .where(eq(projectReviewSettings.projectId, projectId))
    .all();

  if (existing.length === 0) {
    db.insert(projectReviewSettings)
      .values({ projectId, ...serialized, updatedAt: now, updatedBy: by })
      .run();
  } else {
    db.update(projectReviewSettings)
      .set({ ...serialized, updatedAt: now, updatedBy: by })
      .where(eq(projectReviewSettings.projectId, projectId))
      .run();
  }
}
