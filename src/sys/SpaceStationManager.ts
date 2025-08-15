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

    // simple base turret
    const baseRadar = 1400;
    const baseFireCooldownMs = 600; let baseLastShot = 0;
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, (_t:number, dt: number) => {
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
        this.scene.time.delayedCall(2000, () => { this.scene.events.off(Phaser.Scenes.Events.UPDATE, onUpd); proj.destroy(); });
      }
    });

    // waves
    const count = s.wave?.count ?? 5;
    const lifespanMs = s.wave?.lifespanMs ?? 120000;
    const initialDelayMs = s.wave?.initialDelayMs ?? 6000;
    const intervalMs = s.wave?.intervalMs ?? 60000;
    const spawnWave = () => {
      if (!(rect as any).__alive) return;
      const offs = [[-220,-240],[-260,180],[240,-200],[200,260],[0,-280]];
      for (let i = 0; i < count; i++) {
        const ox = baseX + offs[i % offs.length][0];
        const oy = baseY + offs[i % offs.length][1];
        const npc = ((this.scene as any).combat as any).spawnNPCPrefab('pirate', ox, oy) as any;
        if (!npc) continue;
        (npc as any).__behavior = 'patrol';
        (npc as any).__targetPatrol = null;
        (npc as any).__despawnAt = (this.scene as any).time.now + lifespanMs;
        (npc as any).__homeBase = rect;
        (npc as any).__returningHome = false;
        ((this.scene as any).npcs as any[]).push(npc);
      }
    };
    this.scene.time.delayedCall(initialDelayMs, spawnWave);
    this.scene.time.addEvent({ delay: intervalMs, loop: true, callback: spawnWave });
  }
}


