// Sequence container for the choreography system.
// Re-exports the pure Timeline / Intent / LaneId types from lib/choreography.ts
// and defines ChoreographyCtx — the Phaser-scoped execution context that the
// player passes to each intent's run() / cancel() functions.
//
// ChoreographyCtx lives here (not in lib/) because it references PersonaLayer
// and TicketLayer which depend on Phaser. Intent modules import it via
// `import type { ChoreographyCtx } from '../Timeline'` — a type-only import
// that leaves no runtime circular dependency.
//
// Invariants:
//   - No tween creation here. Tweens are created inside layer primitives only.
//   - No fetch, postMessage, or workflow mutation here.

import type Phaser from 'phaser';
import type { PersonaLayer } from '../layers/PersonaLayer';
import type { RoomLayer } from '../layers/RoomLayer';
import type { TicketLayer } from '../layers/TicketLayer';

// Re-export types from the pure lib so callers can import from one place.
// Note: Timeline (the interface) is intentionally NOT re-exported here to avoid
// a name collision with the Timeline namespace below. Import the interface from
// '../../lib/choreography' directly.
export type {
  Intent,
  IntentName,
  LaneId,
  OrchestrationEvent,
} from '../../lib/choreography';

// ─── Execution context ────────────────────────────────────────────────────────

/**
 * Passed by ChoreographyPlayer to each intent's run() / cancel() call.
 * Provides narrow read+write access to the three layers and the scene timer.
 * Never exposed to React; never holds React state.
 */
export interface ChoreographyCtx {
  personaLayer: PersonaLayer;
  ticketLayer: TicketLayer;
  roomLayer: RoomLayer;
  scene: Phaser.Scene;
  emitter: Phaser.Events.EventEmitter;
}

// ─── Observability event payload ──────────────────────────────────────────────

export interface ChoreoEventPayload {
  lane: string;
  intentName: string;
  target: { kind: string; id: string };
  status: string;
}

// ─── Timeline.parallel composition primitive ─────────────────────────────────
// Creates a single composite "parallel" intent that the player resolves when all
// sub-steps complete (or any cancels). One level of nesting only; not a DSL.

import type { Intent, LaneId } from '../../lib/choreography';

// Merges with the Timeline interface re-exported above; adds the parallel() factory.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Timeline {
  /**
   * Returns a single composite step. The player dispatches all subSteps
   * simultaneously and resolves when the last completes (or any cancels).
   * subSteps must all share the same lane; ttlMs is the max of sub-step ttls.
   */
  export function parallel(subSteps: Intent[], lane: LaneId): Intent {
    const ttlMs = subSteps.reduce((max, s) => Math.max(max, s.ttlMs), 0);
    return {
      id: 'parallel',
      target: { kind: 'composite', id: 'parallel' },
      params: {},
      lane,
      ttlMs,
      subSteps,
    };
  }
}
