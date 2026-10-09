import { GENERATORS, ITEMS, specialUnlockLevel, TIPS, UNITS } from '../data/help.ts';
import { Order } from '../data/objects.ts';
import { services } from '../game/services.ts';
import { KEY_ACTIONS, keyLabel, settings } from '../game/settings.ts';
import { h } from './dom.ts';
import { SpritePreview } from './spritePreview.ts';

type Tab = 'basics' | 'controls' | 'units' | 'items';

const TABS: [Tab, string][] = [
  ['basics', 'How to play'],
  ['controls', 'Controls'],
  ['units', 'Units'],
  ['items', 'Items'],
];

let dialog: HTMLDialogElement | null = null;
let current: Tab = 'basics';
let onClosed: (() => void) | undefined;

/** Opens the field manual, optionally on a given tab. */
export function openHelp(tab: Tab = current, closed?: () => void): void {
  dialog ??= createDialog();
  current = tab;
  onClosed = closed;
  render();
  dialog.showModal();
}

function createDialog(): HTMLDialogElement {
  const d = h('dialog', { className: 'settings help', ariaLabel: 'Field manual' });
  d.addEventListener('close', () => {
    onClosed?.();
    onClosed = undefined;
  });
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
  document.body.append(d);
  return d;
}

function render(): void {
  if (!dialog) return;
  const tabs = h('nav', { className: 'segmented tabs', role: 'tablist' },
    ...TABS.map(([tab, label]) =>
      h('button', {
        className: `pill toggle${tab === current ? ' on' : ''}`,
        role: 'tab',
        ariaSelected: String(tab === current),
        onclick: () => {
          current = tab;
          render();
          dialog?.querySelector('.help-body')?.scrollTo(0, 0);
        },
      }, label),
    ),
  );
  dialog.replaceChildren(
    h('header', {},
      h('h2', {}, 'Field manual'),
      h('button', { className: 'icon', ariaLabel: 'Close the manual', onclick: () => dialog?.close() }, '✕'),
    ),
    tabs,
    h('div', { className: 'help-body', role: 'tabpanel' }, ...BODIES[current]()),
  );
}

const BODIES: Record<Tab, () => Node[]> = {
  basics: () => [
    section('The goal',
      p('Lead a band of gladiators through a campaign of battlefields. On each field, defeat every enemy, then walk your character onto an exit to move on.'),
      p('You control one squad member at a time; the rest fight on their own. Switch characters whenever you like.'),
    ),
    section('Between battles',
      p('In the barracks you hire recruits and train your team. Higher stats and levels cost more; experience earned in battle makes training cheaper.'),
      p('Winning pays cash for your score, plus a bonus for finishing quickly. Survivors level up, and every third level unlocks a new special ability. Anyone who fell in a won battle is gone for good. Losing or abandoning a battle costs nothing: your team returns as it was.'),
    ),
    section('In battle',
      p('Bump into an enemy to attack it, or attack from range in the direction you face. Specials cost magic, which slowly regenerates. Hold the alternate key for some specials\' second form.'),
      p('The radar shows the whole field: your team, enemies, missiles and blinking exits. Click or tap it to look around.'),
    ),
    section('Monster generators', list(GENERATORS.map((g) => `${g.name}: ${g.text}`))),
    section('Tips', list(TIPS)),
  ],
  controls: () => {
    const keys = settings.value.keys;
    return [
      section('Keyboard',
        h('dl', { className: 'help-keys' },
          ...KEY_ACTIONS.flatMap(({ action, label }) => [
            h('dt', {}, label),
            h('dd', {}, keys[action].map(keyLabel).join(' or ') || '—'),
          ]),
          h('dt', {}, 'Squad defend on/off'),
          h('dd', {}, `${keyLabel(keys.alternate[0] ?? 'ShiftLeft')} + ${keyLabel(keys.yell[0] ?? 'KeyF')}`),
        ),
        p('Change any key in ⚙ Settings.'),
        p('Drag the map with the mouse to look around and use the wheel to zoom. The camera goes back to your character as soon as you move.'),
      ),
      section('Gamepad', list([
        'Left stick or d-pad: move',
        'A: attack · B: special · X: switch character · Y: call squad',
        'LB: next special · RB (hold): alternate special',
      ])),
      section('Touch', list([
        'Joystick (bottom left): move',
        'Attack (hold), Special, Swap, Yo, and Alt (toggles the alternate special)',
        'Drag the map to look around; the camera goes back to your character when you move',
        'Pinch to zoom',
      ])),
    ];
  },
  units: () => {
    const { bank } = services();
    return UNITS.map((unit) =>
      h('article', { className: 'help-unit' },
        new SpritePreview(bank, unit.family, 0, 3).canvas,
        h('div', {},
          h('h3', {}, unit.name, unit.enemyOnly ? h('span', { className: 'tag' }, 'enemy only') : ''),
          p(unit.text),
          unit.specials.length
            ? h('ol', { className: 'help-specials' },
                ...unit.specials.map((sp, i) =>
                  h('li', {},
                    h('strong', {}, sp.name), h('span', { className: 'tag' }, `level ${specialUnlockLevel(i + 1)}`), ` ${sp.text}`,
                    sp.alternate ? h('div', { className: 'alt' }, h('em', {}, `Alternate: ${sp.alternate.name}.`), ` ${sp.alternate.text}`) : '',
                  ),
                ),
              )
            : p('No special abilities.'),
        ),
      ),
    );
  },
  items: () => {
    const { bank } = services();
    return ITEMS.map((item) =>
      h('article', { className: 'help-unit item' },
        new SpritePreview(bank, item.family, 0, 2, Order.TREASURE).canvas,
        h('div', {}, h('h3', {}, item.name), p(item.text)),
      ),
    );
  },
};

function section(title: string, ...content: Node[]): HTMLElement {
  return h('section', {}, h('h3', {}, title), ...content);
}

function p(text: string): HTMLElement {
  return h('p', {}, text);
}

function list(items: string[]): HTMLElement {
  return h('ul', {}, ...items.map((t) => h('li', {}, t)));
}
