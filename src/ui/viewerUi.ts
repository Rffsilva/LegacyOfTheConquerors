import type { ScenarioAsset, ScenarioSummary } from '../data/assets.ts';
import { PALETTE, teamColorBase } from '../formats/palette.ts';
import { settings } from '../game/settings.ts';
import type { Outcome } from '../sim/world.ts';
import { h } from './dom.ts';

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
  /** The battle menu opened or closed; the battle pauses while it's open. */
  menuToggled(open: boolean): void;
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
 * HTML overlay: HUD, battle menu and touch controls live in the DOM rather than the canvas so
 * they stay crisp, accessible and responsive at any screen size. Only a small menu button
 * sits over the battlefield; everything else is in the menu it opens.
 */
class ViewerUi {
  readonly root: HTMLElement;
  private readonly picker: HTMLSelectElement;
  private readonly menuPanel: HTMLElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly briefing: HTMLElement;
  private readonly teams: HTMLElement;
  private readonly card: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly outcome: HTMLElement;
  private readonly speedButton: HTMLButtonElement;
  private readonly resumeButton: HTMLButtonElement;
  private readonly specialButton: HTMLElement;
  private scenarios: ScenarioSummary[] = [];
  private actions?: ViewerActions;
  private lastCard = '';
  private mode: BattleMode = 'skirmish';
  private running = false;
  /** Whether the battle had started when the menu was opened. */
  private startedBeforeMenu = false;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <button class="icon menu-button" data-act="open-menu" aria-label="Battle menu (Esc)" aria-expanded="false" aria-controls="battle-menu">☰</button>
      <div class="menu-backdrop" data-act="close-menu" hidden></div>
      <section class="battle-menu" id="battle-menu" aria-label="Battle menu" hidden>
        <div class="menu-head">
          <h2 class="field-title"></h2>
          <button class="icon" data-act="close-menu" aria-label="Close menu">✕</button>
        </div>
        <div class="menu-row skirmish-only">
          <button class="icon" data-act="prev" aria-label="Previous field">‹</button>
          <select class="picker" aria-label="Field"></select>
          <button class="icon" data-act="next" aria-label="Next field">›</button>
        </div>
        <button class="pill primary resume" data-act="resume">Resume</button>
        <div class="menu-grid">
          <button class="pill speed" data-act="speed" aria-label="Battle speed">Speed 1×</button>
          <button class="pill" data-act="help">📖 Field manual</button>
          <button class="pill" data-act="settings">⚙ Settings</button>
          <button class="pill fullscreen-toggle" data-act="fullscreen" hidden>⛶ Full screen</button>
          <button class="pill skirmish-only" data-act="restart">↺ Restart battle</button>
          <button class="pill quit" data-act="menu"></button>
        </div>
        <details class="briefing" open>
          <summary>Briefing</summary>
          <div class="briefing-text"></div>
        </details>
      </section>
      <div class="status">
        <div class="teams" aria-label="Units per team"></div>
        <div class="card" hidden></div>
      </div>
      <div class="toasts" aria-live="polite"></div>
      <section class="outcome" hidden></section>
      <div class="radar-box">
        <button class="icon radar-toggle" data-act="radar" aria-label="Show or hide the radar (M)" aria-pressed="true">◎</button>
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
    this.menuPanel = root.querySelector('.battle-menu')!;
    this.menuButton = root.querySelector('.menu-button')!;
    this.briefing = root.querySelector('.briefing-text')!;
    this.teams = root.querySelector('.teams')!;
    this.card = root.querySelector('.card')!;
    this.toasts = root.querySelector('.toasts')!;
    this.outcome = root.querySelector('.outcome')!;
    this.speedButton = root.querySelector('.speed')!;
    this.resumeButton = root.querySelector('.resume')!;
    this.specialButton = root.querySelector('.tb.special')!;

    this.picker.addEventListener('change', () => this.actions?.select(this.picker.value));
    root.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      switch (act) {
        case 'open-menu':
          this.setMenuOpen(!this.menuIsOpen());
          break;
        case 'close-menu':
          this.setMenuOpen(false);
          break;
        case 'resume':
          // Closing resumes a running battle; a battle that hadn't started yet starts now.
          this.setMenuOpen(false);
          if (!this.startedBeforeMenu) this.actions?.togglePlay();
          break;
        case 'prev':
          this.step(-1);
          break;
        case 'next':
        case 'next-scenario':
          this.step(1);
          break;
        case 'zoom-in':
          this.actions?.zoom(1.25);
          break;
        case 'zoom-out':
          this.actions?.zoom(0.8);
          break;
        case 'speed':
          this.actions?.cycleSpeed();
          break;
        case 'restart':
          this.closeMenuQuietly();
          this.actions?.restart();
          break;
        case 'menu':
          this.actions?.menu();
          break;
        case 'finish':
          this.actions?.finish();
          break;
        case 'radar':
          settings.update({ radar: !settings.value.radar });
          break;
        case 'settings':
          this.actions?.settings();
          break;
        case 'help':
          this.actions?.help();
          break;
        case 'fullscreen':
          void toggleFullscreen();
          break;
      }
    });
    window.addEventListener('keydown', (e) => {
      if (root.hidden || e.target instanceof HTMLInputElement || document.querySelector('dialog[open]')) return;
      if (e.code === 'Escape') this.setMenuOpen(!this.menuIsOpen());
      else if (settings.value.keys.radar.includes(e.code)) settings.update({ radar: !settings.value.radar });
      else if (settings.value.keys.pause.includes(e.code) && !this.menuIsOpen()) this.actions?.togglePlay();
    });
    // Full screen hides the browser's address bar on phones (iPhone Safari doesn't support it).
    const fullscreenButton = root.querySelector<HTMLButtonElement>('.fullscreen-toggle')!;
    fullscreenButton.hidden = !document.fullscreenEnabled;
    document.addEventListener('fullscreenchange', () => {
      fullscreenButton.textContent = document.fullscreenElement ? '⛶ Leave full screen' : '⛶ Full screen';
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

  /**
   * Calls back now and whenever it changes with how much of the screen the HUD covers at the
   * top and the touch controls at the bottom. Returns a function that stops watching.
   */
  watchInsets(callback: (insets: { top: number; bottom: number }) => void): () => void {
    const status = this.root.querySelector<HTMLElement>('.status')!;
    const touch = this.touchRoot;
    const measure = () => callback({ top: status.getBoundingClientRect().bottom, bottom: touch.getBoundingClientRect().height });
    const observer = new ResizeObserver(measure);
    observer.observe(status);
    observer.observe(touch);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }

  /** The container the touch controls live in. */
  get touchRoot(): HTMLElement {
    return this.root.querySelector('.touch')!;
  }

  private setRadarVisible(visible: boolean): void {
    this.root.querySelector('.radar-box')!.classList.toggle('collapsed', !visible);
    this.root.querySelector('.radar-toggle')!.setAttribute('aria-pressed', String(visible));
  }

  private menuIsOpen(): boolean {
    return this.menuPanel.hidden === false;
  }

  private setMenuOpen(open: boolean): void {
    if (open === this.menuIsOpen()) return;
    if (open) {
      this.startedBeforeMenu = this.running;
      this.resumeButton.textContent = this.running ? 'Resume' : '⚔ Start battle';
    }
    this.menuPanel.hidden = !open;
    this.root.querySelector<HTMLElement>('.menu-backdrop')!.hidden = !open;
    this.menuButton.setAttribute('aria-expanded', String(open));
    this.actions?.menuToggled(open);
    if (open) this.resumeButton.focus();
    else this.menuButton.focus({ preventScroll: true });
  }

  /** Hide the menu without resuming (the action that closed it takes over). */
  private closeMenuQuietly(): void {
    this.menuPanel.hidden = true;
    this.root.querySelector<HTMLElement>('.menu-backdrop')!.hidden = true;
    this.menuButton.setAttribute('aria-expanded', 'false');
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
    this.root.querySelector('.quit')!.textContent = mode === 'campaign' ? '🏳 Abandon battle' : '☰ Main menu';
    if (mode === 'skirmish') history.replaceState(null, '', `?scen=${scenario.id}`);

    const paragraphs = reflow(scenario.text);
    this.briefing.replaceChildren(
      ...(paragraphs.length ? paragraphs : ['No briefing for this field.']).map((text) => h('p', {}, text)),
      h('p', { className: 'hint' },
        'You control one squad member; the others fight on their own. Defeat every enemy, then walk onto the exit. Moving or attacking starts the battle; Esc or ☰ pauses.',
      ),
    );
    this.closeMenuQuietly();
    this.outcome.hidden = true;
    this.toasts.replaceChildren();
    this.lastCard = '';
  }

  /** Live unit counts per team. */
  setTeams(counts: ReadonlyMap<number, number>, exitOpen: boolean): void {
    this.teams.replaceChildren(
      ...[...counts].sort(([a], [b]) => a - b).map(([team, n]) => {
        const chip = h('span', { className: 'chip' }, `${team === 0 ? 'You' : `Team ${team}`} · ${n}`);
        chip.style.setProperty('--team', `rgb(${PALETTE[teamColorBase(team) + 2].join(' ')})`);
        return chip;
      }),
      ...(exitOpen ? [h('span', { className: 'chip exit' }, 'Field clear · find the exit')] : []),
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
      const m = h('div', { className: `meter ${cls}`, title: `${Math.max(0, value)} / ${max}` });
      m.style.setProperty('--fill', `${Math.max(0, Math.min(1, value / Math.max(max, 1))) * 100}%`);
      return m;
    };
    this.card.replaceChildren(
      h('div', { className: 'card-name' }, `${titleCase(unit.name)} · Lv ${unit.level}`),
      meter('hp', unit.hp, unit.maxHp),
      meter('mp', unit.mp, unit.maxMp),
      h('div', { className: 'card-special' }, `Special: ${titleCase(unit.special)}`),
    );
    this.specialButton.textContent = unit.special === 'NONE' ? 'Special' : titleCase(unit.special);
  }

  setPlayback(running: boolean, speed: number): void {
    this.running = running;
    this.root.dataset.running = String(running);
    this.speedButton.textContent = `Speed ${speed}×`;
  }

  /** A short battle message, like the original's on-screen text. */
  toast(message: string): void {
    const el = h('div', { className: 'toast' }, message);
    this.toasts.append(el);
    while (this.toasts.children.length > MAX_TOASTS) this.toasts.firstElementChild?.remove();
    setTimeout(() => el.remove(), TOAST_MS);
  }

  showOutcome(outcome: Outcome): void {
    this.closeMenuQuietly();
    const won = outcome.result === 'victory';
    const reason = outcome.result === 'defeat' ? outcome.reason : outcome.result === 'retreat' ? 'You withdrew from the field.' : 'The field is yours.';
    const button = (text: string, act: string) => h('button', { className: 'pill', dataset: { act } }, text);
    const actions = h('div', { className: 'actions' });
    if (this.mode === 'campaign') actions.append(button('Continue', 'finish'));
    else actions.append(button('Fight again', 'restart'), ...(won ? [button('Next field', 'next-scenario')] : []), button('Main menu', 'menu'));
    this.outcome.replaceChildren(
      h('h2', {}, won ? 'Victory!' : outcome.result === 'retreat' ? 'Withdrawn' : 'Defeat!'),
      h('p', {}, reason),
      actions,
    );
    this.outcome.hidden = false;
  }

  private step(direction: number): void {
    const i = this.scenarios.findIndex((s) => s.id === this.picker.value);
    const next = this.scenarios[(i + direction + this.scenarios.length) % this.scenarios.length];
    this.actions?.select(next.id);
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
