import type { AgentEventDto } from '@/lib/types';
import { GRILL_REPLY_MARKER } from '../grill-comments';
import { getPayloadStr } from './format';

const CODEX_STDIN_BANNER = 'Reading additional input from stdin...';

type AgentLogPayload = {
  line?: string;
  metric?: string;
  stream?: string;
  text?: string;
};

function stripCodexStdinBanner(value: string): string {
  return value
    .split(/\r?\n/)
    .filter((line) => line !== CODEX_STDIN_BANNER)
    .join('\n')
    .trim();
}

export function normalizeAgentLogEvent(event: AgentEventDto): AgentEventDto | null {
  if (event.kind !== 'agent.log') return event;

  const payload = event.payload as AgentLogPayload | null;
  if (payload?.stream === 'telemetry' && payload.metric === 'prompt_context_size') return null;
  if (payload?.stream !== 'stderr') return event;

  const nextPayload = { ...payload };
  let changed = false;

  if (typeof payload.text === 'string') {
    nextPayload.text = stripCodexStdinBanner(payload.text);
    changed = changed || nextPayload.text !== payload.text;
  }
  if (typeof payload.line === 'string') {
    nextPayload.line = stripCodexStdinBanner(payload.line);
    changed = changed || nextPayload.line !== payload.line;
  }

  if (nextPayload.text === '' && nextPayload.line === '') return null;
  if (nextPayload.text === '' && nextPayload.line == null) return null;
  if (nextPayload.line === '' && nextPayload.text == null) return null;

  return changed ? { ...event, payload: nextPayload } : event;
}

export function getAgentLogDisplayText(event: AgentEventDto): string {
  const normalized = normalizeAgentLogEvent(event) ?? event;
  const payload = normalized.payload as AgentLogPayload | null;
  if (payload?.line != null && (payload.line !== '' || payload.text == null)) return payload.line;
  if (payload?.text != null) return payload.text;
  return getPayloadStr(normalized.payload);
}

export function isCodexTransportWarningLog(event: AgentEventDto): boolean {
  if (event.kind !== 'agent.log') return false;
  const payload = event.payload as AgentLogPayload | null;
  if (payload?.stream !== 'stderr') return false;

  const detail = JSON.stringify(event.payload ?? {});
  const lowerDetail = detail.toLowerCase();
  return (
    lowerDetail.includes('responses_websocket') &&
    lowerDetail.includes('failed to connect to websocket') &&
    lowerDetail.includes('503 service unavailable')
  );
}

export function isGrillReplyManualAction(event: AgentEventDto): boolean {
  if (event.kind !== 'manual.action') return false;
  const payload = event.payload as { preview?: unknown } | null;
  return typeof payload?.preview === 'string' && payload.preview.startsWith(GRILL_REPLY_MARKER);
}
