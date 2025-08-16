import Phaser from 'phaser';
import { HUDManager } from '@/ui/hud/HUDManager';
import { RadialMenuManager } from '@/ui/RadialMenuManager';
import type { ConfigManager } from '@/sys/ConfigManager';

export default class UIScene extends Phaser.Scene {
  private hud!: HUDManager;
  private debugText!: Phaser.GameObjects.Text;
  private configRef?: ConfigManager;
  private uiTextResolution: number = 1;
  private systemMenu?: any;
  private radialMenu!: RadialMenuManager;
  constructor() {
    super('UIScene');
  }

  create() {
    // lock UI text resolution to 2x for stability across zoom/scales
    this.uiTextResolution = 2;
    // keep subpixel positioning for UI (crisper with setResolution)
    try { this.cameras.main.setRoundPixels(false); } catch {}
    const label = this.add.text(32, 32, 'Space is feodal', { color: '#F5F0E9', fontFamily: 'HooskaiChamferedSquare', fontSize: '48px' }).setScrollFactor(0).setDepth(1000);
    try { (label as any).setResolution?.(this.uiTextResolution); } catch {}
    this.debugText = this.add.text(32, 80, '', { color: '#F5F0E9', fontSize: '28px' }).setScrollFactor(0).setDepth(1000);
    try { (this.debugText as any).setResolution?.(this.uiTextResolution); } catch {}

    // Инициализация радиального меню
    this.radialMenu = new RadialMenuManager(this);
    
    // Инициализация UI компонентов: ждём готовности StarSystemScene
    const starScene = this.scene.get('StarSystemScene') as Phaser.Scene & any;
    const onReady = (payload: { config: ConfigManager; ship: Phaser.GameObjects.GameObject }) => {
      this.configRef = payload.config;
      
      // Инициализация HUD (включая миникарту)
      this.hud = new HUDManager(this);
      this.hud.init(payload.config, payload.ship);
      
      // при смене системы полностью пересоздаем HUD для корректной работы шрифтов
      starScene.events.on('system-ready', (pl: any) => {
        this.configRef = pl.config;
        this.hud.updateForNewSystem(pl.config, pl.ship);
      });
    };
    // Если уже создана — попробуем сразу
    if ((starScene as any).config && (starScene as any).ship) {
      onReady({ config: (starScene as any).config, ship: (starScene as any).ship });
    } else {
      starScene.events.once('system-ready', onReady);
    }


    // Debug menu to switch systems
    const key = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.M);
    key?.on('down', () => this.toggleSystemMenu());
  }







  // Публичный метод для обращения к Game Over через HUD
  public showGameOver() {
    this.hud?.showGameOver();
  }

  private async toggleSystemMenu() {
    if (this.systemMenu) { this.systemMenu.destroy(); this.systemMenu = undefined; return; }
    const sw = this.scale.width; const sh = this.scale.height;
    const systems = await (async()=>{ try { return await (await fetch('/configs/systems/systems.json')).json(); } catch { return await (await fetch('/configs/systems.json')).json(); } })();
    const items = Object.entries(systems.defs).map(([id, def]: any) => ({ id, name: def.name }));
    const bg = this.add.rectangle(sw/2, sh/2, 720, 480, 0x0f172a, 0.95).setScrollFactor(0).setDepth(4000);
    bg.setStrokeStyle(2, 0x334155);
    const title = this.add.text(sw/2, sh/2 - 180, 'Смена системы (M)', { color: '#e2e8f0', fontSize: '36px' }).setOrigin(0.5).setDepth(4001).setScrollFactor(0);
    const buttons: any[] = [];
    const rex = (this as any).rexUI;
    items.forEach((it, idx) => {
      const btn = rex.add.label({ x: sw/2, y: sh/2 - 80 + idx*80, background: this.add.rectangle(0,0,560,60,0x111827).setStrokeStyle(2,0x334155), text: this.add.text(0,0,it.name,{color:'#e2e8f0',fontSize:'28px'}), space:{left:20,right:20,top:12,bottom:12} }).layout().setScrollFactor(0).setDepth(4001)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', async () => {
          // Смена системы (runtime): сохраняем выбор в localStorage
          try { localStorage.setItem('sf_selectedSystem', it.id); } catch {}
          const starScene = this.scene.get('StarSystemScene') as any;
          starScene.scene.stop('StarSystemScene');
          starScene.scene.stop('UIScene');
          starScene.scene.start('PreloadScene');
        });
      buttons.push(btn);
    });
    this.systemMenu = this.add.container(0,0,[bg,title,...buttons]).setDepth(4000);
  }

  // Методы для управления радиальным меню
  showRadialMenu(x: number, y: number) {
    this.radialMenu.show(x, y);
  }

  hideRadialMenu() {
    this.radialMenu.hide();
  }

  updateRadialMenuSelection(mouseY: number) {
    this.radialMenu.updateSelection(mouseY);
  }

  getRadialMenuSelection() {
    return this.radialMenu.getSelectedItem();
  }

  isRadialMenuVisible(): boolean {
    return this.radialMenu.isMenuVisible();
  }
}


