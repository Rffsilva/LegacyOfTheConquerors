import Phaser from 'phaser';
import { SPRITE_FILES } from '../data/objects.ts';
import { GRID_SIZE } from '../data/tiles.ts';
import type { Walker } from '../sim/walker.ts';
import type { World } from '../sim/world.ts';
import type { IndexedTextures } from './textures.ts';

interface Tracked {
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

  constructor(scene: Phaser.Scene, textures: IndexedTextures, layer: Phaser.Tilemaps.TilemapLayer) {
    this.scene = scene;
    this.textures = textures;
    this.layer = layer;
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

  /** Call every frame with how far we are between the last tick and the next (0..1). */
  draw(alpha: number): void {
    for (const t of this.tracked.values()) {
      t.image.setPosition(Math.round(t.fromX + (t.toX - t.fromX) * alpha), Math.round(t.fromY + (t.toY - t.fromY) * alpha));
    }
  }

  /** The image showing a given object, e.g. to follow it with the camera. */
  imageFor(ob: Walker): Phaser.GameObjects.Image | undefined {
    return this.tracked.get(ob.id)?.image;
  }

  destroy(): void {
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
      t = { image, fromX: ob.xpos, fromY: ob.ypos, toX: ob.xpos, toY: ob.ypos, seen: gen };
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
