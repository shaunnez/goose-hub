import type { RouteSignals } from './types.js';
import { SENSITIVE_PATH_PATTERN } from './types.js';

export { SENSITIVE_PATH_PATTERN };

export function hasSchemaSignal(text: string): boolean {
  return /\b(api|endpoint|payload|request|response|contract|dto|zod|schema|json schema|graphql|openapi|drizzle|migration|ddl|boundary type|type contract|interface contract|repo[-\s]?match|repo run|run-failed|event payload|state label|human intervention)\b/.test(
    text,
  );
}

export function hasDependencySignal(text: string): boolean {
  return /\b(cross[-\s]?package|server\s*(?:and|\+|\/)\s*web|web\s*(?:and|\+|\/)\s*server|runtime|provider|dependency|dependencies|package boundary|workspace package|workspace dependency|monorepo boundary|import boundary)\b/.test(
    text,
  );
}

export function hasVagueOrHighRiskSignal(text: string): boolean {
  return /\b(vague|unknown|unclear|high[-\s]?risk|critical|security|auth|authentication|authorization|session|migration|concurrency|race|state machine|data loss|permission|secret|token|credential)\b/.test(
    text,
  );
}

export function hasSensitivePathSignal(filePaths: string[]): boolean {
  return filePaths.some((p) => SENSITIVE_PATH_PATTERN.test(p));
}

export function buildRouteSignals(input: {
  workItemId: string;
  workItem: { title: string; body: string; type?: string | null };
  seedFilePaths?: string[];
  investigation?: {
    confidence: 'low' | 'medium' | 'high';
    keyFiles: Array<{ path: string }>;
    wave2Triggered?: boolean;
    contradictions?: Array<{ isBlocking?: unknown; severity?: unknown }> | unknown[];
  } | null;
}): RouteSignals {
  const text = `${input.workItem.title}\n${input.workItem.body}`.toLowerCase();
  const seedPaths = input.seedFilePaths ?? [];
  const allPaths = [...seedPaths, ...(input.investigation?.keyFiles.map((f) => f.path) ?? [])];

  const nonTestFiles = input.investigation?.keyFiles.filter(
    (f) => !/\.(test|spec)\.[jt]sx?$/.test(f.path),
  );
  const contradictions = input.investigation?.contradictions ?? [];
  const blockingContradictions = contradictions.filter((contradiction) => {
    if (contradiction == null || typeof contradiction !== 'object') return true;
    const candidate = contradiction as { isBlocking?: unknown; severity?: unknown };
    if (candidate.isBlocking === false) return false;
    if (candidate.severity === 'wording') return false;
    return true;
  });

  return {
    workItemId: input.workItemId,
    workItemType: input.workItem.type,
    seedFileCount: seedPaths.length > 0 ? seedPaths.length : null,
    hasVagueOrHighRisk: hasVagueOrHighRiskSignal(text),
    hasSensitivePath: hasSensitivePathSignal(allPaths) || SENSITIVE_PATH_PATTERN.test(text),
    hasSchemaSignal: hasSchemaSignal(text),
    hasDependencySignal: hasDependencySignal(text),
    investigationConfidence: input.investigation?.confidence ?? null,
    nonTestFileCount: nonTestFiles != null ? nonTestFiles.length : null,
    hasContradictions: contradictions.length > 0,
    hasBlockingContradictions: blockingContradictions.length > 0,
    wave2Triggered: input.investigation?.wave2Triggered ?? false,
  };
}
