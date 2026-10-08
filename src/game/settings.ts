// Player preferences, kept per browser. The game-speed, brightness, colour-cycling, radar and
// health-bar options mirror the original's in-game options menu (view.cpp).

import { TIMER_UNIT_MS } from './timing.ts';

export type KeyAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'attack'
  | 'special'
  | 'cycleSpecial'
  | 'alternate'
  | 'switchUnit'
  | 'yell'
  | 'pause'
  | 'radar';

export const KEY_ACTIONS: readonly { action: KeyAction; label: string }[] = [
  { action: 'up', label: 'Move up' },
  { action: 'down', label: 'Move down' },
  { action: 'left', label: 'Move left' },
  { action: 'right', label: 'Move right' },
  { action: 'attack', label: 'Attack (hold)' },
  { action: 'special', label: 'Special' },
  { action: 'cycleSpecial', label: 'Next special' },
  { action: 'alternate', label: 'Alternate special (hold)' },
  { action: 'switchUnit', label: 'Switch character' },
  { action: 'yell', label: 'Call squad ("Yo!")' },
  { action: 'pause', label: 'Pause' },
  { action: 'radar', label: 'Show/hide radar' },
];

export interface Settings {
  /** Sound effects volume, 0..1. */
  volume: number;
  /** Music volume, 0..1. */
  musicVolume: number;
  muted: boolean;
  /** The original's speed scale, 1 (slowest) to 11 (fastest); 8 is its default. */
  gameSpeed: number;
  /** Original "brightness" steps, -5..5. */
  brightness: number;
  /** Animate water and lava by cycling palette colours. */
  colorCycling: boolean;
  healthBars: 'all' | 'team' | 'off';
  radar: boolean;
  touchControls: 'auto' | 'on' | 'off';
  touchSize: 'small' | 'normal' | 'large';
  leftHanded: boolean;
  /** Up to two key codes per action. */
  keys: Record<KeyAction, string[]>;
}

export const DEFAULT_KEYS: Record<KeyAction, string[]> = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  attack: ['Space', 'KeyJ'],
  special: ['KeyE', 'KeyK'],
  cycleSpecial: ['KeyQ'],
  alternate: ['ShiftLeft', 'ShiftRight'],
  switchUnit: ['Tab'],
  yell: ['KeyF'],
  pause: ['KeyP'],
  radar: ['KeyM'],
};

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.7,
  musicVolume: 0.5,
  muted: false,
  gameSpeed: 8,
  brightness: 0,
  colorCycling: true,
  healthBars: 'all',
  radar: true,
  touchControls: 'auto',
  touchSize: 'normal',
  leftHanded: false,
  keys: DEFAULT_KEYS,
};

const KEY = 'lotc.settings.v1';

/** Milliseconds per game tick for a speed setting (screen::timer_wait in 13.6 ms units). */
export function tickMs(gameSpeed: number): number {
  const timerWait = 20 - (Math.min(11, Math.max(1, gameSpeed)) - 1) * 2;
  return Math.max(timerWait, 1) * TIMER_UNIT_MS;
}

/** A readable label for a key code, e.g. "KeyW" -> "W", "ArrowUp" -> "↑". */
export function keyLabel(code: string): string {
  const arrows: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  if (arrows[code]) return arrows[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code.replace(/(Left|Right)$/, ' $1').replace(/^Shift/, 'Shift').trim();
}

type Listener = (settings: Settings) => void;

class SettingsStore {
  private current: Settings = load();
  private readonly listeners = new Set<Listener>();

  get value(): Settings {
    return this.current;
  }

  update(patch: Partial<Settings>): void {
    this.current = { ...this.current, ...patch };
    save(this.current);
    for (const listener of this.listeners) listener(this.current);
  }

  setKeys(action: KeyAction, codes: string[]): void {
    // A key can only do one thing: take it away from any other action.
    const keys = Object.fromEntries(
      Object.entries(this.current.keys).map(([a, list]) => [a, a === action ? codes : list.filter((c) => !codes.includes(c))]),
    ) as Record<KeyAction, string[]>;
    this.update({ keys });
  }

  reset(): void {
    this.update(structuredClone(DEFAULT_SETTINGS));
  }

  /** Calls `listener` now and on every change. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }
}

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Settings> | null;
    if (saved) return { ...structuredClone(DEFAULT_SETTINGS), ...saved, keys: { ...DEFAULT_KEYS, ...saved.keys } };
  } catch {
    // unreadable or unavailable storage: defaults
  }
  return structuredClone(DEFAULT_SETTINGS);
}

function save(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // not saved; the settings still apply for this session
  }
}

export const settings = new SettingsStore();
