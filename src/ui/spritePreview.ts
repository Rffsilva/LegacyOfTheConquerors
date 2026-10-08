import { SPRITE_FILES, Order } from '../data/objects.ts';
import { PALETTE, resolveSpriteIndex } from '../formats/palette.ts';
import { pixFrame } from '../formats/pix.ts';
import type { SpriteBank } from '../render/spriteBank.ts';

/** Walking toward the viewer: loader.cpp's "down" walk cycle. */
const WALK_DOWN = [0, 4, 0, 8];
const FRAME_MS = 160;

const active = new Set<SpritePreview>();
let timer: number | null = null;

/** An animated, team-coloured unit portrait for the DOM menus. */
export class SpritePreview {
  readonly canvas: HTMLCanvasElement;
  private readonly bank: SpriteBank;
  private family: number;
  private team: number;
  private step = 0;
  private attached = false;

  constructor(bank: SpriteBank, family: number, team = 0, scale = 3) {
    this.bank = bank;
    this.family = family;
    this.team = team;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sprite';
    this.canvas.dataset.scale = String(scale);
    this.draw();
    active.add(this);
    timer ??= window.setInterval(tickAll, FRAME_MS);
  }

  setFamily(family: number): void {
    this.family = family;
    this.step = 0;
    this.draw();
  }

  /** Stops animating; call when the element leaves the page. */
  dispose(): void {
    active.delete(this);
    if (!active.size && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  advance(): void {
    if (!this.canvas.isConnected) {
      if (this.attached) this.dispose(); // removed from the page
      return;
    }
    this.attached = true;
    this.step = (this.step + 1) % WALK_DOWN.length;
    this.draw();
  }

  private draw(): void {
    const name = SPRITE_FILES[Order.LIVING]?.[this.family];
    if (!name || !this.bank.has(name)) return;
    const pix = this.bank.get(name);
    const scale = Number(this.canvas.dataset.scale);
    const frame = pixFrame(pix, pix.frames > 8 ? WALK_DOWN[this.step] : 0);
    this.canvas.width = pix.width;
    this.canvas.height = pix.height;
    this.canvas.style.width = `${pix.width * scale}px`;
    this.canvas.style.height = `${pix.height * scale}px`;
    const ctx = this.canvas.getContext('2d')!;
    const image = ctx.createImageData(pix.width, pix.height);
    for (let i = 0; i < frame.length; i++) {
      if (!frame[i]) continue;
      const [r, g, b] = PALETTE[resolveSpriteIndex(frame[i], this.team)];
      image.data.set([r, g, b, 255], i * 4);
    }
    ctx.putImageData(image, 0, 0);
  }
}

function tickAll(): void {
  for (const preview of [...active]) preview.advance();
}
