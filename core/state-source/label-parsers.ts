import { STATES, type StateName } from '../state-machine/states.js';
import type { Role } from '../types.js';
import {
  DEFAULT_EXEC,
  DEFAULT_MODE,
  DEFAULT_PRIORITY,
  DEFAULT_SCHEDULE,
  DEFAULT_WORK_ITEM_TYPE,
  type ExecMode,
  type Mode,
  type Priority,
  type Schedule,
  type WorkItemType,
} from './interface.js';

/**
 * Group prefixes for the GitHub-labels state machine. Use this constant
 * instead of repeating bare strings like `'priority:'` across the codebase —
 * adding a new group means changing one place.
 */
export const LABEL_GROUPS = {
  STATE: 'factory:',
  TYPE: 'type:',
  PRIORITY: 'priority:',
  MODE: 'mode:',
  SCHEDULE: 'schedule:',
  EXEC: 'exec:',
} as const;

const STATE_SET: ReadonlySet<string> = new Set(STATES);
const PRIORITY_SET: ReadonlySet<string> = new Set<Priority>(['critical', 'high', 'medium', 'low']);
const MODE_SET: ReadonlySet<string> = new Set<Mode>(['interactive', 'supervised', 'autonomous']);
const SCHEDULE_SET: ReadonlySet<string> = new Set<Schedule>([
  'current',
  'next',
  'later',
  'blocked-by',
]);
const EXEC_SET: ReadonlySet<string> = new Set<ExecMode>(['serial', 'parallel']);
const TYPE_SET: ReadonlySet<string> = new Set<WorkItemType>([
  'feature',
  'bug',
  'chore',
  'research',
]);
const ROLE_SET: ReadonlySet<string> = new Set<Role>([
  'triager',
  'griller',
  'prd-writer',
  'decomposer',
  'investigator',
  'developer',
  'qa',
  'reviewer',
  'dev-reviewer',
  'retrospector',
  'researcher',
  'auditor',
]);

/**
 * Parse a raw `factory:*` label name to a typed StateName, returning null
 * when the label is absent or unrecognised. Strict version — used at ingress
 * to surface unknown states explicitly. Per ADR 0039: validate at the seam,
 * trust the type downstream.
 */
export function parseState(raw: string | undefined): StateName | null {
  if (raw == null) return null;
  return STATE_SET.has(raw) ? (raw as StateName) : null;
}

/** Parse the bare value part of a `priority:<value>` label. */
export function parsePriority(raw: string | undefined): Priority {
  if (raw != null && PRIORITY_SET.has(raw)) return raw as Priority;
  return DEFAULT_PRIORITY;
}

/** Parse the bare value part of a `mode:<value>` label. */
export function parseMode(raw: string | undefined): Mode {
  if (raw != null && MODE_SET.has(raw)) return raw as Mode;
  return DEFAULT_MODE;
}

/** Parse the bare value part of a `schedule:<value>` label. */
export function parseSchedule(raw: string | undefined): Schedule {
  if (raw != null && SCHEDULE_SET.has(raw)) return raw as Schedule;
  return DEFAULT_SCHEDULE;
}

/** Parse the bare value part of an `exec:<value>` label. */
export function parseExec(raw: string | undefined): ExecMode {
  if (raw != null && EXEC_SET.has(raw)) return raw as ExecMode;
  return DEFAULT_EXEC;
}

/** Parse the bare value part of a `type:<value>` label. */
export function parseWorkItemType(raw: string | undefined): WorkItemType {
  if (raw != null && TYPE_SET.has(raw)) return raw as WorkItemType;
  return DEFAULT_WORK_ITEM_TYPE;
}

/**
 * Parse a free-string role identifier, returning null when it doesn't match
 * a known Role. Callers decide how to handle null (skip, default, throw).
 */
export function parseRole(raw: string | undefined): Role | null {
  if (raw == null) return null;
  return ROLE_SET.has(raw) ? (raw as Role) : null;
}

/**
 * Strip a known group prefix from a raw label name, returning the bare value
 * or undefined when no labels in the array carry that prefix. Centralises the
 * `labels.find(...).slice(prefix.length)` pattern used throughout the
 * github-labels mapper.
 */
export function extractLabelValue(
  labelNames: readonly string[],
  prefix: string,
): string | undefined {
  const match = labelNames.find((n) => n.startsWith(prefix));
  return match?.slice(prefix.length);
}
