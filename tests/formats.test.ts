import { describe, expect, it } from 'vitest';
import { parseGladPack } from '../src/formats/gladpack.ts';
import { PALETTE, resolveSpriteIndex, teamColorBase } from '../src/formats/palette.ts';
import { parsePix, pixFrame } from '../src/formats/pix.ts';
import { parseScenario } from '../src/formats/scenario.ts';
import { LivePalette } from '../src/render/palette.ts';

/** Little-endian byte builder for synthetic fixtures. */
class Bytes {
  private out: number[] = [];
  u8(...v: number[]) {
    this.out.push(...v.map((n) => n & 0xff));
    return this;
  }
  i16(v: number) {
    return this.u8(v, v >> 8);
  }
  i32(v: number) {
    return this.u8(v, v >> 8, v >> 16, v >> 24);
  }
  str(s: string, width = s.length) {
    for (let i = 0; i < width; i++) this.out.push(i < s.length ? s.charCodeAt(i) : 0);
    return this;
  }
  get length() {
    return this.out.length;
  }
  build() {
    return new Uint8Array(this.out);
  }
}

describe('parseGladPack', () => {
  it('splits entries by consecutive offsets', () => {
    const headerSize = 8 + 2 + 2 * 17 + 4;
    const b = new Bytes()
      .str('GladPack')
      .i16(2)
      .i32(headerSize)
      .str('A.PIX', 13)
      .i32(headerSize + 3)
      .str('b.fss', 13)
      .i32(headerSize + 5)
      .u8(1, 2, 3, 4, 5);
    const files = parseGladPack(b.build());
    expect([...files.keys()]).toEqual(['a.pix', 'b.fss']);
    expect([...files.get('a.pix')!]).toEqual([1, 2, 3]);
    expect([...files.get('b.fss')!]).toEqual([4, 5]);
  });

  it('rejects other files', () => {
    expect(() => parseGladPack(new Bytes().str('NotAPack').i16(0).i32(0).build())).toThrow(/GladPack/);
  });
});

describe('parsePix', () => {
  it('reads header and frames, padding truncated data', () => {
    const pix = parsePix(new Uint8Array([2, 2, 1, 7, 8, 9]));
    expect(pix).toMatchObject({ frames: 2, width: 2, height: 1 });
    expect([...pixFrame(pix, 0)]).toEqual([7, 8]);
    expect([...pixFrame(pix, 1)]).toEqual([9, 0]);
    expect([...pixFrame(pix, 3)]).toEqual([9, 0]);
  });
});

describe('parseScenario', () => {
  function object(b: Bytes, version: number, team: number, name = '') {
    b.u8(0, 1).i16(32).i16(48).u8(team, 4, 0);
    if (version >= 7) b.i16(12);
    else b.u8(3);
    b.str(name, 12).str('', 10);
  }

  it('parses a version 8 scenario with par value and text', () => {
    const b = new Bytes().str('FSS').u8(8).str('scen0042', 8).str('THE ARENA', 30).u8(1).i16(250).i16(2);
    object(b, 8, 0, 'Hero');
    object(b, 8, 3);
    b.u8(2).u8(5).str('Hello').u8(0);

    const s = parseScenario(b.build());
    expect(s).toMatchObject({ version: 8, grid: 'scen0042', title: 'THE ARENA', type: 1, par: 250 });
    expect(s.objects).toHaveLength(2);
    expect(s.objects[0]).toEqual({ order: 0, family: 1, x: 32, y: 48, team: 0, facing: 4, command: 0, level: 12, name: 'Hero' });
    expect(s.objects[1].team).toBe(3);
    expect(s.text).toEqual(['Hello', '']);
  });

  it('parses a version 5 scenario without title or par', () => {
    const b = new Bytes().str('FSS').u8(5).str('SCEN0001', 8).u8(0).i16(1);
    object(b, 5, 1);
    b.u8(0);

    const s = parseScenario(b.build());
    expect(s).toMatchObject({ version: 5, grid: 'scen0001', title: '', par: null });
    expect(s.objects[0].level).toBe(3);
  });
});

describe('palette', () => {
  it('expands 6-bit VGA channels to 8 bits', () => {
    expect(PALETTE[0]).toEqual([0, 0, 0]);
    expect(PALETTE[15]).toEqual([231, 231, 231]); // 57 = 0b111001 -> 0b111001_11
  });

  it('recolours team pixels to the team ramp', () => {
    expect(resolveSpriteIndex(100, 3)).toBe(100);
    expect(resolveSpriteIndex(255, 0)).toBe(teamColorBase(0));
    expect(resolveSpriteIndex(248, 2)).toBe(teamColorBase(2) + 7);
  });

  it('rotates the water range by one slot per step', () => {
    const p = new LivePalette();
    const before = Array.from(p.rgba.subarray(208, 224));
    p.step();
    expect(Array.from(p.rgba.subarray(208, 224))).toEqual([before[15], ...before.slice(0, 15)]);
    expect(p.rgba[207]).toBe(new LivePalette().rgba[207]);
  });
});
