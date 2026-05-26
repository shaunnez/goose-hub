import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dbDir = mkdtempSync(join(tmpdir(), 'goose-hub-vitest-'));
const dbPath = join(dbDir, 'factory.db');
const vitestBin = process.platform === 'win32' ? 'vitest.cmd' : 'vitest';

const result = spawnSync(vitestBin, ['run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'test',
    DB_PATH: process.env.DB_PATH ?? dbPath,
  },
});

if (result.error != null) {
  throw result.error;
}

process.exit(result.status ?? 1);
