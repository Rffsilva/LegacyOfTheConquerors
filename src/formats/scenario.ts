import { ByteReader } from './binary.ts';

/** Scenario flags (base.h SCEN_TYPE_*). */
export const SCEN_TYPE_CAN_EXIT = 1;
export const SCEN_TYPE_GEN_EXIT = 2;
export const SCEN_TYPE_SAVE_ALL = 4;

export interface ScenarioObject {
  order: number;
  family: number;
  /** World position in pixels (top-left of the sprite). */
  x: number;
  y: number;
  team: number;
  facing: number;
  command: number;
  level: number;
  /** Non-empty for named NPCs (BIT_NAMED in the original). */
  name: string;
}

export interface Scenario {
  version: number;
  /** Map grid to load, e.g. "scen0001" (a .pix whose pixels are tile ids). */
  grid: string;
  title: string;
  type: number;
  /** Par value for scoring (v8+); older versions fall back to the scenario level. */
  par: number | null;
  objects: ScenarioObject[];
  /** Briefing text shown before the battle. */
  text: string[];
}

/**
 * Parses an .fss scenario file, versions 2 through 8 (screen.cpp load_version_*).
 *
 *   "FSS" u8 version
 *   char[8] grid name
 *   char[30] title           (v6+)
 *   u8 scenario type         (v5+)
 *   i16 par                  (v8+)
 *   i16 object count, then per object:
 *     u8 order, u8 family, i16 x, i16 y, u8 team, u8 facing, u8 command,
 *     level: u8 (v3-6) or i16 (v7+), char[12] name (v4+), reserved bytes
 *   u8 line count, then per line u8 length + chars   (v3+)
 */
export function parseScenario(bytes: Uint8Array): Scenario {
  const r = new ByteReader(bytes);
  const magic = r.cString(3);
  if (magic !== 'FSS') throw new Error(`Not a scenario file (magic "${magic}")`);
  const version = r.u8();
  if (version < 2 || version > 8) throw new Error(`Unsupported scenario version ${version}`);

  const grid = r.cString(8).toLowerCase();
  const title = version >= 6 ? r.cString(30).trim() : '';
  const type = version >= 5 ? r.u8() : 0;
  const par = version >= 8 ? r.i16() : null;

  const count = r.i16();
  const objects: ScenarioObject[] = [];
  for (let i = 0; i < count; i++) {
    const order = r.u8();
    const family = r.u8();
    const x = r.i16();
    const y = r.i16();
    const team = r.u8();
    const facing = r.u8();
    const command = r.u8();
    let level = 1;
    let name = '';
    if (version === 2) {
      r.skip(11);
    } else {
      level = version >= 7 ? r.i16() : r.u8();
      if (version >= 4) name = r.cString(12).trim();
      r.skip(10);
    }
    objects.push({ order, family, x, y, team, facing, command, level, name });
  }

  const text: string[] = [];
  if (version >= 3 && r.remaining > 0) {
    const lines = r.u8();
    for (let i = 0; i < lines && r.remaining > 0; i++) {
      const width = r.u8();
      text.push(width > 0 ? r.cString(width) : '');
    }
  }

  return { version, grid, title, type, par, objects, text };
}
