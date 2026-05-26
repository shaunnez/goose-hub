import { eq } from 'drizzle-orm';
import { logger } from '../../logger.js';
import { db } from '../db.js';
import { projectReviewSettings } from '../schema.js';

export type ProjectReviewSettingsRow = typeof projectReviewSettings.$inferSelect;

export type ReviewerSlot = {
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
    const parsed = JSON.parse(row.reviewerSlots) as unknown;
    if (!Array.isArray(parsed)) return null;
    const slots = parsed.flatMap((entry): ReviewerSlot[] => {
      if (entry == null || typeof entry !== 'object') return [];
      const prompt = (entry as { prompt?: unknown }).prompt;
      if (prompt !== 'default' && prompt !== 'unconstrained') return [];
      return [{ prompt }];
    });
    return slots.length > 0 ? slots.slice(0, 2) : null;
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
    reviewerSlots: patch.reviewerSlots != null ? JSON.stringify(patch.reviewerSlots) : null,
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
