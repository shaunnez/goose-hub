// Canvas-HUD layer (z=60). Owns all world-anchored HUD overlays.
// Update cadence: applyHud() per applyPlacements; three emitter events
// for accumulator-driven updates. NO per-frame update() logic. ≤ 320 lines.

import type Phaser from 'phaser';
import type { HudState } from '../../lib/hud-state';
import { resetDoneToday } from '../../lib/hud-state';
import { floorOriginY } from '../../lib/layout';
import { type HudAnchorName, type RoomId, hudAnchor, roomQueueAnchor } from '../../lib/rooms';

const HUD_DEPTH = 60;
const SPOTLIGHT_DEPTH = 50;
const MONO = 'JetBrains Mono, monospace';
const BADGE_STYLE = {
  fontFamily: MONO,
  fontSize: '8px',
  color: '#ffd700',
  backgroundColor: '#1a162299',
  padding: { left: 3, right: 3, top: 1, bottom: 1 },
} as const;
const CTR_STYLE = {
  fontFamily: MONO,
  fontSize: '9px',
  color: '#c7b8ff',
  backgroundColor: '#1a162299',
  padding: { left: 3, right: 3, top: 1, bottom: 1 },
} as const;
const CAM_STYLE = {
  fontFamily: MONO,
  fontSize: '8px',
  color: '#ffffff',
  backgroundColor: '#00000066',
  padding: { left: 3, right: 3, top: 1, bottom: 1 },
} as const;
const ROOM_IDS: RoomId[] = ['triage', 'investigation', 'dev', 'qa', 'review', 'done'];

interface SpotlightEntry {
  circle: Phaser.GameObjects.Arc;
  bell?: Phaser.GameObjects.Text;
}

export class HudLayer {
  private readonly scene: Phaser.Scene;
  private readonly emitter: Phaser.Events.EventEmitter;
  private floorIndex = 0;
  private retryText!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private doneDayText!: Phaser.GameObjects.Text;
  private cameraText!: Phaser.GameObjects.Text;
  private queueBadges = new Map<RoomId, Phaser.GameObjects.Text>();
  private spotlights = new Map<string, SpotlightEntry>();
  private lastDate = new Date().toDateString();
  private midnightInterval: ReturnType<typeof setInterval> | null = null;
  private currentState: HudState | null = null;
  private onStateUpdate: ((s: HudState) => void) | null = null;

  constructor(
    scene: Phaser.Scene,
    emitter: Phaser.Events.EventEmitter,
    onStateUpdate: (s: HudState) => void,
  ) {
    this.scene = scene;
    this.emitter = emitter;
    this.onStateUpdate = onStateUpdate;
    this.boot();
  }

  private boot(): void {
    const oy = floorOriginY(this.floorIndex);
    this.retryText = this.makeText('retry-counter', oy, CTR_STYLE);
    this.roundText = this.makeText('round-counter', oy, CTR_STYLE);
    this.scoreText = this.makeText('quality-score', oy, CTR_STYLE);
    this.doneDayText = this.makeText('done-day', oy, BADGE_STYLE);
    const cs = hudAnchor('camera-state');
    this.cameraText = this.scene.add.text(cs.x, cs.y, '', CAM_STYLE);
    this.cameraText.setDepth(HUD_DEPTH).setScrollFactor(0).setVisible(false);
    for (const t of [this.retryText, this.roundText, this.scoreText, this.doneDayText])
      t.setVisible(false);

    this.emitter.on('choreo.retry-incremented', this.onRetryIncremented, this);
    this.emitter.on('choreo.merge-celebrated', this.onMergeCelebrated, this);
    this.emitter.on('choreo.cinematic-started', this.onCinematicStarted, this);

    this.midnightInterval = setInterval(() => {
      const today = new Date().toDateString();
      if (today !== this.lastDate && this.currentState != null) {
        this.lastDate = today;
        const next = resetDoneToday(this.currentState);
        this.currentState = next;
        this.doneDayText.setVisible(false);
        this.onStateUpdate?.(next);
      }
    }, 60_000);
  }

  private makeText(name: HudAnchorName, oy: number, style: object): Phaser.GameObjects.Text {
    const pt = hudAnchor(name);
    return this.scene.add
      .text(pt.x, oy + pt.y, '', style as Phaser.Types.GameObjects.Text.TextStyle)
      .setDepth(HUD_DEPTH);
  }

  setFloorIndex(fi: number): void {
    this.floorIndex = fi;
  }

  applyHud(state: HudState): void {
    this.currentState = state;
    const oy = floorOriginY(this.floorIndex);
    this.updateRetry(state, oy);
    this.updateRound(state, oy);
    this.updateScore(state, oy);
    this.updateDoneDay(state, oy);
    this.applyCameraState(state.camera.anchor, state.camera.ticketId);
    this.updateQueueBadges(state, oy);
    this.updateSpotlights(state);
  }

  applyCameraState(anchor: 'floor-overview' | 'hero-ticket-follow', ticketId?: string): void {
    if (anchor === 'hero-ticket-follow' && ticketId != null) {
      this.cameraText.setText(`FOLLOWING #${ticketId}`).setVisible(true);
    } else {
      this.cameraText.setVisible(false);
    }
  }

  positionSpotlight(personaId: string, worldX: number, worldY: number): void {
    const e = this.spotlights.get(personaId);
    if (e == null) return;
    e.circle.setPosition(worldX, worldY - 6).setVisible(true);
    if (e.bell != null) e.bell.setPosition(worldX + 16, worldY - 32).setVisible(true);
  }

  destroy(): void {
    if (this.midnightInterval != null) {
      clearInterval(this.midnightInterval);
      this.midnightInterval = null;
    }
    this.emitter.off('choreo.retry-incremented', this.onRetryIncremented, this);
    this.emitter.off('choreo.merge-celebrated', this.onMergeCelebrated, this);
    this.emitter.off('choreo.cinematic-started', this.onCinematicStarted, this);
    for (const t of [
      this.retryText,
      this.roundText,
      this.scoreText,
      this.doneDayText,
      this.cameraText,
    ])
      t.destroy();
    for (const t of this.queueBadges.values()) t.destroy();
    this.queueBadges.clear();
    for (const s of this.spotlights.values()) {
      s.circle.destroy();
      s.bell?.destroy();
    }
    this.spotlights.clear();
  }

  private updateRetry(state: HudState, oy: number): void {
    const heroId = state.hero?.ticketId;
    const count = heroId != null ? (state.retry[heroId] ?? 0) : 0;
    if (count === 0 || heroId == null) {
      this.retryText.setVisible(false);
      return;
    }
    const pt = hudAnchor('retry-counter');
    this.retryText
      .setPosition(pt.x, oy + pt.y)
      .setText(`×${Math.min(count, 9)}${count >= 10 ? '+' : ''}`)
      .setVisible(true);
  }

  private updateRound(state: HudState, oy: number): void {
    if (state.reviewRound == null) {
      this.roundText.setVisible(false);
      return;
    }
    const pt = hudAnchor('round-counter');
    this.roundText
      .setPosition(pt.x, oy + pt.y)
      .setText(`r${state.reviewRound}`)
      .setVisible(true);
  }

  private updateScore(state: HudState, oy: number): void {
    const score = state.hero?.qualityScore ?? null;
    if (score == null) {
      this.scoreText.setVisible(false);
      return;
    }
    const pt = hudAnchor('quality-score');
    this.scoreText
      .setPosition(pt.x, oy + pt.y)
      .setText(String(Math.round(score)))
      .setVisible(true);
  }

  private updateDoneDay(state: HudState, oy: number): void {
    if (state.doneToday === 0) {
      this.doneDayText.setVisible(false);
      return;
    }
    const pt = hudAnchor('done-day');
    this.doneDayText
      .setPosition(pt.x, oy + pt.y)
      .setText(`+${state.doneToday} today`)
      .setVisible(true);
  }

  private updateQueueBadges(state: HudState, oy: number): void {
    for (const roomId of ROOM_IDS) {
      const depth = state.queues[roomId] ?? 0;
      const existing = this.queueBadges.get(roomId);
      if (depth < 16) {
        existing?.setVisible(false);
        continue;
      }
      const qa = roomQueueAnchor(roomId);
      const bx = (qa?.x ?? 0) + 12;
      const by = oy + 88 - 18;
      const label = `+${depth - 15}`;
      if (existing == null) {
        const t = this.scene.add
          .text(bx, by, label, BADGE_STYLE as Phaser.Types.GameObjects.Text.TextStyle)
          .setDepth(HUD_DEPTH)
          .setInteractive();
        t.on('pointerdown', () => this.emitter.emit('queue-click', { roomId }));
        this.queueBadges.set(roomId, t);
      } else {
        existing.setPosition(bx, by).setText(label).setVisible(true);
      }
    }
  }

  private updateSpotlights(state: HudState): void {
    const activeIds = new Set(state.blocked.map((b) => b.personaId));
    for (const [id, e] of this.spotlights) {
      if (!activeIds.has(id)) {
        e.circle.destroy();
        e.bell?.destroy();
        this.spotlights.delete(id);
      }
    }
    for (const { personaId, mode } of state.blocked) {
      if (this.spotlights.has(personaId)) continue;
      const circle = this.scene.add
        .arc(0, 0, 28, 0, 360, false, 0xffffff, 0.12)
        .setDepth(SPOTLIGHT_DEPTH)
        .setVisible(false);
      const entry: SpotlightEntry = { circle };
      if (mode === 'gate-pending') {
        entry.bell = this.scene.add
          .text(16, -32, '🔔', { fontSize: '10px' })
          .setDepth(HUD_DEPTH)
          .setVisible(false);
      }
      this.spotlights.set(personaId, entry);
    }
  }

  private onRetryIncremented(payload: { ticketId?: string }): void {
    const ticketId = payload?.ticketId;
    if (ticketId == null || this.currentState == null) return;
    const count = (this.currentState.retry[ticketId] ?? 0) + 1;
    const next: HudState = {
      ...this.currentState,
      retry: { ...this.currentState.retry, [ticketId]: count },
    };
    this.currentState = next;
    if (next.hero?.ticketId === ticketId && this.retryText.visible) {
      this.scene.tweens.add({
        targets: this.retryText,
        scaleX: 1.4,
        scaleY: 1.4,
        duration: 100,
        ease: 'Quad.Out',
        yoyo: true,
      });
    }
    this.onStateUpdate?.(next);
  }

  private onMergeCelebrated(_payload: unknown): void {
    if (this.currentState == null) return;
    const next: HudState = { ...this.currentState, doneToday: this.currentState.doneToday + 1 };
    this.currentState = next;
    this.updateDoneDay(next, floorOriginY(this.floorIndex));
    this.onStateUpdate?.(next);
  }

  // Satisfies "HudLayer listens to choreo.cinematic-started" invariant.
  // HudFeed (DOM) handles the actual feed line in React.
  private onCinematicStarted(_payload: unknown): void {}
}
