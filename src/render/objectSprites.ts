import { LivingFamily, Order, SPRITE_FILES, TreasureFamily } from '../data/objects.ts';
import type { ScenarioObject } from '../formats/scenario.ts';

/** Standing frame for each facing (FACE_UP .. FACE_UP_LEFT), the first frame of loader.cpp's bit1..bit8 walk cycles. */
const LIVING_FACING_FRAMES = [1, 13, 2, 14, 0, 12, 3, 15];

/** Treasures that share a pixie with another family and pick a frame from it (loader.cpp set_direct_frame). */
const TREASURE_FRAMES: Readonly<Record<number, number>> = {
  [TreasureFamily.SILVER_BAR]: 1,
  [TreasureFamily.INVIS_POTION]: 1,
  [TreasureFamily.INVULNERABLE_POTION]: 2,
  [TreasureFamily.FLIGHT_POTION]: 11,
  [TreasureFamily.SPEED_POTION]: 3,
};

/** Families whose pixies aren't laid out in the standard 8-facing walk cycle. */
const SINGLE_FACING_LIVING = new Set<number>([
  LivingFamily.SLIME,
  LivingFamily.SMALL_SLIME,
  LivingFamily.MEDIUM_SLIME,
  LivingFamily.GIANT_SKELETON,
  LivingFamily.TOWER1,
]);

export interface SpriteRef {
  name: string;
  frame: number;
}

export function spriteForObject(ob: Pick<ScenarioObject, 'order' | 'family' | 'facing'>): SpriteRef | null {
  const name = SPRITE_FILES[ob.order]?.[ob.family];
  if (!name) return null;

  let frame = 0;
  if (ob.order === Order.LIVING && !SINGLE_FACING_LIVING.has(ob.family)) {
    frame = LIVING_FACING_FRAMES[ob.facing & 7];
  } else if (ob.order === Order.TREASURE) {
    frame = TREASURE_FRAMES[ob.family] ?? 0;
  }
  return { name, frame };
}
