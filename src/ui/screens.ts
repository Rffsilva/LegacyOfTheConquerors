// Full-screen menus outside battle: main menu, barracks (hire and train) and battle report.

import type { ScenarioSummary } from '../data/assets.ts';
import { LivingFamily as L } from '../data/objects.ts';
import {
  baseStat,
  dismiss,
  hire,
  hireCost,
  HIREABLE,
  MAX_TEAM,
  recruit,
  STATS,
  train,
  trainingCost,
  type BattleReport,
  type Campaign,
  type Stat,
} from '../game/campaign.ts';
import type { SpriteBank } from '../render/spriteBank.ts';
import { DIFFICULTY_LEVELS } from '../sim/constants.ts';
import { type Guy } from '../sim/guy.ts';
import { specialName } from '../sim/specialNames.ts';
import { formatNumber, h, titleCase } from './dom.ts';
import { SpritePreview } from './spritePreview.ts';

const FAMILY_NAMES: Record<number, string> = {
  [L.SOLDIER]: 'Soldier',
  [L.BARBARIAN]: 'Barbarian',
  [L.ELF]: 'Elf',
  [L.ARCHER]: 'Archer',
  [L.MAGE]: 'Mage',
  [L.CLERIC]: 'Cleric',
  [L.THIEF]: 'Thief',
  [L.DRUID]: 'Druid',
  [L.ORC]: 'Orc',
  [L.SKELETON]: 'Skeleton',
  [L.FIREELEMENTAL]: 'Fire elemental',
  [L.SMALL_SLIME]: 'Slime',
  [L.MEDIUM_SLIME]: 'Slime',
  [L.SLIME]: 'Slime',
  [L.FAERIE]: 'Faerie',
  [L.GHOST]: 'Ghost',
  [L.ARCHMAGE]: 'Archmage',
};

const FAMILY_BLURBS: Record<number, string> = {
  [L.SOLDIER]: 'Sturdy all-rounder. Throws knives that fly back; charges and whirls at higher levels.',
  [L.BARBARIAN]: 'Hits hard and shrugs off magic. Hurls boulders, some of which explode.',
  [L.ELF]: 'Quick rock-thrower who moves through forests. Rocks start bouncing as it levels.',
  [L.ARCHER]: 'Long-range bow. Fire-arrow volleys, barrages and exploding bolts.',
  [L.MAGE]: 'Fragile but deadly fireballs. Teleports, freezes time and bursts foes into flame.',
  [L.CLERIC]: 'Heals nearby allies. Raises skeletons and ghosts, and can resurrect the fallen.',
  [L.THIEF]: 'Fast and slippery. Drops bombs, turns invisible, taunts and charms enemies.',
  [L.DRUID]: 'Casts lightning. Grows trees, summons faeries and shields allies.',
  [L.ORC]: 'Brutal melee. Its howl freezes enemies in fear; eats corpses to heal.',
  [L.SKELETON]: 'Cheap and fast undead that throws bones and tunnels away from danger.',
  [L.FIREELEMENTAL]: 'Expensive powerhouse that hurls meteors and explodes when it dies.',
  [L.SMALL_SLIME]: 'Grows into bigger slimes, which split in two.',
  [L.FAERIE]: 'Tiny flyer whose dust freezes enemies in place.',
  [L.GHOST]: 'Floats through walls and terrain. Scares enemies away.',
};

const STAT_LABELS: Record<Stat, string> = {
  strength: 'Strength',
  dexterity: 'Dexterity',
  constitution: 'Constitution',
  intelligence: 'Intelligence',
  armor: 'Armor',
  level: 'Level',
};

export const familyName = (family: number) => FAMILY_NAMES[family] ?? 'Unit';

/** Rough battle stats for a character, as game.cpp computes them when they deploy. */
function vitals(guy: Guy): { hp: number; mp: number } {
  return {
    hp: 10 + guy.constitution * 3 + Math.trunc(guy.strength / 2) + 25 * guy.level,
    mp: 10 + guy.intelligence * 3 + 25 * guy.level + guy.dexterity,
  };
}

export interface MenuActions {
  continueCampaign?: () => void;
  settings: () => void;
  help: () => void;
  newCampaign: (difficulty: number) => void;
  skirmish: () => void;
  /** Present when the browser offers a one-tap install. */
  install?: () => void;
  /** Show "Add to Home Screen" instructions (iPhone/iPad). */
  manualInstall?: boolean;
}

export interface BarracksActions {
  changed: () => void;
  settings: () => void;
  help: () => void;
  fight: (scenario: number) => void;
  menu: () => void;
}

export class Screens {
  private readonly root: HTMLElement;
  private readonly bank: SpriteBank;
  private readonly scenarios: ScenarioSummary[];

  constructor(root: HTMLElement, bank: SpriteBank, scenarios: ScenarioSummary[]) {
    this.root = root;
    this.bank = bank;
    this.scenarios = scenarios;
  }

  hide(): void {
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  private show(...content: Node[]): void {
    this.root.hidden = false;
    this.root.replaceChildren(...content);
    this.root.scrollTop = 0;
  }

  scenarioTitle(n: number): string {
    const s = this.scenarios.find((x) => x.id === `scen${n}`);
    return s?.title ? `#${n} · ${titleCase(s.title)}` : `Field ${n}`;
  }

  // --- Main menu -------------------------------------------------------------------

  showMenu(actions: MenuActions, saved: Campaign | null): void {
    let difficulty = 1;
    const difficultyButtons = ['Easy', 'Normal', 'Hard'].map((label, i) =>
      h('button', {
        className: `pill toggle${i === difficulty ? ' on' : ''}`,
        onclick: () => {
          difficulty = i;
          difficultyButtons.forEach((b, j) => b.classList.toggle('on', j === i));
        },
      }, label),
    );
    const heroes = h('div', { className: 'menu-heroes' }, ...[L.SOLDIER, L.ARCHER, L.MAGE, L.ELF, L.CLERIC].map((f) => new SpritePreview(this.bank, f, 0, 3).canvas));
    this.show(
      h('div', { className: 'menu' },
        heroes,
        h('h1', {}, 'Legacy of the Conquerors'),
        h('p', { className: 'tagline' }, 'A modern remake of OpenGlad (Gladiator by FSGames)'),
        saved &&
          actions.continueCampaign &&
          h('button', { className: 'pill primary', onclick: actions.continueCampaign },
            `Continue campaign · ${this.scenarioTitle(saved.scenario)} · ${saved.team.length} men`),
        h('div', { className: 'menu-new' },
          h('div', { className: 'segmented', role: 'group', ariaLabel: 'Difficulty' }, ...difficultyButtons),
          h('button', {
            className: `pill${saved ? '' : ' primary'}`,
            onclick: () => {
              if (saved && !confirm('Start a new campaign? Your saved campaign will be replaced.')) return;
              actions.newCampaign(difficulty);
            },
          }, 'New campaign'),
        ),
        h('button', { className: 'pill', onclick: actions.skirmish }, 'Skirmish (any field, ready-made squad)'),
        h('div', { className: 'segmented' },
          h('button', { className: 'pill', onclick: actions.help }, '📖 Field manual'),
          h('button', { className: 'pill', onclick: actions.settings }, '⚙ Settings'),
        ),
        actions.install && h('button', { className: 'pill', onclick: actions.install }, '⬇ Install the app (plays offline)'),
        actions.manualInstall &&
          h('p', { className: 'fineprint' }, 'To install: tap Share, then "Add to Home Screen". It then plays offline, full screen.'),
        h('p', { className: 'fineprint' }, `Difficulty scales enemy strength: ${DIFFICULTY_LEVELS.join('% / ')}%.`),
      ),
    );
  }

  // --- Barracks ----------------------------------------------------------------------

  showBarracks(campaign: Campaign, actions: BarracksActions, notice?: string): void {
    let tab: 'hire' | 'train' = campaign.team.length ? 'train' : 'hire';
    let selected = 0;
    let familyIndex = 0;
    let candidate = recruit(campaign, HIREABLE[familyIndex]);
    let proposal: Guy | null = campaign.team[0]?.clone() ?? null;
    let message = notice ?? '';

    const unlocked = [...new Set([...campaign.completed, campaign.scenario])].sort((a, b) => a - b);
    let field = campaign.scenario;
    let rendered = false;

    /** Redraws the barracks; after the first time, keeps the scroll positions and, with `reveal`, scrolls the panel into view. */
    const render = (reveal = false) => {
      const scroll = this.root.scrollTop;
      const listScroll = this.root.querySelector('.team-list')?.scrollTop ?? 0;
      const header = h('header', { className: 'barracks-top' },
        h('button', { className: 'icon', ariaLabel: 'Main menu', onclick: actions.menu }, '☰'),
        h('h1', {}, 'Barracks'),
        h('div', { className: 'stat-chips' },
          h('div', { className: 'stat-chip' }, `Cash ${formatNumber(campaign.money)}`),
          h('div', { className: 'stat-chip' }, `Score ${formatNumber(campaign.score)}`),
        ),
        h('button', { className: 'icon', ariaLabel: 'Field manual', onclick: actions.help }, '?'),
        h('button', { className: 'icon', ariaLabel: 'Settings', onclick: actions.settings }, '⚙'),
      );

      const teamList = h('ol', { className: 'team-list' },
        ...campaign.team.map((guy, i) => {
          const v = vitals(guy);
          return h('li', {},
            h('button', {
              className: `member${tab === 'train' && i === selected ? ' selected' : ''}`,
              onclick: () => {
                tab = 'train';
                selected = i;
                proposal = guy.clone();
                message = '';
                render(true);
              },
            },
              new SpritePreview(this.bank, guy.family, 0, 2).canvas,
              h('span', { className: 'member-name' }, titleCase(guy.name)),
              h('span', { className: 'member-meta' }, `${familyName(guy.family)} · Lv ${guy.level} · HP ${v.hp} · ${guy.kills} kills`),
            ),
          );
        }),
      );

      const team = h('section', { className: 'team' },
        h('h2', {}, `Your team (${campaign.team.length}/${MAX_TEAM})`),
        campaign.team.length ? teamList : h('p', { className: 'empty' }, 'Nobody yet. Hire some recruits to fight for you.'),
        h('button', {
          className: `pill${tab === 'hire' ? ' on' : ''}`,
          onclick: () => {
            tab = 'hire';
            message = '';
            render(true);
          },
        }, '+ Hire a recruit'),
      );

      const panel = tab === 'hire' ? this.hirePanel(campaign, candidate, (next) => {
        if (next.familyStep) {
          familyIndex = (familyIndex + next.familyStep + HIREABLE.length) % HIREABLE.length;
          candidate = recruit(campaign, HIREABLE[familyIndex]);
        }
        if (next.hire) {
          const result = hire(campaign, candidate);
          message = result.ok ? `${titleCase(candidate.name)} joins your team.` : result.reason;
          if (result.ok) {
            actions.changed();
            candidate = recruit(campaign, HIREABLE[familyIndex]);
          }
        }
        render();
      }) : this.trainPanel(campaign, selected, proposal, (next) => {
        if (next.train && proposal) {
          const result = train(campaign, selected, proposal);
          message = result.ok ? `${titleCase(proposal.name)} trained.` : result.reason;
          if (result.ok) actions.changed();
          proposal = campaign.team[selected]?.clone() ?? null;
        }
        if (next.dismiss) {
          const name = campaign.team[selected]?.name ?? '';
          if (!confirm(`Dismiss ${titleCase(name)}? They leave for good and you get nothing back.`)) return;
          dismiss(campaign, selected);
          actions.changed();
          message = `${titleCase(name)} left the team.`;
          selected = Math.min(selected, campaign.team.length - 1);
          proposal = campaign.team[selected]?.clone() ?? null;
          if (!campaign.team.length) tab = 'hire';
        }
        render();
      });

      const fieldPicker = h('select', { className: 'picker', ariaLabel: 'Field to fight on', onchange: (e: Event) => (field = Number((e.target as HTMLSelectElement).value)) },
        ...unlocked.map((n) => {
          const o = new Option(`${this.scenarioTitle(n)}${campaign.completed.includes(n) ? ' (won)' : ''}`, String(n));
          o.selected = n === field;
          return o;
        }),
      );
      const footer = h('footer', { className: 'barracks-bottom' },
        h('label', { className: 'field' }, h('span', {}, 'Next field'), fieldPicker),
        h('button', {
          className: 'pill primary',
          disabled: !campaign.team.length,
          onclick: () => actions.fight(field),
        }, '⚔ To battle'),
      );

      this.show(h('div', { className: 'barracks' }, header, h('p', { className: 'notice', role: 'status' }, message), h('main', {}, team, panel), footer));
      if (rendered) {
        this.root.scrollTop = scroll;
        teamList.scrollTop = listScroll;
        if (reveal) panel.scrollIntoView({ block: 'nearest' });
      }
      rendered = true;
    };
    render();
  }

  private statRows(guy: Guy, min: (stat: Stat) => number, onChange: () => void): HTMLElement {
    return h('div', { className: 'stats' },
      ...STATS.map((stat) => {
        const value = h('output', {}, String(guy[stat]));
        const changed = guy[stat] > min(stat);
        return h('div', { className: `stat${changed ? ' changed' : ''}` },
          h('span', {}, STAT_LABELS[stat]),
          h('button', {
            className: 'icon small',
            ariaLabel: `Lower ${STAT_LABELS[stat]}`,
            disabled: guy[stat] <= min(stat),
            onclick: () => {
              guy[stat] = Math.max(min(stat), guy[stat] - 1);
              onChange();
            },
          }, '−'),
          value,
          h('button', {
            className: 'icon small',
            ariaLabel: `Raise ${STAT_LABELS[stat]}`,
            onclick: () => {
              guy[stat]++;
              onChange();
            },
          }, '+'),
        );
      }),
    );
  }

  private hirePanel(campaign: Campaign, guy: Guy, update: (a: { familyStep?: number; hire?: boolean }) => void): HTMLElement {
    const cost = hireCost(guy);
    const v = vitals(guy);
    return h('section', { className: 'panel' },
      h('h2', {}, 'Hire a recruit'),
      h('div', { className: 'family-picker' },
        h('button', { className: 'icon', ariaLabel: 'Previous type', onclick: () => update({ familyStep: -1 }) }, '‹'),
        h('div', { className: 'portrait' }, new SpritePreview(this.bank, guy.family, 0, 4).canvas, h('strong', {}, familyName(guy.family))),
        h('button', { className: 'icon', ariaLabel: 'Next type', onclick: () => update({ familyStep: 1 }) }, '›'),
      ),
      h('p', { className: 'blurb' }, FAMILY_BLURBS[guy.family] ?? ''),
      h('label', { className: 'name' }, h('span', {}, 'Name'),
        h('input', { value: titleCase(guy.name), maxLength: 11, oninput: (e: Event) => (guy.name = (e.target as HTMLInputElement).value.toUpperCase()) }),
      ),
      this.statRows(guy, (stat) => baseStat(guy.family, stat), () => update({})),
      h('p', { className: 'derived' }, `HP ${v.hp} · Magic ${v.mp} · First special: ${titleCase(specialName(guy.family, 1))}`),
      h('div', { className: 'buy' },
        h('span', { className: `cost${cost > campaign.money ? ' short' : ''}` }, `Cost ${formatNumber(cost)}`),
        h('button', { className: 'pill primary', disabled: cost > campaign.money || campaign.team.length >= MAX_TEAM, onclick: () => update({ hire: true }) }, 'Hire'),
      ),
    );
  }

  private trainPanel(campaign: Campaign, index: number, proposal: Guy | null, update: (a: { train?: boolean; dismiss?: boolean }) => void): HTMLElement {
    const current = campaign.team[index];
    if (!current || !proposal) return h('section', { className: 'panel' }, h('p', {}, 'Select a team member to train.'));
    const cost = trainingCost(current, proposal);
    const v = vitals(proposal);
    const nextSpecialLevel = [1, 4, 7, 10].find((l) => l > current.level);
    return h('section', { className: 'panel' },
      h('h2', {}, `Train ${titleCase(current.name)}`),
      h('div', { className: 'family-picker' }, h('div', { className: 'portrait' }, new SpritePreview(this.bank, current.family, 0, 4).canvas, h('strong', {}, familyName(current.family)))),
      h('p', { className: 'blurb' },
        `Experience ${formatNumber(current.exp)} · ${current.kills} kills`,
        nextSpecialLevel ? ` · next special at level ${nextSpecialLevel}` : '',
      ),
      this.statRows(proposal, (stat) => current[stat], () => update({})),
      h('p', { className: 'derived' }, `HP ${v.hp} · Magic ${v.mp}`),
      h('div', { className: 'buy' },
        h('button', { className: 'pill danger', onclick: () => update({ dismiss: true }) }, 'Dismiss'),
        h('span', { className: `cost${cost > campaign.money ? ' short' : ''}` }, `Cost ${formatNumber(cost)}`),
        h('button', { className: 'pill primary', disabled: !cost || cost > campaign.money, onclick: () => update({ train: true }) }, 'Train'),
      ),
    );
  }

  // --- Battle report -----------------------------------------------------------------

  showReport(report: BattleReport, onContinue: () => void): void {
    const won = report.outcome.result === 'victory';
    const retreat = report.outcome.result === 'retreat';
    const title = won ? 'Victory!' : retreat ? 'Withdrawn' : 'Defeat';
    const lines: (HTMLElement | false)[] = won
      ? [
          report.alreadyWon && h('p', {}, 'Field already won: no time bonus.'),
          h('dl', { className: 'report-numbers' },
            h('dt', {}, 'Score'), h('dd', {}, formatNumber(report.score)),
            h('dt', {}, 'Time bonus'), h('dd', {}, formatNumber(report.timeBonus)),
            h('dt', {}, 'Cash earned'), h('dd', {}, formatNumber(report.cash)),
          ),
        ]
      : [h('p', {}, retreat ? `You fell back to ${this.scenarioTitle(report.nextScenario)}. You may take this field later.` : `${report.outcome.result === 'defeat' ? report.outcome.reason : ''} Your team returns as it was before the battle.`)];
    this.show(
      h('div', { className: 'report' },
        h('h1', {}, title),
        ...lines.filter((x): x is HTMLElement => !!x),
        report.levelUps.length > 0 &&
          h('ul', { className: 'levelups' },
            ...report.levelUps.map((u) =>
              h('li', {}, `${titleCase(u.name)} ${u.to > u.from ? 'reached' : 'fell to'} level ${u.to}`, u.newAbility ? h('strong', {}, ` · New ability: ${titleCase(u.newAbility)}!`) : ''),
            ),
          ),
        report.fallen.length > 0 && h('p', { className: 'fallen' }, `Fallen: ${report.fallen.map(titleCase).join(', ')}`),
        won && h('p', {}, `Next: ${this.scenarioTitle(report.nextScenario)}`),
        h('button', { className: 'pill primary', onclick: onContinue }, 'Back to the barracks'),
      ),
    );
  }
}
