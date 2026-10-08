/**
 * Seeded PRNG plus helpers that reproduce C integer semantics. The simulation must only use
 * these (never Math.random) so a battle replays identically from the same seed.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** mulberry32: a 32-bit unsigned integer. */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /**
   * The original's random(x): 0..x-1, or 0 when x < 1. Its argument is a Uint32, so a negative
   * value wraps to a huge range; we reproduce that.
   */
  random(x: number): number {
    const n = Math.trunc(x) >>> 0;
    return n < 1 ? 0 : this.next() % n;
  }

  get seed(): number {
    return this.state;
  }
}

/** C-style integer division (truncates toward zero). */
export function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** Sign of a delta as -1, 0 or 1 (the original's `d / abs(d)`). */
export function sign(n: number): number {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

/** Wraps to a C `signed char`. */
export function int8(n: number): number {
  return ((n << 24) >> 24);
}
