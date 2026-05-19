import { type AgentEvent, eventStore } from '../event-stream/store.js';

const DRIFT_EVENT_KINDS = new Set([
  'agent.output-repaired',
  'agent.output-fact-mismatch',
  'agent.contract-gate-blocked',
]);

type CompactPathList = {
  count?: number;
  paths?: string[];
};

type DriftField = {
  field?: string;
  rawValue?: string;
  normalizedValue?: string;
  from?: string;
  to?: string;
};

type DriftPayload = {
  skill?: string;
  gate?: string;
  fields?: DriftField[];
  mismatches?: {
    observedNotDeclared?: CompactPathList;
    declaredNotObserved?: CompactPathList;
  };
};

export type PathDriftBucket = {
  skill: string;
  field: string;
  repaired: number;
  mismatches: number;
  blocked: number;
};

export type PathDriftReport = {
  projectId?: string;
  scannedEvents: number;
  driftEvents: number;
  latestEventId?: number;
  buckets: PathDriftBucket[];
  trend: {
    firstHalfDriftEvents: number;
    secondHalfDriftEvents: number;
    direction: 'decreasing' | 'flat' | 'increasing';
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function compactCount(list: CompactPathList | undefined): number {
  if (typeof list?.count === 'number') return list.count;
  return list?.paths?.length ?? 0;
}

function payload(event: AgentEvent): DriftPayload {
  return isRecord(event.payload) ? (event.payload as DriftPayload) : {};
}

function fieldNames(payload: DriftPayload): string[] {
  const fields =
    payload.fields?.flatMap((field) => (field.field != null ? [field.field] : [])) ?? [];
  const mismatchNames: string[] = [];
  if (compactCount(payload.mismatches?.observedNotDeclared) > 0) {
    mismatchNames.push('mismatches.observedNotDeclared');
  }
  if (compactCount(payload.mismatches?.declaredNotObserved) > 0) {
    mismatchNames.push('mismatches.declaredNotObserved');
  }
  return fields.length > 0 || mismatchNames.length > 0
    ? Array.from(new Set([...fields, ...mismatchNames])).sort()
    : ['(unknown)'];
}

function bucketKey(skill: string, field: string): string {
  return `${skill}\0${field}`;
}

export function buildPathDriftReport(events: AgentEvent[], projectId?: string): PathDriftReport {
  const driftEvents = events
    .filter((event) => DRIFT_EVENT_KINDS.has(event.kind))
    .sort((a, b) => a.id - b.id);
  const buckets = new Map<string, PathDriftBucket>();

  for (const event of driftEvents) {
    const p = payload(event);
    const skill = p.skill ?? 'unknown';
    for (const field of fieldNames(p)) {
      const key = bucketKey(skill, field);
      const bucket =
        buckets.get(key) ??
        ({
          skill,
          field,
          repaired: 0,
          mismatches: 0,
          blocked: 0,
        } satisfies PathDriftBucket);
      if (event.kind === 'agent.output-repaired') bucket.repaired += 1;
      if (event.kind === 'agent.output-fact-mismatch') bucket.mismatches += 1;
      if (event.kind === 'agent.contract-gate-blocked') bucket.blocked += 1;
      buckets.set(key, bucket);
    }
  }

  const midpoint = Math.ceil(driftEvents.length / 2);
  const firstHalfDriftEvents = driftEvents.slice(0, midpoint).length;
  const secondHalfDriftEvents = driftEvents.slice(midpoint).length;
  const direction =
    secondHalfDriftEvents < firstHalfDriftEvents
      ? 'decreasing'
      : secondHalfDriftEvents > firstHalfDriftEvents
        ? 'increasing'
        : 'flat';

  return {
    ...(projectId != null ? { projectId } : {}),
    scannedEvents: events.length,
    driftEvents: driftEvents.length,
    ...(driftEvents.at(-1)?.id != null ? { latestEventId: driftEvents.at(-1)?.id } : {}),
    buckets: Array.from(buckets.values()).sort(
      (a, b) =>
        b.repaired + b.mismatches + b.blocked - (a.repaired + a.mismatches + a.blocked) ||
        a.skill.localeCompare(b.skill) ||
        a.field.localeCompare(b.field),
    ),
    trend: {
      firstHalfDriftEvents,
      secondHalfDriftEvents,
      direction,
    },
  };
}

export function loadPathDriftReport(input: {
  projectId?: string;
  limit?: number;
}): PathDriftReport {
  const events = eventStore.replay({
    ...(input.projectId != null ? { projectId: input.projectId } : {}),
    order: 'desc',
    limit: input.limit ?? 500,
  });
  return buildPathDriftReport(events.reverse(), input.projectId);
}

export function formatPathDriftReport(report: PathDriftReport): string {
  const lines = [
    `path drift report${report.projectId != null ? `: ${report.projectId}` : ''}`,
    `scannedEvents: ${report.scannedEvents}`,
    `driftEvents: ${report.driftEvents}`,
    `trend: ${report.trend.direction} (${report.trend.firstHalfDriftEvents} -> ${report.trend.secondHalfDriftEvents})`,
  ];

  if (report.latestEventId != null) lines.push(`latestEventId: ${report.latestEventId}`);
  if (report.buckets.length === 0) {
    lines.push('buckets: (none)');
    return `${lines.join('\n')}\n`;
  }

  lines.push('buckets:');
  for (const bucket of report.buckets) {
    lines.push(
      `- ${bucket.skill} ${bucket.field}: repaired=${bucket.repaired} mismatches=${bucket.mismatches} blocked=${bucket.blocked}`,
    );
  }
  return `${lines.join('\n')}\n`;
}
