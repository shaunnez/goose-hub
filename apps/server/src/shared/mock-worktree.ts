import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let counter = 0;

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'run';
}

export function createMockWorktree(prefix: string, ...segments: string[]): string {
  counter += 1;
  const suffix = segments.length > 0 ? segments.map(safeSegment).join('-') : String(counter);
  const dir = join(
    tmpdir(),
    `goose-hub-${safeSegment(prefix)}-${suffix}-${process.pid}-${counter}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}
