import type { ConfigManager } from '../../../ConfigManager';
import type { CombatManager } from '../../../CombatManager';
import type { CooldownService } from './CooldownService';
import { EventBus, EVENTS } from './EventBus';

export type BeamCallbacks = {
  shouldContinueBeam: (shooter: any, target: any, w: any) => boolean;
  applyBeamTickDamage: (shooter: any, target: any, w: any) => void;
  drawBeam: (gfx: Phaser.GameObjects.Graphics, shooter: any, target: any, w: any) => void;
  getNowMs: () => number;
  isPaused: () => boolean;
  registerTimer?: (id: string, timer: Phaser.Time.TimerEvent) => void;
  unregisterTimer?: (id: string) => void;
  getPlayerShip: () => any;
};

export class BeamService {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private combat: CombatManager;
  private cooldowns: CooldownService;
  private cb: BeamCallbacks;

  // Активные лучи по стрелку и слоту
  private activeBeams: WeakMap<any, Map<string, { gfx: Phaser.GameObjects.Graphics; timer: Phaser.Time.TimerEvent; target: any }>> = new WeakMap();

  constructor(scene: Phaser.Scene, config: ConfigManager, combat: CombatManager, cooldowns: CooldownService, callbacks: BeamCallbacks) {
    this.scene = scene;
    this.config = config;
    this.combat = combat;
    this.cooldowns = cooldowns;
    this.cb = callbacks;
  }

  public ensureBeam(shooter: any, slotKey: string, w: any, target: any, distNow: number) {
    const inRange = distNow <= w.range;
    const isValid = shooter?.active && target?.active;
    const map = this.activeBeams.get(shooter) || new Map();
    this.activeBeams.set(shooter, map);
    const state = map.get(slotKey);
    if (state && state.target !== target) {
      this.stopBeamIfAny(shooter, slotKey);
    }
    if (!inRange || !isValid) {
      if (state) this.stopBeamIfAny(shooter, slotKey);
      return;
    }
    if (state) {
      return;
    }
    this.stopBeamIfAny(shooter, slotKey);

    const baseDepth = ((((shooter as any)?.depth) ?? 1) - 0.05);
    const gfx = this.scene.add.graphics().setDepth(baseDepth);
    const tickMs = Math.max(10, w?.beam?.tickMs ?? 100);
    const durationMs = Math.max(tickMs, w?.beam?.durationMs ?? 1000);
    const refreshMs = Math.max(0, w?.beam?.refreshMs ?? 500);

    const timer = this.scene.time.addEvent({
      delay: 1000/Math.max(1, w.beam?.ticksPerSecond ?? 10),
      loop: true,
      callback: () => {
        if (this.cb.isPaused()) return;
        if (!this.cb.shouldContinueBeam(shooter, target, w)) { this.stopBeamIfAny(shooter, slotKey); return; }
        this.cb.applyBeamTickDamage(shooter, target, w);
      }
    });

    const redraw = () => {
      if (this.cb.isPaused()) return;
      if (!this.cb.shouldContinueBeam(shooter, target, w)) { this.stopBeamIfAny(shooter, slotKey); return; }
      this.cb.drawBeam(gfx, shooter, target, w);
    };
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, redraw);
    (gfx as any).__beamRedraw = redraw;
    map.set(slotKey, { gfx, timer, target });

    if (shooter === this.cb.getPlayerShip()) {
      try { this.scene.events.emit('beam-start', slotKey, durationMs); } catch {}
      try { new EventBus(this.scene).emit(EVENTS.BeamStart, { slotKey, durationMs }); } catch {}
    }

    // Автоматическое отключение по duration и установка refresh
    const durationId = `beam_duration_${slotKey}_${Date.now()}`;
    const durationTimer = this.scene.time.delayedCall(durationMs, () => {
      const now = this.cb.getNowMs();
      this.cooldowns.setBeamReadyAt(shooter, slotKey, now + refreshMs);
      // HUD: сразу после окончания duration запустить индикацию refresh
      if (shooter === this.cb.getPlayerShip()) {
        try { this.scene.events.emit('beam-refresh', slotKey, refreshMs); } catch {}
        try { new EventBus(this.scene).emit(EVENTS.BeamRefresh, { slotKey, refreshMs }); } catch {}
      }
      this.stopBeamIfAny(shooter, slotKey);
      try { this.cb.unregisterTimer?.(durationId); } catch {}
    });
    try { this.cb.registerTimer?.(durationId, durationTimer); } catch {}
  }

  public stopBeamIfAny(shooter: any, slotKey: string) {
    const map = this.activeBeams.get(shooter);
    if (!map) return;
    const s = map.get(slotKey);
    if (!s) return;
    try { s.timer.remove(false); } catch {}
    try { const cb = (s.gfx as any).__beamRedraw; if (cb) this.scene.events.off(Phaser.Scenes.Events.UPDATE, cb); } catch {}
    try { s.gfx.clear(); s.gfx.destroy(); } catch {}
    map.delete(slotKey);
  }
}
