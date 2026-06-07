import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ImplementWpSchema } from './schema.js';
import config from './skill.config.js';

const makeValidOutput = (overrides: Record<string, unknown> = {}) => ({
  wpId: 'WP1',
  plan: 'Add helper at core/foo/bar.ts',
  filesWritten: [{ path: 'core/foo/bar.ts', reason: 'new helper' }],
  testsWritten: [{ path: 'core/foo/bar.test.ts', cases: 3 }],
  testsRun: { command: 'pnpm test --reporter=json', paths: ['core/foo/bar.test.ts'] },
  confidence: 'high' as const,
  decisionSummaries: [{ kind: 'PLAN', summary: 'Add helper at core/foo/bar.ts' }],
  ...overrides,
});

describe('ImplementWpSchema', () => {
  it('accepts a valid WP output', () => {
    const result = ImplementWpSchema.safeParse(makeValidOutput());
    expect(result.success).toBe(true);
  });

  it('accepts a chore output with empty filesWritten and testsWritten', () => {
    const result = ImplementWpSchema.safeParse(
      makeValidOutput({
        filesWritten: [],
        testsWritten: [],
        testsRun: { command: 'pnpm test', paths: [] },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects when testsWritten is non-empty but testsRun.paths is empty', () => {
    const result = ImplementWpSchema.safeParse(
      makeValidOutput({ testsRun: { command: 'pnpm test', paths: [] } }),
    );
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('testsRun.paths');
  });

  it('rejects when decisionSummaries is empty', () => {
    const result = ImplementWpSchema.safeParse(makeValidOutput({ decisionSummaries: [] }));
    expect(result.success).toBe(false);
  });

  it('rejects when wpId is empty', () => {
    const result = ImplementWpSchema.safeParse(makeValidOutput({ wpId: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects duplicate paths in filesWritten', () => {
    const result = ImplementWpSchema.safeParse(
      makeValidOutput({
        filesWritten: [
          { path: 'core/foo/bar.ts', reason: 'first' },
          { path: 'core/foo/bar.ts', reason: 'duplicate' },
        ],
      }),
    );
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('duplicate path');
  });

  it('accepts confidence:low with failing threshold', () => {
    const result = ImplementWpSchema.safeParse(makeValidOutput({ confidence: 'low' }));
    expect(result.success).toBe(true);
  });
});

describe('implement-wp skill.config', () => {
  it('has developer role', () => {
    expect(config.role).toBe('developer');
  });

  it('uses dev-tools bundle', () => {
    expect(config.toolBundles).toContain('dev-tools');
  });

  it('is pinned to sonnet', () => {
    expect(config.modelPin).toBe('sonnet');
  });

  it('freshContext is false (builder is not a holdout)', () => {
    expect(config.freshContext).toBe(false);
  });

  it('context allowlist includes wp fields', () => {
    const allowlist = config.contextAllowlist ?? [];
    expect(allowlist).toContain('wp.id');
    expect(allowlist).toContain('wp.filesOwned');
    expect(allowlist).toContain('wp.changes');
    expect(allowlist).toContain('codeContext');
    expect(allowlist).toContain('specContext');
    expect(allowlist).toContain('parentPrdContext');
    expect(allowlist).not.toContain('worktreePath');
  });

  it('context allowlist excludes full-spec fields (narrow context)', () => {
    const allowlist = config.contextAllowlist ?? [];
    expect(allowlist).not.toContain('spec');
    expect(allowlist).not.toContain('allWorkPackages');
  });

  it('validates context schema rejects missing wp fields', () => {
    const result = config.contextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 1, priority: 'low' },
      stack: { testCommand: 'pnpm test' },
      // wp is missing
    });
    expect(result.success).toBe(false);
  });

  it('validates context schema accepts a well-formed WP context', () => {
    const result = config.contextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 1, priority: 'medium' },
      wp: {
        id: 'WP1',
        filesOwned: ['core/foo/bar.ts'],
        changes: 'Add helper',
        dependsOn: [],
      },
      codeContext: [
        {
          path: 'core/foo/bar.ts',
          startLine: 10,
          endLine: 16,
          snippet: '10: export function bar() {',
        },
      ],
      specContext: {
        objective: 'Add bar helper',
        architecture: {
          current: 'No helper',
          new: 'Export helper',
          decisionRationale: 'Keep logic shared',
        },
        functionalRequirements: [{ id: 'FR1', statement: 'bar returns guarded values.' }],
        interfaceContracts: [
          {
            name: 'bar helper',
            signature: 'export function bar(): string',
            file: 'core/foo/bar.ts',
            requiredExports: [{ name: 'bar' }],
            lineRange: null,
          },
        ],
        constraints: [
          {
            kind: 'output-format',
            name: 'bar output',
            source: 'core/foo/bar.ts:bar',
          },
        ],
        dependencyWpIds: [],
        dependencyFilesOwned: [],
      },
      investigation: {
        findings: 'bar needs a guard',
        keyFiles: [
          {
            path: 'core/foo/bar.ts',
            reason: 'guard lives here',
            line: 10,
            symbol: 'bar',
            snippet: 'export function bar() {}',
          },
        ],
        openQuestions: [],
        investigationRunId: 'investigation-run-1',
      },
      parentPrdContext: {
        source: 'event',
        parentWorkItemId: 'github:owner/repo#1',
        prdRunId: 'prd-run',
        title: 'PRD',
        problem: 'Problem',
        proposedSolution: 'Solution',
        outOfScope: ['Do not rebuild settings.'],
        successCriteria: ['Works'],
        acceptanceCriteria: [{ id: 'AC1', statement: 'It works.' }],
        journeys: [{ id: 'J1' }],
        functionalSpec: { dataConstraints: ['Keep existing state labels.'] },
        verticalSlices: [],
        implementationDecisions: [],
        testingDecisions: null,
      },
      stack: { testCommand: 'pnpm test' },
    });
    expect(result.success).toBe(true);
  });
});

describe('implement-wp prompt live decisions', () => {
  const prompt = readFileSync(new URL('./prompt.md', import.meta.url), 'utf8');

  it('uses record_decision as the primary live timeline signal', () => {
    expect(prompt).toContain('mcp__factory-tools__record_decision');
    expect(prompt).toContain('The tool call is the primary live timeline signal');
    expect(prompt).toContain('do not rely on text markers alone');
  });

  it('documents line-precise code context', () => {
    expect(prompt).toContain('<codeContext>');
    expect(prompt).toContain('exact pre-read hunks');
  });

  it('clarifies resource probe failures are not Factory tool unavailability', () => {
    expect(prompt).toContain('resources/templates/list');
    expect(prompt).toContain('advisory startup/resource-probe noise');
    expect(prompt).toContain('Do not return a BLOCKER only because a resource probe failed');
  });

  it('documents WP-scoped spec context contracts', () => {
    expect(prompt).toContain('<specContext>');
    expect(prompt).toContain('interfaceContracts[].signature');
    expect(prompt).toContain('requiredExports');
  });

  it('forbids re-running the same useful RED failure before an edit', () => {
    expect(prompt).toContain('After a useful RED failure');
    expect(prompt).toContain('edited a source or test file');
    expect(prompt).toContain('Do not re-run');
  });
});
