import Phaser from 'phaser';
import type { ScenarioAsset } from '../data/assets.ts';
import { Order } from '../data/objects.ts';
import { GRID_SIZE } from '../data/tiles.ts';
import { applyBattleSummary, type BattleReport, type Campaign } from '../game/campaign.ts';
import { services } from '../game/services.ts';
import { soundKey } from '../game/sounds.ts';
import { music } from '../audio/music.ts';
import { settings, tickMs } from '../game/settings.ts';
import { keepAwake } from '../game/wakeLock.ts';
import { CameraControls } from '../input/cameraControls.ts';
import { PlayerControls } from '../input/playerControls.ts';
import { TILE_MARGIN, TILE_SPACING } from '../render/textures.ts';
import { WorldRenderer } from '../render/worldRenderer.ts';
import { OnlineBattle, type BattleMessage } from '../online/onlineBattle.ts';
import type { OnlineCampaign } from '../online/onlineCampaign.ts';
import type { Guy } from '../sim/guy.ts';
import { specialName } from '../sim/specialNames.ts';
import { NO_INPUT } from '../sim/player.ts';
import { World, type Outcome } from '../sim/world.ts';
import { Radar } from '../ui/radar.ts';
import { openHelp } from '../ui/helpDialog.ts';
import { openSettings } from '../ui/settingsDialog.ts';
import { viewerUi } from '../ui/viewerUi.ts';

export interface OnlineBattleConfig {
  campaign: OnlineCampaign;
  message: BattleMessage;
  /** Back to the barracks, with our report (null if we left; `notice` says why it ended). */
  done: (report: BattleReport | null, notice?: string) => void;
}

export interface BattleConfig {
  id: string;
  /**
   * Skirmish: free play on any field. Campaign: results feed back into the campaign. Online:
   * a battle shared with friends, paced by the server (no pause, no speed control).
   */
  mode: 'skirmish' | 'campaign' | 'online';
  squad: Guy[];
  completed?: number[];
  alreadyWon?: boolean;
  difficulty?: number;
  /** Campaign: called once the player continues past the result. */
  onFinish?: (world: World, par: number) => void;
  /** Skirmish: back to the main menu. */
  menu?: () => void;
  running?: boolean;
  speed?: number;
  online?: OnlineBattleConfig;
}

/** Never run more than this many ticks in one frame (e.g. after the tab was hidden). */
const MAX_TICKS_PER_FRAME = 8;
/** Online: this far behind the server, replay as fast as possible instead of at game speed. */
const CATCH_UP_TICKS = 20;

/** A scenario's battlefield with the simulation running on it. */
export class MapScene extends Phaser.Scene {
  private config!: BattleConfig;
  /** Pristine copies of the squad, so a skirmish can be restarted. */
  private initialSquad: Guy[] = [];
  private par = 1;
  private controls?: CameraControls;
  private world?: World;
  private view?: WorldRenderer;
  private accumulator = 0;
  private running = false;
  private speed = 1;
  private hudTimer = 0;
  private playerInput?: PlayerControls;
  private radar?: Radar;
  private menuOpen = false;
  /** Whether the battle was running when the menu opened. */
  private runningBeforeMenu = false;
  private online?: OnlineBattle;
  /** Online: our results, worked out here, and the server's word on them once it arrives. */
  private localReport: BattleReport | null = null;
  private serverReport: BattleReport | null = null;
  /** Online: the server says the battle is over; we finish the ticks we have first. */
  private endedBecause: string | null = null;
  private lastToast = 0;

  constructor() {
    super('map');
  }

  init(data: BattleConfig): void {
    this.config = data;
    this.menuOpen = false;
    this.initialSquad = data.squad.map((g) => g.clone());
    this.running = data.running ?? false;
    this.speed = data.speed ?? this.speed;
    this.accumulator = 0;
    this.online = undefined;
    this.localReport = this.serverReport = null;
    this.endedBecause = null;
    if (data.online) this.running = true;
  }

  preload(): void {
    const key = this.cacheKey();
    if (!this.cache.json.exists(key)) this.load.json(key, `assets/scenarios/${this.config.id}.json`);
  }

  create(): void {
    const scenario = this.cache.json.get(this.cacheKey()) as ScenarioAsset;
    const { textures, spriteInfo } = services();

    const field = { map: scenario.map, objects: scenario.objects, scenarioType: scenario.type, spriteInfo };
    if (this.config.online) {
      this.online = new OnlineBattle(this.config.online.campaign, this.config.online.message, field);
      this.world = this.online.world;
      this.listenOnline(this.config.online, this.online);
    } else {
      this.world = new World({
        ...field,
        seed: (Math.random() * 2 ** 32) >>> 0,
        squad: this.config.squad,
        completed: this.config.completed,
        alreadyWon: this.config.alreadyWon,
        difficulty: this.config.difficulty,
      });
    }
    this.par = scenario.par ?? (Number(scenario.id.replace('scen', '')) || 1);

    const { width, height } = scenario.map;
    const tiles = Array.from(this.world.grid);
    const rows = Array.from({ length: height }, (_, y) => tiles.slice(y * width, (y + 1) * width));
    const map = this.make.tilemap({ data: rows, tileWidth: GRID_SIZE, tileHeight: GRID_SIZE });
    const tileset = map.addTilesetImage(textures.tileset(), undefined, GRID_SIZE, GRID_SIZE, TILE_MARGIN, TILE_SPACING);
    if (!tileset) throw new Error('Failed to create tileset');
    const layer = map.createLayer(0, tileset, 0, 0);
    if (!layer) throw new Error('Failed to create map layer');

    this.view = new WorldRenderer(this, textures, layer);
    this.view.sync(this.world);
    this.view.draw(1);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.view?.destroy());

    this.controls = new CameraControls(this, width * GRID_SIZE, height * GRID_SIZE);
    const unwatchInsets = viewerUi().watchInsets((insets) => this.controls?.setInsets(insets));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unwatchInsets);
    const control = this.followed();
    if (control) this.controls.centerOn(control.xpos, control.ypos);
    else this.controls.centerOn(...this.squadCentre(width * GRID_SIZE, height * GRID_SIZE));

    this.radar = new Radar(viewerUi().radarCanvas, services().bank);
    this.radar.onPick = (x, y) => this.controls?.lookAt(x, y);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.radar && (this.radar.onPick = undefined));

    this.playerInput = new PlayerControls(viewerUi().touchRoot);
    this.playerInput.onActivity = () => {
      if (this.menuOpen) return;
      this.controls?.resumeFollowing();
      if (!this.running && !this.world?.outcome) this.setRunning(true);
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.playerInput?.destroy();
      keepAwake(false);
    });

    const campaign = this.config.mode === 'campaign';
    const online = this.config.online;
    viewerUi().showScenario(scenario, this.config.mode, online ? {
      select: () => undefined,
      zoom: (factor) => this.controls?.zoomBy(factor),
      togglePlay: () => undefined,
      cycleSpeed: () => undefined,
      restart: () => undefined,
      menu: () => {
        if (this.world?.outcome) return this.finishOnline();
        if (confirm('Leave the battle? Your squad fights on under the computer, and you can rejoin from the barracks.')) this.leaveOnline();
      },
      finish: () => this.finishOnline(),
      menuToggled: (open) => (this.menuOpen = open), // friends keep playing: no pause
      settings: () => openSettings(),
      help: () => openHelp('controls'),
    } : {
      select: (id) => this.scene.restart({ ...this.config, id, squad: this.freshSquad(), running: false, speed: this.speed }),
      zoom: (factor) => this.controls?.zoomBy(factor),
      togglePlay: () => this.setRunning(!this.running),
      cycleSpeed: () => this.cycleSpeed(),
      restart: () => {
        music.play('battle', true);
        this.scene.restart({ ...this.config, squad: this.freshSquad(), running: true, speed: this.speed });
      },
      menu: () => {
        if (!campaign) return this.config.menu?.();
        if (this.world?.outcome || confirm('Abandon this battle? Your team returns as it was before it.')) this.finish();
      },
      finish: () => this.finish(),
      menuToggled: (open) => {
        this.menuOpen = open;
        if (open) {
          this.runningBeforeMenu = this.running;
          this.setRunning(false);
        } else if (this.runningBeforeMenu) {
          this.setRunning(true);
        }
      },
      settings: () => this.pauseFor((resume) => openSettings(resume)),
      help: () => this.pauseFor((resume) => openHelp('controls', resume)),
    });
    this.updateHud();
    if (this.running) keepAwake(true);
    suggestLandscape();
  }

  update(_time: number, delta: number): void {
    const world = this.world;
    const view = this.view;
    if (!world || !view) return;

    const tick = this.online?.tickMs ?? tickMs(settings.value.gameSpeed);
    if (this.online) {
      this.updateOnline(this.online, delta);
    } else if (this.running && !world.outcome) {
      this.accumulator += delta * this.speed;
      let ticks = 0;
      while (this.accumulator >= tick && ticks < MAX_TICKS_PER_FRAME) {
        this.accumulator -= tick;
        world.tick([this.playerInput?.read() ?? NO_INPUT]);
        view.sync(world);
        this.handleEvents();
        ticks++;
      }
      if (ticks === MAX_TICKS_PER_FRAME) this.accumulator = 0;
      // Read afresh: TypeScript can't see that tick() may have ended the battle.
      const outcome: Outcome | null = this.world!.outcome;
      if (outcome) {
        this.running = false;
        keepAwake(false);
        music.play(outcome.result === 'victory' ? 'victory' : 'defeat');
        viewerUi().showOutcome(outcome);
      }
    }
    // The HUD and radar refresh on a timer, so they also follow the camera while paused.
    this.hudTimer += delta;
    if (this.hudTimer > 120) {
      this.hudTimer = 0;
      this.updateHud();
    }
    view.draw(this.running ? Math.min(1, this.accumulator / tick) : 1, settings.value.healthBars, this.me()?.control?.teamNum ?? 0);

    const control = this.followed();
    const image = control ? view.imageFor(control) : undefined;
    if (image) this.controls?.follow(image.x + image.width / 2, image.y + image.height / 2);
  }

  /** This device's player. */
  private me() {
    return this.world?.players[this.online?.you ?? 0];
  }

  /** Who the camera follows: our unit, or (online, with ours all fallen) a friend's. */
  private followed() {
    const world = this.world;
    const control = this.me()?.control;
    if (control || !this.online || !world) return control ?? null;
    const you = this.online.you;
    const living = world.oblist.filter((o) => !o.dead && o.order === Order.LIVING && o.squad >= 0);
    return living.find((o) => o.squad === you) ?? living.find((o) => o.user !== -1) ?? living[0] ?? null;
  }

  // --- Online battles ------------------------------------------------------------------

  private listenOnline(config: OnlineBattleConfig, battle: OnlineBattle): void {
    const { campaign } = config;
    campaign.onBattle = (message) => message.setup.id === battle.id && battle.add(message.frames, message.now);
    campaign.takeTicks((frames) => battle.add(frames));
    // The device that got there first already sent the results; the ticks that led there are
    // on their way to us too, so play them out (and see the victory) before leaving.
    campaign.onBattleEnd = (id, reason) => id === battle.id && (this.endedBecause = reason);
    campaign.onReport = (id, report) => id === battle.id && (this.serverReport = report);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      campaign.onBattle = campaign.onBattleEnd = campaign.onReport = undefined;
      campaign.takeTicks(undefined);
    });
  }

  /** Plays the ticks the server has issued: at game speed, or flat out while catching up. */
  private updateOnline(battle: OnlineBattle, delta: number): void {
    const world = battle.world;
    const view = this.view!;
    battle.input(this.menuOpen ? NO_INPUT : (this.playerInput?.read() ?? NO_INPUT));
    if (world.outcome) return;

    if (battle.backlog > CATCH_UP_TICKS) {
      // Joined late or back from a dropout: replay the past quickly, without its sounds.
      const start = performance.now();
      while (battle.backlog > 1 && performance.now() - start < 12) battle.playOne();
      world.events.length = 0;
      view.sync(world);
      this.accumulator = 0;
      this.toastOnce('Catching up with the battle…');
    } else {
      this.accumulator += delta;
      let ticks = 0;
      // A little faster than game speed while behind, so we drift back in step.
      const extra = battle.backlog > 2 ? 1 : 0;
      while ((this.accumulator >= battle.tickMs || ticks < extra) && battle.backlog > 0 && ticks < MAX_TICKS_PER_FRAME) {
        battle.playOne();
        view.sync(world);
        this.handleEvents();
        this.accumulator = Math.max(0, this.accumulator - battle.tickMs);
        ticks++;
      }
      if (!battle.backlog) this.accumulator = Math.min(this.accumulator, battle.tickMs);
      if (!battle.backlog && battle.quietMs > 2500) this.toastOnce('Waiting for the connection…');
    }

    const outcome: Outcome | null = world.outcome;
    if (outcome) this.onlineOutcome(battle, outcome);
    else if (this.endedBecause !== null && !battle.backlog) this.leaveOnline(this.endedBecause);
  }

  /** Everyone's device reaches the same end; each sends the results, the server keeps the first. */
  private onlineOutcome(battle: OnlineBattle, outcome: Outcome): void {
    const campaign = this.config.online!.campaign;
    keepAwake(false);
    music.play(outcome.result === 'victory' ? 'victory' : 'defeat');
    const summaries = battle.summaries();
    campaign.submitBattle(battle.id, this.par, summaries);
    // Our own report straight away (the server works out the same; its copy replaces this).
    const mine = summaries[battle.you];
    const view = campaign.view;
    const copy: Campaign = { ...view, team: view.team.map((g) => g.clone()), completed: [...view.completed], hired: { ...view.hired }, scenario: battle.lockstep.setup.scenario };
    this.localReport = mine ? applyBattleSummary(copy, mine, copy.team, this.par) : null;
    viewerUi().showOutcome(outcome);
  }

  private finishOnline(): void {
    this.config.online?.done(this.serverReport ?? this.localReport);
  }

  /** Out of the battle: by choice (our squad fights on), or because it ended without us. */
  private leaveOnline(endedBecause?: string): void {
    const online = this.config.online;
    if (!online) return;
    if (!endedBecause) online.campaign.leaveBattle();
    online.done(null, endedBecause);
  }

  private toastOnce(message: string): void {
    const now = performance.now();
    if (now - this.lastToast < 4000) return;
    this.lastToast = now;
    viewerUi().toast(message);
  }

  private setRunning(running: boolean): void {
    if (this.world?.outcome) return;
    this.running = running;
    keepAwake(running);
    this.accumulator = 0;
    viewerUi().setPlayback(this.running, this.speed);
  }

  /** Pauses while a dialog is open, resuming afterwards if the battle was running. */
  private pauseFor(open: (resume: () => void) => void): void {
    const wasRunning = this.running;
    this.setRunning(false);
    open(() => wasRunning && this.setRunning(true));
  }

  private cycleSpeed(): void {
    this.speed = this.speed >= 4 ? 1 : this.speed * 2;
    viewerUi().setPlayback(this.running, this.speed);
  }

  private handleEvents(): void {
    const world = this.world!;
    const view = this.cameras.main.worldView;
    const played = new Set<string>();
    for (const event of world.events) {
      if (event.type === 'sound') {
        // Like the original, only things on screen are heard; one of each per tick is plenty.
        if (!played.has(event.sound) && view.contains(event.x, event.y)) {
          played.add(event.sound);
          if (this.cache.audio.exists(soundKey(event.sound))) this.sound.play(soundKey(event.sound), { volume: 0.6 });
        }
      } else if (event.type === 'message' || event.type === 'notify') {
        viewerUi().toast(event.message);
      } else if (event.type === 'freeze') {
        viewerUi().toast('TIME IS FROZEN!');
      } else if (event.type === 'exit') {
        viewerUi().toast('The way out is open.');
      }
    }
    world.events.length = 0;
  }

  private updateHud(): void {
    const world = this.world;
    if (!world) return;
    const counts = new Map<number, number>();
    for (const ob of world.oblist) {
      if (!ob.dead && ob.order === Order.LIVING) counts.set(ob.teamNum, (counts.get(ob.teamNum) ?? 0) + 1);
    }
    viewerUi().setTeams(counts, world.levelDone === 1);
    const control = this.me()?.control ?? null;
    const cam = this.cameras.main.worldView;
    this.radar?.draw(world, control, { x: cam.x, y: cam.y, width: cam.width, height: cam.height });
    // The original swapped to a blue palette while enemies were frozen.
    document.getElementById('game')?.classList.toggle('frozen', world.enemyFreeze > 0);
    const c = this.me()?.control;
    viewerUi().setUnit(
      c && !c.dead
        ? {
            name: c.myguy?.name ?? c.stats.name ?? 'Unit',
            level: c.stats.level,
            hp: c.stats.hitpoints,
            maxHp: c.stats.maxHitpoints,
            mp: c.stats.magicpoints,
            maxMp: c.stats.maxMagicpoints,
            special: specialName(c.family, c.currentSpecial),
          }
        : null,
    );
    viewerUi().setPlayback(this.running, this.speed);
  }

  private cacheKey(): string {
    return `scenario:${this.config.id}`;
  }

  private freshSquad(): Guy[] {
    return this.initialSquad.map((g) => g.clone());
  }

  /** Campaign battles report back; an unfinished battle counts as abandoned. */
  private finish(): void {
    const world = this.world;
    if (!world) return;
    world.outcome ??= { result: 'defeat', reason: 'You abandoned the battle.' };
    this.config.onFinish?.(world, this.par);
  }

  private squadCentre(w: number, h: number): [number, number] {
    const ours = this.world?.oblist.filter((o) => o.order === Order.LIVING && o.teamNum === 0) ?? [];
    if (!ours.length) return [w / 2, h / 2];
    return [ours.reduce((s, o) => s + o.xpos, 0) / ours.length, ours.reduce((s, o) => s + o.ypos, 0) / ours.length];
  }
}

let landscapeTipShown = false;

/** Once per visit, suggest turning a phone held upright: battles see more of the field. */
function suggestLandscape(): void {
  if (landscapeTipShown || !matchMedia('(pointer: coarse) and (orientation: portrait)').matches) return;
  landscapeTipShown = true;
  viewerUi().toast('Tip: turn your phone sideways to see more of the field.');
}
