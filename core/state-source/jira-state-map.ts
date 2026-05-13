import { logger } from '../logger.js';
import type { StateName } from '../state-machine/states.js';

/**
 * Default mapping from Jira workflow status strings to factory:* state
 * labels. Keys are case-sensitive Jira status names (as returned by the
 * Jira API). Per-project overrides may augment or replace any entry.
 *
 * The mapping is intentionally minimal — Jira deployments vary widely.
 * Projects supply overrides via `JiraSourceConfig.statusMap` when their
 * workflow uses different status names.
 */
export const DEFAULT_JIRA_STATE_MAP: Record<string, StateName> = {
  'To Do': 'factory:accepted',
  Open: 'factory:accepted',
  Backlog: 'factory:accepted',
  'In Progress': 'factory:in-progress',
  'In Review': 'factory:needs-review',
  'Code Review': 'factory:needs-review',
  Done: 'factory:done',
  Closed: 'factory:done',
  Resolved: 'factory:done',
  Blocked: 'factory:needs-human',
};

/**
 * Resolve a Jira status string to the corresponding factory:* state.
 * Unmapped statuses log a warning and fall back to `factory:accepted` so
 * the orchestrator can keep processing without crashing.
 */
export function jiraStatusToState(status: string, overrides?: Record<string, string>): StateName {
  const map: Record<string, StateName> = {
    ...DEFAULT_JIRA_STATE_MAP,
    ...((overrides ?? {}) as Record<string, StateName>),
  };
  const mapped = map[status];
  if (mapped == null) {
    logger.warn('unmapped jira status — defaulting to factory:accepted', { status });
    return 'factory:accepted';
  }
  return mapped;
}

/**
 * Reverse-map factory state → Jira status string. Used when transitioning
 * a Jira issue: the orchestrator knows the factory state it wants, this
 * helper returns the Jira status name to ask Jira to transition to.
 *
 * Returns `null` if no Jira status maps to the requested state under the
 * resolved map. Callers should treat this as an unsupported transition
 * and log/skip rather than crash.
 */
export function factoryStateToJiraStatus(
  state: StateName,
  overrides?: Record<string, string>,
): string | null {
  const map: Record<string, StateName> = {
    ...DEFAULT_JIRA_STATE_MAP,
    ...((overrides ?? {}) as Record<string, StateName>),
  };
  for (const [jiraStatus, mappedState] of Object.entries(map)) {
    if (mappedState === state) return jiraStatus;
  }
  return null;
}
