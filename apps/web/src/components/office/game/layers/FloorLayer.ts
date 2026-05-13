// Owns all floor-level Phaser objects: tiles, walls, banners, desks, click
// zones, idle indicators, and stairs. Knows nothing about sprites.
//
// Public contract:
//   applyProjects(projects)          — full rebuild of all floors
//   refreshIdleDeskIndicators(keys)  — show/hide coffee indicators
//   destroyAll()                     — tear down on scene shutdown

import type Phaser from 'phaser';
import type { AgentPlacement } from '../../lib/agent-positions';
import {
  FLOOR_PIXEL_HEIGHT,
  FLOOR_PIXEL_WIDTH,
  TILE_SIZE,
  deskPositions,
  floorOriginY,
  stairsPosition,
} from '../../lib/layout';
import { TEXTURE_KEYS } from '../textures';
import type { DeskClickPayload, OfficeProject } from './types';

interface FloorLayerCallbacks {
  navigateFloor: (delta: number) => void;
  getPlacements: () => readonly AgentPlacement[];
}

export class FloorLayer {
  private readonly scene: Phaser.Scene;
  private readonly emitter: Phaser.Events.EventEmitter;
  private readonly callbacks: FloorLayerCallbacks;
  private projects: readonly OfficeProject[] = [];
  private floorContainers: Phaser.GameObjects.Container[] = [];
  private deskClickZones = new Map<string, Phaser.GameObjects.Zone>();

  constructor(
    scene: Phaser.Scene,
    emitter: Phaser.Events.EventEmitter,
    callbacks: FloorLayerCallbacks,
  ) {
    this.scene = scene;
    this.emitter = emitter;
    this.callbacks = callbacks;
  }

  applyProjects(projects: readonly OfficeProject[]): void {
    this.projects = projects;
    for (const c of this.floorContainers) c.destroy();
    this.floorContainers = [];
    for (const z of this.deskClickZones.values()) z.destroy();
    this.deskClickZones.clear();
    for (let i = 0; i < projects.length; i++) {
      this.buildFloor(i, projects[i]);
    }
  }

  refreshIdleDeskIndicators(occupiedKeys: ReadonlySet<string>): void {
    for (const c of this.floorContainers) {
      const children = c.list as Phaser.GameObjects.GameObject[];
      for (const child of children) {
        if ((child as Phaser.GameObjects.Image).getData?.('kind') !== 'idle-indicator') continue;
        const key = `${(child as Phaser.GameObjects.Image).getData('floorIndex')}:${(child as Phaser.GameObjects.Image).getData('role')}`;
        (child as Phaser.GameObjects.Image).setVisible(!occupiedKeys.has(key));
      }
    }
  }

  destroyAll(): void {
    for (const c of this.floorContainers) c.destroy();
    this.floorContainers = [];
    for (const z of this.deskClickZones.values()) z.destroy();
    this.deskClickZones.clear();
  }

  private buildFloor(floorIndex: number, project: OfficeProject): void {
    const originY = floorOriginY(floorIndex);
    const container = this.scene.add.container(0, 0);
    this.floorContainers.push(container);

    // Floor tiles — alternate two shades for a checkered feel.
    for (let ty = 0; ty < FLOOR_PIXEL_HEIGHT / TILE_SIZE; ty++) {
      for (let tx = 0; tx < FLOOR_PIXEL_WIDTH / TILE_SIZE; tx++) {
        const key = (tx + ty) % 2 === 0 ? TEXTURE_KEYS.floorTile : TEXTURE_KEYS.floorTileAlt;
        const tile = this.scene.add.image(tx * TILE_SIZE, originY + ty * TILE_SIZE, key);
        tile.setOrigin(0, 0);
        container.add(tile);
      }
    }

    // Top wall row.
    for (let tx = 0; tx < FLOOR_PIXEL_WIDTH / TILE_SIZE; tx++) {
      const w = this.scene.add.image(tx * TILE_SIZE, originY, TEXTURE_KEYS.wallTile);
      w.setOrigin(0, 0);
      container.add(w);
    }

    // Project banner.
    const banner = this.scene.add.text(
      FLOOR_PIXEL_WIDTH / 2,
      originY + TILE_SIZE / 2,
      `Floor ${floorIndex + 1} — ${project.name}`,
      {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '10px',
        color: '#c7b8ff',
        backgroundColor: '#1a1622',
        padding: { left: 6, right: 6, top: 2, bottom: 2 },
      },
    );
    banner.setOrigin(0.5, 0.5);
    container.add(banner);

    // Desks — one per role, with a click zone.
    const desks = deskPositions(floorIndex);
    for (const desk of desks) {
      const img = this.scene.add.image(desk.x, desk.y, TEXTURE_KEYS.desk);
      img.setOrigin(0.5, 1);
      container.add(img);
      // Coffee idle indicator placeholder, replaced by sprite when busy.
      const idle = this.scene.add.image(
        desk.x,
        desk.y - TILE_SIZE * 2.5,
        TEXTURE_KEYS.indicatorCoffee,
      );
      idle.setOrigin(0.5, 1);
      idle.setData('role', desk.role);
      idle.setData('floorIndex', floorIndex);
      idle.setData('kind', 'idle-indicator');
      container.add(idle);
      // Click zone covering the desk + sprite area.
      const zone = this.scene.add.zone(desk.x, desk.y - TILE_SIZE, TILE_SIZE * 3, TILE_SIZE * 4);
      zone.setOrigin(0.5, 1);
      zone.setInteractive({ useHandCursor: true });
      zone.setData('role', desk.role);
      zone.setData('floorIndex', floorIndex);
      zone.on('pointerdown', () => this.handleDeskClick(floorIndex, desk.role));
      this.deskClickZones.set(`${floorIndex}:${desk.role}`, zone);
      container.add(zone);
    }

    // Stairs sprite — clickable; navigates +1 floor.
    const stairs = stairsPosition(floorIndex);
    const stairsImg = this.scene.add.image(stairs.x, stairs.y, TEXTURE_KEYS.stairs);
    stairsImg.setOrigin(0.5, 0);
    stairsImg.setInteractive({ useHandCursor: true });
    stairsImg.setData('floorIndex', floorIndex);
    stairsImg.on('pointerdown', () => {
      // Click goes to next floor (down) on most floors; on the bottom, goes up.
      const nextDelta = floorIndex === this.projects.length - 1 ? -1 : +1;
      this.callbacks.navigateFloor(nextDelta);
    });
    container.add(stairsImg);
  }

  private handleDeskClick(floorIndex: number, role: string): void {
    const project = this.projects[floorIndex];
    if (project == null) return;
    const placement = this.callbacks
      .getPlacements()
      .find((p) => p.projectSlug === project.slug && p.role === role);
    if (placement == null) return;
    this.emitter.emit('desk-click', {
      projectSlug: project.slug,
      workItemId: placement.workItemId,
      externalId: placement.externalId,
      title: placement.title,
    } satisfies DeskClickPayload);
  }
}
