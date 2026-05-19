import { describe, expect, it } from 'vitest';
import { CHAT_TOOL_NAMES, CHAT_TOOL_REGISTRY, getToolManifest } from './registry.js';

describe('chat-tools registry', () => {
  it('has at least the documented core tool set', () => {
    const expected = [
      'list_projects',
      'list_skills',
      'list_open_issues',
      'get_issue',
      'get_issue_context',
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

  it('registers the subscribe_to_run / subscribe_to_issue tools as mutating', () => {
    expect(getToolManifest('subscribe_to_run')?.mutating).toBe(true);
    expect(getToolManifest('subscribe_to_issue')?.mutating).toBe(true);
  });

  it('registers settings + active-milestone tools with the right mutating flags', () => {
    expect(getToolManifest('get_settings')?.mutating).toBe(false);
    expect(getToolManifest('update_settings')?.mutating).toBe(true);
    expect(getToolManifest('set_active_milestone')?.mutating).toBe(true);
  });

  it('registers bootstrap_project as a mutating tool', () => {
    expect(getToolManifest('bootstrap_project')?.mutating).toBe(true);
  });

  it('requires create_inbox_note to carry a real type', () => {
    const schema = getToolManifest('create_inbox_note')?.inputSchema;
    expect(schema?.safeParse({ title: 'follow up on retro' }).success).toBe(false);
    expect(schema?.safeParse({ title: 'follow up on retro', type: 'chore' }).success).toBe(true);
  });

  it('derives create_inbox_note type only from explicit Type markers', () => {
    const schema = getToolManifest('create_inbox_note')?.inputSchema;
    const parsed = schema?.safeParse({
      title: 'goose hub logo wrong 911',
      body: 'Type - bug\n\nExpected logo text should read GOOSEHUB.',
    });
    expect(parsed?.success).toBe(true);
    if (!parsed?.success) return;
    expect(parsed.data).toMatchObject({ type: 'bug' });
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
