import { ORANGE_CYCLE, PALETTE, WATER_CYCLE } from '../formats/palette.ts';

/**
 * The live 256-colour palette, as packed little-endian RGBA (ready for a Uint32 view of ImageData).
 * The original animated water and lava by rotating palette ranges rather than swapping tiles;
 * step() reproduces video::do_cycle.
 */
export class LivePalette {
  readonly rgba = new Uint32Array(256);
  private listeners = new Set<() => void>();

  constructor() {
    PALETTE.forEach(([r, g, b], i) => {
      this.rgba[i] = (255 << 24) | (b << 16) | (g << 8) | r;
    });
  }

  step(): void {
    rotate(this.rgba, WATER_CYCLE.start, WATER_CYCLE.end);
    rotate(this.rgba, ORANGE_CYCLE.start, ORANGE_CYCLE.end);
    for (const listener of this.listeners) listener();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Shifts every colour in [start, end] up one slot, wrapping the last back to the start. */
function rotate(colors: Uint32Array, start: number, end: number): void {
  const last = colors[end];
  colors.copyWithin(start + 1, start, end);
  colors[start] = last;
}

/** True if any pixel uses a colour that the palette cycle animates. */
export function usesCyclingColors(indices: Uint8Array): boolean {
  for (const i of indices) {
    if ((i >= WATER_CYCLE.start && i <= WATER_CYCLE.end) || (i >= ORANGE_CYCLE.start && i <= ORANGE_CYCLE.end)) {
      return true;
    }
  }
  return false;
}
