import { describe, expect, it } from 'vitest';
import { CHAT_TOOL_NAMES, CHAT_TOOL_REGISTRY, getToolManifest } from './registry.js';

describe('chat-tools registry', () => {
  it('has at least the documented core tool set', () => {
    const expected = [
      'list_projects',
      'list_skills',
      'list_open_issues',
      'get_issue',
      'recent_events',
      'invoke_skill',
      'transition_issue',
      'comment_on_issue',
      'tick_project',
      'create_inbox_note',
      'open_url',
    ];
    for (const name of expected) {
      expect(CHAT_TOOL_NAMES, `missing ${name}`).toContain(name);
    }
  });

  it('marks mutating tools correctly', () => {
    expect(getToolManifest('list_projects')?.mutating).toBe(false);
    expect(getToolManifest('transition_issue')?.mutating).toBe(true);
    expect(getToolManifest('invoke_skill')?.mutating).toBe(true);
    expect(getToolManifest('open_url')?.mutating).toBe(true);
  });

  it('every entry has a non-empty description', () => {
    for (const entry of CHAT_TOOL_REGISTRY) {
      expect(entry.description.length, `empty description for ${entry.name}`).toBeGreaterThan(10);
    }
  });

  it('returns null for unknown tools', () => {
    expect(getToolManifest('totally_made_up')).toBeNull();
  });
});
