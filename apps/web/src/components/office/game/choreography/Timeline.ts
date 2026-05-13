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
import type { TicketLayer } from '../layers/TicketLayer';

// Re-export types from the pure lib so callers can import from one place.
export type {
  Intent,
  IntentName,
  LaneId,
  OrchestrationEvent,
  Timeline,
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
