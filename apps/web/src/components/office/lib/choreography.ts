// Pure event → choreography mapping module.
// No Phaser imports. Single source of truth for:
//   - The v1 event allowlist (LANE_FOR_EVENT)
//   - Intent shapes and TTL constants
//   - Event → timeline mapping (timelinesForEvent)
//
// Everything in this file is pure; the only hidden state is a monotonic
// ID counter used to give each timeline a unique id (ids are not part of
// functional correctness — they are for diagnostics only).

// Phase 5 cinematic factories (imported lazily via dynamic switch to avoid circular dep issues)
import {
  investigationWavePart1Timeline,
  investigationWavePart2Timeline,
  investigationWavePart3Timeline,
} from '../game/choreography/cinematics/investigationWave';
import {
  mergeCelebrationAmbientTimeline,
  mergeCelebrationTimeline,
} from '../game/choreography/cinematics/mergeCelebration';
import { qaFailedTimeline } from '../game/choreography/cinematics/qaFailed';
import { reviewConvergedTimeline } from '../game/choreography/cinematics/reviewConverged';
import type { ROOM_IDS } from './rooms';
import { deskSlotForRoom, roomForState } from './state-to-room';

// ─── Core types ───────────────────────────────────────────────────────────────

export type LaneId = 'critical' | 'primary' | 'ambient';

export type IntentName =
  | 'walkToRoom'
  | 'attachToDesk'
  | 'swapIndicator'
  // Phase 5 new intents:
  | 'delay'
  | 'cameraTo'
  | 'swapWallTint'
  | 'doorState'
  | 'glowRing'
  | 'particleBurst'
  | 'corridorPulse'
  | 'shelfLand'
  | 'spawnVerdictScroll'
  | 'spawnScoutEnvelope'
  | 'slotTransit'
  | 'parallel';

export type IntentTargetKind =
  | 'persona'
  | 'ticket'
  | 'room'
  | 'door'
  | 'camera'
  | 'scene'
  | 'slot'
  | 'composite';

export interface Intent {
  id: IntentName;
  target: { kind: IntentTargetKind; id: string };
  params: Record<string, unknown>;
  lane: LaneId;
  ttlMs: number;
  /** Sub-steps for 'parallel' composite intent. One level deep only. */
  subSteps?: Intent[];
}

export interface Timeline {
  id: string;
  lane: LaneId;
  /** Hero ticket id, if any (used by Phase 5 for camera follow + hero promotion). */
  ticketId: string | null;
  steps: Intent[];
  onComplete?: () => void;
  /** Invoked on TTL abort only; NOT on preemption. */
  onAbort?: () => void;
  source: 'event' | 'placement' | 'click';
  startedAt?: number;
}

export type OrchestrationEventKind =
  | 'qa.functional-failed'
  | 'gate.awaiting-human'
  | 'audit.autonomy-gate-fired'
  | 'state.transitioned'
  | 'agent.run-started'
  | 'agent.run-completed'
  | 'swarm.wave-started'
  | 'swarm.scout-completed'
  | 'swarm.wave-completed'
  | 'review.converged'
  | 'pr.merged';

export interface OrchestrationEvent {
  kind: string;
  ticketId?: string;
  personaId?: string;
  toState?: string;
  deskSlot?: number;
  projectSlug?: string;
  [key: string]: unknown;
}

export interface ChoreographyContext {
  hero: string | null;
  rooms: typeof ROOM_IDS;
  /** Floor index for the active project (0 for v1 single-project). */
  floorIndex?: number;
  /** Scene emitter — factories use it for choreo.* event emission in onComplete. */
  emitter?: { emit: (event: string, payload?: unknown) => void };
}

// ─── TTL and timing constants ─────────────────────────────────────────────────

export const TTL_WALK_MS = 5000;
export const TTL_ATTACH_MS = 1000;
export const TTL_SWAP_MS = 500;
export const INDICATOR_CLEAR_DELAY_MS = 250;

// ─── Event allowlist ──────────────────────────────────────────────────────────
// Single source of truth. No event-kind string appears anywhere else in game/.

export const LANE_FOR_EVENT: Record<OrchestrationEventKind, LaneId | null> = {
  'qa.functional-failed': 'critical',
  'gate.awaiting-human': 'critical',
  'audit.autonomy-gate-fired': 'critical', // phase 5+; phase 4 ignores
  'state.transitioned': 'primary', // demoted to ambient if non-hero
  'agent.run-started': 'primary', // demoted to ambient if non-hero
  'agent.run-completed': 'primary', // demoted to ambient if non-hero
  'swarm.wave-started': 'primary',
  'swarm.scout-completed': 'primary',
  'swarm.wave-completed': 'primary',
  'review.converged': 'primary',
  'pr.merged': 'primary',
};

// ─── ID generation (diagnostic only) ─────────────────────────────────────────

let _seq = 0;
function nextId(): string {
  return `tl-${++_seq}`;
}

function makeTimeline(lane: LaneId, ticketId: string | null, steps: Intent[]): Timeline {
  return { id: nextId(), lane, ticketId, steps, source: 'event' };
}

// ─── Main mapping function ────────────────────────────────────────────────────

export function timelinesForEvent(
  event: OrchestrationEvent,
  context: ChoreographyContext,
): Timeline[] {
  const kind = event.kind as OrchestrationEventKind;
  if (!(kind in LANE_FOR_EVENT)) return [];
  if (LANE_FOR_EVENT[kind] === null) return [];

  const floorIndex = context.floorIndex ?? 0;
  const emitter = context.emitter ?? { emit: () => {} };

  switch (kind) {
    case 'state.transitioned':
      return intentsForStateTransitioned(event, context);
    case 'agent.run-started':
      return intentsForAgentRunStarted(event, context);
    case 'agent.run-completed':
      return intentsForAgentRunCompleted(event, context);
    case 'qa.functional-failed':
      return intentsForQaFailed(event, floorIndex, emitter);
    case 'gate.awaiting-human':
      return intentsForGateAwaitingHuman(event);
    case 'swarm.wave-started':
      return intentsForSwarmWaveStarted(event, floorIndex);
    case 'swarm.scout-completed':
      return intentsForSwarmScoutCompleted(event, floorIndex);
    case 'swarm.wave-completed':
      return intentsForSwarmWaveCompleted(event, floorIndex);
    case 'review.converged':
      return intentsForReviewConverged(event, floorIndex);
    case 'pr.merged':
      return intentsForPrMerged(event, context, floorIndex, emitter);
    case 'audit.autonomy-gate-fired':
      return [];
    default:
      return [];
  }
}

// ─── Per-event helpers ────────────────────────────────────────────────────────

function isHeroEvent(event: OrchestrationEvent, context: ChoreographyContext): boolean {
  return event.ticketId != null && event.ticketId === context.hero;
}

function intentsForStateTransitioned(
  event: OrchestrationEvent,
  context: ChoreographyContext,
): Timeline[] {
  if (!event.personaId) return [];
  const destRoom = roomForState(event.toState ?? '');
  if (destRoom == null) return [];
  const isHero = isHeroEvent(event, context);
  const lane: LaneId = isHero ? 'primary' : 'ambient';
  // Derive deskSlot from ticketId's externalId component (v1 convention: ticketId = "slug:externalId")
  const externalId = event.ticketId?.split(':').at(-1) ?? '';
  const deskSlot = deskSlotForRoom(destRoom, externalId);
  return [
    makeTimeline(lane, event.ticketId ?? null, [
      {
        id: 'walkToRoom',
        target: { kind: 'persona', id: event.personaId },
        params: { destRoomId: destRoom, deskSlot },
        lane,
        ttlMs: TTL_WALK_MS,
      },
    ]),
  ];
}

function intentsForAgentRunStarted(
  event: OrchestrationEvent,
  context: ChoreographyContext,
): Timeline[] {
  if (!event.personaId) return [];
  const isHero = isHeroEvent(event, context);
  if (!isHero) {
    return [
      makeTimeline('ambient', event.ticketId ?? null, [
        {
          id: 'swapIndicator',
          target: { kind: 'persona', id: event.personaId },
          params: { glyph: 'speech' },
          lane: 'ambient',
          ttlMs: TTL_SWAP_MS,
        },
      ]),
    ];
  }
  const deskSlot = typeof event.deskSlot === 'number' ? event.deskSlot : 0;
  return [
    makeTimeline('primary', event.ticketId ?? null, [
      {
        id: 'attachToDesk',
        target: { kind: 'persona', id: event.personaId },
        params: { deskSlot },
        lane: 'primary',
        ttlMs: TTL_ATTACH_MS,
      },
      {
        id: 'swapIndicator',
        target: { kind: 'persona', id: event.personaId },
        params: { glyph: 'speech' },
        lane: 'primary',
        ttlMs: TTL_SWAP_MS,
      },
    ]),
  ];
}

function intentsForAgentRunCompleted(
  event: OrchestrationEvent,
  context: ChoreographyContext,
): Timeline[] {
  if (!event.personaId) return [];
  const isHero = isHeroEvent(event, context);
  const lane: LaneId = isHero ? 'primary' : 'ambient';
  return [
    makeTimeline(lane, event.ticketId ?? null, [
      {
        id: 'swapIndicator',
        target: { kind: 'persona', id: event.personaId },
        params: { glyph: 'check' },
        lane,
        ttlMs: TTL_SWAP_MS,
      },
      {
        id: 'swapIndicator',
        target: { kind: 'persona', id: event.personaId },
        params: { glyph: null, delayMs: INDICATOR_CLEAR_DELAY_MS },
        lane,
        ttlMs: TTL_SWAP_MS + INDICATOR_CLEAR_DELAY_MS + 100,
      },
    ]),
  ];
}

function intentsForQaFailed(
  event: OrchestrationEvent,
  floorIndex: number,
  emitter: { emit: (event: string, payload?: unknown) => void },
): Timeline[] {
  const ticketId = event.ticketId;
  if (!ticketId) return [];
  return [qaFailedTimeline(ticketId, floorIndex, emitter)];
}

function intentsForGateAwaitingHuman(event: OrchestrationEvent): Timeline[] {
  if (!event.personaId) return [];
  return [
    makeTimeline('critical', event.ticketId ?? null, [
      {
        id: 'swapIndicator',
        target: { kind: 'persona', id: event.personaId },
        params: { glyph: 'question', freeze: true },
        lane: 'critical',
        ttlMs: TTL_SWAP_MS,
      },
    ]),
  ];
}

function intentsForSwarmWaveStarted(event: OrchestrationEvent, floorIndex: number): Timeline[] {
  const ticketId = event.ticketId;
  const leadPersonaId = event.personaId;
  if (!ticketId || !leadPersonaId) return [];
  return [investigationWavePart1Timeline(ticketId, leadPersonaId, floorIndex)];
}

function intentsForSwarmScoutCompleted(event: OrchestrationEvent, floorIndex: number): Timeline[] {
  const ticketId = event.ticketId;
  if (!ticketId) return [];
  const scoutIndex = typeof event.scoutIndex === 'number' ? event.scoutIndex : 0;
  return [investigationWavePart2Timeline(ticketId, scoutIndex, floorIndex)];
}

function intentsForSwarmWaveCompleted(event: OrchestrationEvent, floorIndex: number): Timeline[] {
  const ticketId = event.ticketId ?? null;
  if (!ticketId) return [];
  return [investigationWavePart3Timeline(ticketId, floorIndex)];
}

function intentsForReviewConverged(event: OrchestrationEvent, floorIndex: number): Timeline[] {
  const ticketId = event.ticketId;
  if (!ticketId) return [];
  return [reviewConvergedTimeline(ticketId, floorIndex)];
}

function intentsForPrMerged(
  event: OrchestrationEvent,
  context: ChoreographyContext,
  floorIndex: number,
  emitter: { emit: (event: string, payload?: unknown) => void },
): Timeline[] {
  const ticketId = event.ticketId;
  if (!ticketId) return [];
  const isHero = isHeroEvent(event, context);
  if (isHero) {
    return [mergeCelebrationTimeline(ticketId, floorIndex, emitter)];
  }
  return [mergeCelebrationAmbientTimeline(ticketId, floorIndex)];
}
