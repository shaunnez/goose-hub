import type { AgentEvent } from '@goose-hub/core/event-stream/store.js';

type VerificationEvent = Pick<AgentEvent, 'kind' | 'payload' | 'runId'>;

export type WrittenTestVerificationFailures = {
  unitTestPaths: string[];
  playwrightSpecPaths: string[];
};

export function toolCallName(event: VerificationEvent): string | null {
  if (event.kind !== 'agent.tool-call') return null;
  const payload = event.payload as { tool_name?: unknown; toolName?: unknown };
  const name = payload.tool_name ?? payload.toolName;
  return typeof name === 'string' ? name : null;
}

export function toolCallInput(event: VerificationEvent): Record<string, unknown> {
  const payload = event.payload as {
    tool_input?: unknown;
    toolInput?: unknown;
  };
  const input = payload.tool_input ?? payload.toolInput;
  return input != null && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

export function toolCallStatus(event: VerificationEvent): string | null {
  if (event.kind !== 'agent.tool-call') return null;
  const payload = event.payload as { status?: unknown };
  return typeof payload.status === 'string' ? payload.status : null;
}

export function toolCallPaths(event: VerificationEvent): string[] {
  const payload = event.payload as {
    raw_path?: unknown;
    canonical_path?: unknown;
  };
  const input = toolCallInput(event);
  const paths = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.length > 0) paths.add(value);
  };
  const addArray = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const entry of value) add(entry);
  };
  add(payload.raw_path);
  const canonical = payload.canonical_path;
  if (canonical != null && typeof canonical === 'object' && !Array.isArray(canonical)) {
    add((canonical as { path?: unknown }).path);
  }
  add(input.path);
  add(input.spec);
  addArray(input.paths);
  addArray(input.rawPaths);
  return [...paths];
}

export function normalizePathForCompare(path: string): string {
  return path.replace(/^\.\//, '').replace(/\/+$/, '');
}

export function pathsMatch(left: string, right: string): boolean {
  const a = normalizePathForCompare(left);
  const b = normalizePathForCompare(right);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

export function pathsExactlyMatch(left: string, right: string): boolean {
  return normalizePathForCompare(left) === normalizePathForCompare(right);
}

export function pathCoversPath(candidate: string, target: string): boolean {
  const a = normalizePathForCompare(candidate);
  const b = normalizePathForCompare(target);
  return a === b || b.startsWith(`${a}/`);
}

export function isPlaywrightSpecPath(path: string): boolean {
  const normalized = normalizePathForCompare(path);
  return /^apps\/web\/e2e\/.+\.spec\.tsx?$/.test(normalized);
}

export function isEditToolCall(event: VerificationEvent): boolean {
  const name = toolCallName(event)?.toLowerCase();
  if (name == null) return false;
  if (name.includes('edit') || name.includes('write')) return true;
  const command = toolCallInput(event).command;
  return (
    typeof command === 'string' &&
    (/\bapply_patch\b/.test(command) ||
      /\bsed\s+-[^;&|]*i/.test(command) ||
      /\btee\s+(?:-[a-zA-Z]+\s+)*(?!\/dev\/null\b)\S+/.test(command) ||
      /(^|[^<])>{1,2}\s*\S+/.test(command))
  );
}

export function isE2ePackageScript(event: VerificationEvent): boolean {
  if (toolCallName(event) !== 'run_package_script') return false;
  const script = toolCallInput(event).script;
  return typeof script === 'string' && /\be2e\b/i.test(script);
}

export function isE2ePackageScriptCoveringPath(event: VerificationEvent, path: string): boolean {
  if (!isE2ePackageScript(event)) return false;
  const script = toolCallInput(event).script;
  if (typeof script === 'string' && script.includes(path)) return true;
  const paths = toolCallPaths(event);
  return paths.some((candidate) => pathsExactlyMatch(candidate, path));
}

export function latestRunTestsStatusForPath(
  events: VerificationEvent[],
  path: string,
): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (toolCallName(event) !== 'run_tests') continue;
    const paths = toolCallPaths(event);
    if (paths.length > 0 && !paths.some((candidate) => pathsMatch(candidate, path))) continue;
    return toolCallStatus(event);
  }
  return null;
}

export function latestCoveringRunTestsStatusForPathAfterLastEdit(
  events: VerificationEvent[],
  path: string,
): string | null {
  let lastEditIndex = -1;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (toolCallStatus(event) !== 'ok') continue;
    if (!isEditToolCall(event)) continue;
    const editedPaths = toolCallPaths(event);
    if (editedPaths.length === 0 || editedPaths.some((candidate) => pathsMatch(candidate, path))) {
      lastEditIndex = i;
    }
  }

  for (let i = events.length - 1; i > lastEditIndex; i--) {
    const event = events[i];
    if (toolCallName(event) !== 'run_tests') continue;
    const paths = toolCallPaths(event);
    if (paths.length === 0 || paths.some((candidate) => pathCoversPath(candidate, path))) {
      return toolCallStatus(event);
    }
  }
  return null;
}

export function latestPlaywrightVerificationStatusForPathAfterLastEdit(
  events: VerificationEvent[],
  path: string,
): string | null {
  let lastEditIndex = -1;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (toolCallStatus(event) !== 'ok') continue;
    if (!isEditToolCall(event)) continue;
    const editedPaths = toolCallPaths(event);
    if (editedPaths.length === 0 || editedPaths.some((candidate) => pathsMatch(candidate, path))) {
      lastEditIndex = i;
    }
  }

  for (let i = events.length - 1; i > lastEditIndex; i--) {
    const event = events[i];
    const name = toolCallName(event);
    if (name === 'run_playwright_spec') {
      const paths = toolCallPaths(event);
      if (paths.some((candidate) => pathsExactlyMatch(candidate, path))) {
        return toolCallStatus(event);
      }
      continue;
    }
    if (isE2ePackageScriptCoveringPath(event, path)) return toolCallStatus(event);
  }
  return null;
}

export function writtenTestVerificationStatusAfterLastEdit(
  events: VerificationEvent[],
  path: string,
): string | null {
  if (isPlaywrightSpecPath(path)) {
    return latestPlaywrightVerificationStatusForPathAfterLastEdit(events, path);
  }
  return latestCoveringRunTestsStatusForPathAfterLastEdit(events, path);
}

export function collectWrittenTestVerificationFailures(
  events: VerificationEvent[],
  writtenTestPaths: string[],
): WrittenTestVerificationFailures {
  const failedWrittenTestPaths = [...new Set(writtenTestPaths)].filter(
    (path) => writtenTestVerificationStatusAfterLastEdit(events, path) !== 'ok',
  );
  return {
    unitTestPaths: failedWrittenTestPaths.filter((path) => !isPlaywrightSpecPath(path)),
    playwrightSpecPaths: failedWrittenTestPaths.filter(isPlaywrightSpecPath),
  };
}

export function collectReportedRunTestFailures(input: {
  events: VerificationEvent[];
  reportedRunPaths: string[];
  writtenTestPaths?: string[];
}): string[] {
  const writtenTestPaths = new Set(input.writtenTestPaths ?? []);
  return [...new Set(input.reportedRunPaths)].filter((path) =>
    isPlaywrightSpecPath(path)
      ? latestPlaywrightVerificationStatusForPathAfterLastEdit(input.events, path) !== 'ok'
      : writtenTestPaths.has(path)
        ? writtenTestVerificationStatusAfterLastEdit(input.events, path) !== 'ok'
        : latestCoveringRunTestsStatusForPathAfterLastEdit(input.events, path) !== 'ok',
  );
}

export function hasSuccessfulVerificationToolCall(events: VerificationEvent[]): boolean {
  return events.some((event) => {
    if (event.kind !== 'agent.tool-call') return false;
    if (toolCallStatus(event) !== 'ok') return false;
    const name = toolCallName(event);
    if (name === 'run_playwright_spec' || isE2ePackageScript(event)) return true;
    return name === 'run_tests' || name === 'run_lint' || name === 'run_typecheck';
  });
}

export function formatWrittenTestVerificationFailure(
  failures: WrittenTestVerificationFailures,
): string | null {
  const reasonParts: string[] = [];
  if (failures.unitTestPaths.length > 0) {
    reasonParts.push(
      `written test files need exact-file run_tests success after their last edit: ${failures.unitTestPaths.join(', ')}`,
    );
  }
  if (failures.playwrightSpecPaths.length > 0) {
    reasonParts.push(
      `written Playwright specs need run_playwright_spec or an e2e package-script success after their last edit: ${failures.playwrightSpecPaths.join(', ')}`,
    );
  }
  return reasonParts.length > 0 ? reasonParts.join('; ') : null;
}
