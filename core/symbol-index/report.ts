import type { AgentEvent } from '../event-stream/store.js';

export interface SymbolIndexLookupReport {
  lookupCount: number;
  averageIdentifiersPerLookup: number;
  averageHintsPerLookup: number;
  staleRate: number;
  hintsByConsumerSkill: Record<
    string,
    { lookupCount: number; averageHints: number; totalHints: number }
  >;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function buildSymbolIndexLookupReport(
  events: Array<Pick<AgentEvent, 'kind' | 'payload'>>,
): SymbolIndexLookupReport {
  const lookups = events.filter((event) => event.kind === 'symbol-index.lookup');
  const consumerTotals = new Map<string, { lookupCount: number; totalHints: number }>();
  let identifierTotal = 0;
  let hintTotal = 0;
  let staleCount = 0;

  for (const event of lookups) {
    const payload = asRecord(event.payload);
    const identifierCount = asNumber(payload.identifierCount);
    const hintCount = asNumber(payload.hintCount);
    identifierTotal += identifierCount;
    hintTotal += hintCount;
    if (payload.stale === true) staleCount++;

    const consumerHintCounts = asRecord(payload.consumerHintCounts);
    if (Object.keys(consumerHintCounts).length > 0) {
      for (const [consumerSkill, count] of Object.entries(consumerHintCounts)) {
        const current = consumerTotals.get(consumerSkill) ?? { lookupCount: 0, totalHints: 0 };
        current.lookupCount++;
        current.totalHints += asNumber(count);
        consumerTotals.set(consumerSkill, current);
      }
      continue;
    }

    const consumerSkill =
      typeof payload.consumerSkill === 'string' ? payload.consumerSkill : 'unknown';
    const current = consumerTotals.get(consumerSkill) ?? { lookupCount: 0, totalHints: 0 };
    current.lookupCount++;
    current.totalHints += hintCount;
    consumerTotals.set(consumerSkill, current);
  }

  const lookupCount = lookups.length;
  const hintsByConsumerSkill = Object.fromEntries(
    [...consumerTotals.entries()].map(([consumerSkill, totals]) => [
      consumerSkill,
      {
        lookupCount: totals.lookupCount,
        averageHints: totals.lookupCount === 0 ? 0 : totals.totalHints / totals.lookupCount,
        totalHints: totals.totalHints,
      },
    ]),
  );

  return {
    lookupCount,
    averageIdentifiersPerLookup: lookupCount === 0 ? 0 : identifierTotal / lookupCount,
    averageHintsPerLookup: lookupCount === 0 ? 0 : hintTotal / lookupCount,
    staleRate: lookupCount === 0 ? 0 : staleCount / lookupCount,
    hintsByConsumerSkill,
  };
}
