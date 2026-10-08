import Phaser from 'phaser';
import type { ScenarioSummary, SpriteIndex } from '../data/assets.ts';
import { music } from '../audio/music.ts';
import { SOUND_FILES, soundKey } from '../game/sounds.ts';
import { setServices } from '../game/services.ts';
import { settings } from '../game/settings.ts';
import { PALETTE_CYCLE_MS } from '../game/timing.ts';
import { LivePalette } from '../render/palette.ts';
import { SpriteBank } from '../render/spriteBank.ts';
import { IndexedTextures } from '../render/textures.ts';
import { spriteInfoFromBundle } from '../sim/spriteInfo.ts';
import { App } from '../game/app.ts';
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
    const bin = this.cache.binary.get('sprites-bin') as ArrayBuffer;
    const index = this.cache.json.get('sprites-index') as SpriteIndex;
    const bank = new SpriteBank(bin, index);
    const spriteInfo = spriteInfoFromBundle(index, new Uint8Array(bin));
    const palette = new LivePalette();
    const textures = new IndexedTextures(this.textures, bank, palette);
    textures.tileset();
    const scenarios = this.cache.json.get('scenario-index') as ScenarioSummary[];
    setServices({ bank, palette, textures, scenarios, spriteInfo });
    viewerUi().setScenarios(scenarios);

    // The palette cycle is global, so drive it from the game loop rather than any one scene.
    let elapsed = 0;
    this.game.events.on(Phaser.Core.Events.STEP, (_time: number, delta: number) => {
      elapsed += delta;
      while (elapsed >= PALETTE_CYCLE_MS) {
        elapsed -= PALETTE_CYCLE_MS;
        if (settings.value.colorCycling) palette.step();
      }
    });

    settings.subscribe((s) => {
      this.game.sound.volume = s.volume;
      this.game.sound.mute = s.muted;
      music.setVolume(s.muted ? 0 : s.musicVolume);
      // The original's brightness steps lightened or darkened the whole palette.
      document.getElementById('game')?.style.setProperty('--brightness', String(1 + s.brightness * 0.08));
    });

    document.getElementById('loading')?.remove();
    this.scene.stop();
    // Sound effects load in the background: some mobile browsers hold audio decoding until
    // the first tap, and the game shouldn't wait on that.
    this.scene.launch('sounds');
    new App(this.game).start();
  }
}

/** Loads the sound effects without blocking the game; MapScene skips any not loaded yet. */
export class SoundLoaderScene extends Phaser.Scene {
  constructor() {
    super('sounds');
  }

  create(): void {
    this.load.setPath('assets');
    for (const [name, file] of Object.entries(SOUND_FILES)) this.load.audio(soundKey(name), `sound/${file}`);
    this.load.start();
  }
}
