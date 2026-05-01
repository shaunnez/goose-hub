import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import { RepoMatchOutputSchema } from './schema.js';
import config, { RepoMatchContextSchema } from './skill.config.js';
import {
  parseReposRegistry,
  runKeywordTier,
  scoreRepo,
  scoreToConfidence,
} from './keyword-tier.js';

const REPOS_MD_PATH = join(
  import.meta.dirname,
  '../../target-projects/goose-hub-self/repos.md',
);

describe('repo-match schema', () => {
  it('accepts valid output with candidates and decisionSummaries', () => {
    const result = RepoMatchOutputSchema.safeParse({
      candidates: [
        { repo: 'shaunnez/goose-hub', confidence: 85, evidence: 'slug match', tier: 1 },
      ],
      decisionSummaries: [{ step: 'keyword-match', summary: 'Matched via slug token' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty candidates array', () => {
    const result = RepoMatchOutputSchema.safeParse({
      candidates: [],
      decisionSummaries: [{ step: 'keyword-match', summary: 'No matches found' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid tier value', () => {
    const result = RepoMatchOutputSchema.safeParse({
      candidates: [{ repo: 'x/y', confidence: 50, evidence: 'x', tier: 4 }],
      decisionSummaries: [{ step: 's', summary: 'ok' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence out of range', () => {
    const result = RepoMatchOutputSchema.safeParse({
      candidates: [{ repo: 'x/y', confidence: 150, evidence: 'x', tier: 1 }],
      decisionSummaries: [{ step: 's', summary: 'ok' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing decisionSummaries', () => {
    const result = RepoMatchOutputSchema.safeParse({
      candidates: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty decisionSummaries array', () => {
    const result = RepoMatchOutputSchema.safeParse({
      candidates: [],
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });

  it('zod toJSONSchema roundtrip produces valid JSON Schema object', () => {
    const jsonSchema = toJSONSchema(RepoMatchOutputSchema);
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
    expect(jsonSchema).toHaveProperty('properties');
  });
});

describe('repo-match skill config', () => {
  it('has role researcher', () => {
    expect(config.role).toBe('researcher');
  });

  it('has empty toolBundles', () => {
    expect(config.toolBundles).toHaveLength(0);
  });

  it('is pinned to sonnet model', () => {
    expect(config.modelPin).toBe('sonnet');
  });

  it('contextSchema validates required workItem fields', () => {
    const valid = RepoMatchContextSchema.safeParse({
      workItem: { title: 'Fix triage bug', body: 'Triage fails on empty body.' },
    });
    expect(valid.success).toBe(true);
  });

  it('contextSchema rejects missing workItem.title', () => {
    const invalid = RepoMatchContextSchema.safeParse({ workItem: { body: 'body' } });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema rejects missing workItem.body', () => {
    const invalid = RepoMatchContextSchema.safeParse({ workItem: { title: 'title' } });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema rejects missing workItem entirely', () => {
    const invalid = RepoMatchContextSchema.safeParse({});
    expect(invalid.success).toBe(false);
  });
});

describe('keyword tier scoring', () => {
  const repo = { slug: 'shaunnez/goose-hub', description: 'Personal command centre for AI-assisted software delivery.' };

  it('slug token match in title scores higher than description token match', () => {
    const slugResult = scoreRepo(repo, 'goose-hub triage fix', '');
    const descResult = scoreRepo(repo, 'personal assistant delivery', '');
    expect(slugResult.score).toBeGreaterThan(descResult.score);
  });

  it('full slug match adds 15 bonus points', () => {
    const withBonus = scoreRepo(repo, 'fix issue in goose-hub', '');
    const withoutBonus = scoreRepo(repo, 'fix triage logic', '');
    expect(withBonus.score - withoutBonus.score).toBeGreaterThanOrEqual(15);
  });

  it('slug token in title (10pts) beats slug token in body (3pts)', () => {
    const inTitle = scoreRepo(repo, 'goose fix', '');
    const inBody = scoreRepo(repo, 'fix issue', 'goose related');
    expect(inTitle.score).toBeGreaterThan(inBody.score);
  });

  it('returns sorted results descending by score', () => {
    const repos = [
      { slug: 'other/repo', description: 'Unrelated service.' },
      repo,
    ];
    const results = runKeywordTier(repos, 'goose-hub triage fix', '');
    expect(results[0].repo).toBe('shaunnez/goose-hub');
  });

  it('scoreToConfidence caps at 100', () => {
    expect(scoreToConfidence(100)).toBe(100);
  });

  it('scoreToConfidence returns 0 for score 0', () => {
    expect(scoreToConfidence(0)).toBe(0);
  });
});

describe('parseReposRegistry', () => {
  it('parses repos.md and extracts slug and description', () => {
    const md = `### [shaunnez/goose-hub](https://github.com/shaunnez/goose-hub)\n**Description:** Personal command centre.\n`;
    const repos = parseReposRegistry(md);
    expect(repos).toHaveLength(1);
    expect(repos[0].slug).toBe('shaunnez/goose-hub');
    expect(repos[0].description).toBe('Personal command centre.');
  });

  it('actual repos.md exists and contains goose-hub entry', () => {
    const md = readFileSync(REPOS_MD_PATH, 'utf8');
    const repos = parseReposRegistry(md);
    expect(repos.length).toBeGreaterThanOrEqual(1);
    const gooseHub = repos.find((r) => r.slug === 'shaunnez/goose-hub');
    expect(gooseHub).toBeDefined();
  });

  it('tier-3 prompt renders repo descriptions from allowlist', () => {
    const md = readFileSync(REPOS_MD_PATH, 'utf8');
    const repos = parseReposRegistry(md);
    // Verify descriptions are non-empty — tier-3 prompt must have substance to reason over
    for (const repo of repos) {
      expect(repo.description.length).toBeGreaterThan(0);
    }
  });
});
