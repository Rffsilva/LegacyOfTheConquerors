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

/** Units to mark on the field: the one this device controls, and (online) friends' ones. */
export interface Marks {
  self: Walker | null;
  friends: readonly { unit: Walker; player: number }[];
}

/** The unit you control: a gold ring at its feet and a gold marker above it. */
const SELF_COLOR = 0xffd166;
/** Friends' units, by player number: a marker above them in their colour, and a light tint. */
const PLAYER_COLORS = [0x5cc8ff, 0xff7ad9, 0x8cf06a, 0xffa04d, 0xb98cff, 0xff6b6b, 0x6bf0e0, 0xf0e06b];

/** A friend's colour mixed most of the way to white: a hint, not a repaint of the sprite. */
function lightTint(color: number): number {
  const mix = (shift: number) => Math.round(((color >> shift) & 0xff) * 0.45 + 255 * 0.55) << shift;
  return mix(16) | mix(8) | mix(0);
}

export function playerColor(player: number): number {
  return PLAYER_COLORS[player % PLAYER_COLORS.length];
}

interface Tracked {
  ob: Walker;
  image: Phaser.GameObjects.Image;
  tint: number;
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
  /** The ring under our unit: drawn just beneath it, so it reads as standing on it. */
  private readonly ring: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, textures: IndexedTextures, layer: Phaser.Tilemaps.TilemapLayer) {
    this.scene = scene;
    this.textures = textures;
    this.layer = layer;
    this.bars = scene.add.graphics().setDepth(1e6);
    this.ring = scene.add.graphics();
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
  draw(alpha: number, healthBars: HealthBars = 'off', team = 0, marks?: Marks): void {
    this.bars.clear();
    this.ring.clear();
    const friends = new Map(marks?.friends.map((f) => [f.unit.id, f.player]));
    for (const t of this.tracked.values()) {
      const x = Math.round(t.fromX + (t.toX - t.fromX) * alpha);
      const y = Math.round(t.fromY + (t.toY - t.fromY) * alpha);
      t.image.setPosition(x, y);
      const friend = friends.get(t.ob.id);
      const tint = friend === undefined ? 0xffffff : lightTint(playerColor(friend));
      if (tint !== t.tint) {
        t.tint = tint;
        if (tint === 0xffffff) t.image.clearTint();
        else t.image.setTint(tint);
      }
      if (healthBars !== 'off') this.drawHealth(t.ob, x, y, healthBars === 'all' || t.ob.teamNum === team);
      if (friend !== undefined) this.drawMarker(t, playerColor(friend));
    }
    const self = marks?.self && this.tracked.get(marks.self.id);
    if (self) this.drawSelf(self);
  }

  /** A soft, slowly pulsing ring at our unit's feet, plus the marker above it. */
  private drawSelf(t: Tracked): void {
    const { image, ob } = t;
    const cx = image.x + ob.sizex / 2;
    const cy = image.y + ob.sizey - 1;
    const width = Math.max(ob.sizex + 6, 14);
    const height = Math.max(6, Math.round(width / 2.5));
    const pulse = 0.65 + 0.3 * Math.sin(this.scene.time.now / 260);
    this.ring.setDepth(image.depth - 0.5);
    this.ring.fillStyle(SELF_COLOR, 0.22).fillEllipse(cx, cy, width, height);
    this.ring.lineStyle(1, SELF_COLOR, pulse).strokeEllipse(cx, cy, width, height);
    this.drawMarker(t, SELF_COLOR);
  }

  /** A small downward arrow above a unit, outlined so it shows on any ground. */
  private drawMarker(t: Tracked, color: number): void {
    const cx = Math.round(t.image.x + t.ob.sizex / 2);
    const top = Math.round(t.image.y) - 8;
    this.bars.fillStyle(0x000000, 0.8).fillTriangle(cx - 4, top - 1, cx + 4, top - 1, cx, top + 5);
    this.bars.fillStyle(color, 1).fillTriangle(cx - 3, top, cx + 3, top, cx, top + 3);
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
    this.ring.destroy();
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
      t = { ob, image, tint: 0xffffff, fromX: ob.xpos, fromY: ob.ypos, toX: ob.xpos, toY: ob.ypos, seen: gen };
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
