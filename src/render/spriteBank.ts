import type { SpriteIndex } from '../data/assets.ts';
import { parsePix, type Pix } from '../formats/pix.ts';

/** Every original pixie, decoded on demand from the single sprites.bin blob. */
export class SpriteBank {
  private readonly bytes: Uint8Array;
  private readonly index: SpriteIndex;
  private readonly cache = new Map<string, Pix>();

  constructor(bin: ArrayBuffer, index: SpriteIndex) {
    this.bytes = new Uint8Array(bin);
    this.index = index;
  }

  has(name: string): boolean {
    return name in this.index;
  }

  get(name: string): Pix {
    let pix = this.cache.get(name);
    if (!pix) {
      const entry = this.index[name];
      if (!entry) throw new Error(`Unknown sprite "${name}"`);
      const [offset, length] = entry;
      pix = parsePix(this.bytes.subarray(offset, offset + length));
      this.cache.set(name, pix);
    }
    return pix;
  }
}
