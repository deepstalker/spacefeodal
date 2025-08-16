import Phaser from 'phaser';
import UIPlugin from 'phaser3-rex-plugins/templates/ui/ui-plugin.js';
import BootScene from './scene/BootScene';
import PreloadScene from './scene/PreloadScene';
import StarSystemScene from './scene/StarSystemScene';
import UIScene from './scene/UIScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#0b0f1a',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 3840,
    height: 2160,
    min: {
      width: 1920,
      height: 1080
    },
    max: {
      width: 3840,
      height: 2160
    }
  },
  render: { antialias: true, pixelArt: false, roundPixels: false },
  plugins: { scene: [ { key: 'rexUI', plugin: UIPlugin, mapping: 'rexUI' } ] },
  scene: [BootScene, PreloadScene, StarSystemScene, UIScene]
};

export default new Phaser.Game(config);


