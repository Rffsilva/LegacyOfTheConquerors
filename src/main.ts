import Phaser from 'phaser';
import { BootScene, SoundLoaderScene } from './scenes/BootScene.ts';
import { MapScene } from './scenes/MapScene.ts';
import './style.css';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#000000',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
    // The page can report a 0x0 viewport while it is still being laid out (hidden tabs, some
    // mobile webviews); WebGL can't create a framebuffer that small, so keep a floor.
    min: { width: 320, height: 200 },
  },
  input: { activePointers: 2 },
  scene: [BootScene, MapScene, SoundLoaderScene],
});

