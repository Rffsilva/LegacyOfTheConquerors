/**
 * Converts the original OpenGlad data files into web-friendly assets under public/assets.
 *
 *   npm run convert-assets -- /path/to/openglad
 *
 * Reads pix/ and scen/ loose files first and falls back to graphics.001 / levels.001,
 * matching the original lookup order. Outputs:
 *   sprites.bin + sprites.json   every pixie, raw, with a name -> [offset, length] index
 *   scenarios/index.json         campaign/scenario listing
 *   scenarios/<id>.json          parsed scenario with its map grid inlined
 *   sound/*.wav                  sound effects, copied as-is
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { parseGladPack } from '../src/formats/gladpack.ts';
import { parsePix } from '../src/formats/pix.ts';
import { parseScenario } from '../src/formats/scenario.ts';
import type { MapGrid, ScenarioAsset, ScenarioSummary, SpriteIndex } from '../src/data/assets.ts';

const sourceDir = resolve(process.argv[2] ?? process.env.OPENGLAD_DIR ?? '../../games/openglad-master');
const outDir = resolve(import.meta.dirname, '../public/assets');

if (!existsSync(join(sourceDir, 'graphics.001')) && !existsSync(join(sourceDir, 'pix'))) {
  console.error(`No OpenGlad data found in ${sourceDir}. Pass the OpenGlad directory as an argument.`);
  process.exit(1);
}

function readPack(file: string): Map<string, Uint8Array> {
  const path = join(sourceDir, file);
  return existsSync(path) ? parseGladPack(new Uint8Array(readFileSync(path))) : new Map();
}

/** Loose files override packed ones, like open_data_file() before the pack fallback. */
function collect(pack: string, dir: string, ext: string): Map<string, Uint8Array> {
  const files = new Map([...readPack(pack)].filter(([name]) => name.endsWith(ext)));
  const looseDir = join(sourceDir, dir);
  if (existsSync(looseDir)) {
    for (const name of readdirSync(looseDir)) {
      if (name.toLowerCase().endsWith(ext)) {
        files.set(name.toLowerCase(), new Uint8Array(readFileSync(join(looseDir, name))));
      }
    }
  }
  return files;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'scenarios'), { recursive: true });
mkdirSync(join(outDir, 'sound'), { recursive: true });

// --- Sprites -------------------------------------------------------------
const pixFiles = collect('graphics.001', 'pix', '.pix');
const index: SpriteIndex = {};
const chunks: Uint8Array[] = [];
let offset = 0;
for (const [file, bytes] of [...pixFiles].sort(([a], [b]) => a.localeCompare(b))) {
  const pix = parsePix(bytes);
  const length = 3 + pix.data.length;
  const chunk = new Uint8Array(length);
  chunk.set([pix.frames, pix.width, pix.height]);
  chunk.set(pix.data, 3);
  index[basename(file, '.pix')] = [offset, length];
  chunks.push(chunk);
  offset += length;
}
writeFileSync(join(outDir, 'sprites.bin'), Buffer.concat(chunks));
writeFileSync(join(outDir, 'sprites.json'), JSON.stringify(index));
console.log(`sprites: ${pixFiles.size} pixies, ${(offset / 1024).toFixed(0)} KiB`);

// --- Scenarios -----------------------------------------------------------
const scenFiles = collect('levels.001', 'scen', '.fss');
const summaries: ScenarioSummary[] = [];
for (const [file, bytes] of scenFiles) {
  const id = basename(file, '.fss');
  let scenario;
  try {
    scenario = parseScenario(bytes);
  } catch (err) {
    console.warn(`  skipping ${file}: ${(err as Error).message}`);
    continue;
  }
  const gridBytes = pixFiles.get(`${scenario.grid}.pix`);
  if (!gridBytes) {
    console.warn(`  skipping ${file}: missing map grid ${scenario.grid}.pix`);
    continue;
  }
  const gridPix = parsePix(gridBytes);
  const grid: MapGrid = { width: gridPix.width, height: gridPix.height, tiles: Array.from(gridPix.data) };
  const asset: ScenarioAsset = { id, ...scenario, map: grid };
  writeFileSync(join(outDir, 'scenarios', `${id}.json`), JSON.stringify(asset));
  summaries.push({ id, title: scenario.title, version: scenario.version, width: grid.width, height: grid.height });
}
summaries.sort((a, b) => scenarioNumber(a.id) - scenarioNumber(b.id) || a.id.localeCompare(b.id));
writeFileSync(join(outDir, 'scenarios', 'index.json'), JSON.stringify(summaries, null, 1));
console.log(`scenarios: ${summaries.length} converted`);

function scenarioNumber(id: string): number {
  const n = /^scen(\d+)$/.exec(id);
  return n ? Number(n[1]) : Number.MAX_SAFE_INTEGER;
}

// --- Sounds --------------------------------------------------------------
const soundDir = join(sourceDir, 'sound');
let sounds = 0;
if (existsSync(soundDir)) {
  for (const name of readdirSync(soundDir)) {
    if (extname(name).toLowerCase() === '.wav') {
      copyFileSync(join(soundDir, name), join(outDir, 'sound', name.toLowerCase()));
      sounds++;
    }
  }
}
console.log(`sounds: ${sounds} copied`);
