import { and, eq } from 'drizzle-orm';
import { logger } from '../../logger.js';
import { db } from '../db.js';
import { projectSettings, projectSkillSettings } from '../schema.js';

export type ProjectSettingsRow = typeof projectSettings.$inferSelect;
export type ProjectSkillSettingsRow = typeof projectSkillSettings.$inferSelect;

export type GlobalBudgetPatch = {
  perWorkflowMaxUsd?: number | null;
  perAgentMaxUsd?: number | null;
  perAdvisorMaxUsd?: number | null;
  dailyTokens?: number | null;
  maxParallelAgents?: number | null;
  maxRetries?: number | null;
  perBashCommandMaxSeconds?: number | null;
  useMultiAgentPipeline?: number | null;
  recordDecisionTool?: number | null;
};

export type SkillBudgetPatch = {
  maxTurns?: number | null;
  maxBudgetUsd?: number | null;
  timeoutMs?: number | null;
};

export function readProjectSettings(projectId: string): ProjectSettingsRow | null {
  const rows = db
    .select()
    .from(projectSettings)
    .where(eq(projectSettings.projectId, projectId))
    .all();
  return rows[0] ?? null;
}

export function deriveUseMultiAgentPipeline(row: ProjectSettingsRow | null): boolean {
  return row?.useMultiAgentPipeline === 1;
}

export function getUseMultiAgentPipeline(projectId: string): boolean {
  try {
    return deriveUseMultiAgentPipeline(readProjectSettings(projectId));
  } catch (err) {
    logger.warn('getUseMultiAgentPipeline: read failed, defaulting to false', {
      projectId,
      error: String(err),
    });
    return false;
  }
}

export function setUseMultiAgentPipeline(projectId: string, enabled: boolean, by: string): void {
  writeProjectSettings(projectId, { useMultiAgentPipeline: enabled ? 1 : 0 }, by);
}

export function deriveRecordDecisionTool(row: ProjectSettingsRow | null): boolean {
  return row?.recordDecisionTool === 1;
}

export function getRecordDecisionTool(projectId: string): boolean {
  try {
    return deriveRecordDecisionTool(readProjectSettings(projectId));
  } catch (err) {
    logger.warn('getRecordDecisionTool: read failed, defaulting to false', {
      projectId,
      error: String(err),
    });
    return false;
  }
}

export function readProjectSkillSettings(projectId: string): Map<string, ProjectSkillSettingsRow> {
  const rows = db
    .select()
    .from(projectSkillSettings)
    .where(eq(projectSkillSettings.projectId, projectId))
    .all();
  const map = new Map<string, ProjectSkillSettingsRow>();
  for (const row of rows) {
    map.set(row.skillName, row);
  }
  return map;
}

export function writeProjectSettings(
  projectId: string,
  patch: GlobalBudgetPatch,
  by: string,
): void {
  const now = new Date().toISOString();
  const existing = db
    .select()
    .from(projectSettings)
    .where(eq(projectSettings.projectId, projectId))
    .all();

  if (existing.length === 0) {
    db.insert(projectSettings)
      .values({ projectId, ...patch, updatedAt: now, updatedBy: by })
      .run();
  } else {
    db.update(projectSettings)
      .set({ ...patch, updatedAt: now, updatedBy: by })
      .where(eq(projectSettings.projectId, projectId))
      .run();
  }
}

export function writeProjectSkillSetting(
  projectId: string,
  skillName: string,
  patch: SkillBudgetPatch,
  by: string,
): void {
  const now = new Date().toISOString();
  const where = and(
    eq(projectSkillSettings.projectId, projectId),
    eq(projectSkillSettings.skillName, skillName),
  );
  const existing = db.select().from(projectSkillSettings).where(where).all();

  if (existing.length === 0) {
    db.insert(projectSkillSettings)
      .values({ projectId, skillName, ...patch, updatedAt: now, updatedBy: by })
      .run();
  } else {
    db.update(projectSkillSettings)
      .set({ ...patch, updatedAt: now, updatedBy: by })
      .where(where)
      .run();
  }
}

export function deleteProjectSkillSetting(projectId: string, skillName: string): void {
  db.delete(projectSkillSettings)
    .where(
      and(
        eq(projectSkillSettings.projectId, projectId),
        eq(projectSkillSettings.skillName, skillName),
      ),
    )
    .run();
}
