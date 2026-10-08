// Spatial hash of objects for collision (obmap.cpp). Each object is listed in every 32px cell
// its bounding box touches. Objects flagged `ignore` or at negative coordinates are not listed.

import { LivingFamily, Order, WeaponFamily } from '../data/objects.ts';
import { Bit } from './constants.ts';
import type { Walker } from './walker.ts';

const OBRES = 32;
const CELLS = 200;

export class ObMap {
  readonly resolution = OBRES;
  private readonly cells: Walker[][] = Array.from({ length: CELLS * CELLS }, () => []);

  static hash(v: number): number {
    const n = Math.trunc(v / OBRES);
    return n > 198 || n < 0 ? 199 : n;
  }

  cellAt(x: number, y: number): readonly Walker[] {
    return this.cells[ObMap.hash(x) * CELLS + ObMap.hash(y)];
  }

  remove(ob: Walker): void {
    this.forCells(ob.xpos, ob.ypos, ob, (cell) => {
      const i = cell.indexOf(ob);
      if (i !== -1) cell.splice(i, 1);
    });
  }

  add(ob: Walker, x: number, y: number): void {
    if (x < 0 || y < 0) return;
    this.forCells(x, y, ob, (cell) => cell.push(ob));
  }

  /** Re-lists an object at a new position. As in the original, an unchanged position is a no-op. */
  move(ob: Walker, x: number, y: number): void {
    if (x === ob.xpos && y === ob.ypos) return;
    this.remove(ob);
    this.add(ob, x, y);
  }

  /** True if `ob` could occupy (x, y) without bumping into another object (obmap::query_list). */
  isClear(ob: Walker, x: number, y: number): boolean {
    for (let cx = ObMap.hash(x); cx <= ObMap.hash(x + ob.sizex); cx++) {
      for (let cy = ObMap.hash(y); cy <= ObMap.hash(y + ob.sizey); cy++) {
        if (!passCheck(x, y, ob, this.cells[cx * CELLS + cy])) return false;
      }
    }
    return true;
  }

  private forCells(x: number, y: number, ob: Walker, fn: (cell: Walker[]) => void): void {
    for (let cx = ObMap.hash(x); cx <= ObMap.hash(x + ob.sizex); cx++) {
      for (let cy = ObMap.hash(y); cy <= ObMap.hash(y + ob.sizey); cy++) fn(this.cells[cx * CELLS + cy]);
    }
  }
}

/** obmap.cpp ob_pass_check: collision rules between `ob` moving to (x, y) and one cell's objects. */
function passCheck(x: number, y: number, ob: Walker, row: readonly Walker[]): boolean {
  const myOrder = ob.order;
  // Copy: eating treasure or opening doors can change the cell while we walk it.
  for (const other of [...row]) {
    if (other === ob || other.dead) continue;
    const targetOrder = other.order;
    if ((targetOrder === Order.WEAPON || myOrder === Order.WEAPON) && ob.isFriendly(other)) continue;
    if (targetOrder === Order.WEAPON && myOrder === Order.WEAPON && ob.world.rng.random(10) > 3) continue;
    if (targetOrder === Order.TREASURE && myOrder === Order.WEAPON) continue;

    if (!overlaps(x, y, ob.sizex, ob.sizey, other.xpos, other.ypos, other.sizex, other.sizey)) {
      ob.collideOb = null;
      continue;
    }
    if (targetOrder === Order.TREASURE) {
      other.eatMe(ob);
    } else if (targetOrder === Order.WEAPON && other.family === WeaponFamily.DOOR) {
      if (ob.keys & keyBit(other.stats.level)) {
        other.dead = true;
        other.death();
        ob.collide(other);
        return ob.stats.hasFlag(Bit.NO_COLLIDE);
      }
      if (!ob.skipExit && ob.user !== -1) {
        ob.world.notify(`Key ${other.stats.level} needed!`, ob);
        ob.skipExit = 10;
      }
      ob.collide(other);
      return false;
    } else {
      ob.collide(other);
      return ob.stats.hasFlag(Bit.NO_COLLIDE);
    }
  }
  return true;
}

/** Bounding-box test with each box shrunk by a pixel on every side (obmap.cpp collide). */
function overlaps(x: number, y: number, w: number, h: number, x2: number, y2: number, w2: number, h2: number): boolean {
  x += 1;
  x2 += 1;
  y += 1;
  y2 += 1;
  w -= 2;
  w2 -= 2;
  h -= 2;
  h2 -= 2;
  return !(x > x2 + w2 || x + w < x2 || y > y2 + h2 || y + h < y2);
}

/** Plain bounding-box test (effect.cpp hits). */
export function hits(x: number, y: number, w: number, h: number, x2: number, y2: number, w2: number, h2: number): boolean {
  return !(x > x2 + w2 || x + w < x2 || y > y2 + h2 || y + h < y2);
}

/** Door and key levels map to bits 2^level (treasure.cpp, obmap.cpp). */
export function keyBit(level: number): number {
  return level >= 0 && level < 31 ? 1 << level : 0;
}

/**
 * living.cpp walkerIsAutoAttackable. The original compares only the family number, whatever the
 * object's order, so e.g. any family-0 object (a knife, a soldier) counts as a "tent". We keep that.
 */
export function isAutoAttackable(ob: Walker): boolean {
  if (ob.order === Order.LIVING) return true;
  return AUTO_ATTACK_FAMILIES.has(ob.family);
}

const AUTO_ATTACK_FAMILIES = new Set<number>([
  0, // FAMILY_TENT
  1, // FAMILY_TOWER
  LivingFamily.TOWER1,
  3, // FAMILY_TREEHOUSE
  2, // FAMILY_BONES
  WeaponFamily.GLOW,
  WeaponFamily.TREE,
  WeaponFamily.DOOR,
]);
