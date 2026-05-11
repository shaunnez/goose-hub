import { and, eq } from 'drizzle-orm';
import type { ModelProvider, ModelTier } from '../../types.js';
import { db } from '../db.js';
import { projectModelSettings } from '../schema.js';

export type ProjectModelSettingsRow = typeof projectModelSettings.$inferSelect;

export type RoleModelPatch = {
  primaryModel?: ModelTier | null;
  fallbackModel?: ModelTier | null;
  advisorModel?: ModelTier | null;
  primaryProvider?: ModelProvider | null;
  fallbackProvider?: ModelProvider | null;
  advisorProvider?: ModelProvider | null;
  maxTurns?: number | null;
  timeoutMs?: number | null;
};

/** Complexity overrides for a single role: keys are "type:<T>", "priority:<P>", or "default". */
export type ComplexityOverrides = Record<string, ModelTier>;

export function readProjectModelSettings(projectId: string): Map<string, ProjectModelSettingsRow> {
  const rows = db
    .select()
    .from(projectModelSettings)
    .where(eq(projectModelSettings.projectId, projectId))
    .all();
  const map = new Map<string, ProjectModelSettingsRow>();
  for (const row of rows) {
    map.set(row.role, row);
  }
  return map;
}

export function readProjectModelSettingsForRole(
  projectId: string,
  role: string,
): ProjectModelSettingsRow | null {
  const rows = db
    .select()
    .from(projectModelSettings)
    .where(and(eq(projectModelSettings.projectId, projectId), eq(projectModelSettings.role, role)))
    .all();
  return rows[0] ?? null;
}

export function writeRoleModelSetting(
  projectId: string,
  role: string,
  patch: RoleModelPatch,
  by: string,
): void {
  const now = new Date().toISOString();
  const where = and(
    eq(projectModelSettings.projectId, projectId),
    eq(projectModelSettings.role, role),
  );
  const existing = db.select().from(projectModelSettings).where(where).all();

  if (existing.length === 0) {
    db.insert(projectModelSettings)
      .values({ projectId, role, ...patch, updatedAt: now, updatedBy: by })
      .run();
  } else {
    db.update(projectModelSettings)
      .set({ ...patch, updatedAt: now, updatedBy: by })
      .where(where)
      .run();
  }
}

export function writeComplexityOverrides(
  projectId: string,
  role: string,
  overrides: ComplexityOverrides,
  by: string,
): void {
  const now = new Date().toISOString();
  const json = JSON.stringify(overrides);
  const where = and(
    eq(projectModelSettings.projectId, projectId),
    eq(projectModelSettings.role, role),
  );
  const existing = db.select().from(projectModelSettings).where(where).all();

  if (existing.length === 0) {
    db.insert(projectModelSettings)
      .values({ projectId, role, complexityOverridesJson: json, updatedAt: now, updatedBy: by })
      .run();
  } else {
    db.update(projectModelSettings)
      .set({ complexityOverridesJson: json, updatedAt: now, updatedBy: by })
      .where(where)
      .run();
  }
}

export function deleteRoleModelSetting(projectId: string, role: string): void {
  db.delete(projectModelSettings)
    .where(and(eq(projectModelSettings.projectId, projectId), eq(projectModelSettings.role, role)))
    .run();
}

export function deleteAllRoleModelSettings(projectId: string): void {
  db.delete(projectModelSettings).where(eq(projectModelSettings.projectId, projectId)).run();
}

/**
 * Sets the same (tier, provider) for `primaryModel` + `primaryProvider` across
 * many roles in one call. Used by the "All → Codex" / "All → Claude" bulk
 * switch in the Models settings UI. Existing fallback/advisor/complexity values
 * on each row are preserved.
 */
export function writeBulkRoleModelPrimary(
  projectId: string,
  roles: string[],
  tier: ModelTier,
  provider: ModelProvider,
  by: string,
): void {
  for (const role of roles) {
    writeRoleModelSetting(projectId, role, { primaryModel: tier, primaryProvider: provider }, by);
  }
}

export function parseComplexityOverrides(row: ProjectModelSettingsRow): ComplexityOverrides {
  if (!row.complexityOverridesJson) return {};
  try {
    return JSON.parse(row.complexityOverridesJson) as ComplexityOverrides;
  } catch {
    return {};
  }
}
