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
      
      // Устанавливаем линейную фильтрацию для всех иконок оружия для лучшего качества
      const weaponIcons = ['weapon_laser', 'weapon_cannon', 'weapon_missile', 'weapon_railgun', 'weapon_plasma', 'weapon_flak'];
      weaponIcons.forEach(key => {
        try {
          if (this.textures.exists(key)) {
            this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
          }
        } catch (e) {
          console.warn(`Не удалось установить фильтр для ${key}:`, e);
        }
      });
      
      // Ждем загрузки всех шрифтов перед запуском сцен
      this.waitForFontsAndStart();
    });

    // Конфиги грузим напрямую в StarSystemScene/ConfigManager через fetch — убираем JSON из Loader,
    // чтобы не падать, если сервер отдаёт HTML на 404

    // Принудительная загрузка шрифтов
    const fontPromises = [
      new FontFace('Request', 'url(/fonts/Request\\ Regular.ttf)').load(),
      new FontFace('HooskaiChamferedSquare', 'url(/fonts/HooskaiChamferedSquare.ttf)').load()
    ];
    
    Promise.all(fontPromises).then(fonts => {
      fonts.forEach(font => {
        (document.fonts as any).add(font);
        console.log(`Loaded font: ${font.family}`);
      });
    }).catch(error => {
      console.warn('Failed to preload fonts:', error);
    });

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
    // New ship variants
    this.load.image('ship_ordo_patrol_gunship', '/assets/ships/ordo_patrol_gunship.png');
    // Ship variants — реальные файлы
    this.load.image('ship_explorer', '/assets/ships/alpha/explorer_ship.png');
    this.load.image('ship_trader', '/assets/ships/alpha/trader_ship.png');
    // Background tiles
    // убран устаревший "bg_nebula1" (файл удалён)
    this.load.image('bg_nebula_blue', '/assets/Nebula_Blue.png');
    this.load.image('bg_stars1', '/assets/Stars-Big_1_1_PC.png');
    // Weapons icons (mapped to available files in public/assets/weapons)
    // Загружаем с оптимизированными настройками для высокого качества
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

  private async waitForFontsAndStart() {
    console.log('Waiting for fonts to load...');
    
    // Проверяем, загружены ли наши шрифты
    const checkFont = (fontFamily: string): boolean => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return false;
      
      context.font = `16px ${fontFamily}`;
      const customWidth = context.measureText('test').width;
      context.font = '16px Arial';
      const arialWidth = context.measureText('test').width;
      
      return customWidth !== arialWidth;
    };
    
    // Ждем загрузки шрифтов
    try {
      await document.fonts.ready;
      console.log('Fonts ready event fired');
      
      // Дополнительная проверка наших шрифтов
      const requestLoaded = checkFont('Request');
      const hooskaiLoaded = checkFont('HooskaiChamferedSquare');
      
      console.log('Font status:', { 
        Request: requestLoaded, 
        HooskaiChamferedSquare: hooskaiLoaded
      });
      
      // Если шрифты не загружены, ждем еще немного
      if (!requestLoaded || !hooskaiLoaded) {
        console.log('Fonts not ready, waiting additional 500ms...');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
    } catch (error) {
      console.warn('Font loading error:', error);
      // Продолжаем даже при ошибке, но с задержкой
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('Starting game scenes...');
    this.scene.start('StarSystemScene');
    this.scene.launch('UIScene');
  }

  create() {
    // create() теперь пустой, все происходит в waitForFontsAndStart
  }
}


