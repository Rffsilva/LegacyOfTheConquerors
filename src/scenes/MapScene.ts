import Phaser from 'phaser';
import type { ScenarioAsset } from '../data/assets.ts';
import { Order } from '../data/objects.ts';
import { GRID_SIZE } from '../data/tiles.ts';
import { services } from '../game/services.ts';
import { soundKey } from '../game/sounds.ts';
import { music } from '../audio/music.ts';
import { settings, tickMs } from '../game/settings.ts';
import { keepAwake } from '../game/wakeLock.ts';
import { CameraControls } from '../input/cameraControls.ts';
import { PlayerControls } from '../input/playerControls.ts';
import { TILE_MARGIN, TILE_SPACING } from '../render/textures.ts';
import { WorldRenderer } from '../render/worldRenderer.ts';
import type { Guy } from '../sim/guy.ts';
import { specialName } from '../sim/specialNames.ts';
import { NO_INPUT } from '../sim/player.ts';
import { World, type Outcome } from '../sim/world.ts';
import { Radar } from '../ui/radar.ts';
import { openHelp } from '../ui/helpDialog.ts';
import { openSettings } from '../ui/settingsDialog.ts';
import { viewerUi } from '../ui/viewerUi.ts';

export interface BattleConfig {
  id: string;
  /** Skirmish: free play on any field. Campaign: results feed back into the campaign. */
  mode: 'skirmish' | 'campaign';
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
}

/** Never run more than this many ticks in one frame (e.g. after the tab was hidden). */
const MAX_TICKS_PER_FRAME = 8;

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
  }

  preload(): void {
    const key = this.cacheKey();
    if (!this.cache.json.exists(key)) this.load.json(key, `assets/scenarios/${this.config.id}.json`);
  }

  create(): void {
    const scenario = this.cache.json.get(this.cacheKey()) as ScenarioAsset;
    const { textures, spriteInfo } = services();

    this.world = new World({
      map: scenario.map,
      objects: scenario.objects,
      scenarioType: scenario.type,
      spriteInfo,
      seed: (Math.random() * 2 ** 32) >>> 0,
      squad: this.config.squad,
      completed: this.config.completed,
      alreadyWon: this.config.alreadyWon,
      difficulty: this.config.difficulty,
    });
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
    const control = this.world.players[0]?.control;
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
    viewerUi().showScenario(scenario, campaign ? 'campaign' : 'skirmish', {
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

    const tick = tickMs(settings.value.gameSpeed);
    if (this.running && !world.outcome) {
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
    view.draw(this.running ? this.accumulator / tick : 1, settings.value.healthBars, world.players[0]?.control?.teamNum ?? 0);

    const control = world.players[0]?.control;
    const image = control ? view.imageFor(control) : undefined;
    if (image && this.running) this.controls?.follow(image.x + image.width / 2, image.y + image.height / 2, delta);
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
    const control = world.players[0]?.control ?? null;
    const cam = this.cameras.main.worldView;
    this.radar?.draw(world, control, { x: cam.x, y: cam.y, width: cam.width, height: cam.height });
    // The original swapped to a blue palette while enemies were frozen.
    document.getElementById('game')?.classList.toggle('frozen', world.enemyFreeze > 0);
    const c = world.players[0]?.control;
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
