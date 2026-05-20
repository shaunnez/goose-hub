import { and, eq } from 'drizzle-orm';
import { logger } from '../../logger.js';
import type { CoachPolicy } from '../../types.js';
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
  maxScoutAgents?: number | null;
  maxRetries?: number | null;
  perBashCommandMaxSeconds?: number | null;
  useMultiAgentPipeline?: number | null;
  useInvestigationSwarm?: number | null;
  coachPolicyEnabled?: number | null;
  coachPolicyConsistencyThreshold?: number | null;
  coachPolicyMinLifecycles?: number | null;
  recordDecisionTool?: number | null;
  qaE2eMode?: 'off' | 'ui-changed' | 'always' | null;
  playwrightReproEnabled?: number | null;
  evidencePostEnabled?: number | null;
};

export type SkillBudgetPatch = {
  maxTurns?: number | null;
  maxBudgetUsd?: number | null;
  timeoutMs?: number | null;
  modelTier?: string | null;
  modelProvider?: string | null;
  effort?: string | null;
};

export const DEFAULT_COACH_POLICY: CoachPolicy = {
  enabled: false,
  consistencyThreshold: 0.8,
  minLifecycles: 3,
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

export function deriveUseInvestigationSwarm(
  row: ProjectSettingsRow | null,
  configDefault = true,
): boolean {
  if (row?.useInvestigationSwarm == null) return configDefault;
  return row.useInvestigationSwarm === 1;
}

export function getUseInvestigationSwarm(projectId: string, configDefault = true): boolean {
  try {
    return deriveUseInvestigationSwarm(readProjectSettings(projectId), configDefault);
  } catch (err) {
    logger.warn('getUseInvestigationSwarm: read failed, defaulting to config value', {
      projectId,
      configDefault,
      error: String(err),
    });
    return configDefault;
  }
}

export function setUseInvestigationSwarm(projectId: string, enabled: boolean, by: string): void {
  writeProjectSettings(projectId, { useInvestigationSwarm: enabled ? 1 : 0 }, by);
}

export function deriveCoachPolicy(
  row: ProjectSettingsRow | null,
  configDefault: CoachPolicy | null | undefined,
): CoachPolicy {
  const base = configDefault ?? DEFAULT_COACH_POLICY;
  return {
    enabled: row?.coachPolicyEnabled == null ? base.enabled : row.coachPolicyEnabled === 1,
    consistencyThreshold:
      row?.coachPolicyConsistencyThreshold == null
        ? base.consistencyThreshold
        : row.coachPolicyConsistencyThreshold,
    minLifecycles:
      row?.coachPolicyMinLifecycles == null ? base.minLifecycles : row.coachPolicyMinLifecycles,
  };
}

export function getCoachPolicy(
  projectId: string,
  configDefault: CoachPolicy | null | undefined,
): CoachPolicy {
  try {
    return deriveCoachPolicy(readProjectSettings(projectId), configDefault);
  } catch (err) {
    logger.warn('getCoachPolicy: read failed, defaulting to config value', {
      projectId,
      error: String(err),
    });
    return configDefault ?? DEFAULT_COACH_POLICY;
  }
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

export type QaE2eMode = 'off' | 'ui-changed' | 'always';

export function deriveQaE2eMode(
  row: ProjectSettingsRow | null,
  configDefault: QaE2eMode = 'off',
): QaE2eMode {
  if (row?.qaE2eMode === 'off' || row?.qaE2eMode === 'ui-changed' || row?.qaE2eMode === 'always') {
    return row.qaE2eMode;
  }
  return configDefault;
}

export function getQaE2eMode(projectId: string, configDefault: QaE2eMode = 'off'): QaE2eMode {
  try {
    return deriveQaE2eMode(readProjectSettings(projectId), configDefault);
  } catch (err) {
    logger.warn('getQaE2eMode: read failed, defaulting to config value', {
      projectId,
      configDefault,
      error: String(err),
    });
    return configDefault;
  }
}

function deriveEnabledFlag(value: number | null | undefined, configDefault: boolean): boolean {
  if (value == null) return configDefault;
  return value === 1;
}

export function getPlaywrightReproEnabled(projectId: string, configDefault = true): boolean {
  try {
    return deriveEnabledFlag(readProjectSettings(projectId)?.playwrightReproEnabled, configDefault);
  } catch (err) {
    logger.warn('getPlaywrightReproEnabled: read failed, defaulting to config value', {
      projectId,
      configDefault,
      error: String(err),
    });
    return configDefault;
  }
}

export function getEvidencePostEnabled(projectId: string, configDefault = true): boolean {
  try {
    return deriveEnabledFlag(readProjectSettings(projectId)?.evidencePostEnabled, configDefault);
  } catch (err) {
    logger.warn('getEvidencePostEnabled: read failed, defaulting to config value', {
      projectId,
      configDefault,
      error: String(err),
    });
    return configDefault;
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

/**
 * Clears ALL budget overrides for a project — both the global row and every
 * per-skill override. Used by the "Reset all to defaults" action in the
 * Budgets settings UI. Non-budget project flags in project_settings are
 * preserved.
 */
export function resetAllProjectBudgets(projectId: string): void {
  db.delete(projectSkillSettings).where(eq(projectSkillSettings.projectId, projectId)).run();
  db.update(projectSettings)
    .set({
      perWorkflowMaxUsd: null,
      perAgentMaxUsd: null,
      perAdvisorMaxUsd: null,
      dailyTokens: null,
      maxParallelAgents: null,
      maxScoutAgents: null,
      maxRetries: null,
      perBashCommandMaxSeconds: null,
      updatedAt: new Date().toISOString(),
      updatedBy: 'ui',
    })
    .where(eq(projectSettings.projectId, projectId))
    .run();
}
