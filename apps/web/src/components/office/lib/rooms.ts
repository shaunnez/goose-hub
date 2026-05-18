// Authoritative spatial constants for the Office Mode v2 project floor.
// ALL room coordinates, desk anchors, slot anchors, queue anchors, click zones,
// and camera anchors live here. Scene and layer code MUST import from this file;
// no coordinate literal may appear in game/ or components/ that is not defined here.
//
// v2 geometry: two-band layout matching the canonical gameplay target image.
//   Top band (y=80..255): dev, qa, review, retro, done, archive (6 rooms).
//   Middle corridor (y=272..335): walk-lane at y=304.
//   Bottom band (y=352..527): backlog, triage, investigation, library, coffee (5 rooms).

export const TILE_SIZE = 16;

export const FLOOR_WORLD = { width: 1280, height: 544 } as const;

// Canonical walking-lane y-coordinate inside the middle corridor band.
// Personas and queue stacks travel along this line.
export const CORRIDOR_WALK_Y = 304;

// Top band: left → right, west wing to east wing.
// Bottom band: left → right, mirror of top.
export const ROOM_IDS = [
  'dev',
  'qa',
  'review',
  'retro',
  'done',
  'archive',
  'backlog',
  'triage',
  'investigation',
  'library',
  'coffee',
] as const;
export type RoomId = (typeof ROOM_IDS)[number];

export const TOP_BAND_ROOMS = ['dev', 'qa', 'review', 'retro', 'done', 'archive'] as const;
export const BOTTOM_BAND_ROOMS = [
  'backlog',
  'triage',
  'investigation',
  'library',
  'coffee',
] as const;

export interface Point {
  x: number;
  y: number;
}

export interface PixelRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SlotSpec {
  id: string;
  side: 'north' | 'south' | 'east' | 'west';
  tileRange: [number, number];
  direction: 'inbound' | 'outbound' | 'bidirectional';
  queueAnchor: Point | null;
  exteriorAnchor: Point;
  interiorAnchor: Point;
  tint: 'frosted' | 'opaque';
}

export interface ClickZone {
  id: string;
  rect: PixelRect;
}

export interface CameraAnchor {
  center: Point;
  zoom: number;
}

// ─── Floor band y-extents ─────────────────────────────────────────────────────

// Top band interior (between top-band ceiling and top-band south wall).
export const TOP_BAND_Y = { y1: 80, y2: 255 } as const;
// Middle corridor interior (between top-band south wall and bottom-band north wall).
export const CORRIDOR_Y = { y1: 272, y2: 335 } as const;
// Bottom band interior (between bottom-band north wall and bottom-band south wall).
export const BOTTOM_BAND_Y = { y1: 352, y2: 527 } as const;

// ─── Room pixel bounds (interior, walls excluded) ─────────────────────────────

const ROOM_BOUNDS: Record<RoomId, PixelRect> = {
  // Top band — 6 rooms. DEV is the widest (most-active room); DONE/ARCHIVE
  // are narrow shelf rooms. Widths: 304 + 224 + 224 + 192 + 112 + 128 = 1184.
  // Inter-walls: 5 × 16 = 80. Outer walls: 16 left + 0 right (archive ends
  // flush). Sum: 1184 + 80 + 16 = 1280.
  dev: { x1: 16, y1: TOP_BAND_Y.y1, x2: 319, y2: TOP_BAND_Y.y2 }, // 304 wide
  qa: { x1: 336, y1: TOP_BAND_Y.y1, x2: 559, y2: TOP_BAND_Y.y2 }, // 224 wide
  review: { x1: 576, y1: TOP_BAND_Y.y1, x2: 799, y2: TOP_BAND_Y.y2 }, // 224 wide
  retro: { x1: 816, y1: TOP_BAND_Y.y1, x2: 1007, y2: TOP_BAND_Y.y2 }, // 192 wide
  done: { x1: 1024, y1: TOP_BAND_Y.y1, x2: 1135, y2: TOP_BAND_Y.y2 }, // 112 wide (small shelf room)
  archive: { x1: 1152, y1: TOP_BAND_Y.y1, x2: 1279, y2: TOP_BAND_Y.y2 }, // 128 wide
  // Bottom band — 5 rooms, widths sum to 1184 + 4 inter-walls (64) + 2 outer (32) = 1280
  backlog: { x1: 16, y1: BOTTOM_BAND_Y.y1, x2: 271, y2: BOTTOM_BAND_Y.y2 },
  triage: { x1: 288, y1: BOTTOM_BAND_Y.y1, x2: 511, y2: BOTTOM_BAND_Y.y2 },
  investigation: { x1: 528, y1: BOTTOM_BAND_Y.y1, x2: 783, y2: BOTTOM_BAND_Y.y2 },
  library: { x1: 800, y1: BOTTOM_BAND_Y.y1, x2: 991, y2: BOTTOM_BAND_Y.y2 },
  coffee: { x1: 1008, y1: BOTTOM_BAND_Y.y1, x2: 1263, y2: BOTTOM_BAND_Y.y2 },
};

export function roomBounds(id: RoomId): PixelRect {
  return ROOM_BOUNDS[id];
}

export function roomBand(id: RoomId): 'top' | 'bottom' {
  return (TOP_BAND_ROOMS as readonly string[]).includes(id) ? 'top' : 'bottom';
}

// ─── Room doors (pixel center on the corridor-facing wall) ───────────────────

// Top-band doors face south (the corridor is below); door y = top band south wall.
const TOP_DOOR_Y = TOP_BAND_Y.y2 + 1; // y=256: south wall row
// Bottom-band doors face north (the corridor is above); door y = bottom band north wall.
const BOTTOM_DOOR_Y = BOTTOM_BAND_Y.y1 - 16; // y=336: north wall row

const ROOM_DOORS: Partial<Record<RoomId, Point>> = {
  dev: { x: 168, y: TOP_DOOR_Y },
  qa: { x: 448, y: TOP_DOOR_Y },
  review: { x: 688, y: TOP_DOOR_Y },
  retro: { x: 912, y: TOP_DOOR_Y },
  done: { x: 1080, y: TOP_DOOR_Y },
  archive: { x: 1216, y: TOP_DOOR_Y },
  backlog: { x: 144, y: BOTTOM_DOOR_Y },
  triage: { x: 400, y: BOTTOM_DOOR_Y },
  investigation: { x: 656, y: BOTTOM_DOOR_Y },
  library: { x: 896, y: BOTTOM_DOOR_Y },
  coffee: { x: 1136, y: BOTTOM_DOOR_Y },
};

export function roomDoor(id: RoomId): Point | null {
  return ROOM_DOORS[id] ?? null;
}

// ─── Desk / station / shelf anchors ──────────────────────────────────────────

// Desk Y — place desks ~3/4 down each band so geese have headroom and
// don't appear glued to the ceiling. Top band interior is y=80..255 (176
// tall); placing desks at y=208 puts the goose body around y=192 with feet
// on the desk at y=208.
// Phase 8: back wall extended to 6 tiles tall (96 px). Desk anchors
// pushed down 16 px so the desk top stays clear of the new floor seam.
const TOP_DESK_Y = TOP_BAND_Y.y1 + 144; // y=224 (was 208)
const BOTTOM_DESK_Y = BOTTOM_BAND_Y.y1 + 144; // y=496 (was 480)

// Per-room desk counts reflect each room's purpose and the canonical mockup:
// Dev is the busy floor (4 stations); QA is the booth grid (4); Review has
// 2 big tables; Retro is 1 round table; storage rooms (Done/Archive/Backlog)
// show 1 token desk so persona placements still resolve, but their identity
// lives in the back-wall props (Phase 3 drawRoomBackWallProps).
const ROOM_DESK_ANCHORS: Record<RoomId, Point[]> = {
  // Top band
  dev: [
    { x: 64, y: TOP_DESK_Y },
    { x: 144, y: TOP_DESK_Y },
    { x: 224, y: TOP_DESK_Y },
    { x: 296, y: TOP_DESK_Y },
  ],
  qa: [
    { x: 368, y: TOP_DESK_Y },
    { x: 421, y: TOP_DESK_Y },
    { x: 474, y: TOP_DESK_Y },
    { x: 527, y: TOP_DESK_Y },
  ],
  review: [
    { x: 632, y: TOP_DESK_Y },
    { x: 743, y: TOP_DESK_Y },
  ],
  retro: [{ x: 911, y: TOP_DESK_Y }],
  done: [{ x: 1079, y: TOP_DESK_Y }],
  archive: [{ x: 1215, y: TOP_DESK_Y }],
  // Bottom band
  backlog: [
    { x: 80, y: BOTTOM_DESK_Y },
    { x: 207, y: BOTTOM_DESK_Y },
  ],
  triage: [{ x: 399, y: BOTTOM_DESK_Y }],
  investigation: [
    { x: 592, y: BOTTOM_DESK_Y },
    { x: 719, y: BOTTOM_DESK_Y },
  ],
  library: [
    { x: 832, y: BOTTOM_DESK_Y },
    { x: 895, y: BOTTOM_DESK_Y },
    { x: 958, y: BOTTOM_DESK_Y },
  ],
  coffee: [
    { x: 1040, y: BOTTOM_DESK_Y },
    { x: 1135, y: BOTTOM_DESK_Y },
    { x: 1230, y: BOTTOM_DESK_Y },
  ],
};

export function roomDeskAnchors(id: RoomId): Point[] {
  return ROOM_DESK_ANCHORS[id];
}

// ─── Slot specs for sealed/frosted rooms ─────────────────────────────────────

const LIBRARY_SLOTS: SlotSpec[] = [
  {
    id: 'library.envelope-in',
    side: 'north',
    tileRange: [51, 52],
    direction: 'inbound',
    queueAnchor: { x: 880, y: CORRIDOR_WALK_Y },
    exteriorAnchor: { x: 880, y: BOTTOM_BAND_Y.y1 - 8 },
    interiorAnchor: { x: 880, y: BOTTOM_BAND_Y.y1 + 32 },
    tint: 'opaque',
  },
];

// QA slots are functional anchors (ticket conveyor in/out) — they do NOT
// create wall door gaps. QA's south wall has only its main door.
const QA_SLOTS: SlotSpec[] = [
  {
    id: 'qa.input',
    side: 'south',
    tileRange: [24, 25],
    direction: 'inbound',
    queueAnchor: { x: 384, y: CORRIDOR_WALK_Y },
    exteriorAnchor: { x: 384, y: TOP_BAND_Y.y2 + 8 },
    interiorAnchor: { x: 384, y: TOP_BAND_Y.y2 - 32 },
    tint: 'frosted',
  },
  {
    id: 'qa.output',
    side: 'south',
    tileRange: [32, 33],
    direction: 'outbound',
    queueAnchor: { x: 512, y: CORRIDOR_WALK_Y },
    exteriorAnchor: { x: 512, y: TOP_BAND_Y.y2 + 8 },
    interiorAnchor: { x: 512, y: TOP_BAND_Y.y2 - 32 },
    tint: 'frosted',
  },
];

const REVIEW_SLOTS: SlotSpec[] = [
  {
    id: 'review.door',
    side: 'south',
    tileRange: [35, 36],
    direction: 'bidirectional',
    queueAnchor: { x: 576, y: CORRIDOR_WALK_Y },
    exteriorAnchor: { x: 576, y: TOP_BAND_Y.y2 + 8 },
    interiorAnchor: { x: 576, y: TOP_BAND_Y.y2 - 32 },
    tint: 'frosted',
  },
];

const ROOM_SLOTS: Partial<Record<RoomId, SlotSpec[]>> = {
  library: LIBRARY_SLOTS,
  qa: QA_SLOTS,
  review: REVIEW_SLOTS,
};

export function roomSlotAnchors(id: RoomId): SlotSpec[] {
  return ROOM_SLOTS[id] ?? [];
}

// ─── Queue anchors (corridor-side, y=CORRIDOR_WALK_Y) ────────────────────────

const ROOM_QUEUE_ANCHORS: Partial<Record<RoomId, Point>> = {
  dev: { x: 136, y: CORRIDOR_WALK_Y },
  qa: { x: 368, y: CORRIDOR_WALK_Y },
  review: { x: 576, y: CORRIDOR_WALK_Y },
  retro: { x: 776, y: CORRIDOR_WALK_Y },
  backlog: { x: 144, y: CORRIDOR_WALK_Y },
  triage: { x: 400, y: CORRIDOR_WALK_Y },
  investigation: { x: 656, y: CORRIDOR_WALK_Y },
  library: { x: 896, y: CORRIDOR_WALK_Y },
  coffee: { x: 1136, y: CORRIDOR_WALK_Y },
  // done, archive: no queue — tickets arrive directly
};

export function roomQueueAnchor(id: RoomId): Point | null {
  return ROOM_QUEUE_ANCHORS[id] ?? null;
}

// ─── Click zones ──────────────────────────────────────────────────────────────

const ALL_CLICK_ZONES: ClickZone[] = [
  // Top band — desk-face click zones
  { id: 'zone.dev.face', rect: { x1: 16, y1: TOP_DESK_Y - 24, x2: 255, y2: TOP_DESK_Y + 24 } },
  { id: 'zone.qa.face', rect: { x1: 272, y1: TOP_DESK_Y - 24, x2: 463, y2: TOP_DESK_Y + 24 } },
  {
    id: 'zone.review.face',
    rect: { x1: 480, y1: TOP_DESK_Y - 24, x2: 671, y2: TOP_DESK_Y + 24 },
  },
  { id: 'zone.retro.face', rect: { x1: 688, y1: TOP_DESK_Y - 24, x2: 863, y2: TOP_DESK_Y + 24 } },
  { id: 'zone.done.shelf', rect: { x1: 880, y1: TOP_DESK_Y - 24, x2: 1055, y2: TOP_DESK_Y + 24 } },
  {
    id: 'zone.archive.face',
    rect: { x1: 1072, y1: TOP_DESK_Y - 24, x2: 1263, y2: TOP_DESK_Y + 24 },
  },
  // Bottom band — desk-face click zones
  {
    id: 'zone.backlog.face',
    rect: { x1: 16, y1: BOTTOM_DESK_Y - 24, x2: 271, y2: BOTTOM_DESK_Y + 24 },
  },
  {
    id: 'zone.triage.face',
    rect: { x1: 288, y1: BOTTOM_DESK_Y - 24, x2: 511, y2: BOTTOM_DESK_Y + 24 },
  },
  {
    id: 'zone.investigation.face',
    rect: { x1: 528, y1: BOTTOM_DESK_Y - 24, x2: 783, y2: BOTTOM_DESK_Y + 24 },
  },
  {
    id: 'zone.library.face',
    rect: { x1: 800, y1: BOTTOM_DESK_Y - 24, x2: 991, y2: BOTTOM_DESK_Y + 24 },
  },
  {
    id: 'zone.coffee.face',
    rect: { x1: 1008, y1: BOTTOM_DESK_Y - 24, x2: 1263, y2: BOTTOM_DESK_Y + 24 },
  },
  // Queue zones along the corridor walk-line
  { id: 'zone.queue.dev', rect: { x1: 104, y1: 280, x2: 168, y2: 320 } },
  { id: 'zone.queue.qa', rect: { x1: 336, y1: 280, x2: 400, y2: 320 } },
  { id: 'zone.queue.review', rect: { x1: 544, y1: 280, x2: 608, y2: 320 } },
  { id: 'zone.queue.retro', rect: { x1: 744, y1: 280, x2: 808, y2: 320 } },
  { id: 'zone.queue.backlog', rect: { x1: 112, y1: 280, x2: 176, y2: 320 } },
  { id: 'zone.queue.triage', rect: { x1: 368, y1: 280, x2: 432, y2: 320 } },
  { id: 'zone.queue.investigation', rect: { x1: 624, y1: 280, x2: 688, y2: 320 } },
  { id: 'zone.queue.library', rect: { x1: 864, y1: 280, x2: 928, y2: 320 } },
  { id: 'zone.queue.coffee', rect: { x1: 1104, y1: 280, x2: 1168, y2: 320 } },
];

export function roomClickZones(id: RoomId): ClickZone[] {
  return ALL_CLICK_ZONES.filter((z) => z.id.startsWith(`zone.${id}`));
}

export function allClickZones(): ClickZone[] {
  return ALL_CLICK_ZONES;
}

// ─── Camera anchors ───────────────────────────────────────────────────────────

const CAMERA_ANCHORS: Record<string, CameraAnchor> = {
  'floor-overview': { center: { x: 640, y: 272 }, zoom: 1.0 },
  'hero-ticket-follow': { center: { x: 640, y: 272 }, zoom: 1.0 },
  'room-dev': { center: { x: 168, y: TOP_DESK_Y }, zoom: 1.0 },
  'room-qa': { center: { x: 448, y: TOP_DESK_Y }, zoom: 1.0 },
  'room-review': { center: { x: 688, y: TOP_DESK_Y }, zoom: 1.0 },
  'room-retro': { center: { x: 912, y: TOP_DESK_Y }, zoom: 1.0 },
  'room-done': { center: { x: 1080, y: TOP_DESK_Y }, zoom: 1.0 },
  'room-archive': { center: { x: 1216, y: TOP_DESK_Y }, zoom: 1.0 },
  'room-backlog': { center: { x: 144, y: BOTTOM_DESK_Y }, zoom: 1.0 },
  'room-triage': { center: { x: 400, y: BOTTOM_DESK_Y }, zoom: 1.0 },
  'room-investigation': { center: { x: 656, y: BOTTOM_DESK_Y }, zoom: 1.0 },
  'room-library': { center: { x: 896, y: BOTTOM_DESK_Y }, zoom: 1.0 },
  'room-coffee': { center: { x: 1136, y: BOTTOM_DESK_Y }, zoom: 1.0 },
  'library-zoom': { center: { x: 896, y: BOTTOM_DESK_Y }, zoom: 1.0 },
};

export function cameraAnchor(name: string): CameraAnchor | null {
  return CAMERA_ANCHORS[name] ?? null;
}

// ─── Library sub-room constants (now a top-level room) ────────────────────────

export const LIBRARY_BOUNDS: PixelRect = ROOM_BOUNDS.library;
export const LIBRARY_ENVELOPE_SLOT_CENTER: Point = { x: 880, y: BOTTOM_BAND_Y.y1 + 16 };
export const LIBRARY_RESERVED_SCOUT_ANCHORS: Point[] = [
  { x: 840, y: BOTTOM_DESK_Y + 32 },
  { x: 896, y: BOTTOM_DESK_Y + 32 },
  { x: 952, y: BOTTOM_DESK_Y + 32 },
];

// ─── Inter-room wall column x-positions (px = tx * TILE_SIZE) ────────────────

// Top band: 5 inter-room walls between 6 rooms.
export const TOP_INTER_ROOM_WALL_X = [320, 560, 800, 1008, 1136] as const;
// Bottom band: 4 inter-room walls between 5 rooms.
export const BOTTOM_INTER_ROOM_WALL_X = [272, 512, 784, 992] as const;
// Combined for backwards compat with code that doesn't distinguish bands.
export const INTER_ROOM_WALL_X = [...TOP_INTER_ROOM_WALL_X, ...BOTTOM_INTER_ROOM_WALL_X] as const;

// ─── Phase 6: HUD anchor points ──────────────────────────────────────────────

export type HudAnchorName =
  | 'retry-counter'
  | 'round-counter'
  | 'quality-score'
  | 'done-day'
  | 'camera-state';

const HUD_ANCHORS: Record<HudAnchorName, Point> = {
  'retry-counter': { x: 320, y: 264 }, // corridor side of QA chamber
  'round-counter': { x: 568, y: 264 }, // corridor side of Review chamber
  'quality-score': { x: 608, y: 272 }, // beside Review door frame
  'done-day': { x: 968, y: TOP_DESK_Y + 64 }, // below Done shelf
  'camera-state': { x: 8, y: 8 },
};

export function hudAnchor(name: HudAnchorName): Point {
  return HUD_ANCHORS[name];
}

// ─── Phase 6: Priority tint colours ──────────────────────────────────────────

export type Priority = 'critical' | 'high' | 'normal' | 'low';

const PRIORITY_TINT: Record<Priority, string> = {
  critical: '#ef4444',
  high: '#f59e0b',
  normal: '#22d3ee',
  low: '#9ca3af',
};

export function priorityTintColor(priority: Priority): string {
  return PRIORITY_TINT[priority];
}

// ─── Phase 6: Room pressure colour (in-flight ticket count → tint) ──────────

export function pressureColorForCount(n: number): number {
  if (n <= 0) return 0x2a3344;
  if (n <= 3) return 0x2a3344;
  if (n <= 7) return 0x3d3020;
  if (n <= 15) return 0x4a3010;
  return 0x5c3800;
}
