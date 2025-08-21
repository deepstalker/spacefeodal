import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TargetService } from '@/sys/combat/weapons/services/TargetService';

describe('TargetService', () => {
  let scene: any;
  let combatManager: any;
  let svc: TargetService;

  beforeEach(() => {
    scene = { events: { emit: vi.fn() } };
    combatManager = { markTargetHostileToPlayer: vi.fn() };
    svc = new TargetService(scene as any, combatManager as any);
  });

  it('setTarget stores target and marks hostile', () => {
    const slot = 'laser';
    const target: any = { x: 1, y: 2, active: true };
    svc.setTarget(slot, target);
    expect(svc.getTargets().get(slot)).toBe(target);
    expect(combatManager.markTargetHostileToPlayer).toHaveBeenCalledWith(target);
  });

  it('setTarget(null) clears slot and emits out-of-range false', () => {
    const slot = 'laser';
    const target: any = { x: 1, y: 2, active: true };
    svc.setTarget(slot, target);
    svc.setTarget(slot, null);
    expect(svc.getTargets().has(slot)).toBe(false);
    expect(scene.events.emit).toHaveBeenCalledWith('weapon-out-of-range', slot, false);
  });

  it('clearSlot removes slot and emits events', () => {
    const slot = 'laser';
    const target: any = { x: 1, y: 2, active: true };
    svc.setTarget(slot, target);
    (scene.events.emit as any).mockClear();
    svc.clearSlot(slot, target);
    expect(svc.getTargets().has(slot)).toBe(false);
    expect(scene.events.emit).toHaveBeenCalledWith('weapon-out-of-range', slot, false);
    expect(scene.events.emit).toHaveBeenCalledWith('player-weapon-target-cleared', target, [slot]);
  });

  it('clearAll clears and emits out-of-range for each slot', () => {
    const t1: any = { x: 0, y: 0, active: true };
    const t2: any = { x: 1, y: 1, active: true };
    svc.setTarget('a', t1);
    svc.setTarget('b', t2);
    (scene.events.emit as any).mockClear();
    svc.clearAll();
    expect(svc.getTargets().size).toBe(0);
    expect(scene.events.emit).toHaveBeenCalledWith('weapon-out-of-range', 'a', false);
    expect(scene.events.emit).toHaveBeenCalledWith('weapon-out-of-range', 'b', false);
  });

  it('clearAssignmentsForTarget removes only specified target and emits', () => {
    const t1: any = { x: 0, y: 0, active: true };
    const t2: any = { x: 1, y: 1, active: true };
    svc.setTarget('a', t1);
    svc.setTarget('b', t2);
    (scene.events.emit as any).mockClear();
    svc.clearAssignmentsForTarget(t2);
    expect(svc.getTargets().has('a')).toBe(true);
    expect(svc.getTargets().has('b')).toBe(false);
    expect(scene.events.emit).toHaveBeenCalledWith('player-weapon-target-cleared', t2, ['b']);
  });
});
