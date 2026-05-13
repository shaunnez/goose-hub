// Room geometry owner: renders the six canonical v1 project floor rooms.
// All coordinates are imported from lib/rooms.ts — no literals here.
//
// Public contract:
//   applyProjects(projects)              — full rebuild of all floor blocks
//   refreshIdleDeskIndicators(keys)      — show/hide idle coffee indicators
//   setHeroTicketCell(text)              — update banner R-cell hero ticket label
//   destroyAll()                         — tear down on scene shutdown

import type Phaser from 'phaser';
import { FLOOR_PIXEL_WIDTH, TILE_SIZE, floorOriginY } from '../../lib/layout';
import {
  FLOOR_WORLD,
  INTER_ROOM_WALL_X,
  LIBRARY_BOUNDS,
  ROOM_IDS,
  type RoomId,
  allClickZones,
  roomDeskAnchors,
  roomDoor,
  roomQueueAnchor,
} from '../../lib/rooms';
import { TEXTURE_KEYS } from '../textures';
import type { OfficeProject } from './types';

interface RoomLayerCallbacks {
  navigateFloor: (delta: number) => void;
}

// Pixel rows relative to floor origin (ty × TILE_SIZE)
const ROW_TOP_WALL = 0;
const ROW_BANNER_TOP = TILE_SIZE;
const ROW_CORRIDOR_TOP = TILE_SIZE * 4; // ty=4, py=64
const ROW_CEILING = TILE_SIZE * 7; // ty=7, py=112
const ROW_ROOM_TOP = TILE_SIZE * 8; // ty=8, py=128
const ROW_ROOM_BOTTOM = TILE_SIZE * 22; // ty=22, py=352
const ROW_BOTTOM_WALL = TILE_SIZE * 23; // ty=23, py=368

// Each door gap is 2 tiles wide; half-width for centering
const DOOR_HALF_WIDTH = TILE_SIZE;

// Banner R-cell: hero ticket display (px 848..1263, right-aligned, 12px)
const BANNER_HERO_X = 1263;

export class RoomLayer {
  private readonly scene: Phaser.Scene;
  private readonly callbacks: RoomLayerCallbacks;
  private projects: readonly OfficeProject[] = [];
  private floorContainers: Phaser.GameObjects.Container[] = [];
  private clickZones: Phaser.GameObjects.Zone[] = [];
  /** Banner R-cell texts, one per floor (hero ticket display). */
  private heroTicketTexts: Phaser.GameObjects.Text[] = [];

  constructor(scene: Phaser.Scene, callbacks: RoomLayerCallbacks) {
    this.scene = scene;
    this.callbacks = callbacks;
  }

  applyProjects(projects: readonly OfficeProject[]): void {
    this.projects = projects;
    this.destroyAll();
    for (let i = 0; i < projects.length; i++) {
      this.buildFloor(i, projects[i]);
    }
  }

  refreshIdleDeskIndicators(occupiedKeys: ReadonlySet<string>): void {
    for (const c of this.floorContainers) {
      const children = c.list as Phaser.GameObjects.GameObject[];
      for (const child of children) {
        const obj = child as Phaser.GameObjects.Image;
        if (obj.getData?.('kind') !== 'idle-indicator') continue;
        const key = `${String(obj.getData('floorIndex'))}:${String(obj.getData('deskKey'))}`;
        obj.setVisible(!occupiedKeys.has(key));
      }
    }
  }

  /**
   * Updates the banner R-cell (hero ticket display) on all floor banners.
   * Passing null clears the cell.
   */
  setHeroTicketCell(text: string | null): void {
    for (const t of this.heroTicketTexts) {
      t.setText(text ?? '');
      t.setVisible(text != null && text.length > 0);
    }
  }

  destroyAll(): void {
    for (const c of this.floorContainers) c.destroy();
    this.floorContainers = [];
    for (const z of this.clickZones) z.destroy();
    this.clickZones = [];
    this.heroTicketTexts = [];
  }

  // ─── private ───────────────────────────────────────────────────────────────

  private buildFloor(floorIndex: number, project: OfficeProject): void {
    const originY = floorOriginY(floorIndex);
    const container = this.scene.add.container(0, 0);
    this.floorContainers.push(container);

    this.drawBase(container, originY);
    this.drawWalls(container, originY);
    this.drawRoomOverlays(container, originY);
    this.drawDoneShelf(container, originY);
    this.drawBanner(container, originY, project, floorIndex);
    this.drawRoomLabels(container, originY);
    this.drawDesks(container, originY, floorIndex);
    this.registerClickZones(container, originY, floorIndex);
  }

  private drawBase(container: Phaser.GameObjects.Container, originY: number): void {
    const bg = this.scene.add.graphics();
    bg.fillStyle(0x2a2333, 1);
    bg.fillRect(0, originY, FLOOR_WORLD.width, FLOOR_WORLD.height);
    container.add(bg);

    const corridor = this.scene.add.graphics();
    corridor.fillStyle(0x322a3e, 1);
    corridor.fillRect(0, originY + ROW_CORRIDOR_TOP, FLOOR_WORLD.width, TILE_SIZE * 3);
    container.add(corridor);

    const bannerBg = this.scene.add.graphics();
    bannerBg.fillStyle(0x1a1622, 1);
    bannerBg.fillRect(0, originY + ROW_BANNER_TOP, FLOOR_WORLD.width, TILE_SIZE * 3);
    container.add(bannerBg);
  }

  private drawWalls(container: Phaser.GameObjects.Container, originY: number): void {
    const W = FLOOR_WORLD.width;
    const walls = this.scene.add.graphics();
    walls.fillStyle(0x4a3a5e, 1);

    walls.fillRect(0, originY + ROW_TOP_WALL, W, TILE_SIZE);
    walls.fillRect(0, originY + ROW_BOTTOM_WALL, W, TILE_SIZE);
    this.drawCeilingRow(walls, originY + ROW_CEILING, W);

    const wallH = ROW_BOTTOM_WALL - ROW_CEILING;
    for (const wallX of INTER_ROOM_WALL_X) {
      walls.fillRect(wallX, originY + ROW_CEILING, TILE_SIZE, wallH);
    }

    container.add(walls);
  }

  private drawCeilingRow(
    g: Phaser.GameObjects.Graphics,
    ceilingY: number,
    totalWidth: number,
  ): void {
    const gapCenters: number[] = [];
    for (const id of ROOM_IDS) {
      const door = roomDoor(id as RoomId);
      if (door) gapCenters.push(door.x);
    }
    gapCenters.push(792); // qa.input slot
    gapCenters.push(856); // qa.output slot

    gapCenters.sort((a, b) => a - b);
    let cursor = 0;
    for (const cx of gapCenters) {
      const gapStart = cx - DOOR_HALF_WIDTH;
      const gapEnd = cx + DOOR_HALF_WIDTH;
      if (cursor < gapStart) {
        g.fillRect(cursor, ceilingY, gapStart - cursor, TILE_SIZE);
      }
      cursor = gapEnd;
    }
    if (cursor < totalWidth) {
      g.fillRect(cursor, ceilingY, totalWidth - cursor, TILE_SIZE);
    }
  }

  private drawRoomOverlays(container: Phaser.GameObjects.Container, originY: number): void {
    const roomH = ROW_ROOM_BOTTOM - ROW_ROOM_TOP;
    const overlays = this.scene.add.graphics();

    overlays.fillStyle(0x0a1a3a, 0.45);
    overlays.fillRect(736, originY + ROW_ROOM_TOP, 192, roomH);

    overlays.fillStyle(0x1a1a2a, 0.35);
    overlays.fillRect(944, originY + ROW_ROOM_TOP, 160, roomH);

    overlays.fillStyle(0x0e0b18, 0.55);
    overlays.fillRect(
      LIBRARY_BOUNDS.x1,
      originY + LIBRARY_BOUNDS.y1,
      LIBRARY_BOUNDS.x2 - LIBRARY_BOUNDS.x1,
      LIBRARY_BOUNDS.y2 - LIBRARY_BOUNDS.y1,
    );

    overlays.lineStyle(1, 0x6b4a8e, 1);
    overlays.strokeRect(
      LIBRARY_BOUNDS.x1,
      originY + LIBRARY_BOUNDS.y1,
      LIBRARY_BOUNDS.x2 - LIBRARY_BOUNDS.x1,
      LIBRARY_BOUNDS.y2 - LIBRARY_BOUNDS.y1,
    );

    container.add(overlays);
  }

  private drawDoneShelf(container: Phaser.GameObjects.Container, originY: number): void {
    const shelf = this.scene.add.graphics();
    shelf.fillStyle(0x5c3a1e, 1);
    shelf.fillRect(1120, originY + 160, 143, 8);
    shelf.fillStyle(0x8a6541, 1);
    shelf.fillRect(1120, originY + 160, 143, 2);
    container.add(shelf);
  }

  private drawBanner(
    container: Phaser.GameObjects.Container,
    originY: number,
    project: OfficeProject,
    floorIndex: number,
  ): void {
    // L-cell: Project Name
    const nameText = this.scene.add.text(
      FLOOR_PIXEL_WIDTH / 2,
      originY + ROW_BANNER_TOP + TILE_SIZE * 1.5,
      project.name,
      {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '10px',
        color: '#c7b8ff',
        backgroundColor: '#1a1622',
        padding: { left: 6, right: 6, top: 2, bottom: 2 },
      },
    );
    nameText.setOrigin(0.5, 0.5);
    container.add(nameText);

    // R-cell: Active Hero Ticket (initially hidden)
    const heroText = this.scene.add.text(
      BANNER_HERO_X,
      originY + ROW_BANNER_TOP + TILE_SIZE * 1.5,
      '',
      {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '9px',
        color: '#ffd700',
        backgroundColor: '#1a1622',
        padding: { left: 4, right: 4, top: 2, bottom: 2 },
      },
    );
    heroText.setOrigin(1, 0.5);
    heroText.setVisible(false);
    heroText.setDepth(60); // canvas-hud layer
    container.add(heroText);
    this.heroTicketTexts[floorIndex] = heroText;
  }

  private drawRoomLabels(container: Phaser.GameObjects.Container, originY: number): void {
    const labelY = originY + ROW_CEILING + TILE_SIZE * 2;
    const style = { fontFamily: 'JetBrains Mono, monospace', fontSize: '8px', color: '#8877aa' };
    const labels = [
      { x: 96, text: 'TRIAGE' },
      { x: 312, text: 'INVESTIGATION' },
      { x: 584, text: 'DEV' },
      { x: 832, text: 'QA' },
      { x: 1024, text: 'REVIEW' },
      { x: 1192, text: 'DONE' },
    ] as const;
    for (const { x, text } of labels) {
      const t = this.scene.add.text(x, labelY, text, style);
      t.setOrigin(0.5, 0);
      container.add(t);
    }
  }

  private drawDesks(
    container: Phaser.GameObjects.Container,
    originY: number,
    floorIndex: number,
  ): void {
    for (const id of ROOM_IDS) {
      const anchors = roomDeskAnchors(id as RoomId);
      for (let i = 0; i < anchors.length; i++) {
        const { x, y } = anchors[i];
        const img = this.scene.add.image(x, originY + y, TEXTURE_KEYS.desk);
        img.setOrigin(0.5, 1);
        container.add(img);

        const idle = this.scene.add.image(
          x,
          originY + y - TILE_SIZE * 2.5,
          TEXTURE_KEYS.indicatorCoffee,
        );
        idle.setOrigin(0.5, 1);
        idle.setData('kind', 'idle-indicator');
        idle.setData('floorIndex', floorIndex);
        idle.setData('deskKey', `${id}:${i}`);
        container.add(idle);
      }
    }
  }

  private registerClickZones(
    container: Phaser.GameObjects.Container,
    originY: number,
    floorIndex: number,
  ): void {
    for (const zone of allClickZones()) {
      const { x1, y1, x2, y2 } = zone.rect;
      const w = x2 - x1;
      const h = y2 - y1;
      const pz = this.scene.add.zone(x1 + w / 2, originY + y1 + h / 2, w, h);
      pz.setInteractive({ useHandCursor: false });
      pz.setData('zoneId', zone.id);
      pz.setData('floorIndex', floorIndex);
      this.clickZones.push(pz);
    }

    const dots = this.scene.add.graphics();
    dots.fillStyle(0x6655aa, 0.4);
    for (const id of ROOM_IDS) {
      const qa = roomQueueAnchor(id as RoomId);
      if (qa) dots.fillCircle(qa.x, originY + qa.y, 3);
    }
    container.add(dots);
  }
}
