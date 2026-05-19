import { describe, expect, it } from 'vitest';
import { stageForSkill } from './skill-stage.js';

describe('stageForSkill', () => {
  it('maps known skills to their stage', () => {
    expect(stageForSkill('triage')).toBe('triage');
    expect(stageForSkill('investigate')).toBe('investigate');
    expect(stageForSkill('implement')).toBe('dev');
    expect(stageForSkill('fix-issue')).toBe('dev');
    expect(stageForSkill('qa')).toBe('qa');
    expect(stageForSkill('review')).toBe('review');
    expect(stageForSkill('retrospective-light')).toBe('retrospective');
    expect(stageForSkill('retrospective-deep')).toBe('retrospective');
  });

  it('maps hub-chat to the chat stage so dashboards can group it separately', () => {
    expect(stageForSkill('hub-chat')).toBe('chat');
  });

  it('returns "other" for unknown skills', () => {
    expect(stageForSkill('something-new')).toBe('other');
    expect(stageForSkill('')).toBe('other');
  });
});
