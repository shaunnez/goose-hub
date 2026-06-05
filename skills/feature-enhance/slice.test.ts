import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FeatureEnhanceOutputSchema } from './schema.js';
import config, { FeatureEnhanceContextSchema } from './skill.config.js';

function readPrompt(): string {
  return readFileSync(new URL('prompt.md', import.meta.url), 'utf8');
}

describe('FeatureEnhanceOutputSchema', () => {
  it('accepts grounded feature output', () => {
    const result = FeatureEnhanceOutputSchema.safeParse({
      candidateFiles: [
        {
          path: 'apps/web/src/components/detail/IssueDetailPage.tsx',
          confidence: 'high',
          source: 'tool-verified',
          reason: 'Detail page owns issue presentation.',
        },
      ],
      existingSurfaces: ['apps/web/src/components/detail/IssueDetailPage.tsx'],
      similarPatterns: ['Timeline cards use compact event renderers.'],
      testSurfaces: ['apps/web/src/components/detail/lib/timeline.test.ts'],
      acceptanceHints: ['Renders the new event in the detail timeline.'],
      openQuestions: [],
      confidence: 'high',
      escalationSignals: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an explicit low-confidence miss', () => {
    const result = FeatureEnhanceOutputSchema.safeParse({
      candidateFiles: [],
      existingSurfaces: [],
      similarPatterns: [],
      testSurfaces: [],
      acceptanceHints: [],
      openQuestions: ['No matching repo surface found from the feature language.'],
      confidence: 'low',
      escalationSignals: ['needs product clarification before implementation'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown confidence values', () => {
    const result = FeatureEnhanceOutputSchema.safeParse({
      candidateFiles: [],
      existingSurfaces: [],
      similarPatterns: [],
      testSurfaces: [],
      acceptanceHints: [],
      openQuestions: [],
      confidence: 'maybe',
      escalationSignals: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('feature-enhance skill config', () => {
  it('allows framed feature and project context', () => {
    const result = FeatureEnhanceContextSchema.safeParse({
      workItem: { title: 'Add timeline filters', body: 'Filter the detail timeline.', number: 12 },
      framedFeature: { framedBody: 'Framed body', refinedIntent: 'Add timeline filters.' },
      projectContext: { projectId: 'goose-hub-self', targetRepo: '/repo', defaultBranch: 'main' },
    });
    expect(result.success).toBe(true);
  });

  it('is read-only and triager-owned', () => {
    expect(config.toolBundles).toEqual(['read']);
    expect(config.role).toBe('triager');
    expect(config.contextAllowlist).toEqual(['workItem', 'framedFeature', 'projectContext']);
  });
});

describe('feature-enhance prompt', () => {
  it('forbids bug diagnosis and invented files', () => {
    const prompt = readPrompt();
    expect(prompt).toContain('Do not diagnose bugs');
    expect(prompt).toContain('Do not invent files');
    expect(prompt).toContain('If no files are found');
  });
});
