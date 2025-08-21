import { describe, it, expect, beforeEach } from 'vitest';
import { CooldownService } from '@/sys/combat/weapons/services/CooldownService';

describe('CooldownService', () => {
  let cd: CooldownService;
  const slot = 'laser';
  const playerShip: any = { id: 'player-ship' };

  beforeEach(() => {
    cd = new CooldownService();
  });

  it('getShooterTimes returns stable map per shooter', () => {
    const shooterA = { id: 'A' };
    const shooterB = { id: 'B' };
    const mapA1 = cd.getShooterTimes(shooterA);
    mapA1['laser'] = 123;
    const mapA2 = cd.getShooterTimes(shooterA);
    expect(mapA2['laser']).toBe(123);
    const mapB = cd.getShooterTimes(shooterB);
    expect(mapB['laser']).toBeUndefined();
  });

  it('weapon charge progress goes 0..1 within cooldown and 1 outside', () => {
    const w = { fireRatePerSec: 2 }; // cooldown 500ms
    const now = 1000;
    const until = now + 500;
    cd.setChargeUntil(slot, until);
    // start of cooldown
    expect(cd.getWeaponChargeProgress(slot, now, w)).toBeCloseTo(0, 3);
    // middle
    expect(cd.getWeaponChargeProgress(slot, now + 250, w)).toBeCloseTo(0.5, 2);
    // end
    expect(cd.getWeaponChargeProgress(slot, now + 500, w)).toBeCloseTo(1, 3);
    // beyond end
    expect(cd.getWeaponChargeProgress(slot, now + 800, w)).toBe(1);
  });

  it('clearCharge removes slot from playerChargeUntil', () => {
    const w = { fireRatePerSec: 1 };
    const now = 1000;
    cd.setChargeUntil(slot, now + 1000);
    expect(cd.getWeaponChargeProgress(slot, now, w)).toBeLessThan(1);
    cd.clearCharge(slot);
    expect(cd.getWeaponChargeProgress(slot, now, w)).toBe(1);
  });

  it('beam readyAt and refresh progress reflect timing correctly', () => {
    const now = 1000;
    const w = { beam: { refreshMs: 400 } };
    // initially 1
    expect(cd.getBeamRefreshProgress(slot, now, w, playerShip)).toBe(1);
    cd.setBeamReadyAt(playerShip, slot, now + 400);

    expect(cd.getBeamReadyAt(playerShip, slot)).toBe(now + 400);
    // start
    expect(cd.getBeamRefreshProgress(slot, now, w, playerShip)).toBeCloseTo(0, 3);
    // mid
    expect(cd.getBeamRefreshProgress(slot, now + 200, w, playerShip)).toBeCloseTo(0.5, 2);
    // end
    expect(cd.getBeamRefreshProgress(slot, now + 400, w, playerShip)).toBeCloseTo(1, 3);
  });

  it('isWeaponCharging respects both chargeUntil and beam cooldowns', () => {
    const now = 1000;
    // No cooldowns
    expect(cd.isWeaponCharging(slot, now, playerShip)).toBe(false);
    // Projectile charge
    cd.setChargeUntil(slot, now + 300);
    expect(cd.isWeaponCharging(slot, now, playerShip)).toBe(true);
    expect(cd.isWeaponCharging(slot, now + 300, playerShip)).toBe(false);
    cd.clearCharge(slot);
    // Beam cooldown
    cd.setBeamReadyAt(playerShip, slot, now + 500);
    expect(cd.isWeaponCharging(slot, now, playerShip)).toBe(true);
    expect(cd.isWeaponCharging(slot, now + 500, playerShip)).toBe(false);
  });
});
