import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, keyLabel, settings, tickMs } from '../src/game/settings.ts';
import { TICK_MS } from '../src/game/timing.ts';

describe('settings', () => {
  it('maps the original speed scale to tick lengths', () => {
    expect(tickMs(DEFAULT_SETTINGS.gameSpeed)).toBeCloseTo(TICK_MS); // 6 x 13.6 ms
    expect(tickMs(1)).toBeCloseTo(20 * 13.6);
    expect(tickMs(11)).toBeCloseTo(13.6); // "no delay" is capped at one timer unit
  });

  it('gives each key to only one action', () => {
    settings.reset();
    settings.setKeys('special', ['Space']);
    expect(settings.value.keys.special).toEqual(['Space']);
    expect(settings.value.keys.attack).not.toContain('Space');
    settings.reset();
    expect(settings.value.keys.attack).toContain('Space');
  });

  it('notifies subscribers', () => {
    const seen: number[] = [];
    const stop = settings.subscribe((s) => seen.push(s.brightness));
    settings.update({ brightness: 3 });
    stop();
    settings.update({ brightness: 0 });
    expect(seen).toEqual([0, 3]);
  });

  it('labels keys readably', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('ArrowLeft')).toBe('←');
    expect(keyLabel('ShiftLeft')).toBe('Shift Left');
    expect(keyLabel('Space')).toBe('Space');
  });
});
