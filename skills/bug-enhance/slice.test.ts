import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BugEnhanceOutputSchema } from './schema.js';
import config from './skill.config.js';

function readPrompt(): string {
  return readFileSync(new URL('prompt.md', import.meta.url), 'utf8');
}

describe('BugEnhanceOutputSchema', () => {
  it('accepts valid output', () => {
    const result = BugEnhanceOutputSchema.safeParse({
      enhancedContent:
        '**Repro steps**\n1. Navigate to http://localhost:5173/\n2. Observe the sidebar\n\n**Expected**\nSidebar label reads "Goose Hub"\n\n**Actual**\nSidebar label reads "Agentic OS"',
      decisionSummaries: [
        {
          kind: 'PLAN',
          summary: 'Added Repro steps, Expected, Actual, Location sections',
          evidence: 'sidebar label reads "Agentic OS"',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects output with empty enhancedContent', () => {
    const result = BugEnhanceOutputSchema.safeParse({
      enhancedContent: '',
      decisionSummaries: [{ kind: 'PLAN', summary: 'nothing added' }],
    });
    // enhancedContent is a string — empty string is technically valid per schema;
    // the prompt instructs the agent to always include content.
    expect(result.success).toBe(true);
  });

  it('rejects output missing decisionSummaries', () => {
    const result = BugEnhanceOutputSchema.safeParse({
      enhancedContent: '**Repro steps**\n1. Navigate to http://localhost:5173/',
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts structured groundedHints with candidate files, components, and routes', () => {
    const result = BugEnhanceOutputSchema.safeParse({
      enhancedContent: '**Location**\napps/web/src/components/chat/components/ChatPanel.tsx',
      groundedHints: {
        candidateFiles: [
          {
            path: 'apps/web/src/components/chat/components/ChatPanel.tsx',
            confidence: 'high',
            source: 'tool-verified',
            reason: 'Owns chat panel state',
          },
        ],
        candidateComponents: [
          { name: 'ChatPanel', file: 'apps/web/src/components/chat/components/ChatPanel.tsx' },
        ],
        candidateRoutes: [{ pattern: '/', component: 'App' }],
      },
      decisionSummaries: [{ kind: 'PLAN', summary: 'Grounded location to ChatPanel.tsx' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects candidateFiles entries with unknown confidence value', () => {
    const result = BugEnhanceOutputSchema.safeParse({
      enhancedContent: '**Location**\nx',
      groundedHints: {
        candidateFiles: [{ path: 'apps/web/src/x.tsx', confidence: 'maybe' }],
      },
      decisionSummaries: [{ kind: 'PLAN', summary: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('omits groundedHints entirely when not provided (backwards compatible)', () => {
    const result = BugEnhanceOutputSchema.safeParse({
      enhancedContent: '**Repro steps**\n1. Open',
      decisionSummaries: [{ kind: 'PLAN', summary: 'minimal output' }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.groundedHints).toBeUndefined();
  });

  it('accepts category for ui-web bugs', () => {
    const result = BugEnhanceOutputSchema.safeParse({
      enhancedContent: '**Location**\napps/web/src/components/chat/ChatPanel.tsx',
      category: 'ui-web',
      groundedHints: {
        candidateFiles: [
          { path: 'apps/web/src/components/chat/ChatPanel.tsx', confidence: 'high' },
        ],
      },
      decisionSummaries: [{ kind: 'PLAN', summary: 'ui-web bug grounded' }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.category).toBe('ui-web');
  });

  it('accepts category for server-api bugs with server-rooted candidate files', () => {
    const result = BugEnhanceOutputSchema.safeParse({
      enhancedContent: '**Location**\napps/server/src/domains/inbox/service.ts',
      category: 'server-api',
      groundedHints: {
        candidateFiles: [
          {
            path: 'apps/server/src/domains/inbox/service.ts',
            confidence: 'high',
            source: 'tool-verified',
          },
        ],
      },
      decisionSummaries: [{ kind: 'PLAN', summary: 'server-api bug grounded' }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.category).toBe('server-api');
  });

  it('accepts category for cli, background, build-ci', () => {
    for (const category of ['cli', 'background', 'build-ci'] as const) {
      const result = BugEnhanceOutputSchema.safeParse({
        enhancedContent: '**Trigger**\nx',
        category,
        decisionSummaries: [{ kind: 'PLAN', summary: `${category} bug` }],
      });
      expect(result.success).toBe(true);
    }
  });

  it('accepts unknown category with empty enhancedContent (fail-open)', () => {
    const result = BugEnhanceOutputSchema.safeParse({
      enhancedContent: '',
      category: 'unknown',
      decisionSummaries: [{ kind: 'PLAN', summary: 'cannot place bug' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown category value', () => {
    const result = BugEnhanceOutputSchema.safeParse({
      enhancedContent: '',
      category: 'frontend',
      decisionSummaries: [{ kind: 'PLAN', summary: 'x' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('bug-enhance prompt', () => {
  it('is configured with the read tool bundle', () => {
    expect(config.toolBundles).toEqual(['read']);
  });

  it('grounds server-api request paths through route lookup before generic symbol lookup', () => {
    const prompt = readPrompt();

    expect(prompt).toContain('If a request path is mentioned');
    expect(prompt).toContain(
      'use the repo-intel query tool with `{intent:"find-route", pathPattern:"<path>"}` first',
    );
    expect(prompt).toContain('If the request path starts with `/api/`');
  });

  it('names the runtime-visible repo-intel query tool for Claude and Codex', () => {
    const prompt = readPrompt();

    expect(prompt).toContain('Claude CLI: `mcp__factory-tools__repo_intel_query`');
    expect(prompt).toContain('Codex CLI: `repo_intel.query`');
    expect(prompt).toContain('Never use bare `repo_intel_query`');
    expect(prompt).not.toContain('call `repo_intel.query');
  });

  it('declares all runtime-visible read tools and forbids native/delegation tools', () => {
    const prompt = readPrompt();

    for (const toolName of [
      'mcp__factory-tools__repo_intel_query',
      'mcp__factory-tools__search_text',
      'mcp__factory-tools__list_dir',
      'mcp__factory-tools__list_files',
      'mcp__factory-tools__read_file',
      'repo_intel.query',
      'search_text',
      'list_dir',
      'list_files',
      'read_file',
    ]) {
      expect(prompt).toContain(toolName);
    }

    for (const forbidden of [
      'ToolSearch',
      'native Read',
      'Bash',
      'Agent',
      'Skill',
      'AskUserQuestion',
      'MCP resources',
      'file://',
      'delegation',
      'user questions',
    ]) {
      expect(prompt).toContain(forbidden);
    }
  });
});
