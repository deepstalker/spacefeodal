import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BeamService } from '@/sys/combat/weapons/services/BeamService';
import { EventBus, EVENTS } from '@/sys/combat/weapons/services/EventBus';

// Простая шина событий для сцены
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
  const events = new FakeEvents();
  const timers: Record<string, any> = {};
  let timerIdSeq = 0;
  const scene: any = {
    events,
    add: {
      graphics: vi.fn(() => {
        const gfx: any = {
          setDepth: vi.fn(() => gfx),
          clear: vi.fn(),
          destroy: vi.fn(),
        };
        return gfx;
      })
    },
    time: {
      addEvent: vi.fn(({ callback }) => {
        // Возвращаем простой таймер с вызовом callback по требованию теста
        const t = { remove: vi.fn(), __cb: callback };
        return t;
      }),
      delayedCall: vi.fn((delayMs: number, cb: Function) => {
        const id = `dc_${timerIdSeq++}`;
        const t = { getOverallProgress: () => 0, hasDispatched: false };
        timers[id] = { delayMs, cb, t };
        // Для теста вызываем немедленно, чтобы сымитировать окончание duration
        cb();
        return t as any;
      })
    }
  };
  return { scene, timers };
}

function makeDeps(scene: any) {
  const config: any = { weaponTypes: { homing: {} } };
  const combat: any = { getPlayerShip: () => playerShip };
  const cooldowns: any = { setBeamReadyAt: vi.fn() };
  const callbacks = {
    shouldContinueBeam: vi.fn(() => true),
    applyBeamTickDamage: vi.fn(),
    drawBeam: vi.fn(),
    getNowMs: () => 0,
    isPaused: () => false,
    registerTimer: vi.fn(),
    unregisterTimer: vi.fn(),
    getPlayerShip: () => playerShip,
  };
  return { config, combat, cooldowns, callbacks };
}

const playerShip = { active: true, depth: 1 } as any;

describe('BeamService - events and timers', () => {
  let sceneWrap: any;

  beforeEach(() => {
    sceneWrap = makeScene();
  });

  it('emits BeamStart and BeamRefresh via EventBus and sets beam cooldown on duration end', () => {
    const { scene } = sceneWrap;
    // перехватим новые события EventBus
    const bus = new EventBus(scene);
    const startSpy = vi.fn();
    const refreshSpy = vi.fn();
    bus.on(EVENTS.BeamStart, startSpy);
    bus.on(EVENTS.BeamRefresh, refreshSpy);

    const { config, combat, cooldowns, callbacks } = makeDeps(scene);
    const svc = new BeamService(scene, config, combat, cooldowns, callbacks as any);

    const shooter = playerShip;
    const target = { active: true, x: 100, y: 100 } as any;
    const w: any = { range: 1000, beam: { tickMs: 50, durationMs: 100, refreshMs: 200, ticksPerSecond: 10 } };

    // ensureBeam создаёт луч, эмитит start и по delayedCall — refresh + setBeamReadyAt
    svc.ensureBeam(shooter, 'slotA', w, target, 100);

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(startSpy.mock.calls[0][0]).toEqual({ slotKey: 'slotA', durationMs: 100 });

    // delayedCall в тесте вызван немедленно
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy.mock.calls[0][0]).toEqual({ slotKey: 'slotA', refreshMs: 200 });
    expect(cooldowns.setBeamReadyAt).toHaveBeenCalledWith(shooter, 'slotA', expect.any(Number));
  });
});
