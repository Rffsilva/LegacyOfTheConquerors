import Phaser from 'phaser';
import type { ScenarioSummary, SpriteIndex } from '../data/assets.ts';
import { setServices } from '../game/services.ts';
import { PALETTE_CYCLE_MS } from '../game/timing.ts';
import { LivePalette } from '../render/palette.ts';
import { SpriteBank } from '../render/spriteBank.ts';
import { IndexedTextures } from '../render/textures.ts';
import { viewerUi } from '../ui/viewerUi.ts';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    this.load.setPath('assets');
    this.load.binary('sprites-bin', 'sprites.bin');
    this.load.json('sprites-index', 'sprites.json');
    this.load.json('scenario-index', 'scenarios/index.json');

    const status = document.getElementById('loading');
    this.load.on(Phaser.Loader.Events.PROGRESS, (p: number) => {
      if (status) status.textContent = `Loading… ${Math.round(p * 100)}%`;
    });
  }

  create(): void {
    const bank = new SpriteBank(
      this.cache.binary.get('sprites-bin') as ArrayBuffer,
      this.cache.json.get('sprites-index') as SpriteIndex,
    );
    const palette = new LivePalette();
    const textures = new IndexedTextures(this.textures, bank, palette);
    textures.tileset();
    const scenarios = this.cache.json.get('scenario-index') as ScenarioSummary[];
    setServices({ bank, palette, textures, scenarios });
    viewerUi().setScenarios(scenarios);

    // The palette cycle is global, so drive it from the game loop rather than any one scene.
    let elapsed = 0;
    this.game.events.on(Phaser.Core.Events.STEP, (_time: number, delta: number) => {
      elapsed += delta;
      while (elapsed >= PALETTE_CYCLE_MS) {
        elapsed -= PALETTE_CYCLE_MS;
        palette.step();
      }
    });

    document.getElementById('loading')?.remove();
    const initial = new URLSearchParams(location.search).get('scen') ?? 'scen1';
    this.scene.start('map', { id: scenarios.some((s) => s.id === initial) ? initial : scenarios[0].id });
  }
}
