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
import {
  createCampaign,
  forgetCampaign,
  forgetSession,
  knownCampaigns,
  loadSession,
  readInvite,
  rememberCampaign,
  SERVER,
  SignedOutError,
  signIn,
} from '../online/client.ts';
import { OnlineCampaign } from '../online/onlineCampaign.ts';
import { presenceBar, showCampaignList, showConnecting, showSignIn } from '../ui/onlineScreens.ts';
import { applyBattle, localTeamOps, newCampaign, squadFor, summarizeBattle, type Campaign } from './campaign.ts';
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
  /** The online campaign open right now, if any. */
  private online: OnlineCampaign | null = null;
  /** An invite link the game was opened with, to join once signed in. */
  private invite: { id: string; invite: string } | null = null;

  constructor(game: Phaser.Game) {
    this.game = game;
    const { bank, scenarios } = services();
    this.screens = new Screens(document.getElementById('screens')!, bank, scenarios);
    initPwa((apply) => showUpdateBanner(apply));
    onInstallChange(() => this.onMenu && this.menu());
  }

  start(): void {
    const scen = new URLSearchParams(location.search).get('scen');
    this.invite = SERVER ? readInvite(location.hash) : null;
    if (this.invite) this.onlineMenu();
    else if (scen && this.exists(scen)) this.skirmish(scen);
    else this.menu();
  }

  menu(): void {
    this.closeOnline();
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
        online: SERVER ? () => this.onlineMenu() : undefined,
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
        team: localTeamOps(campaign, () => this.save()),
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

  // --- Online campaigns -------------------------------------------------------------

  private onlineMenu(notice?: string): void {
    this.closeOnline();
    this.leaveBattle();
    this.onMenu = false;
    music.play('menu');
    history.replaceState(null, '', location.pathname);
    const show = (...content: Node[]) => this.screens.show(...content);
    const session = loadSession();
    if (!session?.token) {
      showSignIn(show, {
        name: session?.name ?? '',
        notice: notice ?? (this.invite ? 'Sign in to join your friend\'s campaign.' : undefined),
        signIn: async (name, password) => {
          await signIn(password, name);
          this.onlineMenu();
        },
        back: () => this.menu(),
      });
      return;
    }
    if (this.invite) {
      const { id, invite } = this.invite;
      this.invite = null;
      this.openOnline(id, invite);
      return;
    }
    showCampaignList(show, {
      name: session.name,
      campaigns: knownCampaigns(),
      notice,
      open: (id) => this.openOnline(id, null),
      create: async (name, difficulty) => {
        try {
          const { id } = await createCampaign(session, name, difficulty);
          rememberCampaign({ id, name });
          this.openOnline(id, null);
        } catch (error) {
          if (!(error instanceof SignedOutError)) throw error;
          forgetSession();
          this.onlineMenu(error.message);
        }
      },
      join: (id, invite) => this.openOnline(id, invite),
      forget: (id) => {
        forgetCampaign(id);
        this.onlineMenu();
      },
      signOut: () => {
        forgetSession();
        this.onlineMenu();
      },
      back: () => this.menu(),
    });
  }

  private openOnline(id: string, invite: string | null): void {
    const session = loadSession();
    if (!session?.token) return this.onlineMenu();
    this.closeOnline();
    const campaign = new OnlineCampaign(session, id, invite);
    this.online = campaign;
    if (campaign.ready) return this.onlineBarracks(campaign);
    const back = () => this.onlineMenu();
    showConnecting((...c) => this.screens.show(...c), 'Connecting…', back);
    campaign.onChange = () => {
      if (campaign.status === 'signed-out') return this.signedOut();
      if (campaign.status === 'refused') return showConnecting((...c) => this.screens.show(...c), campaign.refusal, back);
      if (campaign.ready) return this.onlineBarracks(campaign);
      if (campaign.status === 'offline') showConnecting((...c) => this.screens.show(...c), "Can't reach the server. Still trying…", back);
    };
  }

  private onlineBarracks(campaign: OnlineCampaign, notice?: string): void {
    this.leaveBattle();
    this.onMenu = false;
    music.play('menu');
    campaign.setWhere({ at: 'barracks' });
    const bar = presenceBar(campaign);
    const view = this.screens.showBarracks(
      campaign.view,
      {
        team: campaign.team,
        extra: bar.element,
        settings: () => openSettings(),
        help: () => openHelp('units'),
        menu: () => this.onlineMenu(),
        fight: (n) => this.onlineFight(campaign, n),
      },
      notice ?? (campaign.view.team.length ? undefined : `Welcome to ${campaign.view.name}. You have ${campaign.view.money.toLocaleString('en-US')} to hire your first warriors.`),
    );
    let wasOffline = campaign.status === 'offline';
    campaign.onChange = (change) => {
      if (campaign.status === 'signed-out') return this.signedOut();
      bar.update();
      const backOnline = campaign.status === 'online' && wasOffline;
      if (campaign.status === 'online' || campaign.status === 'offline') wasOffline = campaign.status === 'offline';
      if (change.view || change.notice || backOnline) view.refresh(change.notice ?? (backOnline ? 'Back online.' : undefined));
    };
  }

  private onlineFight(campaign: OnlineCampaign, scenario: number): void {
    if (!this.exists(`scen${scenario}`)) return this.onlineBarracks(campaign, `Field ${scenario} doesn't exist. Pick another.`);
    const squad = squadFor(campaign.view);
    // Mid-battle, only show what the server has to say; the barracks catches up afterwards.
    campaign.onChange = (change) => change.notice && viewerUi().toast(change.notice);
    campaign.setWhere({ at: 'battle', scenario });
    this.startBattle({
      id: `scen${scenario}`,
      mode: 'campaign',
      squad,
      completed: campaign.view.completed,
      alreadyWon: campaign.view.completed.includes(scenario),
      difficulty: campaign.view.difficulty,
      onFinish: (world, par) => {
        const report = campaign.finishBattle(scenario, par, squad, summarizeBattle(world, squad));
        this.leaveBattle();
        campaign.setWhere({ at: 'barracks' });
        campaign.onChange = undefined;
        this.screens.showReport(report, () => this.onlineBarracks(campaign));
      },
    });
  }

  private signedOut(): void {
    forgetSession();
    this.onlineMenu('Please sign in again (the online password may have changed).');
  }

  private closeOnline(): void {
    this.online?.close();
    this.online = null;
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
