import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

export const DISPLAY_OUTPUT_LIMIT_BYTES = 4 * 1024;
export const RUN_OUTPUT_DIR = '.factory/run-output';

export interface ShapeCommandOutputInput {
  workspaceRoot: string;
  runId: string;
  invocation: number;
  stdout: Buffer;
  stderr: Buffer;
  byteCaptureTruncated: boolean;
  displayLimitBytes?: number;
}

export interface ShapeCommandOutputResult {
  stdout: string;
  stderr: string;
  displayTruncated: boolean;
  fullOutputPath?: string;
}

function safeRunId(runId: string): string {
  return runId.replace(/[^A-Za-z0-9._:-]/g, '_');
}

function assertInsideWorkspace(workspaceRoot: string, absolutePath: string): void {
  const root = resolve(workspaceRoot);
  const target = resolve(absolutePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`run output path escaped workspace: ${target}`);
  }
}

function banner(stream: 'stdout' | 'stderr', input: ShapeCommandOutputInput, path: string): string {
  const capNote = input.byteCaptureTruncated
    ? '; spill contains captured output up to the command-policy byte limit'
    : '';
  return `[factory] ${stream} display truncated; full captured output: ${path}${capNote}`;
}

function shapeStream(
  stream: 'stdout' | 'stderr',
  input: ShapeCommandOutputInput,
  path: string,
): { text: string; truncated: boolean } {
  const limit = input.displayLimitBytes ?? DISPLAY_OUTPUT_LIMIT_BYTES;
  const value = input[stream];
  if (value.byteLength <= limit) {
    return { text: value.toString('utf8'), truncated: false };
  }

  const marker = Buffer.from(`\n${banner(stream, input, path)}\n`, 'utf8');
  const remaining = Math.max(0, limit - marker.byteLength);
  const headBytes = Math.floor(remaining / 2);
  const tailBytes = remaining - headBytes;
  const head = value.subarray(0, headBytes);
  const tail = tailBytes > 0 ? value.subarray(value.byteLength - tailBytes) : Buffer.alloc(0);

  return {
    text: Buffer.concat([head, marker, tail]).toString('utf8'),
    truncated: true,
  };
}

function spillFileBytes(stdout: Buffer, stderr: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from('===== stdout =====\n', 'utf8'),
    stdout,
    Buffer.from('\n===== stderr =====\n', 'utf8'),
    stderr,
  ]);
}

export async function shapeCommandOutput(
  input: ShapeCommandOutputInput,
): Promise<ShapeCommandOutputResult> {
  const limit = input.displayLimitBytes ?? DISPLAY_OUTPUT_LIMIT_BYTES;
  const needsSpill = input.stdout.byteLength > limit || input.stderr.byteLength > limit;
  if (!needsSpill) {
    return {
      stdout: input.stdout.toString('utf8'),
      stderr: input.stderr.toString('utf8'),
      displayTruncated: false,
    };
  }

  const fullOutputPath = `${RUN_OUTPUT_DIR}/${safeRunId(input.runId)}-${input.invocation}.log`;
  const outputDir = join(input.workspaceRoot, RUN_OUTPUT_DIR);
  const absolutePath = join(input.workspaceRoot, fullOutputPath);
  assertInsideWorkspace(input.workspaceRoot, absolutePath);
  await mkdir(outputDir, { recursive: true });
  await writeFile(absolutePath, spillFileBytes(input.stdout, input.stderr));

  const stdout = shapeStream('stdout', input, fullOutputPath);
  const stderr = shapeStream('stderr', input, fullOutputPath);

  return {
    stdout: stdout.text,
    stderr: stderr.text,
    displayTruncated: stdout.truncated || stderr.truncated,
    fullOutputPath,
  };
}
