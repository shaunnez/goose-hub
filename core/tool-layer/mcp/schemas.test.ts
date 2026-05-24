import { describe, expect, it } from 'vitest';
import {
  FACTORY_TOOL_NAMES,
  ReadFileInput,
  RecordDecisionInput,
  RepoIntelQueryRefined,
  RunPackageScriptInput,
  SearchTextInput,
  WriteFileInput,
} from './schemas.js';

describe('FACTORY_TOOL_NAMES', () => {
  it('has no duplicates', () => {
    const set = new Set(FACTORY_TOOL_NAMES);
    expect(set.size).toBe(FACTORY_TOOL_NAMES.length);
  });

  it('includes every implemented tool family', () => {
    // Phantom names (get_handoff, validate_evidence_artifacts,
    // package_evidence_packet, publish_evidence) from the original ADR
    // catalog were dropped — those are workflow-internal or undefined
    // artifacts, not agent-callable tools.
    const expected = [
      'get_work_item',
      'get_project_context',
      'get_stack_commands',
      'record_decision',
      'read_file',
      'write_file',
      'edit_file',
      'apply_patch',
      'run_tests',
      'run_lint',
      'run_typecheck',
      'collect_evidence',
      'get_diff',
      'get_log',
      'get_blame',
      'stage_changes',
      'commit_changes',
      'open_pr',
      'get_pr_diff',
      'run_isolated_test',
    ];
    for (const name of expected) {
      expect(FACTORY_TOOL_NAMES).toContain(name);
    }
  });

  it('does not include the dropped phantom names', () => {
    const phantoms = [
      'get_handoff',
      'validate_evidence_artifacts',
      'package_evidence_packet',
      'publish_evidence',
    ];
    for (const name of phantoms) {
      expect(FACTORY_TOOL_NAMES).not.toContain(name);
    }
  });
});

describe('schema input validation', () => {
  it('ReadFileInput requires `path`', () => {
    expect(ReadFileInput.safeParse({}).success).toBe(false);
    expect(ReadFileInput.safeParse({ path: 'src/foo.ts' }).success).toBe(true);
  });

  it('ReadFileInput is strict — extra keys fail', () => {
    expect(ReadFileInput.safeParse({ path: 'src/foo.ts', workspaceRoot: '/tmp' }).success).toBe(
      false,
    );
  });

  it('RecordDecisionInput rejects unknown kinds', () => {
    const ok = RecordDecisionInput.safeParse({
      kind: 'PLAN',
      what: 'x',
      why: 'y',
    });
    expect(ok.success).toBe(true);

    const bad = RecordDecisionInput.safeParse({
      kind: 'NOT_A_REAL_KIND',
      what: 'x',
      why: 'y',
    });
    expect(bad.success).toBe(false);
  });

  it('SearchTextInput rejects empty queries', () => {
    expect(SearchTextInput.safeParse({ query: '' }).success).toBe(false);
    expect(SearchTextInput.safeParse({ query: 'hello' }).success).toBe(true);
  });

  it('RunPackageScriptInput rejects shell metacharacters in script name', () => {
    expect(RunPackageScriptInput.safeParse({ script: 'test' }).success).toBe(true);
    expect(RunPackageScriptInput.safeParse({ script: 'test && rm -rf /' }).success).toBe(false);
    expect(RunPackageScriptInput.safeParse({ script: 'a;b' }).success).toBe(false);
  });

  it('WriteFileInput allows empty content but not missing path', () => {
    expect(WriteFileInput.safeParse({ path: 'a.txt', content: '' }).success).toBe(true);
    expect(WriteFileInput.safeParse({ content: 'hi' }).success).toBe(false);
  });
});

describe('RepoIntelQueryRefined (per-intent discriminated validation)', () => {
  it.each([
    ['find-symbol', 'name', { name: 'AuthService' }],
    ['find-callers', 'symbol', { symbol: 'AuthService' }],
    ['find-calls-of', 'symbol', { symbol: 'AuthService' }],
    ['find-jsx-usages', 'component', { component: 'Button' }],
    ['find-importers', 'module + symbol', { module: '@/lib/api', symbol: 'api' }],
    ['find-route', 'pathPattern', { pathPattern: '/projects/:slug' }],
    ['find-component', 'component', { component: 'Button' }],
    ['route-for-component', 'component', { component: 'ProjectPage' }],
    ['find-tests-for', 'target', { target: 'src/auth.ts' }],
    ['related-files', 'target', { target: 'src/auth.ts' }],
    ['fetch-artifact', 'artifactKey', { artifactKey: 'scout-report:abc' }],
  ])('%s requires %s', (intent, _desc, args) => {
    expect(RepoIntelQueryRefined.safeParse({ intent }).success).toBe(false);
    expect(RepoIntelQueryRefined.safeParse({ intent, ...args }).success).toBe(true);
  });

  it.each([
    ['recent-changes', {}],
    ['prior-investigation', {}],
  ])('%s allows empty payload (all fields optional)', (intent, args) => {
    expect(RepoIntelQueryRefined.safeParse({ intent, ...args }).success).toBe(true);
  });

  it('rejects unknown intent', () => {
    expect(RepoIntelQueryRefined.safeParse({ intent: 'not-real' }).success).toBe(false);
  });
});
