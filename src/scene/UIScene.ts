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
  private npcDebugText?: Phaser.GameObjects.Text;
  private npcDebugTimer?: Phaser.Time.TimerEvent;
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
    const onReady = (payload: { config: ConfigManager; ship: Phaser.GameObjects.GameObject; pauseManager?: any; timeManager?: any }) => {
      this.configRef = payload.config;
      
      // Инициализация HUD (включая миникарту, паузу и время)
      this.hud = new HUDManager(this);
      this.hud.init(payload.config, payload.ship, payload.pauseManager, payload.timeManager);
      
      // при смене системы полностью пересоздаем HUD для корректной работы шрифтов
      starScene.events.on('system-ready', (pl: any) => {
        this.configRef = pl.config;
        this.hud.updateForNewSystem(pl.config, pl.ship);
      });
    };
    // Если уже создана — попробуем сразу
    if ((starScene as any).config && (starScene as any).ship) {
      onReady({ 
        config: (starScene as any).config, 
        ship: (starScene as any).ship, 
        pauseManager: (starScene as any).pauseManager, 
        timeManager: (starScene as any).timeManager 
      });
    } else {
      starScene.events.once('system-ready', onReady);
    }


    // Открытие меню систем через InputManager действия
    try {
      const stars = this.scene.get('StarSystemScene') as any;
      const inputMgr = stars?.inputMgr;
      inputMgr?.onAction('systemMenu', () => this.toggleSystemMenu());
    } catch {}

    // Debug overlay: NPC quotas/active/pending
    this.npcDebugText = this.add.text(16, 100, '', { color: '#ffffff', fontFamily: 'roboto', fontSize: '20px' })
      .setScrollFactor(0)
      .setDepth(1200)
      .setOrigin(0, 0);
    this.npcDebugTimer = this.time.addEvent({ delay: 500, loop: true, callback: this.updateNpcDebug, callbackScope: this });
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

  private updateNpcDebug = () => {
    if (!this.npcDebugText) return;
    const stars: any = this.scene.get('StarSystemScene');
    const cfg: ConfigManager | undefined = this.configRef ?? (stars?.config as ConfigManager | undefined);
    if (!cfg) { this.npcDebugText.setText(''); return; }

    // Суммарные квоты по префабам
    const quotaByPrefab = new Map<string, number>();
    try {
      const sys = cfg.system as any;
      const add = (prefab: string, count: number) => quotaByPrefab.set(prefab, (quotaByPrefab.get(prefab) ?? 0) + (count ?? 0));
      for (const p of (sys?.planets ?? []) as any[]) {
        const q = p?.spawn?.quotas as Record<string, number> | undefined;
        if (!q) continue; for (const [k, v] of Object.entries(q)) add(k, v ?? 0);
      }
      for (const s of (sys?.stations ?? []) as any[]) {
        const q = s?.spawn?.quotas as Record<string, number> | undefined;
        if (!q) continue; for (const [k, v] of Object.entries(q)) add(k, v ?? 0);
      }
    } catch {}

    // Активные по префабам
    const activeByPrefab = new Map<string, number>();
    try {
      const npcs: any[] = (stars?.npcs ?? []).filter((o: any) => o?.active);
      for (const o of npcs) {
        const k = (o as any).__prefabKey ?? 'unknown';
        activeByPrefab.set(k, (activeByPrefab.get(k) ?? 0) + 1);
      }
    } catch {}

    // Ожидающие (pending) по префабам
    const pendingByPrefab = new Map<string, number>();
    try {
      const sim: any = stars?.npcSim;
      const arr: any[] = (sim?.getPendingSnapshot?.() ?? sim?.pending ?? []).filter((p: any) => p && p.created === false);
      for (const p of arr) {
        const k = p.prefab ?? 'unknown';
        pendingByPrefab.set(k, (pendingByPrefab.get(k) ?? 0) + 1);
      }
    } catch {}

    const allPrefabs = new Set<string>([
      ...Array.from(quotaByPrefab.keys()),
      ...Array.from(activeByPrefab.keys()),
      ...Array.from(pendingByPrefab.keys())
    ]);
    const names = Array.from(allPrefabs.values()).sort();

    const lines: string[] = [];
    lines.push('Активные NPC');
    for (const name of names) {
      const c = activeByPrefab.get(name) ?? 0;
      const limit = quotaByPrefab.get(name) ?? 0;
      lines.push(`${name} x ${c}/${limit}`);
    }
    lines.push('');
    lines.push('Ожидающие NPC');
    for (const name of names) {
      const c = pendingByPrefab.get(name) ?? 0;
      const limit = quotaByPrefab.get(name) ?? 0;
      lines.push(`${name} x ${c}/${limit}`);
    }

    this.npcDebugText.setText(lines.join('\n'));
  };
}


