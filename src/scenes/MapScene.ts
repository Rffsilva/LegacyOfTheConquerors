import Phaser from 'phaser';
import type { ScenarioAsset } from '../data/assets.ts';
import { LivingFamily, Order } from '../data/objects.ts';
import { GRID_SIZE } from '../data/tiles.ts';
import { services } from '../game/services.ts';
import { soundKey } from '../game/sounds.ts';
import { TICK_MS } from '../game/timing.ts';
import { CameraControls } from '../input/cameraControls.ts';
import { PlayerControls } from '../input/playerControls.ts';
import { TILE_MARGIN, TILE_SPACING } from '../render/textures.ts';
import { WorldRenderer } from '../render/worldRenderer.ts';
import { Guy } from '../sim/guy.ts';
import { specialName } from '../sim/specialNames.ts';
import { NO_INPUT } from '../sim/player.ts';
import { World } from '../sim/world.ts';
import { viewerUi } from '../ui/viewerUi.ts';

/**
 * Until recruiting exists, every battle starts with this level-1 squad. The player starts in
 * control of the last one placed, so the sturdy soldier goes last.
 */
const DEFAULT_SQUAD = [LivingFamily.MAGE, LivingFamily.ELF, LivingFamily.ARCHER, LivingFamily.SOLDIER];

/** Never run more than this many ticks in one frame (e.g. after the tab was hidden). */
const MAX_TICKS_PER_FRAME = 8;

/** A scenario's battlefield with the simulation running on it. */
export class MapScene extends Phaser.Scene {
  private scenarioId = '';
  private controls?: CameraControls;
  private world?: World;
  private view?: WorldRenderer;
  private accumulator = 0;
  private running = false;
  private speed = 1;
  private hudTimer = 0;
  private playerInput?: PlayerControls;

  constructor() {
    super('map');
  }

  init(data: { id: string; running?: boolean; speed?: number }): void {
    this.scenarioId = data.id;
    this.running = data.running ?? false;
    this.speed = data.speed ?? this.speed;
    this.accumulator = 0;
  }

  preload(): void {
    const key = this.cacheKey();
    if (!this.cache.json.exists(key)) this.load.json(key, `assets/scenarios/${this.scenarioId}.json`);
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
      squad: DEFAULT_SQUAD.map((f) => new Guy(f)),
    });

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

    this.playerInput = new PlayerControls(viewerUi().touchRoot);
    this.playerInput.onActivity = () => {
      this.controls?.resumeFollowing();
      if (!this.running && !this.world?.outcome) this.setRunning(true);
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.playerInput?.destroy());

    viewerUi().showScenario(scenario, {
      select: (id) => this.scene.restart({ id, running: false, speed: this.speed }),
      zoom: (factor) => this.controls?.zoomBy(factor),
      togglePlay: () => this.setRunning(!this.running),
      cycleSpeed: () => this.cycleSpeed(),
      restart: () => this.scene.restart({ id: this.scenarioId, running: true, speed: this.speed }),
    });
    this.updateHud();
  }

  update(_time: number, delta: number): void {
    const world = this.world;
    const view = this.view;
    if (!world || !view) return;

    if (this.running && !world.outcome) {
      this.accumulator += delta * this.speed;
      let ticks = 0;
      while (this.accumulator >= TICK_MS && ticks < MAX_TICKS_PER_FRAME) {
        this.accumulator -= TICK_MS;
        world.tick([this.playerInput?.read() ?? NO_INPUT]);
        view.sync(world);
        this.handleEvents();
        ticks++;
      }
      if (ticks === MAX_TICKS_PER_FRAME) this.accumulator = 0;
      if (world.outcome) {
        this.running = false;
        viewerUi().showOutcome(world.outcome);
      }
      this.hudTimer += delta;
      if (this.hudTimer > 120) {
        this.hudTimer = 0;
        this.updateHud();
      }
    }
    view.draw(this.running ? this.accumulator / TICK_MS : 1);

    const control = world.players[0]?.control;
    const image = control ? view.imageFor(control) : undefined;
    if (image && this.running) this.controls?.follow(image.x + image.width / 2, image.y + image.height / 2, delta);
  }

  private setRunning(running: boolean): void {
    if (this.world?.outcome) return;
    this.running = running;
    this.accumulator = 0;
    viewerUi().setPlayback(this.running, this.speed);
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
    return `scenario:${this.scenarioId}`;
  }

  private squadCentre(w: number, h: number): [number, number] {
    const ours = this.world?.oblist.filter((o) => o.order === Order.LIVING && o.teamNum === 0) ?? [];
    if (!ours.length) return [w / 2, h / 2];
    return [ours.reduce((s, o) => s + o.xpos, 0) / ours.length, ours.reduce((s, o) => s + o.ypos, 0) / ours.length];
  }
}
