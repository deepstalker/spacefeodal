import { describe, it, expect, vi, beforeEach } from 'vitest';
import Phaser from 'phaser';
import { ProjectileService } from '@/sys/combat/weapons/services/ProjectileService';

class FakeEvents {
  handlers = new Map<string, Set<Function>>();
  on(name: string, fn: Function) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name)!.add(fn);
  }
  off(name: string, fn: Function) { this.handlers.get(name)?.delete(fn); }
  emit(name: string, ...args: any[]) { this.handlers.get(name)?.forEach(fn => fn(...args)); }
}

function makeScene() {
  // гарантируем наличие Phaser.Scenes.Events.UPDATE
  (Phaser as any).Scenes = (Phaser as any).Scenes || { Events: { UPDATE: 'update' } };
  if (!(Phaser as any).Scenes.Events) (Phaser as any).Scenes.Events = { UPDATE: 'update' };

  const events = new FakeEvents();
  const scene: any = {
    events,
    add: {
      circle: vi.fn((x: number, y: number, r: number) => {
        const obj: any = { x, y, r, setDepth: vi.fn(() => obj), destroy: vi.fn(), setRotation: vi.fn(() => obj) };
        return obj;
      }),
      rectangle: vi.fn((x: number, y: number, w: number, h: number) => {
        const obj: any = { x, y, w, h, setDepth: vi.fn(() => obj), destroy: vi.fn(), setRotation: vi.fn(() => obj) };
        return obj;
      })
    },
    time: {
      delayedCall: vi.fn((_delayMs: number, cb: Function) => {
        // В тесте пусть не срабатывает автоматически
        const t = { remove: vi.fn() };
        // можно вызывать вручную при необходимости: cb();
        return t as any;
      })
    }
  };
  return scene;
}

function makeCombat() {
  const state: any = {
    targets: [] as any[],
    player: { x: 0, y: 0 },
  };
  const combat: any = {
    getPlayerShip: () => state.player,
    findTargetEntry: (t: any) => ({ obj: t, faction: 'enemy' }),
    getTargetEntries: () => state.targets,
    getEffectiveRadiusPublic: (_obj: any) => 5,
    isTargetCombatAssignedPublic: () => false,
    isTargetCombatSelectedPublic: () => false,
    getRelationPublic: (_a: any, _b: any) => 'confrontation',
    applyDamagePublic: vi.fn(),
  };
  return { combat, state };
}

describe('ProjectileService - linear flight and hit', () => {
  let scene: any;

  beforeEach(() => {
    scene = makeScene();
  });

  it('moves projectile and registers a hit on target', () => {
    const { combat } = makeCombat();
    const config: any = { weaponTypes: {} };
    const callbacks = {
      getFoW: () => undefined,
      registerTimer: vi.fn(),
      unregisterTimer: vi.fn(),
      spawnHitEffect: vi.fn(),
      isInvulnerable: () => false,
    };
    const svc = new ProjectileService(scene, config, combat as any, callbacks);

    const shooter: any = { x: 0, y: 0 };
    const target: any = { x: 10, y: 0, active: true };
    const w: any = { damage: 10, projectile: { shape: 'circle', radius: 2, color: '#ffffff' } };

    const proj = svc.spawnProjectile(w, shooter, { x: 0, y: 0 }, 0, target);

    // стартуем линейный полёт по оси X к цели
    const angle = 0; // вправо
    const speed = 100; // px/s
    const lifetimeMs = 2000;
    const shooterFaction = 'player';
    const shooterOverrides = undefined;

    const opts = {
      getNowMs: () => 0,
      isPaused: () => false,
      setVisibleByFoW: (_: any) => {},
    };

    svc.startFlight(w, proj, shooter, target, angle, speed, lifetimeMs, shooterFaction, shooterOverrides, opts);

    // Эмулируем один апдейт ~100мс, чтобы пуля прошла через радиус цели
    scene.events.emit((Phaser as any).Scenes.Events.UPDATE, 0, 100);

    // Должен быть нанесён урон и снаряд уничтожен
    expect(combat.applyDamagePublic).toHaveBeenCalledWith(target, w.damage, shooter);
    expect(proj.destroy).toHaveBeenCalled();
  });
});
