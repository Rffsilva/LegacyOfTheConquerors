// The battle radar (radar.cpp), shown as a whole-map minimap with a camera frame.

import { Order, TreasureFamily as T } from '../data/objects.ts';
import { GRID_SIZE, TILE_FILES } from '../data/tiles.ts';
import { PALETTE, teamColorBase, type Rgb } from '../formats/palette.ts';
import { pixFrame } from '../formats/pix.ts';
import type { SpriteBank } from '../render/spriteBank.ts';
import type { Walker } from '../sim/walker.ts';
import type { World } from '../sim/world.ts';

/** Screen pixels per map tile on the minimap. */
const SCALE = 3;
const WHITE: Rgb = [235, 235, 235];
const FIRE: Rgb = [235, 120, 40];
const EXIT: Rgb = [90, 170, 255];
const TREASURE_COLORS: Partial<Record<number, Rgb>> = {
  [T.GOLD_BAR]: [240, 210, 60],
  [T.SILVER_BAR]: [200, 200, 210],
  [T.DRUMSTICK]: [170, 110, 60],
  [T.MAGIC_POTION]: [80, 120, 255],
  [T.INVIS_POTION]: [80, 120, 255],
  [T.INVULNERABLE_POTION]: [80, 120, 255],
  [T.FLIGHT_POTION]: [80, 120, 255],
  [T.SPEED_POTION]: [80, 120, 255],
};

export interface CameraRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class Radar {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tileColors: Rgb[];
  private terrain: ImageData | null = null;
  private terrainFor: World | null = null;
  /** The grid as last painted, to catch scorched tiles. */
  private painted = new Uint8Array(0);
  private blink = 0;
  /** Called with a world position when the minimap is clicked or tapped. */
  onPick?: (x: number, y: number) => void;

  constructor(canvas: HTMLCanvasElement, bank: SpriteBank) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.tileColors = TILE_FILES.map((name) => averageColor(bank, name));

    const pick = (e: PointerEvent) => {
      if (!this.terrainFor || !(e.buttons & 1)) return;
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * this.terrainFor.pixmaxx;
      const y = ((e.clientY - r.top) / r.height) * this.terrainFor.pixmaxy;
      this.onPick?.(x, y);
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pick(e);
    });
    canvas.addEventListener('pointermove', pick);
  }

  /** Redraws terrain, objects and the camera frame. `control` is the player's unit. */
  draw(world: World, control: Walker | null, camera: CameraRect): void {
    if (this.terrainFor !== world) this.buildTerrain(world);
    for (let i = 0; i < world.grid.length; i++) if (world.grid[i] !== this.painted[i]) this.paintTile(world, i);
    this.blink++;

    const ctx = this.ctx;
    ctx.putImageData(this.terrain!, 0, 0);
    const team = control?.teamNum ?? 0;
    const seeAll = (control?.viewAll ?? 0) > 0;
    const dot = (ob: Walker, color: Rgb, size = 1) => {
      ctx.fillStyle = `rgb(${color[0]} ${color[1]} ${color[2]})`;
      const x = Math.trunc((ob.xpos + 1) / GRID_SIZE) * SCALE;
      const y = Math.trunc((ob.ypos + 1) / GRID_SIZE) * SCALE;
      ctx.fillRect(x, y, SCALE * size, SCALE * size);
    };

    for (const ob of world.fxlist) {
      if (ob.dead || ob.order !== Order.TREASURE) continue;
      if (ob.family === T.EXIT || ob.family === T.TELEPORTER) {
        if ((this.blink >> 2) % 2) dot(ob, EXIT, 2);
      } else if (seeAll && TREASURE_COLORS[ob.family]) {
        dot(ob, TREASURE_COLORS[ob.family]!);
      }
    }
    for (const ob of [...world.oblist, ...world.weaplist]) {
      if (ob.dead || ob === control) continue;
      const visible = ob.teamNum === team || ob.invisibilityLeft < 1 || seeAll;
      if (!visible) continue;
      if (ob.order === Order.LIVING) dot(ob, teamColor(ob.teamNum));
      else if (ob.order === Order.GENERATOR) seeAll && dot(ob, teamColor(ob.teamNum, 1), 2);
      else if (ob.isType(Order.TREASURE, T.LIFE_GEM)) dot(ob, FIRE);
      else if (ob.order === Order.WEAPON) dot(ob, WHITE);
    }
    if (control && !control.dead && (this.blink >> 1) % 2) dot(control, [255, 255, 255], 2);

    // Camera frame.
    ctx.strokeStyle = 'rgb(255 255 255 / 0.8)';
    ctx.lineWidth = 1;
    const k = SCALE / GRID_SIZE;
    ctx.strokeRect(Math.round(camera.x * k) + 0.5, Math.round(camera.y * k) + 0.5, Math.round(camera.width * k) - 1, Math.round(camera.height * k) - 1);
  }

  private buildTerrain(world: World): void {
    this.terrainFor = world;
    this.canvas.width = world.maxx * SCALE;
    this.canvas.height = world.maxy * SCALE;
    this.terrain = this.ctx.createImageData(this.canvas.width, this.canvas.height);
    this.painted = new Uint8Array(world.grid.length);
    for (let i = 0; i < world.grid.length; i++) this.paintTile(world, i);
  }

  private paintTile(world: World, index: number): void {
    this.painted[index] = world.grid[index];
    const data = this.terrain!.data;
    const [r, g, b] = this.tileColors[world.grid[index]] ?? [0, 0, 0];
    const tx = (index % world.maxx) * SCALE;
    const ty = Math.trunc(index / world.maxx) * SCALE;
    for (let y = 0; y < SCALE; y++) {
      for (let x = 0; x < SCALE; x++) {
        const p = ((ty + y) * this.canvas.width + tx + x) * 4;
        data[p] = r;
        data[p + 1] = g;
        data[p + 2] = b;
        data[p + 3] = 255;
      }
    }
  }
}

function teamColor(team: number, shade = 0): Rgb {
  return PALETTE[teamColorBase(team) + shade];
}

/** Each tile's average colour, so the minimap reads like a tiny version of the map. */
function averageColor(bank: SpriteBank, name: string): Rgb {
  if (!bank.has(name)) return [0, 0, 0];
  const frame = pixFrame(bank.get(name), 0);
  let r = 0;
  let g = 0;
  let b = 0;
  for (const i of frame) {
    r += PALETTE[i][0];
    g += PALETTE[i][1];
    b += PALETTE[i][2];
  }
  const n = frame.length || 1;
  // Slightly darker than the real map so the unit dots stand out.
  return [Math.round((r / n) * 0.8), Math.round((g / n) * 0.8), Math.round((b / n) * 0.8)];
}
