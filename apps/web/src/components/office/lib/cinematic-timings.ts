// Cinematic timing constants for Office Mode v1.
// ALL duration values in game/ come from this module — no literal ms values
// may appear in cinematic factory or intent code.
// Pure module: no Phaser imports, no side effects.

export const TIMING = {
  cameraEase: 400,
  cameraEaseSlow: 800,
  walkRoomMs: 800,
  walkCorridorMs: 1200,
  slotTransit3AnchorMs: 600,
  doorOpenMs: 200,
  doorHoldMs: 800,
  doorCloseMs: 200,
  corridorPulseMs: 1000,
  shelfLandHeroMs: 800,
  shelfLandAmbientMs: 400,
  glowRingMs: 600,
  particleBurstMs: 800,
  wallTintRestoreMs: 0,
  qaFailedHardCapMs: 3500,
  heroReleaseDelayMs: 500,
  scoutSpawnStaggerMs: 100,
  scoutEnvelopeSpawnMs: 200,
  swapIndicatorMs: 50,
  corridorPulseEastToWestMs: 1000,
  investigationWaveTtlMs: 8000,
} as const;

export type TimingKey = keyof typeof TIMING;

// Default easing for all cinematic tweens.
// "Cubic.InOut" matches Board 02 §14 spec.
// Particle alpha uses Quad.Out (specified per intent).
export const DEFAULT_EASE = 'Cubic.InOut' as const;
export const PARTICLE_ALPHA_EASE = 'Quad.Out' as const;
