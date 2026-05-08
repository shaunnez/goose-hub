import { ClaudeCliRuntime } from './claude-cli.js';
import { CodexCliRuntime } from './codex-cli.js';
import type { AgentRuntime } from './interface.js';
import { type ModelProvider, providerOf } from './models.js';

export type ConfigRuntime = 'claude-cli' | 'codex-cli' | 'auto';

export interface SelectRuntimeInput {
  /** `agentConfig.runtime` from project config. */
  configRuntime: ConfigRuntime;
  /** Resolved concrete model ID, when known. The dispatcher reads its provider when `configRuntime === 'auto'`. */
  model?: string;
  /** `SkillConfig.provider` hint, used as a tiebreaker when `model` is absent. */
  skillProvider?: ModelProvider;
}

/**
 * Picks the agent runtime for a given project + spec hint. Pure factory —
 * no I/O, no side effects. Callers wrap the returned runtime with `withFallback`
 * etc. as they would `new ClaudeCliRuntime()`.
 *
 * Resolution:
 *   1. configRuntime === 'claude-cli'  → ClaudeCliRuntime
 *   2. configRuntime === 'codex-cli'   → CodexCliRuntime
 *   3. configRuntime === 'auto':
 *        a. provider derived from `model` (if present and known)
 *        b. else `skillProvider` (if present)
 *        c. else 'claude' (safe default — matches today's hard-coded behaviour)
 *
 * See ADR 0036.
 */
export function selectRuntime(input: SelectRuntimeInput): AgentRuntime {
  if (input.configRuntime === 'claude-cli') {
    return new ClaudeCliRuntime();
  }
  if (input.configRuntime === 'codex-cli') {
    return new CodexCliRuntime();
  }
  // 'auto'
  let provider: ModelProvider = 'claude';
  if (input.model != null) {
    try {
      provider = providerOf(input.model);
    } catch {
      // Unknown model ID — fall through to the next signal rather than crashing
      // the dispatcher. The actual spawn will surface the error if the model is
      // unsupported by the chosen runtime.
      if (input.skillProvider != null) provider = input.skillProvider;
    }
  } else if (input.skillProvider != null) {
    provider = input.skillProvider;
  }
  return provider === 'codex' ? new CodexCliRuntime() : new ClaudeCliRuntime();
}
