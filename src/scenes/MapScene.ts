import Phaser from 'phaser';
import type { ScenarioAsset } from '../data/assets.ts';
import { Order } from '../data/objects.ts';
import { GRID_SIZE } from '../data/tiles.ts';
import { services } from '../game/services.ts';
import { CameraControls } from '../input/cameraControls.ts';
import { spriteForObject } from '../render/objectSprites.ts';
import { TILE_MARGIN, TILE_SPACING } from '../render/textures.ts';
import { viewerUi } from '../ui/viewerUi.ts';

/** Renders a scenario's map and starting objects. The first milestone: no simulation yet. */
export class MapScene extends Phaser.Scene {
  private scenarioId = '';
  private controls?: CameraControls;

  constructor() {
    super('map');
  }

  init(data: { id: string }): void {
    this.scenarioId = data.id;
  }

  preload(): void {
    const key = this.cacheKey();
    if (!this.cache.json.exists(key)) this.load.json(key, `assets/scenarios/${this.scenarioId}.json`);
  }

  create(): void {
    const scenario = this.cache.json.get(this.cacheKey()) as ScenarioAsset;
    const { textures } = services();
    const { width, height, tiles } = scenario.map;

    const rows = Array.from({ length: height }, (_, y) => tiles.slice(y * width, (y + 1) * width));
    const map = this.make.tilemap({ data: rows, tileWidth: GRID_SIZE, tileHeight: GRID_SIZE });
    const tileset = map.addTilesetImage(textures.tileset(), undefined, GRID_SIZE, GRID_SIZE, TILE_MARGIN, TILE_SPACING);
    if (!tileset) throw new Error('Failed to create tileset');
    map.createLayer(0, tileset, 0, 0);

    for (const ob of scenario.objects) {
      // Squad spawn markers: game.cpp swaps them for the player's recruits and drops the rest.
      if (ob.order === Order.SPECIAL) continue;
      const sprite = spriteForObject(ob);
      if (!sprite) continue;
      const key = textures.sprite(sprite.name, ob.team);
      const image = this.add.image(ob.x, ob.y, key, sprite.frame).setOrigin(0, 0);
      // Floor items sit under walkers; everything else is sorted by its feet.
      image.setDepth(ob.order === Order.TREASURE ? 0 : ob.y + image.height);
    }

    const worldWidth = width * GRID_SIZE;
    const worldHeight = height * GRID_SIZE;
    this.controls = new CameraControls(this, worldWidth, worldHeight);
    this.controls.centerOn(...this.startPoint(scenario, worldWidth, worldHeight));

    viewerUi().showScenario(scenario, {
      select: (id) => this.scene.restart({ id }),
      zoom: (factor) => this.controls?.zoomBy(factor),
    });
  }

  update(_time: number, delta: number): void {
    this.controls?.update(delta);
  }

  private cacheKey(): string {
    return `scenario:${this.scenarioId}`;
  }

  /** Centre on the player's team (team 0) if it has units, otherwise the map centre. */
  private startPoint(scenario: ScenarioAsset, w: number, h: number): [number, number] {
    const ours = scenario.objects.filter((o) => o.order === Order.LIVING && o.team === 0);
    if (!ours.length) return [w / 2, h / 2];
    const x = ours.reduce((sum, o) => sum + o.x, 0) / ours.length;
    const y = ours.reduce((sum, o) => sum + o.y, 0) / ours.length;
    return [x, y];
  }
}
