import path from 'node:path';
import type { AgentEvent, AppendEventInput } from '../event-stream/store.js';
import type { ShapedSymbolHint, SymbolImpact, SymbolKeyFileHint } from './lookup.js';

export type SymbolIndexHintsUsedConsumerSkill =
  | 'scout-code-path'
  | 'scout-dependency'
  | 'scout-schema'
  | 'scout-test-inventory'
  | 'implement'
  | 'dev-review';

export type SymbolIndexHintSource =
  | 'definition'
  | 'importer'
  | 'nearby-test'
  | 'key-file'
  | 'symbol-impact';

export interface OfferedSymbolIndexHint {
  name: string;
  path: string;
  source: SymbolIndexHintSource;
}

export interface SymbolIndexHintsUsedPayload {
  consumerSkill: SymbolIndexHintsUsedConsumerSkill;
  runId: string;
  parentRunId?: string;
  offeredHintCount: number;
  usedHintCount: number;
  detectionMethod: 'tool-call-path-match';
  usedHints: OfferedSymbolIndexHint[];
}

const DEFAULT_MAX_USED_HINTS = 8;

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function normalizeRepoPath(value: string, worktreePath?: string): string {
  let normalized = value.trim().replaceAll('\\', '/');
  normalized = normalized.replace(/^['"]|['"]$/g, '');
  if (worktreePath != null) {
    const root = worktreePath.replaceAll('\\', '/').replace(/\/$/, '');
    if (normalized === root) return '';
    if (normalized.startsWith(`${root}/`)) normalized = normalized.slice(root.length + 1);
  }
  normalized = normalized.replace(/^\.\//, '');
  return normalized.replace(/\/+$/, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function commandMentionsPath(command: string, hintPath: string, worktreePath?: string): boolean {
  const normalizedCommand = command.replaceAll('\\', '/');
  const normalizedHint = normalizeRepoPath(hintPath);
  const variants = [`./${normalizedHint}`, normalizedHint];
  if (worktreePath != null) {
    variants.push(`${worktreePath.replaceAll('\\', '/').replace(/\/$/, '')}/${normalizedHint}`);
  }

  return variants.some((variant) => {
    const pattern = new RegExp(
      `(^|[^A-Za-z0-9_./-])${escapeRegExp(variant)}(?=$|[^A-Za-z0-9_./-])`,
    );
    return pattern.test(normalizedCommand);
  });
}

function pathFieldMatches(value: string, hintPath: string, worktreePath?: string): boolean {
  return normalizeRepoPath(value, worktreePath) === normalizeRepoPath(hintPath);
}

function toolCallMatchesHintPath(
  event: Pick<AgentEvent, 'payload'>,
  hintPath: string,
  worktreePath?: string,
): boolean {
  const payload = asRecord(event.payload);
  const input = asRecord(
    payload.tool_input ?? payload.toolInput ?? payload.redacted_tool_input ?? payload.input,
  );

  for (const key of ['file_path', 'path']) {
    const value = input[key];
    if (typeof value === 'string' && pathFieldMatches(value, hintPath, worktreePath)) {
      return true;
    }
  }

  for (const key of ['command', 'cmd']) {
    const value = input[key];
    if (typeof value === 'string' && commandMentionsPath(value, hintPath, worktreePath)) {
      return true;
    }
  }

  return false;
}

function dedupeOfferedHints(hints: OfferedSymbolIndexHint[]): OfferedSymbolIndexHint[] {
  const out: OfferedSymbolIndexHint[] = [];
  const seen = new Set<string>();
  for (const hint of hints) {
    const normalizedPath = normalizeRepoPath(hint.path);
    if (hint.name.trim().length === 0 || normalizedPath.length === 0) continue;
    const key = `${hint.name}\0${normalizedPath}\0${hint.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...hint, path: normalizedPath });
  }
  return out;
}

export function detectSymbolIndexHintsUsed(input: {
  consumerSkill: SymbolIndexHintsUsedConsumerSkill;
  runId: string;
  parentRunId?: string;
  offeredHints: OfferedSymbolIndexHint[];
  toolEvents: Array<Pick<AgentEvent, 'payload'>>;
  worktreePath?: string;
  maxUsedHints?: number;
}): SymbolIndexHintsUsedPayload | null {
  const offeredHints = dedupeOfferedHints(input.offeredHints);
  if (offeredHints.length === 0) return null;

  const usedHints = offeredHints.filter((hint) =>
    input.toolEvents.some((event) => toolCallMatchesHintPath(event, hint.path, input.worktreePath)),
  );
  if (usedHints.length === 0) return null;

  return {
    consumerSkill: input.consumerSkill,
    runId: input.runId,
    ...(input.parentRunId != null ? { parentRunId: input.parentRunId } : {}),
    offeredHintCount: offeredHints.length,
    usedHintCount: usedHints.length,
    detectionMethod: 'tool-call-path-match',
    usedHints: usedHints.slice(0, input.maxUsedHints ?? DEFAULT_MAX_USED_HINTS),
  };
}

export function emitSymbolIndexHintsUsedEvent(input: {
  projectId: string;
  workItemId?: string | null;
  consumerSkill: SymbolIndexHintsUsedConsumerSkill;
  runId: string;
  parentRunId?: string;
  personaId?: string | null;
  offeredHints: OfferedSymbolIndexHint[];
  toolEvents: Array<Pick<AgentEvent, 'payload'>>;
  worktreePath?: string;
  appendEvent: (event: AppendEventInput) => unknown;
}): SymbolIndexHintsUsedPayload | null {
  const payload = detectSymbolIndexHintsUsed(input);
  if (payload == null) return null;

  input.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId ?? null,
    kind: 'symbol-index.hints-used',
    payload,
    runId: input.runId,
    personaId: input.personaId ?? null,
  });

  return payload;
}

export function offeredHintsFromScoutSymbolIndexHints(hints: unknown): OfferedSymbolIndexHint[] {
  if (!Array.isArray(hints)) return [];

  const offered: OfferedSymbolIndexHint[] = [];
  for (const rawHint of hints) {
    const hint = rawHint as Partial<ShapedSymbolHint>;
    if (typeof hint.name !== 'string') continue;

    if (typeof hint.definedIn === 'string') {
      offered.push({ name: hint.name, path: hint.definedIn, source: 'definition' });
    }
    for (const importer of asStringArray(hint.importers ?? hint.callers)) {
      offered.push({ name: hint.name, path: importer, source: 'importer' });
    }
    for (const nearbyTest of asStringArray(hint.nearbyTests)) {
      offered.push({ name: hint.name, path: nearbyTest, source: 'nearby-test' });
    }
  }
  return offered;
}

function symbolNameFromKeyFileReason(reason: string, filePath: string): string {
  const exported = reason.match(/^Symbol index: (.+?) is exported here$/);
  if (exported?.[1] != null) return exported[1];
  const imported = reason.match(/^Symbol index: imports (.+)$/);
  if (imported?.[1] != null) return imported[1];
  return path.posix.basename(filePath).replace(/\.[^.]+$/, '');
}

export function offeredHintsFromSymbolKeyFiles(
  keyFiles: SymbolKeyFileHint[],
): OfferedSymbolIndexHint[] {
  return keyFiles.map((keyFile) => ({
    name: symbolNameFromKeyFileReason(keyFile.reason, keyFile.path),
    path: keyFile.path,
    source: 'key-file',
  }));
}

export function offeredHintsFromSymbolImpact(impacts: SymbolImpact[]): OfferedSymbolIndexHint[] {
  return impacts.flatMap((impact) => [
    { name: impact.changedExport, path: impact.definedIn, source: 'symbol-impact' as const },
    ...impact.importers.map((importer) => ({
      name: impact.changedExport,
      path: importer,
      source: 'symbol-impact' as const,
    })),
  ]);
}
