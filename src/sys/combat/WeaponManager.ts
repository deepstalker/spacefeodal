import type { ConfigManager } from '../ConfigManager';
import type { CombatManager } from '../CombatManager';
import { NPCState } from '../NPCStateManager';
import type { EnhancedFogOfWar } from '../fog-of-war/EnhancedFogOfWar';
import { DynamicObjectType } from '../fog-of-war/types';

type Target = Phaser.GameObjects.GameObject & { x: number; y: number; active: boolean };

export class WeaponManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private combatManager: CombatManager;
  private pauseManager?: any;
  private fogOfWar?: EnhancedFogOfWar;

  private lastFireTimesByShooter: WeakMap<any, Record<string, number>> = new WeakMap();
  private playerWeaponTargets: Map<string, Target> = new Map();
  private activeBeams: WeakMap<any, Map<string, { gfx: Phaser.GameObjects.Graphics; timer: Phaser.Time.TimerEvent; target: any }>> = new WeakMap();
  private beamCooldowns: WeakMap<any, Record<string, number>> = new WeakMap();
  private playerChargeUntil: Record<string, number> = {};
  private beamPrepUntil: WeakMap<any, Record<string, number>> = new WeakMap();
  private playerWeaponRangeCircles: Map<string, Phaser.GameObjects.Arc> = new Map();
  private weaponSlots: string[] = ['laser', 'cannon', 'missile']; // Default, will be replaced for NPCs

  constructor(scene: Phaser.Scene, config: ConfigManager, combatManager: CombatManager) {
    this.scene = scene;
    this.config = config;
    this.combatManager = combatManager;

    this.scene.events.on('weapon-slot-selected', (slotKey: string, selected: boolean) => {
        try { this.togglePlayerWeaponRangeCircle(slotKey, !!selected); } catch {}
    });
  }

  public setPauseManager(pauseManager: any) {
    this.pauseManager = pauseManager;
  }

  public setFogOfWar(fogOfWar: EnhancedFogOfWar) {
    this.fogOfWar = fogOfWar;
  }

  public getWeaponChargeProgress(slotKey: string): number {
    const chargeUntil = this.playerChargeUntil[slotKey];
    if (!chargeUntil) return 1;

    const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
    if (now >= chargeUntil) return 1;

    const w = this.config.weapons.defs[slotKey];
    if (!w) return 1;

    const cooldownMs = 1000 / Math.max(0.001, (w.fireRatePerSec ?? 1));
    const chargeStartTime = chargeUntil - cooldownMs;
    const elapsed = now - chargeStartTime;

    return Math.max(0, Math.min(1, elapsed / cooldownMs));
  }

  public isWeaponCharging(slotKey: string): boolean {
    const chargeUntil = this.playerChargeUntil[slotKey];
    if (chargeUntil) {
      const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
      if (now < chargeUntil) return true;
    }

    const beamCooldowns = this.beamCooldowns.get(this.combatManager.getPlayerShip());
    if (beamCooldowns && beamCooldowns[slotKey]) {
      const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
      return now < beamCooldowns[slotKey];
    }

    return false;
  }

  public getBeamRefreshProgress(slotKey: string): number {
    const beamCooldowns = this.beamCooldowns.get(this.combatManager.getPlayerShip());
    if (!beamCooldowns || !beamCooldowns[slotKey]) return 1;

    const refreshUntil = beamCooldowns[slotKey];
    const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
    if (now >= refreshUntil) return 1;

    const w = this.config.weapons.defs[slotKey];
    if (!w) return 1;

    const refreshMs = Math.max(0, w?.beam?.refreshMs ?? 500);
    const refreshStartTime = refreshUntil - refreshMs;
    const elapsed = now - refreshStartTime;

    return Math.max(0, Math.min(1, elapsed / refreshMs));
  }

  public setPlayerWeaponTarget(slotKey: string, target: Target | null) {
    if (target) {
      // Обозначаем цель как враждебную к игроку через боевой менеджер
      try { (this.combatManager as any).markTargetHostileToPlayer?.(target as any); } catch {}
      this.playerWeaponTargets.set(slotKey, target);
      const w = this.config.weapons.defs[slotKey];
      if (w) {
        if ((w.type ?? 'single') === 'beam') {
          const refreshMs = Math.max(0, w?.beam?.refreshMs ?? 500);
          const shooterTimes = this.beamCooldowns.get(this.combatManager.getPlayerShip()) ?? {};
          this.beamCooldowns.set(this.combatManager.getPlayerShip(), shooterTimes);
          const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
          shooterTimes[slotKey] = now + refreshMs;
          this.stopBeamIfAny(this.combatManager.getPlayerShip(), slotKey);
        } else {
          const times = this.getShooterTimes(this.combatManager.getPlayerShip());
          const cooldownMs = 1000 / Math.max(0.001, (w.fireRatePerSec ?? 1));
          const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
          times[slotKey] = now + cooldownMs;
        }
      }
    } else {
      this.playerWeaponTargets.delete(slotKey);
      try { this.scene.events.emit('weapon-out-of-range', slotKey, false); } catch {}
    }
  }

  public clearPlayerWeaponTargets() {
    if (this.playerWeaponTargets.size > 0) {
      const clearedSlots = Array.from(this.playerWeaponTargets.keys());
      this.playerWeaponTargets.clear();
      if (clearedSlots.length > 0) {
        for (const slotKey of clearedSlots) {
          try { this.scene.events.emit('weapon-out-of-range', slotKey, false); } catch {}
        }
      }
    }
  }

    public getPlayerWeaponTargets(): ReadonlyMap<string, Target> {
        return this.playerWeaponTargets;
    }

    public clearAssignmentsForTarget(target: any) {
        const clearedSlots: string[] = [];
        for (const [slot, tgt] of this.playerWeaponTargets.entries()) {
            if (tgt === target) {
                this.playerWeaponTargets.delete(slot);
                clearedSlots.push(slot);
            }
        }
        if (clearedSlots.length > 0) {
            try { this.scene.events.emit('player-weapon-target-cleared', target, clearedSlots); } catch {}
        }
    }

  public update(isPaused: boolean) {
    this.updatePlayerWeapons(isPaused);
    this.updateNpcWeapons(isPaused);
    this.updatePlayerWeaponRangeCircles();
  }

  private updatePlayerWeapons(isPaused: boolean) {
    const ship = this.combatManager.getPlayerShip();
    if (!ship) return;

    const playerRadarRange = this.combatManager.getRadarRangeForPublic(ship);
    const slotsToClear: string[] = [];
    for (const [slot, target] of this.playerWeaponTargets.entries()) {
        const distToTarget = Phaser.Math.Distance.Between(ship.x, ship.y, target.x, target.y);
        if (distToTarget > playerRadarRange) {
            slotsToClear.push(slot);
        }
    }
    if (slotsToClear.length > 0) {
        for (const slot of slotsToClear) {
            this.playerWeaponTargets.delete(slot);
            try { this.scene.events.emit('weapon-out-of-range', slot, false); } catch {}
        }
        try { this.scene.events.emit('player-weapon-target-cleared', null, slotsToClear); } catch {}
    }

    for (const [slotKey, target] of this.playerWeaponTargets.entries()) {
        if (!target.active) {
            this.playerWeaponTargets.delete(slotKey);
            try { this.scene.events.emit('weapon-out-of-range', slotKey, false); } catch {}
            try { this.scene.events.emit('player-weapon-target-cleared', target, [slotKey]); } catch {}
        }
    }

    const playerSlots = this.config.player?.weapons ?? [];
    if (playerSlots.length) {
        const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
        for (let i = 0; i < playerSlots.length; i++) {
            const slotKey = playerSlots[i];
            const target = this.playerWeaponTargets.get(slotKey);
            if (!target || !target.active) continue;
            const w = this.config.weapons.defs[slotKey];
            if (!w) continue;
            const dx = target.x - ship.x;
            const dy = target.y - ship.y;
            const dist = Math.hypot(dx, dy);

            if ((w.type ?? 'single') === 'beam') {
                const readyObj = this.beamCooldowns.get(ship) ?? {}; this.beamCooldowns.set(ship, readyObj);
                const readyAt = readyObj[slotKey] ?? 0;
                const prepObj = this.beamPrepUntil.get(ship) ?? {}; this.beamPrepUntil.set(ship, prepObj);
                const prepUntil = prepObj[slotKey] ?? 0;
                if (dist > w.range) {
                    if (prepUntil) { delete prepObj[slotKey]; }
                    try { this.scene.events.emit('weapon-out-of-range', slotKey, true); } catch {}
                    this.stopBeamIfAny(ship, slotKey);
                    continue;
                }
                try { this.scene.events.emit('weapon-out-of-range', slotKey, false); } catch {}
                if (now < readyAt) { this.stopBeamIfAny(ship, slotKey); continue; }
                if (!prepUntil) {
                    const refreshMs = Math.max(0, w?.beam?.refreshMs ?? 500);
                    prepObj[slotKey] = now + refreshMs;
                    continue;
                }
                if (now >= prepUntil) {
                    delete prepObj[slotKey];
                    if (!isPaused) {
                        this.ensureBeam(ship, slotKey, w, target, dist);
                    }
                }
                continue;
            }

            const cooldownMs = 1000 / Math.max(0.001, (w.fireRatePerSec ?? 1));
            if (dist > w.range) {
                if (this.playerChargeUntil[slotKey]) { delete this.playerChargeUntil[slotKey]; }
                try { this.scene.events.emit('weapon-out-of-range', slotKey, true); } catch {}
                continue;
            }
            try { this.scene.events.emit('weapon-out-of-range', slotKey, false); } catch {}
            if (!this.playerChargeUntil[slotKey]) {
                this.playerChargeUntil[slotKey] = now + cooldownMs;
                continue;
            }
            if (now >= this.playerChargeUntil[slotKey]) {
                if (!isPaused) {
                    this.playerChargeUntil[slotKey] = now + cooldownMs;
                    const muzzleOffset = this.resolveMuzzleOffset(ship, i, { x: 0, y: 0 });
                    const w2 = { ...w, muzzleOffset, __slotIndex: i };
                    const isBurst = ((w2?.burst?.count ?? 1) > 1) || ((w2.type ?? 'single') === 'burst');
                    if (isBurst) this.fireBurstWeapon(slotKey, w2, target, ship);
                    else this.fireWeapon(slotKey, w2, target, ship);
                }
            }
        }
    }
  }

  private updateNpcWeapons(isPaused: boolean) {
    const targets = this.combatManager.getTargetEntries();
    for (const t of targets) {
        const ctx = this.combatManager.getNpcStateManager().getContext(t.obj);
        const st = ctx?.state;
        const legacyAttack = t.intent?.type === 'attack' && t.intent.target?.active;
        const legacyFlee = t.intent?.type === 'flee' && t.intent.target?.active;
        const combatProfile = t.combatAI ? this.config.combatAI?.profiles?.[t.combatAI] : undefined;
        const isNonCombat = !!combatProfile?.nonCombat;
        const canShoot = !isNonCombat && ((st === NPCState.COMBAT_ATTACKING) || (st === NPCState.COMBAT_FLEEING) || legacyAttack || legacyFlee);
        const targetObj = ctx?.targetStabilization?.currentTarget ?? t.intent?.target;

        if (!targetObj || !targetObj.active) {
            continue;
        }

        const savedSlots = this.weaponSlots;
        const npcSlots = (t as any).weaponSlots as string[] | undefined;
        if (npcSlots && npcSlots.length) this.weaponSlots = npcSlots;

        if (canShoot) {
            this.autoFire(t.obj, targetObj, isPaused);
        }
        this.weaponSlots = savedSlots;
    }
  }

  private autoFire(shooter: any, target: any, isPaused: boolean) {
    if (!target || !target.active || !shooter || !shooter.active) return;
    const dx = target.x - shooter.x;
    const dy = target.y - shooter.y;
    const dist = Math.hypot(dx, dy);
    const times = this.getShooterTimes(shooter);
    const slotsArr = this.weaponSlots;
    for (let i = 0; i < slotsArr.length; i++) {
      const slotKey = slotsArr[i];
      const w = this.config.weapons.defs[slotKey];
      if (!w) continue;
      if ((w.type ?? 'single') === 'beam') {
        const nowMs = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
        const shooterTimes = this.beamCooldowns.get(shooter) ?? {}; this.beamCooldowns.set(shooter, shooterTimes);
        const readyAt = shooterTimes[slotKey] ?? 0;
        if (nowMs >= readyAt && dist <= w.range) {
          if (!isPaused) {
            this.ensureBeam(shooter, slotKey, w, target, dist);
          }
        } else {
          this.stopBeamIfAny(shooter, slotKey);
        }
        continue;
      }
      if (dist > w.range) { this.stopBeamIfAny(shooter, slotKey); continue; }
      const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
      const cooldownMs = 1000 / Math.max(0.001, (w.fireRatePerSec ?? 1));
      const last = times[slotKey] ?? 0;
      if (now - last >= cooldownMs) {
        if (!isPaused) {
          times[slotKey] = now;
          const muzzleOffset = this.resolveMuzzleOffset(shooter, i, { x: 0, y: 0 });
          const w2 = { ...w, muzzleOffset };
          const isBurst = ((w2?.burst?.count ?? 1) > 1) || ((w2.type ?? 'single') === 'burst');
          if (isBurst) this.fireBurstWeapon(slotKey, w2, target, shooter);
          else this.fireWeapon(slotKey, w2, target, shooter);
        }
      }
    }
  }

  private fireWeapon(_slot: string, w: any, target: any, shooter: any) {
    const fallbackOffset = { x: 0, y: 0 };
    const mo = (w && w.muzzleOffset) ? w.muzzleOffset : this.resolveMuzzleOffset(shooter, (w && typeof w.__slotIndex === 'number') ? w.__slotIndex : 0, fallbackOffset);
    const muzzle = this.getMuzzleWorldPositionFor(shooter, mo);
    const aim = this.getAimedTargetPoint(shooter, target, w);
    const angle = Math.atan2(aim.y - muzzle.y, aim.x - muzzle.x);
    let proj: Phaser.GameObjects.GameObject & { x: number; y: number };
    if (w.projectile.shape === 'rect') {
      proj = this.scene.add.rectangle(muzzle.x, muzzle.y, w.projectile.width, w.projectile.height, Number((w.projectile.color as string).replace('#','0x'))).setDepth(0.8) as any;
      (proj as any).setRotation?.(angle);
    } else {
      const r = w.projectile.radius ?? 4;
      proj = this.scene.add.circle(muzzle.x, muzzle.y, r, Number((w.projectile.color as string).replace('#','0x'))).setDepth(0.8) as any;
    }
    (proj as any).__combat = { damage: w.damage, target };
    (proj as any).setDepth?.(((shooter as any).depth ?? 1) - 0.1);
    
    if (this.fogOfWar) {
      this.fogOfWar.registerDynamicObject(proj, DynamicObjectType.PROJECTILE);
    }

    const speed = Math.max(1, w.projectileSpeed || 1);
    const lifetimeMs = Math.max(1,
      (w?.type === 'homing' && w?.homing?.lifetimeMs)
        ? w.homing.lifetimeMs
        : ((w.range / Math.max(1, speed)) * 1000 + 50)
    );
    const shooterEntry = this.combatManager.findTargetEntry(shooter);
    const shooterFaction = shooterEntry?.faction ?? (shooter === this.combatManager.getPlayerShip() ? 'player' : undefined);
    const shooterOverrides = (shooterEntry as any)?.overrides?.factions;

    // Вспомогательная функция: минимальная дистанция от точки до отрезка
    const distPointToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
      const vx = x2 - x1, vy = y2 - y1;
      const wx = px - x1, wy = py - y1;
      const vv = vx*vx + vy*vy;
      const t = vv > 0 ? Phaser.Math.Clamp((wx*vx + wy*vy) / vv, 0, 1) : 0;
      const cx = x1 + t * vx;
      const cy = y1 + t * vy;
      return Math.hypot(px - cx, py - cy);
    };
    const tryCollisions = (prevX?: number, prevY?: number) => {
      if (!target || !target.active) {
        return 'target_lost' as const;
      }
      // Цель считается "допускающей урон", если она назначена хотя бы одним оружием игрока
      const tgtEntry = this.combatManager.findTargetEntry(target);
      const assignedByPlayer = this.combatManager.isTargetCombatAssignedPublic(target) || Array.from(this.playerWeaponTargets.values()).some(t => {
        const te = this.combatManager.findTargetEntry(t);
        return !!(te && tgtEntry && te.obj === tgtEntry.obj);
      });
      const entries = this.combatManager.getTargetEntries();
      for (const rec of entries) {
        const obj = rec.obj as any;
        if (!obj || !obj.active) continue;
        if (obj === shooter) continue;
        if (obj === target) continue;
        const st = obj.__state;
        const invulnerable = st === 'docking' || st === 'docked' || st === 'undocking' || (typeof obj.alpha === 'number' && obj.alpha <= 0.05) || obj.visible === false;
        if (invulnerable) continue;
        const hitR = this.combatManager.getEffectiveRadiusPublic(obj);
        const dAny = (typeof prevX === 'number' && typeof prevY === 'number')
          ? distPointToSegment(obj.x, obj.y, prevX, prevY, (proj as any).x, (proj as any).y)
          : Phaser.Math.Distance.Between((proj as any).x, (proj as any).y, obj.x, obj.y);
        if (dAny <= hitR) {
          const victimFaction = rec.faction;
          const relSV = this.combatManager.getRelationPublic(shooterFaction, victimFaction, shooterOverrides);
          const relVS = this.combatManager.getRelationPublic(victimFaction, shooterFaction, rec.overrides?.factions);
          const hostile = (relSV === 'confrontation') || (relVS === 'confrontation');
          const selectedByPlayerObj = this.combatManager.isTargetCombatSelectedPublic(obj);
          const assignedByPlayerObj = this.combatManager.isTargetCombatAssignedPublic(obj);
          const canApplyDueToSelectionObj = (shooter === this.combatManager.getPlayerShip()) && (selectedByPlayerObj || assignedByPlayerObj);
          if (hostile || canApplyDueToSelectionObj) {
            this.combatManager.applyDamagePublic(obj, w.damage, shooter);
            this.spawnHitEffect((proj as any).x, (proj as any).y, w);
            return 'hit' as const;
          }
        }
      }
      const hitDist = this.combatManager.getEffectiveRadiusPublic(target as any);
      const d = (typeof prevX === 'number' && typeof prevY === 'number')
        ? distPointToSegment(target.x, target.y, prevX, prevY, (proj as any).x, (proj as any).y)
        : Phaser.Math.Distance.Between((proj as any).x, (proj as any).y, target.x, target.y);
      if (d <= hitDist) {
        const st = (target as any).__state;
        const invulnerable = st === 'docking' || st === 'docked' || st === 'undocking' || (typeof (target as any).alpha === 'number' && (target as any).alpha <= 0.05) || (target as any).visible === false;
        if (!invulnerable) {
          const targetEntry = this.combatManager.findTargetEntry(target);
          const targetFaction = targetEntry?.faction ?? (target === this.combatManager.getPlayerShip() ? 'player' : undefined);
          const targetOverrides = (targetEntry as any)?.overrides?.factions;
          const relSV = this.combatManager.getRelationPublic(shooterFaction, targetFaction, shooterOverrides);
          const relVS = this.combatManager.getRelationPublic(targetFaction, shooterFaction, targetOverrides);
          const hostileEnemy = (relSV === 'confrontation') || (relVS === 'confrontation');
          const selectedByPlayer = this.combatManager.isTargetCombatSelectedPublic(target);
          const canApplyDueToSelection = (shooter === this.combatManager.getPlayerShip()) && (assignedByPlayer || selectedByPlayer);
          if (hostileEnemy || canApplyDueToSelection) {
            this.combatManager.applyDamagePublic(target, w.damage, shooter);
            this.spawnHitEffect((proj as any).x, (proj as any).y, w);
            return 'hit' as const;
          }
        } else {
          return 'expire' as const;
        }
      }
      return 'none' as const;
    };

    if ((w.type ?? 'single') === 'homing') {
      const adjustIntervalMs = Math.max(50, this.config.weaponTypes?.homing?.adjustIntervalMs ?? 300);
      let desiredAngleCached = angle;
      let lastDesiredUpdate = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
      const recomputeDesired = () => {
        try {
          const ap = this.getAimedTargetPoint(shooter, target, w) || { x: (target?.x ?? aim.x), y: (target?.y ?? aim.y) };
          let wAcc = typeof w?.accuracy === 'number' ? Phaser.Math.Clamp(w.accuracy, 0, 1) : 1;
          let sAcc = 1;
          const entry = this.combatManager.findTargetEntry(shooter);
          if (shooter === this.combatManager.getPlayerShip()) {
            const playerShipId = this.config.player?.shipId ?? this.config.ships.current;
            const shipDef = this.config.ships.defs[playerShipId];
            const sa = shipDef?.combat?.accuracy;
            if (typeof sa === 'number') sAcc = Phaser.Math.Clamp(sa, 0, 1);
          } else if (entry) {
            const eShipId = entry.shipId ?? this.config.ships.current;
            const shipDef = this.config.ships.defs[eShipId];
            const sa = shipDef?.combat?.accuracy;
            if (typeof sa === 'number') sAcc = Phaser.Math.Clamp(sa, 0, 1);
          }
          const baseAcc = Phaser.Math.Clamp(wAcc * sAcc, 0, 1);
          const exp = (typeof w?.homing?.accuracyExponent === 'number' && w.homing.accuracyExponent > 0) ? w.homing.accuracyExponent : (this.config.weaponTypes?.homing?.accuracyExponent ?? 0.6);
          const effAcc = Math.pow(baseAcc, exp);
          const influence = Math.max(0, Math.min(1, w?.homing?.accuracyInfluenceMultiplier ?? this.config.weaponTypes?.homing?.accuracyInfluenceMultiplier ?? 0.35));
          const cx = (target?.x ?? ap.x);
          const cy = (target?.y ?? ap.y);
          let aimX = cx + (ap.x - cx) * influence;
          let aimY = cy + (ap.y - cy) * influence;
          const maxErrDeg = Math.max(0, w?.homing?.maxAngleErrorDeg ?? this.config.weaponTypes?.homing?.maxAngleErrorDeg ?? 8);
          const desiredCoreAngle = Math.atan2((target?.y ?? cy) - (proj as any).y, (target?.x ?? cx) - (proj as any).x);
          const noisyAngle = Math.atan2(aimY - (proj as any).y, aimX - (proj as any).x);
          let angleDelta = Phaser.Math.Angle.Wrap(noisyAngle - desiredCoreAngle);
          const maxDelta = (maxErrDeg * (1 - effAcc)) * Math.PI / 180;
          angleDelta = Phaser.Math.Clamp(angleDelta, -maxDelta, maxDelta);
          const clampedAngle = Phaser.Math.Angle.Wrap(desiredCoreAngle + angleDelta);
          desiredAngleCached = clampedAngle;
        } catch {
          const tx = (target?.x ?? aim.x);
          const ty = (target?.y ?? aim.y);
          desiredAngleCached = Math.atan2(ty - (proj as any).y, tx - (proj as any).x);
        }
      };
      recomputeDesired();
      const reverseLaunch = !!(w.__burstShot === true);
      const backfireDeg = (w?.homing?.backfireDeg ?? this.config.weaponTypes?.homing?.backfireDeg ?? 0);
      const backfireRand = (w?.homing?.backfireRandomDeg ?? this.config.weaponTypes?.homing?.backfireRandomDeg ?? 0);
      const backfireJitter = reverseLaunch ? ((backfireDeg + (Math.random()*2 - 1) * backfireRand) * Math.PI/180) : 0;
      const biasDeg = (w?.homing?.biasDeg ?? this.config.weaponTypes?.homing?.biasDeg ?? 0);
      const biasRad = (biasDeg !== 0) ? ((Math.random()*2 - 1) * Math.abs(biasDeg) * Math.PI/180) : 0;
      let currentAngle = (reverseLaunch ? angle + Math.PI + backfireJitter : angle) + biasRad;
      (proj as any).setRotation?.(currentAngle);
      const turnDegPerSec = (typeof w?.homing?.turnSpeedDegPerSec === 'number' && w.homing.turnSpeedDegPerSec > 0) ? w.homing.turnSpeedDegPerSec : (this.config.weaponTypes?.homing?.turnSpeedDegPerSec ?? 0);
      const maxTurnRadPerMs = (turnDegPerSec > 0)
        ? (turnDegPerSec * Math.PI / 180) / 1000
        : Infinity;
      const jitterAmp = Math.max(0, (w?.homing?.jitterDeg ?? this.config.weaponTypes?.homing?.jitterDeg ?? 0)) * Math.PI/180;
      const jitterHz = Math.max(0, (w?.homing?.jitterHz ?? this.config.weaponTypes?.homing?.jitterHz ?? 0));
      let jitterPhase = Math.random() * Math.PI * 2;

      const onUpdateHoming = (_t: number, dt: number) => {
        if (this.pauseManager?.isSystemPausable('combat') && this.pauseManager?.getPaused()) {
          return;
        }

        if (this.fogOfWar) {
          try {
            const visible = this.fogOfWar.isObjectVisible(proj as any);
            (proj as any).setVisible?.(visible);
          } catch {}
        }

        const nowMs = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
        if (nowMs - lastDesiredUpdate >= adjustIntervalMs) {
          recomputeDesired();
          lastDesiredUpdate = nowMs;
        }
        let desired = desiredAngleCached;
        if (jitterAmp > 0 && jitterHz > 0) {
          jitterPhase += (Math.PI * 2) * jitterHz * (dt/1000);
          desired += Math.sin(jitterPhase) * jitterAmp;
        }
        let delta = Phaser.Math.Angle.Wrap(desired - currentAngle);
        const maxStep = maxTurnRadPerMs === Infinity ? Math.abs(delta) : (maxTurnRadPerMs * dt);
        delta = Phaser.Math.Clamp(delta, -maxStep, maxStep);
        currentAngle = Phaser.Math.Angle.Wrap(currentAngle + delta);
        (proj as any).setRotation?.(currentAngle);

        const vxH = Math.cos(currentAngle) * speed;
        const vyH = Math.sin(currentAngle) * speed;
        const prevX = (proj as any).x;
        const prevY = (proj as any).y;
        (proj as any).x = prevX + vxH * (dt/1000);
        (proj as any).y = prevY + vyH * (dt/1000);

        const col = tryCollisions(prevX, prevY);
        if (col === 'hit' || col === 'target_lost' || col === 'expire') {
          this.scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdateHoming);
          if (this.fogOfWar) {
            this.fogOfWar.unregisterObject(proj);
          }
          if (col !== 'hit' && w.hitEffect) {
            this.spawnHitEffect((proj as any).x, (proj as any).y, w);
          }
          (proj as any).destroy?.();
        }
      };
      this.scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdateHoming);
      const projId = `projectile_${(proj as any)._uid ?? Phaser.Utils.String.UUID()}`;
      const lifetimeTimer = this.scene.time.delayedCall(lifetimeMs, () => {
        this.scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdateHoming);
        if (this.fogOfWar) {
          this.fogOfWar.unregisterObject(proj);
        }
        if (w.hitEffect) {
          this.spawnHitEffect((proj as any).x, (proj as any).y, w);
        }
        (proj as any).destroy?.();
        try { this.pauseManager?.unregisterTimer?.(projId); } catch {}
      });
      try { this.pauseManager?.registerTimer?.(projId, lifetimeTimer); } catch {}

      if (shooter === this.combatManager.getPlayerShip()) {
        try { this.scene.events.emit('player-weapon-fired', _slot, target); } catch {}
      }
      return;
    }

    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;

    const onUpdate = (_t: number, dt: number) => {
      if (this.pauseManager?.isSystemPausable('combat') && this.pauseManager?.getPaused()) {
        return;
      }
      
      if (this.fogOfWar) {
        try {
          const visible = this.fogOfWar.isObjectVisible(proj as any);
          (proj as any).setVisible?.(visible);
        } catch {}
      }
      const prevX = (proj as any).x;
      const prevY = (proj as any).y;
      (proj as any).x = prevX + vx * (dt/1000);
      (proj as any).y = prevY + vy * (dt/1000);
      const col = tryCollisions(prevX, prevY);
      if (col === 'hit' || col === 'target_lost' || col === 'expire') {
        this.scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
        if (this.fogOfWar) { this.fogOfWar.unregisterObject(proj); }
        (proj as any).destroy?.();
      }
    };
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
    const projId = `projectile_${(proj as any)._uid ?? Phaser.Utils.String.UUID()}`;
    const lifetimeTimer = this.scene.time.delayedCall(lifetimeMs, () => {
      this.scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
      if (this.fogOfWar) {
        this.fogOfWar.unregisterObject(proj);
      }
      (proj as any).destroy?.();
      try { this.pauseManager?.unregisterTimer?.(projId); } catch {}
    });
    try { this.pauseManager?.registerTimer?.(projId, lifetimeTimer); } catch {}

    if (shooter === this.combatManager.getPlayerShip()) {
      try { this.scene.events.emit('player-weapon-fired', _slot, target); } catch {}
    }
  }

  private fireBurstWeapon(slot: string, w: any, target: any, shooter: any) {
    const count = Math.max(1, w?.burst?.count ?? 3);
    const delayMs = Math.max(1, w?.burst?.delayMs ?? 80);
    for (let k = 0; k < count; k++) {
      const burstId = `burst_${slot}_${k}_${Date.now()}`;
      const burstTimer = this.scene.time.delayedCall(k * delayMs, () => {
        if (this.pauseManager?.isSystemPausable('combat') && this.pauseManager?.getPaused()) {
          return;
        }
        
        if (!shooter?.active || !target?.active) return;
        const muzzleOffset = this.resolveMuzzleOffset(shooter, 0, { x: 0, y: 0 });
        const w2 = { ...w, muzzleOffset, __slotIndex: 0, __burstShot: (w.type === 'homing') ? true : undefined };
        this.fireWeapon(slot, w2, target, shooter);
        try { this.pauseManager?.unregisterTimer?.(burstId); } catch {}
      });
      try { this.pauseManager?.registerTimer?.(burstId, burstTimer); } catch {}
    }
  }

  private getMuzzleWorldPositionFor(shooter: any, offset: { x: number; y: number }) {
    const nose = (shooter as any).__noseOffsetRad || 0;
    const rot = shooter.rotation - nose;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const lx = offset.x;
    const ly = offset.y;
    const wx = shooter.x + lx * cos - ly * sin;
    const wy = shooter.y + lx * sin + ly * cos;
    return { x: wx, y: wy };
  }

  private resolveMuzzleOffset(shooter: any, slotIndex: number, defaultOffset: { x: number; y: number }) {
    if (shooter === this.combatManager.getPlayerShip()) {
      const shipId = this.config.player?.shipId ?? this.config.ships.current;
      const def = this.config.ships.defs[shipId];
      const off = def?.combat?.slots?.[slotIndex]?.offset;
      if (off) return off;
    }
    const entry = this.combatManager.findTargetEntry(shooter);
    const eShipId = entry?.shipId;
    if (eShipId) {
      const offE = this.config.ships.defs[eShipId]?.combat?.slots?.[slotIndex]?.offset;
      if (offE) return offE;
    }
    const offP = this.config.ships.defs[this.config.player?.shipId ?? this.config.ships.current]?.combat?.slots?.[slotIndex]?.offset;
    return offP ?? defaultOffset;
  }

  private getShooterTimes(shooter: any): Record<string, number> {
    let times = this.lastFireTimesByShooter.get(shooter);
    if (!times) { times = {}; this.lastFireTimesByShooter.set(shooter, times); }
    return times;
  }

  private calculateInterceptTime(rx: number, ry: number, vx: number, vy: number, projectileSpeed: number): number {
    const maxIterations = 10;
    const tolerance = 0.1;
    
    let t = Math.sqrt(rx * rx + ry * ry) / projectileSpeed;
    
    for (let i = 0; i < maxIterations; i++) {
      const futureX = rx + vx * t;
      const futureY = ry + vy * t;
      
      const distanceToFuture = Math.sqrt(futureX * futureX + futureY * futureY);
      
      const newT = distanceToFuture / projectileSpeed;
      
      if (Math.abs(newT - t) < tolerance / 1000) {
        return newT;
      }
      
      t = newT;
    }
    
    return t;
  }

  private getAimedTargetPoint(shooter: any, target: any, w: any) {
    let weaponAccuracy = typeof w?.accuracy === 'number' ? Phaser.Math.Clamp(w.accuracy, 0, 1) : 1;
    let shipAccuracy = 1.0;
    const entry = this.combatManager.findTargetEntry(shooter);
    if (shooter === this.combatManager.getPlayerShip()) {
      const playerShipId = this.config.player?.shipId ?? this.config.ships.current;
      const shipDef = this.config.ships.defs[playerShipId];
      const sa = shipDef?.combat?.accuracy;
      if (typeof sa === 'number') shipAccuracy = Phaser.Math.Clamp(sa, 0, 1);
    } else if (entry) {
      const eShipId = entry.shipId ?? this.config.ships.current;
      const shipDef = this.config.ships.defs[eShipId];
      const sa = shipDef?.combat?.accuracy;
      if (typeof sa === 'number') shipAccuracy = Phaser.Math.Clamp(sa, 0, 1);
    }
    const accuracy = Phaser.Math.Clamp(weaponAccuracy * shipAccuracy, 0, 1);
    
    let vx = 0, vy = 0;
    
    const moveRef = (target as any).__moveRef;
    if (moveRef && typeof moveRef.speed === 'number' && typeof moveRef.headingRad === 'number') {
      const speedPerSecond = moveRef.speed;
      const heading = moveRef.headingRad;
      vx = Math.cos(heading) * speedPerSecond;
      vy = Math.sin(heading) * speedPerSecond;
    }
    
    const projectileSpeed = Math.max(1, w.projectileSpeed || 1);
    const sx = shooter.x;
    const sy = shooter.y;
    const tx = target.x;
    const ty = target.y;
    const rx = tx - sx;
    const ry = ty - sy;
    const targetSpeed = Math.sqrt(vx * vx + vy * vy);
    const distance = Math.sqrt(rx * rx + ry * ry);
    
    let tHit: number;
    
    if (targetSpeed < 1) {
      tHit = distance / projectileSpeed;
    } else {
      tHit = this.calculateInterceptTime(rx, ry, vx, vy, projectileSpeed);
      
      if (tHit <= 0 || isNaN(tHit)) {
        tHit = distance / projectileSpeed;
      }
    }
    const perfectLeadX = tx + vx * tHit;
    const perfectLeadY = ty + vy * tHit;
    
    const targetStationary = targetSpeed < 0.5;
    const accuracyError = targetStationary ? 0 : (1 - accuracy);
    const baseAngle = Math.atan2(perfectLeadY - sy, perfectLeadX - sx);
    const dLead = Math.hypot(perfectLeadX - sx, perfectLeadY - sy);
    const maxErrDeg = (this.config.weaponTypes?.single as any)?.maxAngleErrorDeg ?? 8;
    const maxErrRad = (maxErrDeg * accuracyError) * Math.PI / 180;
    const delta = (Math.random() * 2 - 1) * maxErrRad;
    const errAngle = baseAngle + delta;
    const aimX = sx + Math.cos(errAngle) * dLead;
    const aimY = sy + Math.sin(errAngle) * dLead;
    
    return { x: aimX, y: aimY };
  }

  private ensureBeam(shooter: any, slotKey: string, w: any, target: any, distNow: number) {
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
    const dmgTick = w?.beam?.damagePerTick ?? 1;
    
    const timer = this.scene.time.addEvent({ delay: tickMs, loop: true, callback: () => {
      if (this.pauseManager?.isSystemPausable('combat') && this.pauseManager?.getPaused()) {
        return;
      }
      
      if (!shooter?.active || !target?.active) { 
        this.stopBeamIfAny(shooter, slotKey); 
        return; 
      }
      const dx = target.x - shooter.x; const dy = target.y - shooter.y; const d = Math.hypot(dx, dy);
      if (d > w.range) { 
        this.stopBeamIfAny(shooter, slotKey); 
        return; 
      }
      
      this.combatManager.applyDamagePublic(target, dmgTick, shooter);
      
      if (w.hitEffect) {
        const targetRadius = this.combatManager.getEffectiveRadiusPublic(target);
        const beamVector = new Phaser.Math.Vector2(dx, dy).normalize();
        const hitPoint = {
          x: target.x - beamVector.x * targetRadius,
          y: target.y - beamVector.y * targetRadius
        };
        let canShow = true;
        if (this.fogOfWar) {
          try {
            const sVis = this.fogOfWar.isObjectVisible(shooter as any);
            const tVis = this.fogOfWar.isObjectVisible(target as any);
            canShow = sVis || tVis;
          } catch {}
        }
        if (canShow) this.spawnHitEffect(hitPoint.x, hitPoint.y, w);
      }
    }});
    
    const redraw = () => {
      if (this.pauseManager?.isSystemPausable('combat') && this.pauseManager?.getPaused()) {
        return;
      }
      
      if (!shooter?.active || !target?.active) { this.stopBeamIfAny(shooter, slotKey); return; }
      const dx = target.x - shooter.x; const dy = target.y - shooter.y; const d = Math.hypot(dx, dy);
      if (d > w.range) { this.stopBeamIfAny(shooter, slotKey); return; }
      const muzzle = this.getMuzzleWorldPositionFor(shooter, this.resolveMuzzleOffset(shooter, 0, { x: 0, y: 0 }));
      
      const targetRadius = this.combatManager.getEffectiveRadiusPublic(target);
      const beamVector = new Phaser.Math.Vector2(dx, dy).normalize();
      const hitPoint = {
        x: target.x - beamVector.x * targetRadius,
        y: target.y - beamVector.y * targetRadius
      };
      
      if (this.fogOfWar) {
        try {
          const shooterVisible = this.fogOfWar.isObjectVisible(shooter as any);
          const targetVisible = this.fogOfWar.isObjectVisible(target as any);
          const shouldShow = shooterVisible || targetVisible;
          gfx.setVisible(shouldShow);
          if (!shouldShow) { return; }
        } catch {}
      }

      gfx.clear();
      const colorHex = (w?.beam?.color || w?.hitEffect?.color || w?.projectile?.color || '#60a5fa').replace('#','0x');
      const outerW = Math.max(1, Math.floor(w?.beam?.outerWidth ?? 6));
      const innerW = Math.max(1, Math.floor(w?.beam?.innerWidth ?? 3));
      const outerA = Phaser.Math.Clamp(w?.beam?.outerAlpha ?? 0.25, 0, 1);
      const innerA = Phaser.Math.Clamp(w?.beam?.innerAlpha ?? 0.9, 0, 1);
      gfx.lineStyle(outerW, Number(colorHex), outerA);
      gfx.beginPath(); gfx.moveTo(muzzle.x, muzzle.y); gfx.lineTo(hitPoint.x, hitPoint.y); gfx.strokePath();
      gfx.lineStyle(innerW, Number(colorHex), innerA);
      gfx.beginPath(); gfx.moveTo(muzzle.x, muzzle.y); gfx.lineTo(hitPoint.x, hitPoint.y); gfx.strokePath();
      gfx.setAlpha(1);
      
      (gfx as any).__hitPoint = hitPoint;
    };
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, redraw);
    (gfx as any).__beamRedraw = redraw;
    map.set(slotKey, { gfx, timer, target });
    if (shooter === this.combatManager.getPlayerShip()) {
      try { this.scene.events.emit('beam-start', slotKey, durationMs); } catch {}
    }
    const durationId = `beam_duration_${slotKey}_${Date.now()}`;
    const durationTimer = this.scene.time.delayedCall(durationMs, () => {
      const shooterTimes = this.beamCooldowns.get(shooter) ?? {}; this.beamCooldowns.set(shooter, shooterTimes);
      const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
      shooterTimes[slotKey] = now + refreshMs;
      if (shooter === this.combatManager.getPlayerShip()) {
        try { this.scene.events.emit('beam-refresh', slotKey, refreshMs); } catch {}
      }
      this.stopBeamIfAny(shooter, slotKey);
      try { this.pauseManager?.unregisterTimer?.(durationId); } catch {}
    });
    try { this.pauseManager?.registerTimer?.(durationId, durationTimer); } catch {}
    
    if (shooter === this.combatManager.getPlayerShip()) { try { this.scene.events.emit('player-weapon-fired', slotKey, target); } catch {} }
  }

  private stopBeamIfAny(shooter: any, slotKey: string) {
    const map = this.activeBeams.get(shooter);
    if (!map) return;
    const s = map.get(slotKey);
    if (!s) return;
    
    try { s.timer.remove(false); } catch {}
    try { const cb = (s.gfx as any).__beamRedraw; if (cb) this.scene.events.off(Phaser.Scenes.Events.UPDATE, cb); } catch {}
    try { s.gfx.clear(); s.gfx.destroy(); } catch {}
    
    map.delete(slotKey);
  }

  private spawnHitEffect(x: number, y: number, w: any) {
    const colorNum = Number((w.hitEffect.color as string).replace('#', '0x'));
    const r = w.hitEffect.radius ?? 16;
    const g = this.scene.add.circle(x, y, r, colorNum, 0.6).setDepth(0.9);
    this.scene.tweens.add({ targets: g, alpha: 0, scale: 1.4, duration: w.hitEffect.durationMs ?? 200, onComplete: () => g.destroy() });
  }

  private updatePlayerWeaponRangeCircles() {
    const ship = this.combatManager.getPlayerShip();
    if (ship && this.playerWeaponRangeCircles.size > 0) {
        for (const [slotKey, circle] of this.playerWeaponRangeCircles.entries()) {
            if (!circle || !circle.active) continue;
            circle.setPosition(ship.x, ship.y);
            const w = this.config.weapons?.defs?.[slotKey];
            if (w && typeof w.range === 'number') {
                circle.setRadius(w.range);
            }
        }
    }
  }

  private togglePlayerWeaponRangeCircle(slotKey: string, show: boolean) {
    const def = this.config.weapons?.defs?.[slotKey];
    if (!def || typeof def.range !== 'number') {
      const old = this.playerWeaponRangeCircles.get(slotKey);
      if (old) { try { old.setVisible(false); } catch {} }
      return;
    }
    let circle = this.playerWeaponRangeCircles.get(slotKey);
    if (show) {
      if (!circle) {
        const wr = this.config.settings?.ui?.combat?.weaponRanges ?? {} as any;
        const fillColorNum = Number((wr.color ?? '#4ade80').replace('#','0x'));
        const fillAlpha = typeof wr.fillAlpha === 'number' ? Phaser.Math.Clamp(wr.fillAlpha, 0, 1) : 0.08;
        const strokeColorNum = Number((wr.strokeColor ?? wr.color ?? '#4ade80').replace('#','0x'));
        const strokeAlpha = typeof wr.strokeAlpha === 'number' ? Phaser.Math.Clamp(wr.strokeAlpha, 0, 1) : 0.8;
        const strokeWidth = typeof wr.strokeWidth === 'number' ? Math.max(0, Math.floor(wr.strokeWidth)) : 1;
        const ship = this.combatManager.getPlayerShip();
        circle = this.scene.add.circle(ship?.x ?? 0, ship?.y ?? 0, def.range, fillColorNum, fillAlpha).setDepth(0.35);
        circle.setStrokeStyle(strokeWidth, strokeColorNum, strokeAlpha);
        this.playerWeaponRangeCircles.set(slotKey, circle);
      }
      const wr2 = this.config.settings?.ui?.combat?.weaponRanges ?? {} as any;
      const fillColorNum2 = Number((wr2.color ?? '#4ade80').replace('#','0x'));
      const fillAlpha2 = typeof wr2.fillAlpha === 'number' ? Phaser.Math.Clamp(wr2.fillAlpha, 0, 1) : 0.08;
      const strokeColorNum2 = Number((wr2.strokeColor ?? wr2.color ?? '#4ade80').replace('#','0x'));
      const strokeAlpha2 = typeof wr2.strokeAlpha === 'number' ? Phaser.Math.Clamp(wr2.strokeAlpha, 0, 1) : 0.8;
      const strokeWidth2 = typeof wr2.strokeWidth === 'number' ? Math.max(0, Math.floor(wr2.strokeWidth)) : 1;
      circle.setFillStyle(fillColorNum2, fillAlpha2);
      circle.setStrokeStyle(strokeWidth2, strokeColorNum2, strokeAlpha2);
      circle.setRadius(def.range);
      const ship = this.combatManager.getPlayerShip();
      circle.setPosition(ship?.x ?? 0, ship?.y ?? 0);
      circle.setVisible(true);
    } else {
      if (circle) {
        circle.setVisible(false);
      }
    }
  }

  public destroy() {
    for (const c of this.playerWeaponRangeCircles.values()) { try { c.destroy(); } catch {} }
    this.playerWeaponRangeCircles.clear();
  }
}
