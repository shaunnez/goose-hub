import type { Stage } from './types.js';

/**
 * Maps a skill name to the high-level pipeline stage it belongs to.
 * The dashboard groups costs by stage; the persisted row also records the
 * exact `skill`, so finer breakdowns are still possible from raw data.
 */
const SKILL_TO_STAGE: Record<string, Stage> = {
  triage: 'triage',
  'triage-light': 'triage',
  'grill-me': 'discover',
  'write-prd': 'discover',
  'advise-on-prd': 'discover',
  'decompose-issues': 'discover',
  investigate: 'investigate',
  investigation: 'investigate',
  implement: 'dev',
  fix: 'dev',
  'fix-issue': 'dev',
  qa: 'qa',
  review: 'review',
  'retrospective-light': 'retrospective',
  'retrospective-deep': 'retrospective',
};

export function stageForSkill(skill: string): Stage {
  return SKILL_TO_STAGE[skill] ?? 'other';
}
