/**
 * Per-step typed-timeout scaffolding (#219).
 *
 * Wraps every orchestrator lifecycle step in a promise that rejects with a
 * step-specific typed error if it exceeds its budget. Each error subclass
 * carries `_tag` for pattern-matching and `timeoutMs` for diagnostic
 * surfaces.
 *
 * Defaults (internal — not user-configurable from skill prompts):
 *
 *   WorktreeCreateTimeoutError  →  10_000  (10 s)
 *   HookExecTimeoutError        →   5_000  ( 5 s)
 *   AgentSpawnTimeoutError      →  60_000  (60 s)
 *   AgentIdleTimeoutError       →  60_000  (60 s, reset on each output line)
 *   ToolCallTimeoutError        →  30_000  (30 s, FACTORY_RULES rule 32)
 *
 * Note on subprocess cleanup: `withTimeout` rejects the wrapping promise but
 * does NOT kill spawned subprocesses. Callers that need to clean up an
 * underlying child process must do so in their own .catch() handler — the
 * existing `ClaudeCliRuntime` pattern of capturing the child handle in
 * closure and calling `.kill('SIGKILL')` on timeout is the reference
 * implementation. `withTimeout` provides the typed-error and AbortSignal
 * discipline; cleanup is the caller's responsibility.
 */

export type LifecycleStepTag =
  | 'WorktreeCreateTimeout'
  | 'HookExecTimeout'
  | 'AgentSpawnTimeout'
  | 'AgentIdleTimeout'
  | 'ToolCallTimeout';

export interface LifecycleTimeoutContext {
  [key: string]: unknown;
}

export class LifecycleTimeoutError extends Error {
  readonly _tag: LifecycleStepTag;
  readonly timeoutMs: number;
  readonly context: LifecycleTimeoutContext;

  constructor(
    tag: LifecycleStepTag,
    timeoutMs: number,
    message: string,
    context: LifecycleTimeoutContext = {},
  ) {
    super(message);
    this.name = `${tag}Error`;
    this._tag = tag;
    this.timeoutMs = timeoutMs;
    this.context = context;
  }
}

export class WorktreeCreateTimeoutError extends LifecycleTimeoutError {
  constructor(timeoutMs: number, context: LifecycleTimeoutContext = {}) {
    super(
      'WorktreeCreateTimeout',
      timeoutMs,
      `git worktree creation timed out after ${timeoutMs}ms`,
      context,
    );
  }
}

export class HookExecTimeoutError extends LifecycleTimeoutError {
  constructor(timeoutMs: number, context: LifecycleTimeoutContext = {}) {
    super(
      'HookExecTimeout',
      timeoutMs,
      `pre/post-tool-use hook execution timed out after ${timeoutMs}ms`,
      context,
    );
  }
}

export class AgentSpawnTimeoutError extends LifecycleTimeoutError {
  constructor(timeoutMs: number, context: LifecycleTimeoutContext = {}) {
    super(
      'AgentSpawnTimeout',
      timeoutMs,
      `agent subprocess spawn timed out after ${timeoutMs}ms`,
      context,
    );
  }
}

export class AgentIdleTimeoutError extends LifecycleTimeoutError {
  constructor(timeoutMs: number, context: LifecycleTimeoutContext = {}) {
    super('AgentIdleTimeout', timeoutMs, `agent produced no output for ${timeoutMs}ms`, context);
  }
}

export class ToolCallTimeoutError extends LifecycleTimeoutError {
  constructor(timeoutMs: number, context: LifecycleTimeoutContext = {}) {
    super('ToolCallTimeout', timeoutMs, `tool call timed out after ${timeoutMs}ms`, context);
  }
}

export const DEFAULT_TIMEOUTS: Record<LifecycleStepTag, number> = {
  WorktreeCreateTimeout: 10_000,
  HookExecTimeout: 5_000,
  AgentSpawnTimeout: 60_000,
  AgentIdleTimeout: 60_000,
  ToolCallTimeout: 30_000,
};

interface WithTimeoutOptions {
  timeoutMs: number;
  errorFactory: () => LifecycleTimeoutError;
  /**
   * Optional AbortSignal. When the signal aborts BEFORE the timeout fires,
   * `withTimeout` rejects with the abort reason (`signal.reason`), NOT the
   * timeout error. This preserves the cancellation cause for the caller —
   * an explicit abort always beats an opportunistic timeout.
   */
  signal?: AbortSignal;
}

/**
 * Races `promise` against `options.timeoutMs`. Returns the resolved value
 * if the promise wins; rejects with the typed error from `errorFactory`
 * if the timer wins; rejects with the abort reason if `options.signal`
 * fires first.
 */
export function withTimeout<T>(promise: Promise<T>, options: WithTimeoutOptions): Promise<T> {
  const { timeoutMs, errorFactory, signal } = options;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (handler: () => void): void => {
      if (settled) return;
      settled = true;
      handler();
    };

    const timer = setTimeout(() => {
      settle(() => reject(errorFactory()));
    }, timeoutMs);

    const onAbort = (): void => {
      settle(() => {
        clearTimeout(timer);
        reject(signal?.reason ?? new Error('Aborted'));
      });
    };

    if (signal != null) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('Aborted'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    promise
      .then((value) => {
        settle(() => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          resolve(value);
        });
      })
      .catch((err: unknown) => {
        settle(() => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          reject(err);
        });
      });
  });
}
