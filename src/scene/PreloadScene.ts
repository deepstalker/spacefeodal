import Phaser from 'phaser';
import UIPlugin from 'phaser3-rex-plugins/templates/ui/ui-plugin.js';

export default class PreloadScene extends Phaser.Scene {
  rexUI!: UIPlugin;

  constructor() {
    super('PreloadScene');
  }

  preload() {
    // Прогресс-бар через rexUI: горизонтальный sizer с заполнением
    const width = this.scale.width;
    const height = this.scale.height;

    const sizer = this.rexUI.add.sizer({ x: width / 2, y: height / 2, width: 420, height: 28, orientation: 0 });
    const box = this.add.rectangle(0, 0, 420, 24, 0x222222).setOrigin(0.5);
    const fill = this.add.rectangle(-210 + 2, 0, 0, 16, 0x20c997).setOrigin(0, 0.5);
    sizer.add(box, 0, 'center', 0, true);
    sizer.add(fill, 0, 'center', { left: 2, right: 2 }, false);
    sizer.layout();

    this.load.on('progress', (v: number) => {
      fill.width = (416 - 4) * v;
      sizer.layout();
    });

    this.load.on('complete', () => {
      sizer.destroy();
    });

    // Конфиги грузим напрямую в StarSystemScene/ConfigManager через fetch — убираем JSON из Loader,
    // чтобы не падать, если сервер отдаёт HTML на 404

    // Загрузка ассетов: сначала пробуем из src/assets через ESM URL, затем public fallback
    // Пробуем загрузить из src (ESM) и из public (fallback)
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const urlFromSrc = new URL('../assets/ships/alpha/alpha_image.png', import.meta.url).href;
      this.load.image('ship_alpha', urlFromSrc);
    } catch (_) {
      /* noop */
    }
    this.load.image('ship_alpha_public', '/assets/ships/alpha/alpha_image.png');
    // Ship variants — реальные файлы
    this.load.image('ship_explorer', '/assets/ships/alpha/explorer_ship.jpg');
    this.load.image('ship_trader', '/assets/ships/alpha/trader_ship.jpg');
    // Background tiles
    // убран устаревший "bg_nebula1" (файл удалён)
    this.load.image('bg_nebula_blue', '/assets/Nebula_Blue.png');
    this.load.image('bg_stars1', '/assets/Stars-Big_1_1_PC.png');
    // Weapons icons (mapped to available files in public/assets/weapons)
    this.load.image('weapon_laser', '/assets/weapons/laser_cannon.png');
    this.load.image('weapon_cannon', '/assets/weapons/heavy_laser_cannon.png');
    this.load.image('weapon_missile', '/assets/weapons/imperial_photon_cannon.png');
    this.load.image('weapon_railgun', '/assets/weapons/basic_railgin.png');
    this.load.image('weapon_plasma', '/assets/weapons/ion_cannon.png');
    this.load.image('weapon_flak', '/assets/weapons/impulse_charger.png');
    // Planets
    for (let i = 0; i <= 9; i++) {
      const idx = i.toString().padStart(2, '0');
      this.load.image(`planet_${idx}`, `/assets/planet${idx}.png`);
    }
  }

  create() {
    this.scene.start('StarSystemScene');
    this.scene.launch('UIScene');
  }
}


