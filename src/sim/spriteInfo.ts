import type { SpriteIndex } from '../data/assets.ts';
import { SPRITE_FILES } from '../data/objects.ts';
import type { SpriteInfo } from './world.ts';

/**
 * Builds the world's sprite-size lookup from the converted sprite bundle. Only each pixie's
 * 3-byte header is read: frame count, width, height.
 */
export function spriteInfoFromBundle(index: SpriteIndex, bin: Uint8Array): (order: number, family: number) => SpriteInfo | null {
  const cache = new Map<string, SpriteInfo | null>();
  return (order, family) => {
    const name = SPRITE_FILES[order]?.[family];
    if (!name) return null;
    let info = cache.get(name);
    if (info === undefined) {
      const entry = index[name];
      info = entry ? { frames: bin[entry[0]], width: bin[entry[0] + 1], height: bin[entry[0] + 2] } : null;
      cache.set(name, info);
    }
    return info;
  };
}
