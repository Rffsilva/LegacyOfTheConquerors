import Phaser from 'phaser';
import { Order, SPRITE_FILES } from '../data/objects.ts';
import { GRID_SIZE } from '../data/tiles.ts';
import type { Walker } from '../sim/walker.ts';
import { PALETTE } from '../formats/palette.ts';
import type { World } from '../sim/world.ts';
import type { IndexedTextures } from './textures.ts';

/** Health bar colours from base.h: LOW_HP_COLOR, MID_HP_COLOR and LIGHT_GREEN. */
const HP_LOW = rgb(42);
const HP_MID = rgb(237);
const HP_HIGH = rgb(56);

function rgb(index: number): number {
  const [r, g, b] = PALETTE[index];
  return (r << 16) | (g << 8) | b;
}

export type HealthBars = 'all' | 'team' | 'off';

interface Tracked {
  ob: Walker;
  image: Phaser.GameObjects.Image;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  seen: number;
}

/** Larger jumps than this between ticks (teleports, spawns) snap instead of sliding. */
const MAX_SLIDE = GRID_SIZE * 2;

/**
 * Mirrors the simulation into Phaser images. The simulation runs at the original's ~12 ticks a
 * second; positions are interpolated between ticks so motion stays smooth at any frame rate.
 */
export class WorldRenderer {
  private readonly scene: Phaser.Scene;
  private readonly textures: IndexedTextures;
  private readonly layer: Phaser.Tilemaps.TilemapLayer;
  private readonly tracked = new Map<number, Tracked>();
  private generation = 0;
  private readonly bars: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, textures: IndexedTextures, layer: Phaser.Tilemaps.TilemapLayer) {
    this.scene = scene;
    this.textures = textures;
    this.layer = layer;
    this.bars = scene.add.graphics().setDepth(1e6);
  }

  /** Call after each simulation tick. */
  sync(world: World): void {
    const gen = ++this.generation;
    for (const ob of world.fxlist) this.track(ob, 0, gen);
    for (const ob of world.oblist) this.track(ob, ob.ypos + ob.sizey, gen);
    // Missiles draw over whatever they fly past.
    for (const ob of world.weaplist) this.track(ob, ob.ypos + ob.sizey + GRID_SIZE, gen);

    for (const [id, t] of this.tracked) {
      if (t.seen !== gen) {
        t.image.destroy();
        this.tracked.delete(id);
      }
    }
    for (const i of world.tileChanges) this.layer.putTileAt(world.grid[i], i % world.maxx, Math.floor(i / world.maxx));
    world.tileChanges.length = 0;
  }

  /**
   * Call every frame with how far we are between the last tick and the next (0..1). Hurt units
   * get the original's small health bar under them (walker.cpp draw_smallHealthBar).
   */
  draw(alpha: number, healthBars: HealthBars = 'off', team = 0): void {
    this.bars.clear();
    for (const t of this.tracked.values()) {
      const x = Math.round(t.fromX + (t.toX - t.fromX) * alpha);
      const y = Math.round(t.fromY + (t.toY - t.fromY) * alpha);
      t.image.setPosition(x, y);
      if (healthBars !== 'off') this.drawHealth(t.ob, x, y, healthBars === 'all' || t.ob.teamNum === team);
    }
  }

  private drawHealth(ob: Walker, x: number, y: number, show: boolean): void {
    if (!show || (ob.order !== Order.LIVING && ob.order !== Order.GENERATOR)) return;
    const { hitpoints: hp, maxHitpoints: max } = ob.stats;
    const ratio = hp / Math.max(max, 1);
    if (ratio < 0 || ratio >= 0.95) return;
    const color = hp * 3 < max ? HP_LOW : (hp * 3) / 2 < max ? HP_MID : HP_HIGH;
    const top = y + ob.sizey + 1;
    this.bars.fillStyle(0x000000, 1).fillRect(x - 1, top - 1, ob.sizex + 2, 3);
    this.bars.fillStyle(color, 1).fillRect(x, top, Math.max(1, Math.round(ob.sizex * ratio)), 1);
  }

  /** The image showing a given object, e.g. to follow it with the camera. */
  imageFor(ob: Walker): Phaser.GameObjects.Image | undefined {
    return this.tracked.get(ob.id)?.image;
  }

  destroy(): void {
    this.bars.destroy();
    for (const t of this.tracked.values()) t.image.destroy();
    this.tracked.clear();
  }

  private track(ob: Walker, depth: number, gen: number): void {
    if (ob.dead || ob.xpos < 0) return;
    const name = SPRITE_FILES[ob.order]?.[ob.family];
    if (!name) return;
    const key = this.textures.sprite(name, ob.teamNum);
    const frame = ob.frames > 0 ? ((ob.frame % ob.frames) + ob.frames) % ob.frames : 0;

    let t = this.tracked.get(ob.id);
    if (!t) {
      const image = this.scene.add.image(ob.xpos, ob.ypos, key, frame).setOrigin(0, 0);
      t = { ob, image, fromX: ob.xpos, fromY: ob.ypos, toX: ob.xpos, toY: ob.ypos, seen: gen };
      this.tracked.set(ob.id, t);
    } else {
      const jump = Math.abs(ob.xpos - t.toX) + Math.abs(ob.ypos - t.toY);
      t.fromX = jump > MAX_SLIDE ? ob.xpos : t.toX;
      t.fromY = jump > MAX_SLIDE ? ob.ypos : t.toY;
      t.toX = ob.xpos;
      t.toY = ob.ypos;
      if (t.image.texture.key !== key) t.image.setTexture(key, frame);
      else if (t.image.frame.name !== String(frame)) t.image.setFrame(frame);
    }
    t.seen = gen;
    t.image.setDepth(depth);
    t.image.setAlpha(ob.invisibilityLeft > 0 ? 0.35 : 1);
  }
}
