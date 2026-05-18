#!/usr/bin/env tsx
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySeed, restoreSeed, statusAll, verifyRed } from './runner.js';
import { getSeed, listSeeds } from './seeds/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

function printUsage(): void {
  console.log(`Usage: pnpm dogfood <command> [args]

Commands:
  list                          List all known seeds
  status                        Show which seeds are currently applied
  apply <seed-id>               Apply a seed mutation to the working tree
  restore <seed-id>             Restore the original file(s) for a seed
  verify-red <seed-id>          Run the seed's truth-signal test, expect it to fail
  issue <seed-id>               Print the GitHub issue title + body for a seed

Examples:
  pnpm dogfood list
  pnpm dogfood apply logger-001-drop-meta
  pnpm dogfood verify-red logger-001-drop-meta
  pnpm dogfood restore logger-001-drop-meta
`);
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
      for (const r of rows) {
        const mark = r.applied ? '[applied]' : '[clean]  ';
        console.log(`${mark} ${r.id.padEnd(28)} ${r.description}`);
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
      if (result.truthSignalRed) {
        console.log('OK: truth-signal test is red as expected.');
      } else {
        console.log(
          'FAIL: truth-signal test is NOT red. Either the seed did not apply, or the test does not exercise the mutated code path.',
        );
        process.exitCode = 1;
      }
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
