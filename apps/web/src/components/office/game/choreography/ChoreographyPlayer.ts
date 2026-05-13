// ChoreographyPlayer — lane dispatcher for the Office Mode choreography system.
//
// Responsibilities:
//   - Accept Timeline[] via applyChoreography(); coalesce within one Phaser tick.
//   - Manage three independent lane queues (critical / primary / ambient).
//   - Run each lane's active timeline step by step, honouring TTL.
//   - Handle critical-preempts-primary with resume; critical/primary-cancel-ambient.
//   - Emit choreo.intent-{started,completed,cancelled} on the scene emitter.
//
// Invariants:
//   - No per-frame update() loop. Execution is intent-driven.
//   - No tween creation; tweens are owned by layer primitives.
//   - ≤ 300 lines.

import type { Intent, LaneId, Timeline } from '../../lib/choreography';
import type { IntentResult } from '../layers/types';
import type { ChoreoEventPayload, ChoreographyCtx } from './Timeline';
import * as attachToDeskIntent from './intents/attachToDesk';
import * as swapIndicatorIntent from './intents/swapIndicator';
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
    // Same lane + same first-step intent + same first-step target → keep latest only.
    // Including intent id prevents collapsing different-intent timelines for the same target.
    // Timelines with no steps (no-op) are all kept (no meaningful target to key on).
    const latest = new Map<string, Timeline>();
    const noops: Timeline[] = [];
    for (const t of timelines) {
      const firstStep = t.steps[0];
      if (firstStep == null) {
        noops.push(t);
        continue;
      }
      const key = `${t.lane}:${firstStep.id}:${firstStep.target.kind}:${firstStep.target.id}`;
      latest.set(key, t); // later entry wins
    }
    return [...latest.values(), ...noops];
  }

  // ─── private: dispatch to lanes ─────────────────────────────────────────────

  private dispatch(t: Timeline): void {
    if (t.lane === 'critical') {
      this.preemptForCritical(t);
    } else if (t.lane === 'primary') {
      // primary-cancel-ambient (spec §4.4): primary work cancels in-flight ambient (no resume).
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
    // Cancel primary (save for resume), cancel ambient (no resume).
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
        const timeline = this.queues[lane].shift() as Timeline;
        timeline.startedAt ??= Date.now();
        const entry: ActiveEntry = { timeline, stepIndex: 0 };
        this.active[lane] = entry;
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
        this.active[lane] = null;
        this.process();
      }
    });

    dispatchRun(step, this.ctx).then((result: IntentResult) => {
      if (settled) return;
      settled = true;
      ttlTimer.remove(false);

      // Preemption guard: if this entry is no longer active, do nothing.
      if (this.active[lane] !== entry) return;

      if (result.status === 'cancelled') {
        // Deliberate cancellation by preemption — preempt handler already saved state.
        return;
      }

      if (result.status === 'failed') {
        this.emit('choreo.intent-cancelled', lane, step, 'failed');
        this.active[lane] = null;
        this.process();
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
    this.active[lane] = null;

    if (lane === 'critical' && this.savedPrimary != null) {
      const { timeline, stepIndex } = this.savedPrimary;
      this.savedPrimary = null;
      // Re-run from the cancelled step (spec §4.5: "re-runs the cancelled step from scratch").
      const resumeTimeline: Timeline = {
        ...timeline,
        id: `${timeline.id}-resume`,
        steps: timeline.steps.slice(stepIndex),
        startedAt: Date.now(),
      };
      this.queues.primary.unshift(resumeTimeline);
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
}

// ─── Intent dispatch ──────────────────────────────────────────────────────────
// Isolated here so ChoreographyPlayer doesn't import intent modules directly —
// this keeps the player oblivious to intent internals.

function dispatchRun(step: Intent, ctx: ChoreographyCtx): Promise<IntentResult> {
  switch (step.id) {
    case 'walkToRoom':
      return walkToRoomIntent.run(step, ctx);
    case 'attachToDesk':
      return attachToDeskIntent.run(step, ctx);
    case 'swapIndicator':
      return swapIndicatorIntent.run(step, ctx);
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
  }
}
