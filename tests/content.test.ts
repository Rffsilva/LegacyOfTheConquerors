import { describe, expect, it } from 'vitest';
import { SCORE } from '../src/audio/music.ts';
import { UNITS } from '../src/data/help.ts';
import { HIREABLE } from '../src/game/campaign.ts';
import { SPECIAL_NAMES } from '../src/sim/specialNames.ts';

describe('field manual', () => {
  it('covers every hireable unit', () => {
    const covered = new Set(UNITS.map((u) => u.family));
    expect(HIREABLE.filter((f) => !covered.has(f))).toEqual([]);
  });

  it('lists as many specials as each unit really has', () => {
    for (const unit of UNITS) {
      const real = (SPECIAL_NAMES[unit.family] ?? []).filter((n) => n !== 'NONE').length;
      expect(unit.specials.length, unit.name).toBe(real);
    }
  });
});

describe('music', () => {
  it.each(Object.entries(SCORE))('%s fits its length and a sensible range', (_name, track) => {
    expect(track.notes.length).toBeGreaterThan(0);
    for (const note of track.notes) {
      expect(note.step + note.length).toBeLessThanOrEqual(track.steps);
      expect(note.pitch).toBeGreaterThanOrEqual(24);
      expect(note.pitch).toBeLessThanOrEqual(96);
    }
    for (const hit of track.hits) expect(hit.step).toBeLessThan(track.steps);
  });
});
