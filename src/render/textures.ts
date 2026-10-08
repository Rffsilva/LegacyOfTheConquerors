import Phaser from 'phaser';
import { resolveSpriteIndex } from '../formats/palette.ts';
import { pixFrame, type Pix } from '../formats/pix.ts';
import { GRID_SIZE, TILE_FILES } from '../data/tiles.ts';
import { usesCyclingColors, type LivePalette } from './palette.ts';
import type { SpriteBank } from './spriteBank.ts';

export const TILESET_KEY = 'tiles';
const TILESET_COLUMNS = 16;
/** Each tile is drawn with a 1px border of its own edge pixels so scaled tilemaps don't show seams. */
export const TILE_MARGIN = 1;
export const TILE_SPACING = 2;

/**
 * Turns palette-indexed pixies into Phaser canvas textures, shared by all scenes. Textures that use palette-cycled
 * colours are repainted whenever the live palette steps, which animates water and fire.
 */
export class IndexedTextures {
  private readonly textures: Phaser.Textures.TextureManager;
  private readonly bank: SpriteBank;
  private readonly palette: LivePalette;
  private readonly animated: (() => void)[] = [];

  constructor(textures: Phaser.Textures.TextureManager, bank: SpriteBank, palette: LivePalette) {
    this.textures = textures;
    this.bank = bank;
    this.palette = palette;
    palette.onChange(() => this.animated.forEach((repaint) => repaint()));
  }

  /** Builds the map tileset: tile id N is frame N, laid out in a 16-wide grid. */
  tileset(): string {
    if (this.textures.exists(TILESET_KEY)) return TILESET_KEY;
    const stride = GRID_SIZE + TILE_SPACING;
    const rows = Math.ceil(TILE_FILES.length / TILESET_COLUMNS);
    const width = TILESET_COLUMNS * stride;
    const height = rows * stride;
    const tiles = TILE_FILES.map((name) => pixFrame(this.bank.get(name), 0));

    const paint = (target: Uint32Array) => {
      tiles.forEach((tile, id) => {
        const ox = (id % TILESET_COLUMNS) * stride + TILE_MARGIN;
        const oy = Math.floor(id / TILESET_COLUMNS) * stride + TILE_MARGIN;
        for (let y = -TILE_MARGIN; y < GRID_SIZE + TILE_MARGIN; y++) {
          const sy = Math.min(Math.max(y, 0), GRID_SIZE - 1);
          for (let x = -TILE_MARGIN; x < GRID_SIZE + TILE_MARGIN; x++) {
            const sx = Math.min(Math.max(x, 0), GRID_SIZE - 1);
            target[(oy + y) * width + ox + x] = this.palette.rgba[tile[sy * GRID_SIZE + sx]];
          }
        }
      });
    };
    this.createCanvas(TILESET_KEY, width, height, paint, tiles.some(usesCyclingColors));
    return TILESET_KEY;
  }

  /**
   * Returns a texture for a sprite recoloured for `team`, with one numbered frame per pixie frame.
   * Pixel index 0 is transparent and indices 248+ take the team's colour ramp.
   */
  sprite(name: string, team = 0): string {
    const key = `${name}@${team}`;
    if (this.textures.exists(key)) return key;

    const pix = this.bank.get(name);
    const width = pix.width * pix.frames;
    const paint = (target: Uint32Array) => paintStrip(pix, team, this.palette.rgba, target);
    const texture = this.createCanvas(key, width, pix.height, paint, usesCyclingColors(pix.data));
    for (let f = 0; f < pix.frames; f++) texture.add(f, 0, f * pix.width, 0, pix.width, pix.height);
    return key;
  }

  private createCanvas(
    key: string,
    width: number,
    height: number,
    paint: (target: Uint32Array) => void,
    animated: boolean,
  ): Phaser.Textures.CanvasTexture {
    const texture = this.textures.createCanvas(key, width, height);
    if (!texture) throw new Error(`Could not create texture ${key}`);
    const image = texture.context.createImageData(width, height);
    const pixels = new Uint32Array(image.data.buffer);
    const repaint = () => {
      paint(pixels);
      texture.context.putImageData(image, 0, 0);
      texture.refresh();
    };
    repaint();
    if (animated) this.animated.push(repaint);
    return texture;
  }
}

function paintStrip(pix: Pix, team: number, rgba: Uint32Array, target: Uint32Array): void {
  const stripWidth = pix.width * pix.frames;
  for (let f = 0; f < pix.frames; f++) {
    const frame = pixFrame(pix, f);
    for (let y = 0; y < pix.height; y++) {
      for (let x = 0; x < pix.width; x++) {
        const index = frame[y * pix.width + x];
        target[y * stripWidth + f * pix.width + x] = index === 0 ? 0 : rgba[resolveSpriteIndex(index, team)];
      }
    }
  }
}
