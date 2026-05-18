#!/usr/bin/env tsx
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Completion, describeCompletion, newRun } from './outcome.js';
import { applySeed, restoreSeed, statusAll, verifyRed } from './runner.js';
import { RunsStore, aggregate } from './runs-store.js';
import { getSeed, listSeeds } from './seeds/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const DEFAULT_REPO = 'shaunnez/goose-hub';

function printUsage(): void {
  console.log(`Usage: pnpm dogfood <command> [args]

Seed mechanics:
  list                          List all known seeds
  status                        Show which seeds are currently applied
  apply <seed-id>               Apply a seed mutation to the working tree
  restore <seed-id>             Restore the original file(s) for a seed
  verify-red <seed-id>          Run the seed's truth-signal test, expect it to fail
  issue <seed-id>               Print the GitHub issue title + body for a seed

Outcome tracking:
  file-issue <seed-id>          Print the gh-issue-create command and record a pending run
  record <run-id> --key=value   Record outcome fields on a run (--completion, --truth-pass,
                                --qa-correct, --hygiene-clean, --issue-url, --notes)
  runs [--limit=N]              List recent dogfood runs (default 20)
  runs:summary                  Aggregate stats across all recorded runs

Examples:
  pnpm dogfood apply logger-001-drop-meta
  pnpm dogfood verify-red logger-001-drop-meta
  pnpm dogfood file-issue logger-001-drop-meta
  pnpm dogfood record dogfood-abc-xyz --completion=reached-terminal --truth-pass=true
  pnpm dogfood runs:summary
`);
}

function parseFlags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of args) {
    const m = arg.match(/^--([a-zA-Z0-9-]+)(?:=(.*))?$/);
    if (!m) continue;
    const [, k, v] = m;
    out[k] = v ?? 'true';
  }
  return out;
}

function parseBool(v: string | undefined): boolean | undefined {
  if (v == null) return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new Error(`Expected true|false, got: ${v}`);
}

function parseIssueUrl(url: string): { repo: string; number: number; url: string } {
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
  if (!m) throw new Error(`Could not parse issue URL: ${url}`);
  return { repo: m[1], number: Number(m[2]), url };
}

function parseCompletion(s: string): Completion {
  if (s === 'pending' || s === 'reached-terminal' || s === 'stalled' || s === 'aborted-by-human') {
    return s;
  }
  if (s.startsWith('failed:')) {
    const [, node, ...reasonParts] = s.split(':');
    return { failed: { node: node ?? 'unknown', reason: reasonParts.join(':') || undefined } };
  }
  throw new Error(
    `Unknown --completion=${s}. Use: pending | reached-terminal | stalled | aborted-by-human | failed:<node>[:<reason>]`,
  );
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  if (!command || command === 'help' || command === '--help') {
    printUsage();
    return;
  }

  const opts = { repoRoot };

  switch (command) {
    case 'list': {
      for (const s of listSeeds()) {
        console.log(`${s.id.padEnd(28)} [${s.area.padEnd(8)}] ${s.description}`);
      }
      return;
    }
    case 'status': {
      const rows = await statusAll(opts);
      if (rows.length === 0) {
        console.log('No seeds registered.');
        return;
      }
      let anyUnknown = false;
      for (const r of rows) {
        const mark =
          r.state === 'applied' ? '[applied]' : r.state === 'clean' ? '[clean]  ' : '[unknown]';
        console.log(`${mark} ${r.id.padEnd(28)} ${r.description}`);
        if (r.state === 'unknown') {
          anyUnknown = true;
          console.log(`           reason: ${r.error ?? '(no error message captured)'}`);
        }
      }
      if (anyUnknown) {
        process.exitCode = 1;
      }
      return;
    }
    case 'apply': {
      const seedId = rest[0];
      if (!seedId) throw new Error('apply requires <seed-id>');
      const seed = await applySeed(seedId, opts);
      console.log(`[applied] ${seed.id}`);
      console.log(
        `  File mutated. Next: \`pnpm dogfood verify-red ${seed.id}\` to confirm the truth-signal test is red.`,
      );
      return;
    }
    case 'restore': {
      const seedId = rest[0];
      if (!seedId) throw new Error('restore requires <seed-id>');
      const seed = await restoreSeed(seedId, opts);
      console.log(`[restored] ${seed.id}`);
      return;
    }
    case 'verify-red': {
      const seedId = rest[0];
      if (!seedId) throw new Error('verify-red requires <seed-id>');
      const result = await verifyRed(seedId, opts);
      const seed = getSeed(seedId);
      console.log(`Truth-signal: ${seed.truthSignal.testName}`);
      console.log(`Test file:    ${seed.truthSignal.testFile}`);
      console.log('');
      console.log(`Failing tests (${result.failingTests.length}):`);
      for (const n of result.failingTests) console.log(`  - ${n}`);
      console.log(`Passing tests (${result.passingTests.length}):`);
      for (const n of result.passingTests) console.log(`  - ${n}`);
      console.log('');
      if (!result.truthSignalRed) {
        console.log(
          'FAIL: truth-signal test is NOT red. Either the seed did not apply, or the test does not exercise the mutated code path.',
        );
        process.exitCode = 1;
        return;
      }
      if (result.unexpectedFailures.length > 0) {
        console.log(
          `FAIL: truth-signal is red, but ${result.unexpectedFailures.length} other test(s) in the file are also red. The seed must break exactly one test — additional reds invalidate the controlled-mutation guarantee.`,
        );
        for (const n of result.unexpectedFailures) console.log(`  - ${n}`);
        process.exitCode = 1;
        return;
      }
      console.log('OK: truth-signal test is red, no other tests in the file are failing.');
      return;
    }
    case 'issue': {
      const seedId = rest[0];
      if (!seedId) throw new Error('issue requires <seed-id>');
      const seed = getSeed(seedId);
      console.log(`TITLE: ${seed.issue.title}`);
      console.log(`LABELS: ${seed.issue.labels.join(', ')}`);
      console.log('---');
      console.log(seed.issue.body);
      return;
    }
    case 'file-issue': {
      const seedId = rest[0];
      if (!seedId) throw new Error('file-issue requires <seed-id>');
      const seed = getSeed(seedId);
      const run = newRun(seed.id, 'bug');
      const store = new RunsStore();
      await store.append(run);

      const bodyDir = path.join(os.tmpdir(), 'dogfood-issue-bodies');
      await fs.mkdir(bodyDir, { recursive: true });
      const bodyFile = path.join(bodyDir, `${run.runId}.md`);
      await fs.writeFile(bodyFile, seed.issue.body, 'utf8');

      const labelFlags = seed.issue.labels
        .map((l) => `--label ${JSON.stringify(l)}`)
        .join(' \\\n    ');

      console.log(`Run id:   ${run.runId}`);
      console.log(`Seed:     ${seed.id}`);
      console.log(`Workflow: ${run.workflow}`);
      console.log(`Recorded pending row at: ${store.path}`);
      console.log('');
      console.log('To file the issue, run locally (requires `gh` authenticated):');
      console.log('');
      console.log(
        `  gh issue create --repo ${DEFAULT_REPO} \\\n    --title ${JSON.stringify(seed.issue.title)} \\\n    --body-file ${JSON.stringify(bodyFile)} \\\n    ${labelFlags}`,
      );
      console.log('');
      console.log('After filing, link the URL back so outcomes can be correlated:');
      console.log(`  pnpm dogfood record ${run.runId} --issue-url=<url>`);
      return;
    }
    case 'record': {
      const runId = rest[0];
      if (!runId) throw new Error('record requires <run-id>');
      const flags = parseFlags(rest.slice(1));
      const store = new RunsStore();
      const current = await store.get(runId);
      if (!current)
        throw new Error(`Unknown run-id: ${runId}. Run \`pnpm dogfood runs\` to see ids.`);

      const patch: Record<string, unknown> = {};
      if (flags.completion) patch.completion = parseCompletion(flags.completion);
      const tp = parseBool(flags['truth-pass']);
      if (tp != null) patch.truthPass = tp;
      const qc = parseBool(flags['qa-correct']);
      if (qc != null) patch.qaCorrect = qc;
      const hc = parseBool(flags['hygiene-clean']);
      if (hc != null) patch.hygieneClean = hc;
      if (flags['issue-url']) patch.issue = parseIssueUrl(flags['issue-url']);
      if (flags.notes) patch.notes = flags.notes;
      if (flags['ended-at']) patch.endedAt = flags['ended-at'];
      if (Object.keys(patch).length === 0) {
        throw new Error('record requires at least one --key=value flag');
      }
      if (patch.completion != null && patch.completion !== 'pending' && !('endedAt' in patch)) {
        patch.endedAt = new Date().toISOString();
      }

      const updated = await store.update(runId, patch);
      console.log(`Updated ${runId}`);
      console.log(`  completion:  ${describeCompletion(updated.completion)}`);
      if (updated.truthPass != null) console.log(`  truth-pass:  ${updated.truthPass}`);
      if (updated.qaCorrect != null) console.log(`  qa-correct:  ${updated.qaCorrect}`);
      if (updated.hygieneClean != null) console.log(`  hygiene:     ${updated.hygieneClean}`);
      if (updated.issue) console.log(`  issue:       ${updated.issue.url}`);
      if (updated.notes) console.log(`  notes:       ${updated.notes}`);
      return;
    }
    case 'runs': {
      const flags = parseFlags(rest);
      const limit = flags.limit ? Number(flags.limit) : 20;
      const store = new RunsStore();
      const rows = await store.listRecent(limit);
      if (rows.length === 0) {
        console.log(`No runs recorded. Store: ${store.path}`);
        return;
      }
      for (const r of rows) {
        const c = describeCompletion(r.completion);
        const tp = r.truthPass == null ? '?' : r.truthPass ? '✓' : '✗';
        const issue = r.issue ? `#${r.issue.number}` : '(no issue)';
        console.log(
          `${r.runId.padEnd(28)} ${r.seedId.padEnd(32)} ${r.workflow.padEnd(8)} ${issue.padEnd(12)} truth=${tp} ${c}`,
        );
      }
      return;
    }
    case 'runs:summary': {
      const store = new RunsStore();
      const rows = await store.list();
      const stats = aggregate(rows);
      console.log(`Total runs: ${stats.total}`);
      console.log(`  pending:           ${stats.pending}`);
      console.log(`  reached-terminal:  ${stats.reachedTerminal}`);
      console.log(`  failed:            ${stats.failed}`);
      if (stats.truthPassRate != null) {
        console.log(`Truth-pass rate:     ${(stats.truthPassRate * 100).toFixed(1)}%`);
      }
      if (stats.qaCorrectRate != null) {
        console.log(`QA accuracy rate:    ${(stats.qaCorrectRate * 100).toFixed(1)}%`);
      }
      if (stats.hygieneCleanRate != null) {
        console.log(`Hygiene-clean rate:  ${(stats.hygieneCleanRate * 100).toFixed(1)}%`);
      }
      console.log('');
      console.log('By workflow:');
      for (const [wf, s] of Object.entries(stats.byWorkflow)) {
        console.log(`  ${wf.padEnd(10)} ${s.reachedTerminal}/${s.total} reached terminal`);
      }
      console.log('');
      console.log('By seed:');
      for (const [id, s] of Object.entries(stats.bySeed)) {
        const truth = s.total > 0 ? ((s.truthPassCount / s.total) * 100).toFixed(0) : '–';
        console.log(
          `  ${id.padEnd(36)} ${s.reachedTerminal}/${s.total} terminal, truth-pass ${truth}%`,
        );
      }
      return;
    }
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
