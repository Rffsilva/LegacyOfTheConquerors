import type Phaser from 'phaser';
import { music } from '../audio/music.ts';
import { LivingFamily } from '../data/objects.ts';
import type { BattleConfig } from '../scenes/MapScene.ts';
import { Guy } from '../sim/guy.ts';
import type { World } from '../sim/world.ts';
import { Screens } from '../ui/screens.ts';
import { h } from '../ui/dom.ts';
import { openHelp } from '../ui/helpDialog.ts';
import { openSettings } from '../ui/settingsDialog.ts';
import { viewerUi } from '../ui/viewerUi.ts';
import { applyBattle, newCampaign, squadFor, type Campaign } from './campaign.ts';
import { canInstall, initPwa, install, needsManualInstall, onInstallChange } from './pwa.ts';
import { services } from './services.ts';
import { loadCampaign, saveCampaign } from './storage.ts';

/** Skirmishes use this level-1 squad; the soldier goes last so the player starts as them. */
const SKIRMISH_SQUAD = [LivingFamily.MAGE, LivingFamily.ELF, LivingFamily.ARCHER, LivingFamily.SOLDIER];

/** Moves between the menus and battles. */
export class App {
  private readonly game: Phaser.Game;
  private readonly screens: Screens;
  private campaign: Campaign | null = loadCampaign();

  private onMenu = false;

  constructor(game: Phaser.Game) {
    this.game = game;
    const { bank, scenarios } = services();
    this.screens = new Screens(document.getElementById('screens')!, bank, scenarios);
    initPwa((apply) => showUpdateBanner(apply));
    onInstallChange(() => this.onMenu && this.menu());
  }

  start(): void {
    const scen = new URLSearchParams(location.search).get('scen');
    if (scen && this.exists(scen)) this.skirmish(scen);
    else this.menu();
  }

  menu(): void {
    this.leaveBattle();
    this.onMenu = true;
    music.play('menu');
    history.replaceState(null, '', location.pathname);
    this.screens.showMenu(
      {
        continueCampaign: this.campaign ? () => this.barracks() : undefined,
        newCampaign: (difficulty) => {
          this.campaign = newCampaign('SAVED GAME', difficulty);
          this.save();
          this.barracks('Welcome, commander. You have 5,000 to hire your first warriors.');
        },
        skirmish: () => this.skirmish(),
        settings: () => openSettings(),
        help: () => openHelp('basics'),
        install: canInstall() ? () => void install() : undefined,
        manualInstall: needsManualInstall(),
      },
      this.campaign,
    );
  }

  barracks(notice?: string): void {
    this.onMenu = false;
    const campaign = this.campaign;
    if (!campaign) return this.menu();
    this.leaveBattle();
    music.play('menu');
    this.screens.showBarracks(
      campaign,
      {
        changed: () => this.save(),
        settings: () => openSettings(),
        help: () => openHelp('units'),
        menu: () => this.menu(),
        fight: (n) => this.fight(n),
      },
      notice,
    );
  }

  private fight(scenario: number): void {
    const campaign = this.campaign!;
    if (!this.exists(`scen${scenario}`)) {
      this.barracks(`Field ${scenario} doesn't exist. Pick another.`);
      return;
    }
    campaign.scenario = scenario;
    this.save();
    const squad = squadFor(campaign);
    this.startBattle({
      id: `scen${scenario}`,
      mode: 'campaign',
      squad,
      completed: campaign.completed,
      alreadyWon: campaign.completed.includes(scenario),
      difficulty: campaign.difficulty,
      onFinish: (world, par) => this.finishBattle(world, squad, par),
    });
  }

  private finishBattle(world: World, squad: Guy[], par: number): void {
    const campaign = this.campaign!;
    const report = applyBattle(campaign, world, squad, par);
    this.save();
    this.leaveBattle();
    this.screens.showReport(report, () => this.barracks());
  }

  skirmish(id = 'scen1'): void {
    this.startBattle({
      id,
      mode: 'skirmish',
      squad: SKIRMISH_SQUAD.map((f) => new Guy(f)),
      menu: () => this.menu(),
    });
  }

  private startBattle(config: BattleConfig): void {
    this.onMenu = false;
    this.screens.hide();
    music.play('battle');
    viewerUi().root.hidden = false;
    if (this.game.scene.isActive('map')) this.game.scene.stop('map');
    this.game.scene.start('map', config);
  }

  private leaveBattle(): void {
    if (this.game.scene.isActive('map') || this.game.scene.isPaused('map')) this.game.scene.stop('map');
    viewerUi().root.hidden = true;
    document.getElementById('game')?.classList.remove('frozen');
  }

  private exists(id: string): boolean {
    return services().scenarios.some((s) => s.id === id);
  }

  private save(): void {
    if (this.campaign) saveCampaign(this.campaign);
  }
}

/** A small banner offering to switch to a newly downloaded version. */
function showUpdateBanner(apply: () => void): void {
  if (document.querySelector('.update-banner')) return;
  const banner = h('div', { className: 'update-banner', role: 'status' },
    h('span', {}, 'A new version is ready.'),
    h('button', { className: 'pill primary', onclick: () => { banner.remove(); apply(); } }, 'Reload'),
    h('button', { className: 'icon small', ariaLabel: 'Later', onclick: () => banner.remove() }, '✕'),
  );
  document.body.append(banner);
}
