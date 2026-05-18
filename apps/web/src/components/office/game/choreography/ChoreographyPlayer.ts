// ChoreographyPlayer — lane dispatcher for the Office Mode choreography system.
//
// Responsibilities:
//   - Accept Timeline[] via applyChoreography(); coalesce within one Phaser tick.
//   - Manage three independent lane queues (critical / primary / ambient).
//   - Run each lane's active timeline step by step, honouring TTL.
//   - Handle critical-preempts-primary with resume; critical/primary-cancel-ambient.
//   - Emit choreo.intent-{started,completed,cancelled} on the scene emitter.
//   - Phase 5: ambient suppression while critical active; hero promotion from ticketId;
//     camera switching at cinematic start/end; parallel step dispatch; onAbort invocation.
//
// Invariants:
//   - No per-frame update() loop. Execution is intent-driven.
//   - No tween creation; tweens are owned by layer primitives.
//   - ≤ 300 lines.

import type { Intent, LaneId, Timeline } from '../../lib/choreography';
import type { IntentResult } from '../layers/types';
import type { ChoreoEventPayload, ChoreographyCtx } from './Timeline';
import * as attachToDeskIntent from './intents/attachToDesk';
import * as cameraToIntent from './intents/cameraTo';
import * as corridorPulseIntent from './intents/corridorPulse';
import * as delayIntent from './intents/delay';
import * as doorStateIntent from './intents/doorState';
import * as glowRingIntent from './intents/glowRing';
import * as particleBurstIntent from './intents/particleBurst';
import * as shelfLandIntent from './intents/shelfLand';
import * as slotTransitIntent from './intents/slotTransit';
import * as spawnScoutEnvelopeIntent from './intents/spawnScoutEnvelope';
import * as spawnVerdictScrollIntent from './intents/spawnVerdictScroll';
import * as swapIndicatorIntent from './intents/swapIndicator';
import * as swapWallTintIntent from './intents/swapWallTint';
import * as walkToRoomIntent from './intents/walkToRoom';

const MAX_QUEUE_DEPTH = 8;
const LANES: readonly LaneId[] = ['critical', 'primary', 'ambient'];

interface ActiveEntry {
  timeline: Timeline;
  stepIndex: number;
}

export class ChoreographyPlayer {
  private readonly ctx: ChoreographyCtx;
  private readonly queues: Record<LaneId, Timeline[]> = {
    critical: [],
    primary: [],
    ambient: [],
  };
  private readonly active: Record<LaneId, ActiveEntry | null> = {
    critical: null,
    primary: null,
    ambient: null,
  };
  private savedPrimary: { timeline: Timeline; stepIndex: number } | null = null;
  private pending: Timeline[] = [];
  private flushScheduled = false;
  /** True while a critical timeline is active; suppresses ambient start. */
  private criticalActive = false;

  constructor(ctx: ChoreographyCtx) {
    this.ctx = ctx;
  }

  applyChoreography(timelines: Timeline[]): void {
    this.pending.push(...timelines);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      this.ctx.scene.time.delayedCall(0, () => this.flush());
    }
  }

  // ─── private: flush and coalesce ────────────────────────────────────────────

  private flush(): void {
    this.flushScheduled = false;
    const batch = this.pending.splice(0);
    const coalesced = this.coalesce(batch);
    for (const t of coalesced) {
      this.dispatch(t);
    }
    this.process();
  }

  private coalesce(timelines: Timeline[]): Timeline[] {
    const latest = new Map<string, Timeline>();
    const noops: Timeline[] = [];
    for (const t of timelines) {
      const firstStep = t.steps[0];
      if (firstStep == null) {
        noops.push(t);
        continue;
      }
      const key = `${t.lane}:${firstStep.id}:${firstStep.target.kind}:${firstStep.target.id}`;
      latest.set(key, t);
    }
    return [...latest.values(), ...noops];
  }

  // ─── private: dispatch to lanes ─────────────────────────────────────────────

  private dispatch(t: Timeline): void {
    if (t.lane === 'critical') {
      this.preemptForCritical(t);
    } else if (t.lane === 'primary') {
      this.cancelAmbientForPrimary();
      this.enqueue('primary', t);
    } else {
      this.enqueue(t.lane, t);
    }
  }

  private cancelAmbientForPrimary(): void {
    if (this.active.ambient != null) {
      this.cancelStep(this.active.ambient.timeline.steps[this.active.ambient.stepIndex], 'ambient');
      this.active.ambient = null;
    }
  }

  private preemptForCritical(t: Timeline): void {
    if (this.active.primary != null) {
      const { timeline, stepIndex } = this.active.primary;
      this.savedPrimary = { timeline, stepIndex };
      this.cancelStep(timeline.steps[stepIndex], 'primary');
      this.active.primary = null;
    }
    if (this.active.ambient != null) {
      this.cancelStep(this.active.ambient.timeline.steps[this.active.ambient.stepIndex], 'ambient');
      this.active.ambient = null;
    }
    this.enqueue('critical', t);
  }

  private enqueue(lane: LaneId, t: Timeline): void {
    const q = this.queues[lane];
    if (q.length >= MAX_QUEUE_DEPTH) {
      const dropped = q.shift() as Timeline;
      const step = dropped.steps[0];
      if (step) {
        this.emit('choreo.intent-cancelled', lane, step, 'cancelled');
      }
      console.warn(`[ChoreographyPlayer] queue overflow on ${lane}; dropping ${dropped.id}`);
    }
    q.push(t);
  }

  // ─── private: process loop ───────────────────────────────────────────────────

  private process(): void {
    for (const lane of LANES) {
      if (this.active[lane] == null && this.queues[lane].length > 0) {
        // Phase 5: ambient lane does not start while critical is active.
        if (lane === 'ambient' && this.criticalActive) continue;

        const timeline = this.queues[lane].shift() as Timeline;
        timeline.startedAt ??= Date.now();
        const entry: ActiveEntry = { timeline, stepIndex: 0 };
        this.active[lane] = entry;

        // Hero promotion: primary/critical with ticketId → promote ticket.
        if ((lane === 'primary' || lane === 'critical') && timeline.ticketId != null) {
          this.ctx.ticketLayer.promote(timeline.ticketId);
          this.emitCinematicStarted(lane, timeline);
        }

        if (lane === 'critical') this.criticalActive = true;

        this.runStep(lane, entry);
      }
    }
  }

  private runStep(lane: LaneId, entry: ActiveEntry): void {
    const { timeline, stepIndex } = entry;
    const step = timeline.steps[stepIndex];

    if (step == null) {
      this.completeTimeline(lane, entry);
      return;
    }

    this.emit('choreo.intent-started', lane, step, 'running');

    let settled = false;
    const ttlTimer = this.ctx.scene.time.delayedCall(step.ttlMs, () => {
      if (settled) return;
      settled = true;
      this.cancelStep(step, lane);
      this.emit('choreo.intent-cancelled', lane, step, 'failed');
      console.warn(`[ChoreographyPlayer] TTL exceeded for ${step.id} on ${lane}`);
      if (this.active[lane] === entry) {
        // TTL abort: invoke onAbort, NOT preemption.
        this.abortTimeline(lane, entry);
      }
    });

    dispatchRun(step, this.ctx).then((result: IntentResult) => {
      if (settled) return;
      settled = true;
      ttlTimer.remove(false);

      if (this.active[lane] !== entry) return;

      if (result.status === 'cancelled') {
        return;
      }

      if (result.status === 'failed') {
        this.emit('choreo.intent-cancelled', lane, step, 'failed');
        this.failTimeline(lane, entry);
        return;
      }

      this.emit('choreo.intent-completed', lane, step, 'completed');
      const next: ActiveEntry = { timeline, stepIndex: stepIndex + 1 };
      this.active[lane] = next;
      this.runStep(lane, next);
    });
  }

  private completeTimeline(lane: LaneId, entry: ActiveEntry): void {
    entry.timeline.onComplete?.();
    this.emitCinematicCompleted(lane, entry.timeline);

    // Hero release on primary/critical completion.
    if ((lane === 'primary' || lane === 'critical') && entry.timeline.ticketId != null) {
      this.ctx.ticketLayer.release();
    }

    this.active[lane] = null;

    if (lane === 'critical') {
      this.criticalActive = false;
      if (this.savedPrimary != null) {
        const { timeline, stepIndex } = this.savedPrimary;
        this.savedPrimary = null;
        const resumeTimeline: Timeline = {
          ...timeline,
          id: `${timeline.id}-resume`,
          steps: timeline.steps.slice(stepIndex),
          startedAt: Date.now(),
        };
        this.queues.primary.unshift(resumeTimeline);
      }
    }

    this.process();
  }

  /** Full abort (TTL exceeded). Invokes onAbort callback; NOT called on preemption. */
  private abortTimeline(lane: LaneId, entry: ActiveEntry): void {
    entry.timeline.onAbort?.();
    this.emitCinematicCompleted(lane, entry.timeline);

    if ((lane === 'primary' || lane === 'critical') && entry.timeline.ticketId != null) {
      this.ctx.ticketLayer.release();
    }

    this.active[lane] = null;

    if (lane === 'critical') {
      this.criticalActive = false;
      if (this.savedPrimary != null) {
        const { timeline, stepIndex } = this.savedPrimary;
        this.savedPrimary = null;
        const resumeTimeline: Timeline = {
          ...timeline,
          id: `${timeline.id}-resume`,
          steps: timeline.steps.slice(stepIndex),
          startedAt: Date.now(),
        };
        this.queues.primary.unshift(resumeTimeline);
      }
    }

    this.process();
  }

  /** Execution failure (intent returned failed). Does NOT invoke onAbort — that is TTL-only. */
  private failTimeline(lane: LaneId, entry: ActiveEntry): void {
    this.emitCinematicCompleted(lane, entry.timeline);

    if ((lane === 'primary' || lane === 'critical') && entry.timeline.ticketId != null) {
      this.ctx.ticketLayer.release();
    }

    this.active[lane] = null;

    if (lane === 'critical') {
      this.criticalActive = false;
      if (this.savedPrimary != null) {
        const { timeline, stepIndex } = this.savedPrimary;
        this.savedPrimary = null;
        const resumeTimeline: Timeline = {
          ...timeline,
          id: `${timeline.id}-resume`,
          steps: timeline.steps.slice(stepIndex),
          startedAt: Date.now(),
        };
        this.queues.primary.unshift(resumeTimeline);
      }
    }

    this.process();
  }

  // ─── private: helpers ────────────────────────────────────────────────────────

  private cancelStep(step: Intent, lane: LaneId): void {
    try {
      dispatchCancel(step, this.ctx);
    } catch (e) {
      console.error(`[ChoreographyPlayer] cancel error on ${lane}:`, e);
    }
  }

  private emit(
    event: 'choreo.intent-started' | 'choreo.intent-completed' | 'choreo.intent-cancelled',
    lane: LaneId,
    step: Intent,
    status: string,
  ): void {
    this.ctx.emitter.emit(event, {
      lane,
      intentName: step.id,
      target: step.target,
      status,
    } satisfies ChoreoEventPayload);
  }

  private emitCinematicStarted(lane: LaneId, timeline: Timeline): void {
    this.ctx.emitter.emit('choreo.cinematic-started', {
      lane,
      timelineId: timeline.id,
      ticketId: timeline.ticketId,
    });
  }

  private emitCinematicCompleted(lane: LaneId, timeline: Timeline): void {
    this.ctx.emitter.emit('choreo.cinematic-completed', {
      lane,
      timelineId: timeline.id,
      ticketId: timeline.ticketId,
    });
  }
}

// ─── Intent dispatch ──────────────────────────────────────────────────────────

function dispatchRun(step: Intent, ctx: ChoreographyCtx): Promise<IntentResult> {
  switch (step.id) {
    case 'walkToRoom':
      return walkToRoomIntent.run(step, ctx);
    case 'attachToDesk':
      return attachToDeskIntent.run(step, ctx);
    case 'swapIndicator':
      return swapIndicatorIntent.run(step, ctx);
    case 'delay':
      return delayIntent.run(step, ctx);
    case 'cameraTo':
      return cameraToIntent.run(step, ctx);
    case 'swapWallTint':
      return swapWallTintIntent.run(step, ctx);
    case 'doorState':
      return doorStateIntent.run(step, ctx);
    case 'glowRing':
      return glowRingIntent.run(step, ctx);
    case 'particleBurst':
      return particleBurstIntent.run(step, ctx);
    case 'corridorPulse':
      return corridorPulseIntent.run(step, ctx);
    case 'shelfLand':
      return shelfLandIntent.run(step, ctx);
    case 'spawnVerdictScroll':
      return spawnVerdictScrollIntent.run(step, ctx);
    case 'spawnScoutEnvelope':
      return spawnScoutEnvelopeIntent.run(step, ctx);
    case 'slotTransit':
      return slotTransitIntent.run(step, ctx);
    case 'parallel':
      return dispatchParallel(step, ctx);
    default:
      return Promise.resolve({ status: 'failed', reason: 'unknown-intent' });
  }
}

function dispatchCancel(step: Intent, ctx: ChoreographyCtx): void {
  switch (step.id) {
    case 'walkToRoom':
      walkToRoomIntent.cancel(step, ctx);
      break;
    case 'attachToDesk':
      attachToDeskIntent.cancel(step, ctx);
      break;
    case 'swapIndicator':
      swapIndicatorIntent.cancel(step, ctx);
      break;
    case 'delay':
      delayIntent.cancel(step, ctx);
      break;
    case 'cameraTo':
      cameraToIntent.cancel(step, ctx);
      break;
    case 'swapWallTint':
      swapWallTintIntent.cancel(step, ctx);
      break;
    case 'doorState':
      doorStateIntent.cancel(step, ctx);
      break;
    case 'glowRing':
      glowRingIntent.cancel(step, ctx);
      break;
    case 'particleBurst':
      particleBurstIntent.cancel(step, ctx);
      break;
    case 'corridorPulse':
      corridorPulseIntent.cancel(step, ctx);
      break;
    case 'shelfLand':
      shelfLandIntent.cancel(step, ctx);
      break;
    case 'spawnVerdictScroll':
      spawnVerdictScrollIntent.cancel(step, ctx);
      break;
    case 'spawnScoutEnvelope':
      spawnScoutEnvelopeIntent.cancel(step, ctx);
      break;
    case 'slotTransit':
      slotTransitIntent.cancel(step, ctx);
      break;
    case 'parallel':
      cancelParallel(step, ctx);
      break;
  }
}

/**
 * Runs all sub-steps simultaneously; resolves when the last completes
 * (or any one cancels). One level of parallelism only.
 */
function dispatchParallel(step: Intent, ctx: ChoreographyCtx): Promise<IntentResult> {
  const subSteps = step.subSteps ?? [];
  if (subSteps.length === 0) return Promise.resolve({ status: 'completed' });

  return new Promise<IntentResult>((resolve) => {
    let remaining = subSteps.length;
    let settled = false;

    for (const sub of subSteps) {
      dispatchRun(sub, ctx)
        .then((result) => {
          if (settled) return;
          if (result.status === 'cancelled' || result.status === 'failed') {
            settled = true;
            for (const other of subSteps) {
              if (other !== sub) dispatchCancel(other, ctx);
            }
            // Propagate the actual status so failed sub-steps trigger abortTimeline.
            resolve({ status: result.status });
            return;
          }
          remaining--;
          if (remaining === 0) {
            settled = true;
            resolve({ status: 'completed' });
          }
        })
        .catch(() => {
          if (settled) return;
          settled = true;
          for (const other of subSteps) {
            try {
              dispatchCancel(other, ctx);
            } catch {
              /* ignore */
            }
          }
          resolve({ status: 'failed', reason: 'sub-step-threw' });
        });
    }
  });
}

function cancelParallel(step: Intent, ctx: ChoreographyCtx): void {
  for (const sub of step.subSteps ?? []) {
    try {
      dispatchCancel(sub, ctx);
    } catch {
      // ignore individual cancel errors
    }
  }
}
