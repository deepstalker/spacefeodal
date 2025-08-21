import type { ConfigManager } from '../../../ConfigManager';
import type { CombatManager } from '../../../CombatManager';
import type { EnhancedFogOfWar } from '../../../fog-of-war/EnhancedFogOfWar';
import { distPointToSegment } from '../utils/geometry';

export type ProjectileCallbacks = {
  getFoW: () => EnhancedFogOfWar | undefined;
  registerTimer?: (id: string, timer: Phaser.Time.TimerEvent) => void;
  unregisterTimer?: (id: string) => void;
  spawnHitEffect: (x: number, y: number, w: any) => void;
  isInvulnerable: (obj: any) => boolean;
};

export class ProjectileService {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private combat: CombatManager;
  private cb: ProjectileCallbacks;

  constructor(scene: Phaser.Scene, config: ConfigManager, combat: CombatManager, callbacks: ProjectileCallbacks) {
    this.scene = scene;
    this.config = config;
    this.combat = combat;
    this.cb = callbacks;
  }

  // Регистрация/снятие объекта в тумане войны
  public registerProjectileFoW(obj: any) {
    const fow = this.cb.getFoW?.();
    if (!obj) return;
    if (fow) {
      try { fow.registerDynamicObject(obj, (this.combat as any).DynamicObjectType?.PROJECTILE ?? 2); } catch {}
    }
  }

  public unregisterProjectileFoW(obj: any) {
    const fow = this.cb.getFoW?.();
    if (!obj) return;
    if (fow) {
      try { fow.unregisterObject(obj); } catch {}
    }
  }

  // Создание визуала снаряда (circle/rect), установка глубины и FoW-учёта
  public spawnProjectile(w: any, shooter: any, muzzle: { x: number; y: number }, angle: number, target: any) {
    let proj: any;
    if (w.projectile.shape === 'rect') {
      proj = this.scene.add.rectangle(muzzle.x, muzzle.y, w.projectile.width, w.projectile.height, Number((w.projectile.color as string).replace('#','0x'))).setDepth(0.8) as any;
      (proj as any).setRotation?.(angle);
    } else {
      const r = w.projectile.radius ?? 4;
      proj = this.scene.add.circle(muzzle.x, muzzle.y, r, Number((w.projectile.color as string).replace('#','0x'))).setDepth(0.8) as any;
    }
    (proj as any).__combat = { damage: w.damage, target };
    (proj as any).setDepth?.(((shooter as any).depth ?? 1) - 0.1);
    this.registerProjectileFoW(proj);
    return proj;
  }

  // Таймер жизни снаряда с поддержкой PauseManager
  public setupProjectileLifetime(proj: any, lifetimeMs: number, onExpire: () => void) {
    const projId = `projectile_${(proj as any)._uid ?? Phaser.Utils.String.UUID()}`;
    const lifetimeTimer = this.scene.time.delayedCall(lifetimeMs, () => {
      try { onExpire(); } finally {
        try { this.cb.unregisterTimer?.(projId); } catch {}
      }
    });
    try { this.cb.registerTimer?.(projId, lifetimeTimer); } catch {}
    return projId;
  }

  // Проверка коллизий снаряда за прошедший тик. Возвращает 'hit' | 'target_lost' | 'expire' | 'none'
  public checkProjectileCollisions(
    prevX: number | undefined,
    prevY: number | undefined,
    proj: any,
    shooter: any,
    target: any,
    w: any,
    shooterFaction: any,
    shooterOverrides: any
  ): 'hit' | 'target_lost' | 'expire' | 'none' {
    if (!target || !target.active) {
      return 'target_lost';
    }
    const tgtEntry = this.combat.findTargetEntry(target);
    const assignedByPlayer = this.combat.isTargetCombatAssignedPublic(target) || this.combat.isTargetCombatSelectedPublic(target);
    const entries = this.combat.getTargetEntries();
    for (const rec of entries) {
      const obj = rec.obj as any;
      if (!obj || !obj.active) continue;
      if (obj === shooter) continue;
      if (obj === target) continue;
      const invulnerable = this.cb.isInvulnerable(obj);
      if (invulnerable) continue;
      const hitR = this.combat.getEffectiveRadiusPublic(obj);
      const dAny = (typeof prevX === 'number' && typeof prevY === 'number')
        ? distPointToSegment(obj.x, obj.y, prevX, prevY, (proj as any).x, (proj as any).y)
        : Phaser.Math.Distance.Between((proj as any).x, (proj as any).y, obj.x, obj.y);
      if (dAny <= hitR) {
        const victimFaction = rec.faction;
        const relSV = this.combat.getRelationPublic(shooterFaction, victimFaction, shooterOverrides);
        const relVS = this.combat.getRelationPublic(victimFaction, shooterFaction, rec.overrides?.factions);
        const hostile = (relSV === 'confrontation') || (relVS === 'confrontation');
        const selectedByPlayerObj = this.combat.isTargetCombatSelectedPublic(obj);
        const assignedByPlayerObj = this.combat.isTargetCombatAssignedPublic(obj);
        const canApplyDueToSelectionObj = (shooter === this.combat.getPlayerShip()) && (selectedByPlayerObj || assignedByPlayerObj);
        if (hostile || canApplyDueToSelectionObj) {
          this.combat.applyDamagePublic(obj, w.damage, shooter);
          this.cb.spawnHitEffect((proj as any).x, (proj as any).y, w);
          return 'hit';
        }
      }
    }
    const hitDist = this.combat.getEffectiveRadiusPublic(target as any);
    const d = (typeof prevX === 'number' && typeof prevY === 'number')
      ? distPointToSegment(target.x, target.y, prevX, prevY, (proj as any).x, (proj as any).y)
      : Phaser.Math.Distance.Between((proj as any).x, (proj as any).y, target.x, target.y);
    if (d <= hitDist) {
      const invulnerable = this.cb.isInvulnerable(target as any);
      if (!invulnerable) {
        const targetEntry = this.combat.findTargetEntry(target);
        const targetFaction = targetEntry?.faction ?? (target === this.combat.getPlayerShip() ? 'player' : undefined);
        const targetOverrides = (targetEntry as any)?.overrides?.factions;
        const relSV = this.combat.getRelationPublic(shooterFaction, targetFaction, shooterOverrides);
        const relVS = this.combat.getRelationPublic(targetFaction, shooterFaction, targetOverrides);
        const hostileEnemy = (relSV === 'confrontation') || (relVS === 'confrontation');
        const selectedByPlayer = this.combat.isTargetCombatSelectedPublic(target);
        const canApplyDueToSelection = (shooter === this.combat.getPlayerShip()) && selectedByPlayer;
        if (hostileEnemy || canApplyDueToSelection) {
          this.combat.applyDamagePublic(target, w.damage, shooter);
          this.cb.spawnHitEffect((proj as any).x, (proj as any).y, w);
          return 'hit';
        }
      } else {
        return 'expire';
      }
    }
    return 'none';
  }

  /**
   * Запуск полёта снаряда: линейный или хомящийся. Обновление и коллизии внутри.
   */
  public startFlight(
    w: any,
    proj: any,
    shooter: any,
    target: any,
    angle: number,
    speed: number,
    lifetimeMs: number,
    shooterFaction: any,
    shooterOverrides: any,
    opts: {
      getNowMs: () => number;
      isPaused: () => boolean;
      setVisibleByFoW: (obj: any) => void;
    }
  ) {
    const tryCollisions = (prevX?: number, prevY?: number) => {
      return this.checkProjectileCollisions(prevX, prevY, proj, shooter, target, w, shooterFaction, shooterOverrides);
    };

    const isHomingWeapon = !!w?.homing || (w?.type === 'homing');
    if (isHomingWeapon) {
      const adjustIntervalMs = Math.max(50, (this.config.weaponTypes as any)?.homing?.adjustIntervalMs ?? 300);
      let desiredAngleCached = angle;
      let lastDesiredUpdate = opts.getNowMs();

      const recomputeDesired = () => {
        try {
          // Приблизительный desiredAngle на цель
          const tx = (target?.x ?? (proj as any).x + Math.cos(angle));
          const ty = (target?.y ?? (proj as any).y + Math.sin(angle));
          const desiredCoreAngle = Math.atan2(ty - (proj as any).y, tx - (proj as any).x);

          let angleDelta = 0;
          const maxErrDeg = Math.max(0, w?.homing?.maxAngleErrorDeg ?? (this.config.weaponTypes as any)?.homing?.maxAngleErrorDeg ?? 8);
          const maxDelta = (maxErrDeg) * Math.PI / 180;
          angleDelta = Phaser.Math.Clamp(angleDelta, -maxDelta, maxDelta);
          const clampedAngle = Phaser.Math.Angle.Wrap(desiredCoreAngle + angleDelta);
          desiredAngleCached = clampedAngle;
        } catch {
          desiredAngleCached = angle;
        }
      };
      recomputeDesired();

      const reverseLaunch = !!(w.__burstShot === true);
      const backfireDeg = (w?.homing?.backfireDeg ?? (this.config.weaponTypes as any)?.homing?.backfireDeg ?? 0);
      const backfireRand = (w?.homing?.backfireRandomDeg ?? (this.config.weaponTypes as any)?.homing?.backfireRandomDeg ?? 0);
      const backfireJitter = reverseLaunch ? ((backfireDeg + (Math.random()*2 - 1) * backfireRand) * Math.PI/180) : 0;
      const biasDeg = (w?.homing?.biasDeg ?? (this.config.weaponTypes as any)?.homing?.biasDeg ?? 0);
      const biasRad = (biasDeg !== 0) ? ((Math.random()*2 - 1) * Math.abs(biasDeg) * Math.PI/180) : 0;
      let currentAngle = (reverseLaunch ? angle + Math.PI + backfireJitter : angle) + biasRad;
      (proj as any).setRotation?.(currentAngle);

      const turnDegPerSec = (typeof w?.homing?.turnSpeedDegPerSec === 'number' && w.homing.turnSpeedDegPerSec > 0)
        ? w.homing.turnSpeedDegPerSec
        : ((this.config.weaponTypes as any)?.homing?.turnSpeedDegPerSec ?? 0);
      const maxTurnRadPerMs = (turnDegPerSec > 0) ? (turnDegPerSec * Math.PI / 180) / 1000 : Infinity;
      const jitterAmp = Math.max(0, (w?.homing?.jitterDeg ?? (this.config.weaponTypes as any)?.homing?.jitterDeg ?? 0)) * Math.PI/180;
      const jitterHz = Math.max(0, (w?.homing?.jitterHz ?? (this.config.weaponTypes as any)?.homing?.jitterHz ?? 0));
      let jitterPhase = Math.random() * Math.PI * 2;

      const onUpdateHoming = (_t: number, dt: number) => {
        if (opts.isPaused()) return;
        opts.setVisibleByFoW(proj as any);

        const nowMs = opts.getNowMs();
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
          this.unregisterProjectileFoW(proj);
          if (col !== 'hit' && w.hitEffect) {
            this.cb.spawnHitEffect((proj as any).x, (proj as any).y, w);
          }
          (proj as any).destroy?.();
        }
      };
      this.scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdateHoming);
      this.setupProjectileLifetime(proj, lifetimeMs, () => {
        this.scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdateHoming);
        this.unregisterProjectileFoW(proj);
        if (w.hitEffect) {
          this.cb.spawnHitEffect((proj as any).x, (proj as any).y, w);
        }
        (proj as any).destroy?.();
      });
      return;
    }

    // Линейный полёт
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const onUpdate = (_t: number, dt: number) => {
      if (opts.isPaused()) return;
      opts.setVisibleByFoW(proj as any);
      const prevX = (proj as any).x;
      const prevY = (proj as any).y;
      (proj as any).x = prevX + vx * (dt/1000);
      (proj as any).y = prevY + vy * (dt/1000);
      const col = tryCollisions(prevX, prevY);
      if (col === 'hit' || col === 'target_lost' || col === 'expire') {
        this.scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
        this.unregisterProjectileFoW(proj);
        (proj as any).destroy?.();
      }
    };
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
    this.setupProjectileLifetime(proj, lifetimeMs, () => {
      this.scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
      this.unregisterProjectileFoW(proj);
      (proj as any).destroy?.();
    });
  }
}
