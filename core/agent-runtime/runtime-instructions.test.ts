import { describe, expect, it } from 'vitest';
import {
  FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS,
  FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS_CODEX,
  FACTORY_WORKSPACE_ONLY_INSTRUCTIONS,
  withFactoryRuntimeInstructions,
} from './runtime-instructions.js';

describe('withFactoryRuntimeInstructions', () => {
  it('prepends both the workspace boundary and the factory-tools preference', () => {
    const out = withFactoryRuntimeInstructions('skill body');
    expect(out).toContain(FACTORY_WORKSPACE_ONLY_INSTRUCTIONS);
    expect(out).toContain(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS);
    expect(out).toContain('skill body');
  });

  it('returns the prelude alone when no system prompt is supplied', () => {
    const out = withFactoryRuntimeInstructions(undefined);
    expect(out).toContain(FACTORY_WORKSPACE_ONLY_INSTRUCTIONS);
    expect(out).toContain(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS);
    expect(out).not.toMatch(/skill body/);
  });

  it('returns the prelude alone for a whitespace-only system prompt', () => {
    const out = withFactoryRuntimeInstructions('   \n  ');
    expect(out).toContain(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS);
  });
});

describe('FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS', () => {
  it('names the high-traffic factory tool families', () => {
    for (const name of [
      'mcp__factory-tools__read_file',
      'mcp__factory-tools__search_text',
      'mcp__factory-tools__write_file',
      'mcp__factory-tools__edit_file',
      'mcp__factory-tools__run_tests',
      'mcp__factory-tools__get_diff',
      'mcp__factory-tools__get_project_context',
    ]) {
      expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS).toContain(name);
    }
  });

  it('does not advertise workflow-owned tools to the agent', () => {
    const forbidden = [
      'mcp__factory-tools__stage_changes',
      'mcp__factory-tools__commit_changes',
      'mcp__factory-tools__open_pr',
      'mcp__factory-tools__update_pr',
      'mcp__factory-tools__post_issue_comment',
      'mcp__factory-tools__transition_state',
      'mcp__factory-tools__publish_evidence',
    ];
    for (const name of forbidden) {
      expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS).not.toContain(name);
    }
  });

  it('states that paths must be workspace-relative', () => {
    expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS).toMatch(/workspace-relative/i);
  });

  it('forbids MCP resources and spawning while naming Claude factory read tools', () => {
    expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS).toContain('resources/read');
    expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS).toContain('resources/list');
    expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS).toContain('file://');
    expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS).toMatch(/spawn/i);
    expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS).toMatch(/delegation/i);
    expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS).toContain('mcp__factory-tools__read_file');
    expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS).toContain('mcp__factory-tools__list_dir');
    expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS).toContain('mcp__factory-tools__list_files');
    expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS).toContain('mcp__factory-tools__search_text');
  });
});

describe('FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS_CODEX', () => {
  it('names the high-traffic factory tool families with bare Codex names', () => {
    for (const name of [
      '`read_file`',
      '`search_text`',
      '`write_file`',
      '`edit_file`',
      '`run_tests`',
      '`get_diff`',
      '`get_project_context`',
    ]) {
      expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS_CODEX).toContain(name);
    }
  });

  it('does not advertise Claude-style prefixed names to Codex', () => {
    expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS_CODEX).not.toContain('mcp__factory-tools__');
  });

  it('forbids MCP resources and spawning while naming bare Codex factory read tools', () => {
    expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS_CODEX).toContain('resources/read');
    expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS_CODEX).toContain('resources/list');
    expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS_CODEX).toContain('file://');
    expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS_CODEX).toMatch(/spawn/i);
    expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS_CODEX).toMatch(/delegation/i);
    expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS_CODEX).toContain('`read_file`');
    expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS_CODEX).toContain('`list_dir`');
    expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS_CODEX).toContain('`list_files`');
    expect(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS_CODEX).toContain('`search_text`');
  });
});

describe('withFactoryRuntimeInstructions runtime selection', () => {
  it('uses the Claude variant by default', () => {
    const out = withFactoryRuntimeInstructions('body');
    expect(out).toContain(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS);
    expect(out).not.toContain(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS_CODEX);
  });

  it('uses the Codex variant when runtime is codex-cli', () => {
    const out = withFactoryRuntimeInstructions('body', { runtime: 'codex-cli' });
    expect(out).toContain(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS_CODEX);
    expect(out).not.toContain(FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS);
  });
});
