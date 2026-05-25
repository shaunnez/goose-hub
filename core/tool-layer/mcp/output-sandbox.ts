import { lstat, mkdir, open, realpath } from 'node:fs/promises';
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
  return runId.replace(/[^A-Za-z0-9._-]/g, '_');
}

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`);
}

function assertInsideWorkspace(root: string, target: string): void {
  if (!isInside(root, target)) {
    throw new Error(`run output path escaped workspace: ${target}`);
  }
}

async function assertNotSymlink(path: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      throw new Error(`run output path must not be a symlink: ${path}`);
    }
    if (!stats.isDirectory()) {
      throw new Error(`run output path is not a directory: ${path}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

async function ensureRunOutputDir(workspaceRoot: string): Promise<string> {
  const root = await realpath(workspaceRoot);
  const factoryDir = join(root, '.factory');
  const outputDir = join(root, RUN_OUTPUT_DIR);

  await assertNotSymlink(factoryDir);
  await mkdir(factoryDir, { recursive: true });
  await assertNotSymlink(factoryDir);

  await assertNotSymlink(outputDir);
  await mkdir(outputDir, { recursive: true });
  await assertNotSymlink(outputDir);

  const outputReal = await realpath(outputDir);
  assertInsideWorkspace(root, outputReal);
  return outputDir;
}

function banner(
  stream: 'stdout' | 'stderr',
  input: ShapeCommandOutputInput,
  path: string | null,
  spillError?: string,
): string {
  const capNote = input.byteCaptureTruncated
    ? '; spill contains captured output up to the command-policy byte limit'
    : '';
  const outputNote =
    path == null
      ? `spill file unavailable${spillError != null ? `: ${spillError}` : ''}`
      : `full captured output: ${path}`;
  return `[factory] ${stream} display truncated; ${outputNote}${capNote}`;
}

function shapeStream(
  stream: 'stdout' | 'stderr',
  input: ShapeCommandOutputInput,
  path: string | null,
  spillError?: string,
): { text: string; truncated: boolean } {
  const limit = input.displayLimitBytes ?? DISPLAY_OUTPUT_LIMIT_BYTES;
  const value = input[stream];
  if (value.byteLength <= limit) {
    return { text: value.toString('utf8'), truncated: false };
  }

  const marker = Buffer.from(`\n${banner(stream, input, path, spillError)}\n`, 'utf8');
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
  const root = await realpath(input.workspaceRoot);
  await ensureRunOutputDir(root);
  const absolutePath = join(root, fullOutputPath);
  assertInsideWorkspace(root, resolve(absolutePath));
  const handle = await open(absolutePath, 'wx');
  try {
    await handle.writeFile(spillFileBytes(input.stdout, input.stderr));
  } finally {
    await handle.close();
  }

  const stdout = shapeStream('stdout', input, fullOutputPath);
  const stderr = shapeStream('stderr', input, fullOutputPath);

  return {
    stdout: stdout.text,
    stderr: stderr.text,
    displayTruncated: stdout.truncated || stderr.truncated,
    fullOutputPath,
  };
}

export function shapeCommandOutputInMemory(
  input: ShapeCommandOutputInput,
  spillError: string,
): ShapeCommandOutputResult {
  const stdout = shapeStream('stdout', input, null, spillError);
  const stderr = shapeStream('stderr', input, null, spillError);
  return {
    stdout: stdout.text,
    stderr: stderr.text,
    displayTruncated: stdout.truncated || stderr.truncated,
  };
}
