// Authoritative spatial constants for the Office Mode v1 project floor.
// ALL room coordinates, desk anchors, slot anchors, queue anchors, click zones,
// and camera anchors live here. Scene and layer code MUST import from this file;
// no coordinate literal may appear in game/ or components/ that is not defined here.
// Source: Board 02 canonical project floor design-spec.md §3–§8, §10, §14.

export const TILE_SIZE = 16;

export const FLOOR_WORLD = { width: 1280, height: 384 } as const;

// Canonical walking-lane y-coordinate inside the corridor band (ty=4..6).
// Personas and queue stacks travel along this line.
export const CORRIDOR_WALK_Y = 88;

export const ROOM_IDS = ['triage', 'investigation', 'dev', 'qa', 'review', 'done'] as const;
export type RoomId = (typeof ROOM_IDS)[number];

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

// ─── Room pixel bounds (interior, walls excluded) ─────────────────────────────

const ROOM_BOUNDS: Record<RoomId, PixelRect> = {
  triage: { x1: 16, y1: 128, x2: 175, y2: 351 },
  investigation: { x1: 192, y1: 128, x2: 431, y2: 351 },
  dev: { x1: 448, y1: 128, x2: 719, y2: 351 },
  qa: { x1: 736, y1: 128, x2: 927, y2: 351 },
  review: { x1: 944, y1: 128, x2: 1103, y2: 351 },
  done: { x1: 1120, y1: 128, x2: 1263, y2: 351 },
};

export function roomBounds(id: RoomId): PixelRect {
  return ROOM_BOUNDS[id];
}

// ─── Room doors (pixel center at ceiling row ty=7, py=112) ───────────────────

const ROOM_DOORS: Partial<Record<RoomId, Point>> = {
  triage: { x: 80, y: 112 },
  investigation: { x: 392, y: 112 },
  dev: { x: 568, y: 112 },
  // qa: no door; has input/output slots only
  review: { x: 1016, y: 112 },
  done: { x: 1192, y: 112 },
};

export function roomDoor(id: RoomId): Point | null {
  return ROOM_DOORS[id] ?? null;
}

// ─── Desk / station / shelf anchors ──────────────────────────────────────────

const ROOM_DESK_ANCHORS: Record<RoomId, Point[]> = {
  triage: [
    { x: 56, y: 200 }, // triager desk
  ],
  investigation: [
    { x: 232, y: 168 }, // scout desk 1
    { x: 280, y: 168 }, // scout desk 2
    { x: 328, y: 168 }, // scout desk 3
    { x: 280, y: 280 }, // lead investigator desk
  ],
  dev: [
    { x: 512, y: 232 }, // builder desk 1
    { x: 576, y: 232 }, // builder desk 2
    { x: 640, y: 232 }, // builder desk 3
  ],
  qa: [
    { x: 768, y: 232 }, // QA station 1 (silhouette)
    { x: 832, y: 232 }, // QA station 2 (silhouette)
    { x: 896, y: 232 }, // QA station 3 (silhouette)
  ],
  review: [
    { x: 976, y: 232 }, // reviewer silhouette 1
    { x: 1056, y: 232 }, // reviewer silhouette 2
  ],
  done: [
    { x: 1144, y: 168 }, // shelf slot 1
    { x: 1168, y: 168 }, // shelf slot 2
    { x: 1192, y: 168 }, // shelf slot 3 (most recent merge)
    { x: 1216, y: 168 }, // shelf slot 4
    { x: 1240, y: 168 }, // shelf slot 5
  ],
};

export function roomDeskAnchors(id: RoomId): Point[] {
  return ROOM_DESK_ANCHORS[id];
}

// ─── Slot specs for sealed/frosted rooms ─────────────────────────────────────

const LIBRARY_SLOTS: SlotSpec[] = [
  {
    id: 'library.envelope-out',
    side: 'south',
    tileRange: [17, 18],
    direction: 'outbound',
    queueAnchor: null, // opens south into Investigation Lab, not corridor
    exteriorAnchor: { x: 288, y: 200 },
    interiorAnchor: { x: 288, y: 224 },
    tint: 'opaque',
  },
];

const QA_SLOTS: SlotSpec[] = [
  {
    id: 'qa.input',
    side: 'north',
    tileRange: [49, 50],
    direction: 'inbound',
    queueAnchor: { x: 792, y: 88 },
    exteriorAnchor: { x: 792, y: 96 },
    interiorAnchor: { x: 792, y: 136 },
    tint: 'frosted',
  },
  {
    id: 'qa.output',
    side: 'north',
    tileRange: [53, 54],
    direction: 'outbound',
    queueAnchor: { x: 856, y: 88 },
    exteriorAnchor: { x: 856, y: 96 },
    interiorAnchor: { x: 856, y: 136 },
    tint: 'frosted',
  },
];

const REVIEW_SLOTS: SlotSpec[] = [
  {
    id: 'review.door',
    side: 'north',
    tileRange: [63, 64],
    direction: 'bidirectional',
    queueAnchor: { x: 1016, y: 88 },
    exteriorAnchor: { x: 1016, y: 96 },
    interiorAnchor: { x: 1016, y: 136 },
    tint: 'frosted',
  },
];

const ROOM_SLOTS: Partial<Record<RoomId, SlotSpec[]>> = {
  investigation: LIBRARY_SLOTS,
  qa: QA_SLOTS,
  review: REVIEW_SLOTS,
};

export function roomSlotAnchors(id: RoomId): SlotSpec[] {
  return ROOM_SLOTS[id] ?? [];
}

// ─── Queue anchors (corridor-side, py=88) ────────────────────────────────────

const ROOM_QUEUE_ANCHORS: Partial<Record<RoomId, Point>> = {
  triage: { x: 72, y: 88 },
  investigation: { x: 392, y: 88 },
  dev: { x: 568, y: 88 },
  qa: { x: 792, y: 88 },
  review: { x: 1016, y: 88 },
  // done: no queue — tickets arrive via mergeCelebration directly
};

export function roomQueueAnchor(id: RoomId): Point | null {
  return ROOM_QUEUE_ANCHORS[id] ?? null;
}

// ─── Click zones ──────────────────────────────────────────────────────────────

const ALL_CLICK_ZONES: ClickZone[] = [
  { id: 'zone.triage.desk', rect: { x1: 16, y1: 176, x2: 175, y2: 239 } },
  { id: 'zone.investigation.library', rect: { x1: 208, y1: 144, x2: 367, y2: 207 } },
  { id: 'zone.investigation.lead', rect: { x1: 256, y1: 256, x2: 319, y2: 319 } },
  { id: 'zone.dev.desk.0', rect: { x1: 480, y1: 208, x2: 559, y2: 271 } },
  { id: 'zone.dev.desk.1', rect: { x1: 544, y1: 208, x2: 623, y2: 271 } },
  { id: 'zone.dev.desk.2', rect: { x1: 608, y1: 208, x2: 687, y2: 271 } },
  { id: 'zone.qa.face', rect: { x1: 736, y1: 112, x2: 927, y2: 159 } },
  { id: 'zone.review.face', rect: { x1: 944, y1: 112, x2: 1103, y2: 175 } },
  { id: 'zone.done.shelf', rect: { x1: 1120, y1: 160, x2: 1263, y2: 223 } },
  { id: 'zone.queue.triage', rect: { x1: 48, y1: 64, x2: 111, y2: 111 } },
  { id: 'zone.queue.investigation', rect: { x1: 368, y1: 64, x2: 431, y2: 111 } },
  { id: 'zone.queue.dev', rect: { x1: 544, y1: 64, x2: 607, y2: 111 } },
  { id: 'zone.queue.qa', rect: { x1: 768, y1: 64, x2: 831, y2: 111 } },
  { id: 'zone.queue.review', rect: { x1: 992, y1: 64, x2: 1055, y2: 111 } },
];

export function roomClickZones(id: RoomId): ClickZone[] {
  return ALL_CLICK_ZONES.filter((z) => z.id.startsWith(`zone.${id}`));
}

export function allClickZones(): ClickZone[] {
  return ALL_CLICK_ZONES;
}

// ─── Camera anchors ───────────────────────────────────────────────────────────

const CAMERA_ANCHORS: Record<string, CameraAnchor> = {
  'floor-overview': { center: { x: 640, y: 192 }, zoom: 1.0 },
  'hero-ticket-follow': { center: { x: 640, y: 192 }, zoom: 1.0 }, // dynamic; center is placeholder
  'room-triage': { center: { x: 96, y: 200 }, zoom: 1.0 },
  'room-investigation': { center: { x: 312, y: 200 }, zoom: 1.0 },
  'room-dev': { center: { x: 584, y: 200 }, zoom: 1.0 },
  'room-qa': { center: { x: 832, y: 200 }, zoom: 1.0 },
  'room-review': { center: { x: 1024, y: 200 }, zoom: 1.0 },
  'room-done': { center: { x: 1192, y: 200 }, zoom: 1.0 },
  'library-zoom': { center: { x: 288, y: 168 }, zoom: 1.0 },
};

export function cameraAnchor(name: string): CameraAnchor | null {
  return CAMERA_ANCHORS[name] ?? null;
}

// ─── Library sub-room constants ───────────────────────────────────────────────

// Interior bounds (inside outer Investigation room)
export const LIBRARY_BOUNDS: PixelRect = { x1: 208, y1: 144, x2: 367, y2: 207 };

// Center of the envelope slot opening on the Library south wall
export const LIBRARY_ENVELOPE_SLOT_CENTER: Point = { x: 288, y: 216 };

// Reserved scout desk anchors (slots 4–6, not instantiated in v1)
export const LIBRARY_RESERVED_SCOUT_ANCHORS: Point[] = [
  { x: 240, y: 184 },
  { x: 304, y: 184 },
  { x: 352, y: 184 },
];

// ─── Inter-room wall column x-positions (px = tx * TILE_SIZE) ────────────────

// Vertical walls between rooms at tile columns 11, 27, 45, 58, 69.
export const INTER_ROOM_WALL_X = [176, 432, 720, 928, 1104] as const;
