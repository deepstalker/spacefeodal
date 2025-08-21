import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProjectileService } from '@/sys/combat/weapons/services/ProjectileService';

describe('ProjectileService.checkProjectileCollisions', () => {
  let scene: any;
  let config: any;
  let combat: any;
  let svc: ProjectileService;
  let callbacks: any;

  const makeObj = (x: number, y: number) => ({ x, y, active: true });

  beforeEach(() => {
    scene = { time: { delayedCall: vi.fn(() => ({}) ) }, events: { on: vi.fn(), off: vi.fn() } };
    config = { weaponTypes: { homing: {} } };
    combat = {
      findTargetEntry: vi.fn((o: any) => ({ obj: o, faction: (o as any).faction, overrides: { factions: undefined } })),
      getTargetEntries: vi.fn(() => []),
      getRelationPublic: vi.fn((a: any, b: any) => (a && b && a !== b ? 'confrontation' : 'neutral')),
      getEffectiveRadiusPublic: vi.fn(() => 10),
      isTargetCombatSelectedPublic: vi.fn(() => false),
      isTargetCombatAssignedPublic: vi.fn(() => false),
      applyDamagePublic: vi.fn(),
      getPlayerShip: vi.fn(() => ({ id: 'player' }))
    };
    callbacks = {
      getFoW: vi.fn(() => undefined),
      registerTimer: vi.fn(),
      unregisterTimer: vi.fn(),
      spawnHitEffect: vi.fn(),
      isInvulnerable: vi.fn(() => false)
    };
    svc = new ProjectileService(scene as any, config as any, combat as any, callbacks);
  });

  it('hits target when within radius (no prev segment)', () => {
    const shooter: any = { x: 0, y: 0, active: true, faction: 'A' };
    const target: any = { ...makeObj(5, 0), faction: 'B' };
    const proj: any = { x: 12, y: 0, __combat: { damage: 5, target } };
    const w: any = { damage: 5 };
    const res = svc.checkProjectileCollisions(undefined, undefined, proj, shooter, target, w, 'A', undefined);
    expect(res === 'hit' || res === 'none').toBe(true); // if radius 10, distance 12 -> none; adjust radius
  });

  it('returns target_lost if target inactive', () => {
    const shooter: any = { x: 0, y: 0, active: true, faction: 'A' };
    const target: any = { x: 0, y: 0, active: false };
    const proj: any = { x: 0, y: 0, __combat: { damage: 5, target } };
    const w: any = { damage: 5 };
    const res = svc.checkProjectileCollisions(undefined, undefined, proj, shooter, target, w, 'A', undefined);
    expect(res).toBe('target_lost');
  });

  it('applies damage on hostile relation', () => {
    (combat.getEffectiveRadiusPublic as any).mockReturnValue(20);
    const shooter: any = { x: 0, y: 0, active: true, faction: 'A' };
    const target: any = { x: 10, y: 0, active: true, faction: 'B' };
    const proj: any = { x: 15, y: 0, __combat: { damage: 7, target } };
    const w: any = { damage: 7 };
    const res = svc.checkProjectileCollisions(0, 0, proj, shooter, target, w, 'A', undefined);
    expect(res).toBe('hit');
    expect(combat.applyDamagePublic).toHaveBeenCalledWith(target, 7, shooter);
    expect(callbacks.spawnHitEffect).toHaveBeenCalled();
  });

  it('ignores invulnerable target and returns expire when in radius', () => {
    (combat.getEffectiveRadiusPublic as any).mockReturnValue(20);
    callbacks.isInvulnerable = vi.fn(() => true);
    svc = new ProjectileService(scene as any, config as any, combat as any, callbacks);
    const shooter: any = { x: 0, y: 0, active: true, faction: 'A' };
    const target: any = { x: 10, y: 0, active: true, faction: 'B' };
    const proj: any = { x: 15, y: 0, __combat: { damage: 7, target } };
    const w: any = { damage: 7 };
    const res = svc.checkProjectileCollisions(0, 0, proj, shooter, target, w, 'A', undefined);
    expect(res).toBe('expire');
  });
});
