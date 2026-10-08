import type { Scenario } from '../formats/scenario.ts';

/** Shapes of the converted files in public/assets (written by tools/convert-assets.ts). */

/** Pixie name -> [byte offset, byte length] inside sprites.bin. */
export type SpriteIndex = Record<string, [number, number]>;

export interface MapGrid {
  width: number;
  height: number;
  /** Row-major tile ids, see TILE_FILES. */
  tiles: number[];
}

export interface ScenarioAsset extends Scenario {
  id: string;
  map: MapGrid;
}

export interface ScenarioSummary {
  id: string;
  title: string;
  version: number;
  width: number;
  height: number;
}
