import { KEY_ACTIONS, keyLabel, settings, type KeyAction, type Settings } from '../game/settings.ts';
import { h } from './dom.ts';

let dialog: HTMLDialogElement | null = null;
let onClosed: (() => void) | undefined;

/** Opens the settings dialog; `closed` runs when it's dismissed. */
export function openSettings(closed?: () => void): void {
  dialog ??= createDialog();
  onClosed = closed;
  render();
  dialog.showModal();
}

function createDialog(): HTMLDialogElement {
  const d = h('dialog', { className: 'settings', ariaLabel: 'Settings' });
  d.addEventListener('close', () => {
    stopListening();
    onClosed?.();
    onClosed = undefined;
  });
  // Clicking the backdrop closes it.
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
  document.body.append(d);
  return d;
}

/** The action waiting for a key press while rebinding, if any. */
let listeningFor: { action: KeyAction; slot: number } | null = null;

function stopListening(): void {
  listeningFor = null;
}

window.addEventListener(
  'keydown',
  (e) => {
    if (!listeningFor || !dialog?.open) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code !== 'Escape') {
      const { action, slot } = listeningFor;
      const codes = [...settings.value.keys[action]];
      codes[slot] = e.code;
      settings.setKeys(action, [...new Set(codes.filter(Boolean))]);
    }
    listeningFor = null;
    render();
  },
  true,
);

function render(): void {
  if (!dialog) return;
  const s = settings.value;
  const set = (patch: Partial<Settings>) => {
    settings.update(patch);
    render();
  };

  const range = (label: string, value: number, min: number, max: number, step: number, show: (v: number) => string, apply: (v: number) => void) => {
    const output = h('output', {}, show(value));
    return h('label', { className: 'setting' },
      h('span', {}, label),
      h('input', {
        type: 'range',
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(value),
        oninput: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          output.textContent = show(v);
          apply(v);
        },
      }),
      output,
    );
  };
  const toggle = (label: string, value: boolean, apply: (v: boolean) => void) =>
    h('label', { className: 'setting check' },
      h('span', {}, label),
      h('input', { type: 'checkbox', checked: value, onchange: (e: Event) => apply((e.target as HTMLInputElement).checked) }),
    );
  const choice = <T extends string>(label: string, value: T, options: [T, string][], apply: (v: T) => void) =>
    h('div', { className: 'setting' },
      h('span', {}, label),
      h('div', { className: 'segmented', role: 'group', ariaLabel: label },
        ...options.map(([v, text]) =>
          h('button', { className: `pill toggle${v === value ? ' on' : ''}`, ariaPressed: String(v === value), onclick: () => apply(v) }, text),
        ),
      ),
    );

  const keyRows = KEY_ACTIONS.map(({ action, label }) =>
    h('div', { className: 'keyrow' },
      h('span', {}, label),
      ...[0, 1].map((slot) => {
        const code = s.keys[action][slot];
        const waiting = listeningFor?.action === action && listeningFor.slot === slot;
        return h('button', {
          className: `pill key${waiting ? ' on' : ''}`,
          ariaLabel: `${label}, key ${slot + 1}: ${code ? keyLabel(code) : 'none'}. Press to change.`,
          onclick: () => {
            listeningFor = { action, slot };
            render();
          },
        }, waiting ? 'Press a key…' : code ? keyLabel(code) : '—');
      }),
    ),
  );

  dialog.replaceChildren(
    h('header', {},
      h('h2', {}, 'Settings'),
      h('button', { className: 'icon', ariaLabel: 'Close settings', onclick: () => dialog?.close() }, '✕'),
    ),
    h('section', {},
      h('h3', {}, 'Sound'),
      range('Volume', s.volume, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => settings.update({ volume: v })),
      toggle('Mute', s.muted, (v) => set({ muted: v })),
    ),
    h('section', {},
      h('h3', {}, 'Game'),
      range('Game speed', s.gameSpeed, 1, 11, 1, (v) => (v === 8 ? '8 (original)' : String(v)), (v) => settings.update({ gameSpeed: v })),
      h('p', { className: 'hint' }, 'The original\'s speed scale. The 1×/2×/4× button in battle multiplies it.'),
    ),
    h('section', {},
      h('h3', {}, 'Display'),
      range('Brightness', s.brightness, -5, 5, 1, (v) => (v > 0 ? `+${v}` : String(v)), (v) => settings.update({ brightness: v })),
      toggle('Animated water and lava', s.colorCycling, (v) => set({ colorCycling: v })),
      choice('Health bars', s.healthBars, [['all', 'Everyone'], ['team', 'Your team'], ['off', 'Off']], (v) => set({ healthBars: v })),
      toggle('Radar', s.radar, (v) => set({ radar: v })),
    ),
    h('section', {},
      h('h3', {}, 'Touch controls'),
      choice('Show', s.touchControls, [['auto', 'On touch screens'], ['on', 'Always'], ['off', 'Never']], (v) => set({ touchControls: v })),
      choice('Size', s.touchSize, [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']], (v) => set({ touchSize: v })),
      toggle('Left-handed (joystick on the right)', s.leftHanded, (v) => set({ leftHanded: v })),
    ),
    h('section', {},
      h('h3', {}, 'Keyboard'),
      h('p', { className: 'hint' }, 'Select a key slot, then press the key you want. Esc cancels.'),
      h('div', { className: 'keys' }, ...keyRows),
      h('p', { className: 'hint' }, 'Gamepad: left stick or d-pad moves, A attacks, B special, X switch, Y yell, LB next special, RB alternate.'),
    ),
    h('footer', {},
      h('button', {
        className: 'pill danger',
        onclick: () => {
          if (confirm('Reset all settings, including key bindings, to their defaults?')) {
            settings.reset();
            render();
          }
        },
      }, 'Reset to defaults'),
      h('button', { className: 'pill primary', onclick: () => dialog?.close() }, 'Done'),
    ),
  );
}
