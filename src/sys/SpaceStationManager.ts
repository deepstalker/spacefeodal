import type { ConfigManager } from './ConfigManager';

export class SpaceStationManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private stations: any[] = [];

  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
  }

  init() {
    const sys: any = this.config.system;
    if (!sys?.stations) return;
    for (const s of sys.stations as any[]) {
      if (s.type === 'pirate_base') this.spawnPirateBase(s);
    }
  }

  private spawnPirateBase(s: { x: number; y: number; wave?: { initialDelayMs?: number; intervalMs?: number; count?: number; lifespanMs?: number } }) {
    const baseX = s.x;
    const baseY = s.y;
    const rect = this.scene.add.rectangle(baseX, baseY, 420, 420, 0x7f1d1d).setDepth(0.2);
    const lbl = this.scene.add.text(baseX, baseY, 'Пиратская база', { color: '#fca5a5', fontSize: '20px', fontStyle: 'bold' }).setOrigin(0.5).setDepth(0.21);
    (rect as any).__hp = 5000; (rect as any).__alive = true;
    this.stations.push({ type: 'pirate_base', obj: rect, label: lbl });

    // register as target in combat system so it can be attacked
    const cm: any = (this.scene as any).combat;
    if (cm && Array.isArray(cm['targets'])) {
      const bg = this.scene.add.rectangle(rect.x - 64, rect.y - 260, 128, 8, 0x111827).setOrigin(0, 0.5).setDepth(0.15);
      const fill = this.scene.add.rectangle(rect.x - 64, rect.y - 260, 128, 8, 0xef4444).setOrigin(0, 0.5).setDepth(0.16);
      bg.setVisible(false); fill.setVisible(false);
      cm['targets'].push({ obj: rect, hp: 5000, hpMax: 5000, hpBarBg: bg, hpBarFill: fill, ai: { type: 'static', preferRange: 0, retreatHpPct: 0 }, faction: 'pirate' });
    }

    // simple base turret
    const baseRadar = 1400;
    const baseFireCooldownMs = 600; let baseLastShot = 0;
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, (_t:number, dt: number) => {
      // Не стреляем во время паузы
      const pauseManager: any = (this.scene as any).pauseManager;
      if (pauseManager?.getPaused && pauseManager.getPaused()) {
        return;
      }
      
      if (!(rect as any).__alive) return;
      const cm: any = (this.scene as any).combat;
      const now = (this.scene as any).time.now;
      let best: any = null; let bestD = Number.POSITIVE_INFINITY;
      for (const t of (cm?.targets ?? [])) {
        if (!t.obj?.active) continue;
        if (t.faction === 'pirate') continue;
        const d = Phaser.Math.Distance.Between(baseX, baseY, (t.obj as any).x, (t.obj as any).y);
        if (d < bestD && d <= baseRadar) { best = t.obj; bestD = d; }
      }
      if (best && now - baseLastShot > baseFireCooldownMs) {
        baseLastShot = now;
        const ang = Math.atan2((best as any).y - baseY, (best as any).x - baseX);
        const proj = this.scene.add.rectangle(baseX, baseY, 12, 4, 0xff6666).setDepth(0.25);
        const spd = 900; const vx = Math.cos(ang) * spd; const vy = Math.sin(ang) * spd;
        const onUpd = (_tt:number, dtt:number) => {
          // Проверяем паузу
          if (pauseManager?.getPaused && pauseManager.getPaused()) {
            return;
          }
          
          (proj as any).x += vx * (dtt/1000);
          (proj as any).y += vy * (dtt/1000);
          const dd = Phaser.Math.Distance.Between((proj as any).x, (proj as any).y, (best as any).x, (best as any).y);
          if (dd < 30 && (best as any).active) {
            const cm2: any = (this.scene as any).combat;
            cm2?.applyDamage?.(best, 20, rect);
            this.scene.events.off(Phaser.Scenes.Events.UPDATE, onUpd);
            proj.destroy();
          }
        };
        this.scene.events.on(Phaser.Scenes.Events.UPDATE, onUpd);
        
        // Создаем таймер с учетом паузы
        const lifetimeTimer = this.scene.time.delayedCall(2000, () => { 
          this.scene.events.off(Phaser.Scenes.Events.UPDATE, onUpd); 
          proj.destroy(); 
        });
        
        // Регистрируем таймер для паузы если доступен pauseManager
        if (pauseManager?.pauseTimer) {
          // Генерируем уникальный ID для таймера
          const timerId = `station-projectile-lifetime-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          pauseManager.pauseTimer(lifetimeTimer, timerId);
        }
      }
    });

    // waves отключены: спавн NPC централизован симулятором по квотам

    // handle base destruction: when hp <= 0, remove, stop waves
    const checkAlive = (_t:number, _dt:number) => {
      const cmAny: any = (this.scene as any).combat;
      const entry = cmAny?.targets?.find((t: any) => t.obj === rect);
      if (!entry) return;
      if (entry.hp <= 0 && (rect as any).__alive) {
        (rect as any).__alive = false;
        rect.destroy(); lbl.destroy();
        entry.hpBarBg.destroy(); entry.hpBarFill.destroy();
      }
    };
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, checkAlive);
  }
}


