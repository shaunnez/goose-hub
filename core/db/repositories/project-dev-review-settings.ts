import { eq } from 'drizzle-orm';
import { db } from '../db.js';
import { projectDevReviewSettings } from '../schema.js';

export type ProjectDevReviewSettingsRow = typeof projectDevReviewSettings.$inferSelect;

export type DevReviewSettingsPatch = {
  enabled?: boolean | null;
  triggerOn?: string | null;
  maxRevisionTurns?: number | null;
  perCycleMaxUsd?: number | null;
  timeoutMs?: number | null;
};

export function readProjectDevReviewSettings(
  projectId: string,
): ProjectDevReviewSettingsRow | null {
  try {
    const rows = db
      .select()
      .from(projectDevReviewSettings)
      .where(eq(projectDevReviewSettings.projectId, projectId))
      .all();
    return rows[0] ?? null;
  } catch {
    // Table may not exist yet (migration pending) — treat as no override.
    return null;
  }
}

export function writeProjectDevReviewSettings(
  projectId: string,
  patch: DevReviewSettingsPatch,
  by: string,
): void {
  const now = new Date().toISOString();
  const existing = db
    .select()
    .from(projectDevReviewSettings)
    .where(eq(projectDevReviewSettings.projectId, projectId))
    .all();

  if (existing.length === 0) {
    db.insert(projectDevReviewSettings)
      .values({ projectId, ...patch, updatedAt: now, updatedBy: by })
      .run();
  } else {
    db.update(projectDevReviewSettings)
      .set({ ...patch, updatedAt: now, updatedBy: by })
      .where(eq(projectDevReviewSettings.projectId, projectId))
      .run();
  }
}
