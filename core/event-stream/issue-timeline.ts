import { EVENT_KINDS, type EventKind } from './kinds.js';

/**
 * Intentionally hidden from issue timelines. Keep this list code-visible so
 * manual timeline testing can review which durable events are excluded.
 *
 * Hub Chat is isolated from issue timelines: chat.* events belong to the chat
 * surface. Intervention proposer runtime events are represented by durable
 * intervention rows, so the issue timeline should not also show raw proposer
 * agent runs. Runtime events for these skills are filtered by isIssueTimelineEvent().
 */
export const INTENTIONALLY_FILTERED_ISSUE_TIMELINE_EVENT_KINDS = [
  'chat.user-message',
  'chat.agent-message',
  'chat.agent-thinking',
  'chat.tool-proposed',
  'chat.tool-approved',
  'chat.tool-rejected',
  'chat.tool-running',
  'chat.tool-completed',
  'chat.tool-failed',
  'chat.run-failed',
] as const satisfies readonly EventKind[];

const FILTERED_ISSUE_TIMELINE_EVENT_KIND_SET = new Set<string>(
  INTENTIONALLY_FILTERED_ISSUE_TIMELINE_EVENT_KINDS,
);

const ISSUE_TIMELINE_EVENT_KIND_SET = new Set<string>(
  EVENT_KINDS.filter((kind) => !FILTERED_ISSUE_TIMELINE_EVENT_KIND_SET.has(kind)),
);

export const ISSUE_TIMELINE_EVENT_KINDS = EVENT_KINDS.filter((kind) =>
  ISSUE_TIMELINE_EVENT_KIND_SET.has(kind),
) as readonly EventKind[];

type IssueTimelineCandidate = {
  kind: string;
  payload: unknown;
};

const ISSUE_TIMELINE_HIDDEN_RUNTIME_SKILLS = new Set(['hub-chat', 'intervention-proposer']);

export function isIssueTimelineEvent(event: IssueTimelineCandidate): boolean {
  if (!ISSUE_TIMELINE_EVENT_KIND_SET.has(event.kind)) return false;
  const payload = event.payload as { skill?: unknown } | null;
  return !(
    typeof payload?.skill === 'string' && ISSUE_TIMELINE_HIDDEN_RUNTIME_SKILLS.has(payload.skill)
  );
}
