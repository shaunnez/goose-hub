// Pure carry-position math for TicketSprites relative to PersonaSprites.
// All offsets are in world pixels (no Phaser imports).
//
// Source: Board 02 §5.3 carry conventions.
// Origin conventions: persona origin (0.5, 1) = bottom-center;
//                     ticket origin (0.5, 0.5) = centered.

export interface CarryOffset {
  dx: number;
  dy: number;
}

/**
 * Offset applied to the ticket container when position='carried'.
 * The ticket is parented to the persona container; this local offset
 * positions it slightly to the right and above the persona's feet.
 * Per Board 02 §5.3: (+10, −12).
 */
export function ticketCarryOffset(): CarryOffset {
  return { dx: 10, dy: -12 };
}

/**
 * Offset applied when the ticket is at the desk attachment point.
 * Position relative to the desk anchor (not persona) — used when the
 * ticket is re-parented to the scene root on `position='desk'`.
 * A small upward shift places the card on the desk surface.
 */
export function ticketAtDeskOffset(): CarryOffset {
  return { dx: 0, dy: -8 };
}
