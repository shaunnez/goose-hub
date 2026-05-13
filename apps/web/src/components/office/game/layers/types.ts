// Shared payload types for the Office scene layers.
//
// Lives here (not in OfficeScene.ts) to break the potential circular-import
// that would arise if layers imported from their parent scene while OfficeScene
// imported from those layers. OfficeScene re-exports these for backward-compat
// so the React side doesn't need import-path changes.
//
// Phase-3: PersonaPlacement and TicketPlacement live in lib/agent-positions.ts
// (pure, Phaser-free); they are re-exported here for layer convenience.

export interface OfficeProject {
  slug: string;
  name: string;
  color?: string;
}

export interface DeskClickPayload {
  projectSlug: string;
  workItemId: string;
  externalId: string;
  title?: string;
}

export interface FloorChangePayload {
  floorIndex: number;
  projectSlug: string;
  projectName: string;
}

/** Verified PNG assets to queue in preload (probed by the React mount). */
export interface VerifiedAsset {
  key: string;
  url: string;
}

// ─── Choreography intent result types ────────────────────────────────────────
// Defined here (not in lib/) so PersonaLayer and TicketLayer can import them
// without pulling Phaser into lib/.

export type IntentStatus = 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface IntentResult {
  status: IntentStatus;
  reason?: string;
}
