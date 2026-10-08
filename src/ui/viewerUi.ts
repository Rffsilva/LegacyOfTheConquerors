import type { ScenarioAsset, ScenarioSummary } from '../data/assets.ts';
import { Order } from '../data/objects.ts';
import { PALETTE, teamColorBase } from '../formats/palette.ts';

export interface ViewerActions {
  select(id: string): void;
  zoom(factor: number): void;
}

/**
 * HTML overlay for the scenario viewer. Menus live in the DOM rather than the canvas so they
 * stay crisp, accessible and responsive at any screen size.
 */
class ViewerUi {
  private readonly root: HTMLElement;
  private readonly picker: HTMLSelectElement;
  private readonly briefing: HTMLElement;
  private readonly teams: HTMLElement;
  private scenarios: ScenarioSummary[] = [];
  private actions?: ViewerActions;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <header class="bar">
        <button class="icon" data-act="prev" aria-label="Previous scenario">‹</button>
        <select class="picker" aria-label="Scenario"></select>
        <button class="icon" data-act="next" aria-label="Next scenario">›</button>
        <button class="pill" data-act="brief" aria-expanded="false">Briefing</button>
      </header>
      <section class="briefing" hidden></section>
      <div class="teams" aria-label="Units per team"></div>
      <div class="zoom">
        <button class="icon" data-act="zoom-in" aria-label="Zoom in">+</button>
        <button class="icon" data-act="zoom-out" aria-label="Zoom out">−</button>
      </div>`;
    this.picker = root.querySelector('.picker')!;
    this.briefing = root.querySelector('.briefing')!;
    this.teams = root.querySelector('.teams')!;

    this.picker.addEventListener('change', () => this.actions?.select(this.picker.value));
    root.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'prev') this.step(-1);
      else if (act === 'next') this.step(1);
      else if (act === 'zoom-in') this.actions?.zoom(1.25);
      else if (act === 'zoom-out') this.actions?.zoom(0.8);
      else if (act === 'brief') this.toggleBriefing();
    });
  }

  setScenarios(scenarios: ScenarioSummary[]): void {
    this.scenarios = scenarios;
    this.picker.replaceChildren(
      ...scenarios.map((s) => new Option(s.title ? `${s.id.replace('scen', '#')} · ${titleCase(s.title)}` : s.id, s.id)),
    );
  }

  showScenario(scenario: ScenarioAsset, actions: ViewerActions): void {
    this.actions = actions;
    this.picker.value = scenario.id;
    history.replaceState(null, '', `?scen=${scenario.id}`);

    const paragraphs = reflow(scenario.text);
    this.briefing.replaceChildren(
      Object.assign(document.createElement('h2'), { textContent: titleCase(scenario.title || scenario.id) }),
      ...(paragraphs.length ? paragraphs : ['No briefing for this scenario.']).map((text) =>
        Object.assign(document.createElement('p'), { textContent: text }),
      ),
    );

    const counts = new Map<number, number>();
    for (const ob of scenario.objects) {
      if (ob.order === Order.LIVING) counts.set(ob.team, (counts.get(ob.team) ?? 0) + 1);
    }
    const slots = scenario.objects.filter((ob) => ob.order === Order.SPECIAL).length;
    this.teams.replaceChildren(
      ...(slots ? [Object.assign(document.createElement('span'), { className: 'chip', textContent: `Squad slots · ${slots}` })] : []),
      ...[...counts].sort(([a], [b]) => a - b).map(([team, n]) => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.style.setProperty('--team', `rgb(${PALETTE[teamColorBase(team) + 2].join(' ')})`);
        chip.textContent = `${team === 0 ? 'You' : `Team ${team}`} · ${n}`;
        return chip;
      }),
    );
  }

  private step(direction: number): void {
    const i = this.scenarios.findIndex((s) => s.id === this.picker.value);
    const next = this.scenarios[(i + direction + this.scenarios.length) % this.scenarios.length];
    this.actions?.select(next.id);
  }

  private toggleBriefing(): void {
    const button = this.root.querySelector<HTMLButtonElement>('[data-act="brief"]')!;
    this.briefing.hidden = !this.briefing.hidden;
    button.setAttribute('aria-expanded', String(!this.briefing.hidden));
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

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

let instance: ViewerUi | null = null;

export function viewerUi(): ViewerUi {
  instance ??= new ViewerUi(document.getElementById('ui')!);
  return instance;
}
