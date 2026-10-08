import type { ScenarioSummary } from '../data/assets.ts';
import type { SpriteInfo } from '../sim/world.ts';
import type { LivePalette } from '../render/palette.ts';
import type { SpriteBank } from '../render/spriteBank.ts';
import type { IndexedTextures } from '../render/textures.ts';

/** Game-wide singletons, created once by BootScene after the core assets load. */
export interface Services {
  bank: SpriteBank;
  palette: LivePalette;
  textures: IndexedTextures;
  scenarios: ScenarioSummary[];
  /** Sprite sizes for the simulation's collision boxes. */
  spriteInfo: (order: number, family: number) => SpriteInfo | null;
}

let current: Services | null = null;

export function setServices(services: Services): void {
  current = services;
}

export function services(): Services {
  if (!current) throw new Error('Services used before BootScene finished loading');
  return current;
}
