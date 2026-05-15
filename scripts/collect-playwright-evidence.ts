#!/usr/bin/env tsx

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type EvidencePhase = 'before' | 'after';
export type EvidenceClassification = 'reproduced' | 'setup_failed' | 'passed' | 'validation_failed';

export interface CollectorArgs {
  issue: number;
  slug: string;
  resultsPath: string;
  evidenceDir: string;
  phase: EvidencePhase;
  runFfmpeg: boolean;
}

export interface PlaywrightEvidence {
  issue: number;
  slug: string;
  phase: EvidencePhase;
  classification: EvidenceClassification;
  reproduced: boolean;
  passed: boolean;
  status: string | null;
  errors: string[];
  stdout: string[];
  screenshots: string[];
  videoPath: string | null;
  gifPath: string | null;
  ffmpegError: string | null;
  notes: string;
}

interface PlaywrightResult {
  status?: unknown;
  errors?: unknown;
  error?: unknown;
  stdout?: unknown;
  attachments?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  const obj = asRecord(value);
  if (obj == null) return null;
  if (typeof obj.message === 'string') return obj.message;
  if (typeof obj.value === 'string') return obj.value;
  if (typeof obj.text === 'string') return obj.text;
  return JSON.stringify(value);
}

export function extractFirstJsonValue(text: string): unknown {
  const start = text.search(/[\[{]/);
  if (start < 0) throw new Error('No JSON object or array found in Playwright results');

  const opener = text[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === opener) {
      depth += 1;
    } else if (char === closer) {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(text.slice(start, i + 1));
      }
    }
  }

  throw new Error('Incomplete JSON in Playwright results');
}

function collectResults(value: unknown, out: PlaywrightResult[] = []): PlaywrightResult[] {
  const obj = asRecord(value);
  if (obj != null) {
    if (Array.isArray(obj.results)) {
      for (const result of obj.results) {
        const record = asRecord(result);
        if (record != null && ('status' in record || 'errors' in record || 'attachments' in record)) {
          out.push(record);
        }
        collectResults(result, out);
      }
    }
    for (const child of Object.values(obj)) collectResults(child, out);
  } else if (Array.isArray(value)) {
    for (const child of value) collectResults(child, out);
  }
  return out;
}

function collectTopLevelErrors(value: unknown): string[] {
  const obj = asRecord(value);
  if (obj == null) return [];
  const errors = Array.isArray(obj.errors) ? obj.errors : [];
  return errors.map(textOf).filter((entry): entry is string => entry != null);
}

function resultErrors(result: PlaywrightResult): string[] {
  const errors = Array.isArray(result.errors) ? result.errors : [];
  const fromErrors = errors.map(textOf).filter((entry): entry is string => entry != null);
  const singleError = textOf(result.error);
  return singleError == null ? fromErrors : [...fromErrors, singleError];
}

function resultStdout(result: PlaywrightResult): string[] {
  const stdout = Array.isArray(result.stdout) ? result.stdout : [];
  return stdout.map(textOf).filter((entry): entry is string => entry != null);
}

function findVideoAttachment(results: PlaywrightResult[]): string | null {
  for (const result of results) {
    const attachments = Array.isArray(result.attachments) ? result.attachments : [];
    for (const attachment of attachments) {
      const obj = asRecord(attachment);
      if (obj == null) continue;
      const name = typeof obj.name === 'string' ? obj.name : '';
      const contentType = typeof obj.contentType === 'string' ? obj.contentType : '';
      const attachmentPath = typeof obj.path === 'string' ? obj.path : null;
      if (attachmentPath != null && (name === 'video' || contentType.includes('video'))) {
        return attachmentPath;
      }
    }
  }
  return null;
}

function findScreenshots(evidenceDir: string): string[] {
  if (!fs.existsSync(evidenceDir)) return [];
  return fs
    .readdirSync(evidenceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(png|jpe?g)$/i.test(entry.name))
    .map((entry) => path.join(evidenceDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function isAssertionFailure(message: string): boolean {
  return (
    /\bexpect(?:\.soft)?\(/i.test(message) ||
    /\bexpect(received|ed)?\b/i.test(message) ||
    /toBeVisible|toHaveText|toContainText|toHaveURL|toBeTruthy|toEqual/i.test(message) ||
    /REPRO_EXPECTED_BUG/i.test(message)
  );
}

function isSetupFailure(message: string): boolean {
  return (
    /webServer|server.*failed|ECONNREFUSED|ERR_CONNECTION|net::ERR|Cannot find module/i.test(message) ||
    /Timeout .*waiting for|waiting for selector|locator\(|page\.goto|Navigation|Target closed/i.test(
      message,
    )
  );
}

export function classifyPlaywrightResult(params: {
  phase: EvidencePhase;
  status: string | null;
  errors: string[];
}): EvidenceClassification {
  if (params.status === 'passed' || params.status === 'expected') return 'passed';

  const joinedErrors = params.errors.join('\n');
  if (joinedErrors.length === 0 && params.status == null) return 'setup_failed';
  if (isSetupFailure(joinedErrors) && !isAssertionFailure(joinedErrors)) return 'setup_failed';
  if (isAssertionFailure(joinedErrors)) {
    return params.phase === 'before' ? 'reproduced' : 'validation_failed';
  }
  return 'setup_failed';
}

function convertVideoToGif(videoPath: string | null, evidenceDir: string, runFfmpeg: boolean) {
  if (!runFfmpeg || videoPath == null) return { gifPath: null, ffmpegError: null };
  const gifPath = path.join(evidenceDir, 'walkthrough.gif');
  try {
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-i',
        videoPath,
        '-vf',
        'fps=8,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
        gifPath,
      ],
      { stdio: 'pipe' },
    );
    return { gifPath, ffmpegError: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { gifPath: null, ffmpegError: message };
  }
}

export function collectPlaywrightEvidence(args: CollectorArgs): PlaywrightEvidence {
  const raw = fs.readFileSync(args.resultsPath, 'utf8');
  const parsed = extractFirstJsonValue(raw);
  const results = collectResults(parsed);
  const errors = [...collectTopLevelErrors(parsed), ...results.flatMap(resultErrors)];
  const stdout = results.flatMap(resultStdout);
  const status =
    results.find((result) => typeof result.status === 'string')?.status?.toString() ?? null;
  const classification = classifyPlaywrightResult({ phase: args.phase, status, errors });
  const screenshots = findScreenshots(args.evidenceDir);
  const videoPath = findVideoAttachment(results);
  const { gifPath, ffmpegError } = convertVideoToGif(videoPath, args.evidenceDir, args.runFfmpeg);

  return {
    issue: args.issue,
    slug: args.slug,
    phase: args.phase,
    classification,
    reproduced: classification === 'reproduced',
    passed: classification === 'passed',
    status,
    errors,
    stdout,
    screenshots,
    videoPath,
    gifPath,
    ffmpegError,
    notes: errors[0] ?? (classification === 'passed' ? 'Playwright passed' : 'No error detail found'),
  };
}

export function parseArgs(argv: string[]): CollectorArgs {
  const values = new Map<string, string>();
  let runFfmpeg = true;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-ffmpeg') {
      runFfmpeg = false;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const value = argv[i + 1];
    if (value == null || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    values.set(arg.slice(2), value);
    i += 1;
  }

  const issue = Number(values.get('issue'));
  const slug = values.get('slug');
  const resultsPath = values.get('results');
  const evidenceDir = values.get('evidence-dir');
  const phase = values.get('phase') ?? 'before';

  if (!Number.isInteger(issue)) throw new Error('--issue must be an integer');
  if (!slug) throw new Error('--slug is required');
  if (!resultsPath) throw new Error('--results is required');
  if (!evidenceDir) throw new Error('--evidence-dir is required');
  if (phase !== 'before' && phase !== 'after') throw new Error('--phase must be before or after');

  return { issue, slug, resultsPath, evidenceDir, phase, runFfmpeg };
}

function main(): void {
  const evidence = collectPlaywrightEvidence(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
