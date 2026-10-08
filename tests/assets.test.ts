import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScenarioAsset, ScenarioSummary, SpriteIndex } from '../src/data/assets.ts';
import { SPRITE_FILES } from '../src/data/objects.ts';
import { TILE_FILES } from '../src/data/tiles.ts';
import { spriteForObject } from '../src/render/objectSprites.ts';

/** Integrity checks on the converted data in public/assets (regenerate with npm run convert-assets). */
const assets = join(import.meta.dirname, '../public/assets');
const read = <T>(file: string): T => JSON.parse(readFileSync(join(assets, file), 'utf8')) as T;

const sprites = read<SpriteIndex>('sprites.json');
const scenarios = read<ScenarioSummary[]>('scenarios/index.json');

describe('converted assets', () => {
  it('includes every tile and object sprite the game references', () => {
    const referenced = [...TILE_FILES, ...Object.values(SPRITE_FILES).flatMap((f) => Object.values(f))];
    expect(referenced.filter((name) => !(name in sprites))).toEqual([]);
  });

  it('has the original campaign', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(50);
    expect(scenarios.find((s) => s.id === 'scen1')?.title).toBe('SOUTH OF TALWOOD (BEGINNING)');
  });

  it.each(scenarios.map((s) => s.id))('%s uses only known tiles and objects', (id) => {
    const s = read<ScenarioAsset>(`scenarios/${id}.json`);
    expect(s.map.tiles).toHaveLength(s.map.width * s.map.height);
    expect(s.map.tiles.filter((t) => t >= TILE_FILES.length)).toEqual([]);
    const unknown = s.objects.filter((o) => !spriteForObject(o));
    expect(unknown.map((o) => `${o.order}/${o.family}`)).toEqual([]);
  });
});
