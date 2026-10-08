import type { ScenarioAsset, ScenarioSummary } from '../data/assets.ts';
import { PALETTE, teamColorBase } from '../formats/palette.ts';
import { settings } from '../game/settings.ts';
import type { Outcome } from '../sim/world.ts';

export interface ViewerActions {
  select(id: string): void;
  zoom(factor: number): void;
  togglePlay(): void;
  cycleSpeed(): void;
  restart(): void;
  /** Skirmish: back to the main menu. Campaign: abandon the battle. */
  menu(): void;
  /** Campaign: continue to the battle report. */
  finish(): void;
  settings(): void;
  help(): void;
}

export type BattleMode = 'skirmish' | 'campaign';

export interface UnitCard {
  name: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  level: number;
  special: string;
}

const TOAST_MS = 3500;
const MAX_TOASTS = 4;


/**
 * HTML overlay: menus, HUD and touch controls live in the DOM rather than the canvas so they
 * stay crisp, accessible and responsive at any screen size.
 */
class ViewerUi {
  readonly root: HTMLElement;
  private readonly picker: HTMLSelectElement;
  private readonly info: HTMLElement;
  private readonly teams: HTMLElement;
  private readonly card: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly outcome: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly speedButton: HTMLButtonElement;
  private readonly specialButton: HTMLElement;
  private scenarios: ScenarioSummary[] = [];
  private actions?: ViewerActions;
  private lastCard = '';
  private mode: BattleMode = 'skirmish';

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <header class="bar">
        <button class="icon" data-act="menu" aria-label="Menu">☰</button>
        <button class="icon skirmish-only" data-act="prev" aria-label="Previous scenario">‹</button>
        <select class="picker skirmish-only" aria-label="Scenario"></select>
        <div class="field-title campaign-only"></div>
        <button class="icon skirmish-only" data-act="next" aria-label="Next scenario">›</button>
        <button class="icon play" data-act="play" aria-label="Start battle">▶</button>
        <button class="icon speed" data-act="speed" aria-label="Battle speed">1×</button>
        <button class="icon" data-act="info" aria-label="Briefing and controls" aria-expanded="false">?</button>
        <button class="icon" data-act="settings" aria-label="Settings">⚙</button>
      </header>
      <section class="info" hidden></section>
      <div class="status">
        <div class="teams" aria-label="Units per team"></div>
        <div class="card" hidden></div>
      </div>
      <div class="toasts" aria-live="polite"></div>
      <section class="outcome" hidden></section>
      <div class="radar-box">
        <div class="tool-row">
          <button class="icon fullscreen-toggle" data-act="fullscreen" aria-label="Full screen" hidden>⛶</button>
          <button class="icon radar-toggle" data-act="radar" aria-label="Show or hide the radar (M)" aria-pressed="true">◎</button>
        </div>
        <canvas class="radar" aria-label="Radar: the whole field. Click to look there."></canvas>
      </div>
      <div class="zoom">
        <button class="icon" data-act="zoom-in" aria-label="Zoom in">+</button>
        <button class="icon" data-act="zoom-out" aria-label="Zoom out">−</button>
      </div>
      <div class="touch" aria-hidden="true">
        <div class="stick"><div class="stick-knob"></div></div>
        <div class="buttons">
          <button class="tb small" data-touch="yell">Yo</button>
          <button class="tb small" data-touch="switchUnit">Swap</button>
          <button class="tb small" data-touch="alternate">Alt</button>
          <button class="tb special" data-touch="special">Special</button>
          <button class="tb fire" data-touch="fire">Attack</button>
        </div>
      </div>`;
    this.picker = root.querySelector('.picker')!;
    this.info = root.querySelector('.info')!;
    this.teams = root.querySelector('.teams')!;
    this.card = root.querySelector('.card')!;
    this.toasts = root.querySelector('.toasts')!;
    this.outcome = root.querySelector('.outcome')!;
    this.playButton = root.querySelector('.play')!;
    this.speedButton = root.querySelector('.speed')!;
    this.specialButton = root.querySelector('.tb.special')!;

    this.picker.addEventListener('change', () => this.actions?.select(this.picker.value));
    root.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'prev') this.step(-1);
      else if (act === 'next' || act === 'next-scenario') this.step(1);
      else if (act === 'zoom-in') this.actions?.zoom(1.25);
      else if (act === 'zoom-out') this.actions?.zoom(0.8);
      else if (act === 'info') this.toggleInfo();
      else if (act === 'play') this.actions?.togglePlay();
      else if (act === 'speed') this.actions?.cycleSpeed();
      else if (act === 'restart') this.actions?.restart();
      else if (act === 'menu') this.actions?.menu();
      else if (act === 'finish') this.actions?.finish();
      else if (act === 'radar') settings.update({ radar: !settings.value.radar });
      else if (act === 'settings') this.actions?.settings();
      else if (act === 'help') this.actions?.help();
      else if (act === 'fullscreen') void toggleFullscreen();
    });
    window.addEventListener('keydown', (e) => {
      if (root.hidden || e.target instanceof HTMLInputElement || document.querySelector('dialog[open]')) return;
      if (settings.value.keys.radar.includes(e.code)) settings.update({ radar: !settings.value.radar });
      else if (settings.value.keys.pause.includes(e.code)) this.actions?.togglePlay();
    });
    // Full screen hides the browser's address bar on phones (iPhone Safari doesn't support it).
    const fullscreenButton = root.querySelector<HTMLButtonElement>('.fullscreen-toggle')!;
    fullscreenButton.hidden = !document.fullscreenEnabled;
    document.addEventListener('fullscreenchange', () => {
      fullscreenButton.setAttribute('aria-pressed', String(!!document.fullscreenElement));
      fullscreenButton.setAttribute('aria-label', document.fullscreenElement ? 'Leave full screen' : 'Full screen');
    });
    settings.subscribe((s) => {
      this.setRadarVisible(s.radar);
      root.dataset.touch = s.touchControls;
      root.dataset.touchSize = s.touchSize;
      root.dataset.leftHanded = String(s.leftHanded);
    });
  }

  get radarCanvas(): HTMLCanvasElement {
    return this.root.querySelector('.radar')!;
  }

  private setRadarVisible(visible: boolean): void {
    this.root.querySelector('.radar-box')!.classList.toggle('collapsed', !visible);
    this.root.querySelector('.radar-toggle')!.setAttribute('aria-pressed', String(visible));
  }

  /** The container the touch controls live in. */
  get touchRoot(): HTMLElement {
    return this.root.querySelector('.touch')!;
  }

  setScenarios(scenarios: ScenarioSummary[]): void {
    this.scenarios = scenarios;
    this.picker.replaceChildren(
      ...scenarios.map((s) => new Option(s.title ? `${s.id.replace('scen', '#')} · ${titleCase(s.title)}` : s.id, s.id)),
    );
  }

  showScenario(scenario: ScenarioAsset, mode: BattleMode, actions: ViewerActions): void {
    this.actions = actions;
    this.mode = mode;
    this.root.dataset.mode = mode;
    this.picker.value = scenario.id;
    this.root.querySelector('.field-title')!.textContent = titleCase(scenario.title || scenario.id);
    if (mode === 'skirmish') history.replaceState(null, '', `?scen=${scenario.id}`);

    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]>) =>
      Object.assign(document.createElement(tag), props);
    const manual = el('button', { className: 'pill', textContent: '📖 Field manual: controls, units, items' });
    manual.dataset.act = 'help';
    const restart = el('button', { className: 'pill', textContent: mode === 'campaign' ? 'Abandon battle' : 'Restart battle' });
    restart.dataset.act = mode === 'campaign' ? 'menu' : 'restart';

    const paragraphs = reflow(scenario.text);
    this.info.replaceChildren(
      el('h2', { textContent: titleCase(scenario.title || scenario.id) }),
      ...(paragraphs.length ? paragraphs : ['No briefing for this scenario.']).map((text) => el('p', { textContent: text })),
      el('h3', { textContent: 'How to play' }),
      el('p', {
        textContent:
          'You control one squad member; the others fight on their own. Defeat every enemy, then walk your character onto the exit. Moving or attacking starts the battle. P pauses, M toggles the radar.',
      }),
      manual,
      restart,
    );
    this.outcome.hidden = true;
    this.toasts.replaceChildren();
    this.lastCard = '';
  }

  /** Live unit counts per team. */
  setTeams(counts: ReadonlyMap<number, number>, exitOpen: boolean): void {
    this.teams.replaceChildren(
      ...[...counts].sort(([a], [b]) => a - b).map(([team, n]) => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.style.setProperty('--team', `rgb(${PALETTE[teamColorBase(team) + 2].join(' ')})`);
        chip.textContent = `${team === 0 ? 'You' : `Team ${team}`} · ${n}`;
        return chip;
      }),
      ...(exitOpen ? [Object.assign(document.createElement('span'), { className: 'chip exit', textContent: 'Field clear · find the exit' })] : []),
    );
  }

  /** The character you're steering. */
  setUnit(unit: UnitCard | null): void {
    const key = JSON.stringify(unit);
    if (key === this.lastCard) return;
    this.lastCard = key;
    this.card.hidden = !unit;
    if (!unit) return;
    const meter = (cls: string, value: number, max: number) => {
      const m = document.createElement('div');
      m.className = `meter ${cls}`;
      m.style.setProperty('--fill', `${Math.max(0, Math.min(1, value / Math.max(max, 1))) * 100}%`);
      m.title = `${Math.max(0, value)} / ${max}`;
      return m;
    };
    this.card.replaceChildren(
      Object.assign(document.createElement('div'), { className: 'card-name', textContent: `${titleCase(unit.name)} · Lv ${unit.level}` }),
      meter('hp', unit.hp, unit.maxHp),
      meter('mp', unit.mp, unit.maxMp),
      Object.assign(document.createElement('div'), { className: 'card-special', textContent: `Special: ${titleCase(unit.special)}` }),
    );
    this.specialButton.textContent = unit.special === 'NONE' ? 'Special' : titleCase(unit.special);
  }

  setPlayback(running: boolean, speed: number): void {
    this.playButton.textContent = running ? '❚❚' : '▶';
    this.playButton.setAttribute('aria-label', running ? 'Pause battle' : 'Start battle');
    this.speedButton.textContent = `${speed}×`;
  }

  /** A short battle message, like the original's on-screen text. */
  toast(message: string): void {
    const el = Object.assign(document.createElement('div'), { className: 'toast', textContent: message });
    this.toasts.append(el);
    while (this.toasts.children.length > MAX_TOASTS) this.toasts.firstElementChild?.remove();
    setTimeout(() => el.remove(), TOAST_MS);
  }

  showOutcome(outcome: Outcome): void {
    const won = outcome.result === 'victory';
    const reason = outcome.result === 'defeat' ? outcome.reason : outcome.result === 'retreat' ? 'You withdrew from the field.' : 'The field is yours.';
    const button = (text: string, act: string) => {
      const b = Object.assign(document.createElement('button'), { className: 'pill', textContent: text });
      b.dataset.act = act;
      return b;
    };
    const actions = Object.assign(document.createElement('div'), { className: 'actions' });
    if (this.mode === 'campaign') actions.append(button('Continue', 'finish'));
    else actions.append(button('Fight again', 'restart'), ...(won ? [button('Next scenario', 'next-scenario')] : []));
    this.outcome.replaceChildren(
      Object.assign(document.createElement('h2'), { textContent: won ? 'Victory!' : outcome.result === 'retreat' ? 'Withdrawn' : 'Defeat!' }),
      Object.assign(document.createElement('p'), { textContent: reason }),
      actions,
    );
    this.outcome.hidden = false;
  }

  private step(direction: number): void {
    const i = this.scenarios.findIndex((s) => s.id === this.picker.value);
    const next = this.scenarios[(i + direction + this.scenarios.length) % this.scenarios.length];
    this.actions?.select(next.id);
  }

  private toggleInfo(): void {
    const button = this.root.querySelector<HTMLButtonElement>('[data-act="info"]')!;
    this.info.hidden = !this.info.hidden;
    button.setAttribute('aria-expanded', String(!this.info.hidden));
  }
}

/** The original briefings are hard-wrapped to ~30 columns; join them back into paragraphs at blank lines. */
function reflow(lines: string[]): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of [...lines, '']) {
    if (line.trim()) {
      current.push(line.trim());
    } else if (current.length) {
      paragraphs.push(current.join(' '));
      current = [];
    }
  }
  return paragraphs;
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    // refused (e.g. not from a user gesture); nothing to do
  }
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

let instance: ViewerUi | null = null;

export function viewerUi(): ViewerUi {
  instance ??= new ViewerUi(document.getElementById('ui')!);
  return instance;
}
