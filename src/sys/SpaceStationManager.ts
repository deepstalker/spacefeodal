import type { ConfigManager } from './ConfigManager';
import { StaticObjectType } from './fog-of-war/types';

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
    this.stations.push({ type: 'pirate_base', obj: rect, label: lbl });

    // Регистрируем как статический объект тумана войны, чтобы он не участвовал в бою
    try {
      const fog: any = (this.scene as any).fogOfWar;
      if (fog?.registerStaticObject) {
        fog.registerStaticObject(rect as any, StaticObjectType.STATION);
      }
    } catch {}

    // Не регистрируем станцию в CombatManager.targets, не создаём HP-бары, не стреляем.
  }
}


