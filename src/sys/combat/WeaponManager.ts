 import type { ConfigManager } from '../ConfigManager';
import type { CombatManager } from '../CombatManager';
import { NPCState } from '../NPCStateManager';
import type { EnhancedFogOfWar } from '../fog-of-war/EnhancedFogOfWar';
import { getWeaponType, isHoming } from './weapons/types';
import { getBeamVisualParams } from './weapons/beamHelpers';
import { BeamService } from './weapons/services/BeamService';
import { RangeUiService } from './weapons/ui/RangeUiService';
import { ProjectileService } from './weapons/services/ProjectileService';
import { calculateInterceptTime, getTargetVelocity } from './weapons/utils/aiming';
import { TargetService } from './weapons/services/TargetService';
import { EventBus, EVENTS } from './weapons/services/EventBus';
import { CooldownService } from './weapons/services/CooldownService';

type Target = Phaser.GameObjects.GameObject & { x: number; y: number; active: boolean };

export class WeaponManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private combatManager: CombatManager;
  private pauseManager?: any;
  private fogOfWar?: EnhancedFogOfWar;

  private targetService: TargetService;
  private beamService: BeamService;
  private cooldowns: CooldownService;
  private projectileService: ProjectileService;
  private beamPrepUntil: WeakMap<any, Record<string, number>> = new WeakMap();
  private rangeUi: RangeUiService;
  private weaponSlots: string[] = ['laser', 'cannon', 'missile']; // Default, will be replaced for NPCs

  constructor(scene: Phaser.Scene, config: ConfigManager, combatManager: CombatManager) {
    this.scene = scene;
    this.config = config;
    this.combatManager = combatManager;
    this.rangeUi = new RangeUiService(scene, config, combatManager);
    this.targetService = new TargetService(scene, combatManager);
    this.cooldowns = new CooldownService();
    this.beamService = new BeamService(scene, config, combatManager, this.cooldowns, {
      shouldContinueBeam: (sh, tg, w) => this.shouldContinueBeam(sh, tg, w),
      applyBeamTickDamage: (sh, tg, w) => this.applyBeamTickDamage(sh, tg, w),
      drawBeam: (gfx, sh, tg, w) => this.drawBeam(gfx, sh, tg, w),
      getNowMs: () => this.getNowMs(),
      isPaused: () => !!(this.pauseManager?.isSystemPausable('combat') && this.pauseManager?.getPaused()),
      registerTimer: (id, timer) => { try { this.pauseManager?.registerTimer?.(id, timer); } catch {} },
      unregisterTimer: (id) => { try { this.pauseManager?.unregisterTimer?.(id); } catch {} },
      registerUpdateHandler: (id, handler) => { try { this.pauseManager?.registerUpdateHandler?.(id, handler); } catch {} },
      unregisterUpdateHandler: (id) => { try { this.pauseManager?.unregisterUpdateHandler?.(id); } catch {} },
      getWrappedUpdateHandler: (id) => { try { return this.pauseManager?.getWrappedUpdateHandler?.(id) ?? null; } catch { return null; } },
      getPlayerShip: () => this.combatManager.getPlayerShip()
    });
    this.projectileService = new ProjectileService(scene, config, combatManager, {
      getFoW: () => this.fogOfWar,
      registerTimer: (id, timer) => { try { this.pauseManager?.registerTimer?.(id, timer); } catch {} },
      unregisterTimer: (id) => { try { this.pauseManager?.unregisterTimer?.(id); } catch {} },
      spawnHitEffect: (x, y, w) => this.spawnHitEffect(x, y, w),
      isInvulnerable: (obj) => this.isInvulnerable(obj),
      registerUpdateHandler: (id, handler) => { try { this.pauseManager?.registerUpdateHandler?.(id, handler); } catch {} },
      unregisterUpdateHandler: (id) => { try { this.pauseManager?.unregisterUpdateHandler?.(id); } catch {} },
    });

    this.scene.events.on('weapon-slot-selected', (slotKey: string, selected: boolean) => {
        try { this.rangeUi.toggle(slotKey, !!selected); } catch {}
    });
  }

  /**
   * Инъекция PauseManager после создания CombatManager/WeaponManager
   * Вызывается из CombatManager.setPauseManager()
   */
  public setPauseManager(pm: any) {
    this.pauseManager = pm;
  }

  /**
   * Показ/скрытие круга дальности по причине наведения курсора на иконку оружия в HUD
   */
  public setHoverRange(slotKey: string, show: boolean) {
    try { this.rangeUi.setHover(slotKey, !!show); } catch {}
  }

  /**
   * Применить тик урона лучом и, при необходимости, показать hit-эффект (FoW учитывается)
   */
  private applyBeamTickDamage(shooter: any, target: any, w: any): void {
    this.combatManager.applyDamagePublic(target, (w.damage ?? 0) / Math.max(1, w.beam?.ticksPerSecond ?? 10), shooter);
    if (w.hitEffect) {
      const hitPoint = this.getBeamHitPoint(shooter, target);
      const { anyVisible } = this.getFoWPairVisible(shooter, target);
      if (anyVisible) this.spawnHitEffect(hitPoint.x, hitPoint.y, w);
    }
  }

  /**
   * Проверка, стоит ли продолжать луч (активность и дистанция)
   */
  private shouldContinueBeam(shooter: any, target: any, w: any): boolean {
    if (!shooter?.active || !target?.active) return false;
    const dx = target.x - shooter.x; const dy = target.y - shooter.y; const d = Math.hypot(dx, dy);
    if (d > w.range) return false;
    return true;
  }

  // === Internal helpers (refactor-safe, no behavior changes) ===
  private isInvulnerable(obj: any): boolean {
    const st = obj?.__state;
    const alphaLow = typeof obj?.alpha === 'number' && obj.alpha <= 0.05;
    const invisible = obj?.visible === false;
    return st === 'docking' || st === 'docked' || st === 'undocking' || alphaLow || invisible;
  }

  private setVisibleByFoW(obj: any) {
    if (!this.fogOfWar || !obj) return;
    try {
      const visible = this.fogOfWar.isObjectVisible(obj);
      obj.setVisible?.(visible);
    } catch {}
  }

  // Спавн снаряда с учётом формы, поворота, глубины и регистрации в FoW
  private spawnProjectile(w: any, shooter: any, muzzle: { x: number; y: number }, angle: number, target: any) {
    return this.projectileService.spawnProjectile(w, shooter, muzzle, angle, target);
  }

  // Геометрия вынесена в utils/geometry.ts

  /**
   * Проверка видимости пары объектов в FoW (если FoW нет — считаем видимыми)
   */
  private getFoWPairVisible(a: any, b: any): { shooterVisible: boolean; targetVisible: boolean; anyVisible: boolean } {
    let shooterVisible = true, targetVisible = true;
    if (this.fogOfWar) {
      try {
        shooterVisible = this.fogOfWar.isObjectVisible(a as any);
        targetVisible = this.fogOfWar.isObjectVisible(b as any);
      } catch {}
    }
    return { shooterVisible, targetVisible, anyVisible: (shooterVisible || targetVisible) };
  }

  /**
   * Точка попадания луча по поверхности цели (с учётом радиуса цели)
   */
  private getBeamHitPoint(shooter: any, target: any): { x: number; y: number } {
    const dx = target.x - shooter.x;
    const dy = target.y - shooter.y;
    const targetRadius = this.combatManager.getEffectiveRadiusPublic(target);
    const beamVector = new Phaser.Math.Vector2(dx, dy).normalize();
    return {
      x: target.x - beamVector.x * targetRadius,
      y: target.y - beamVector.y * targetRadius,
    };
  }

  /**
   * Отрисовка луча с учётом FoW и визуальных параметров
   */
  private drawBeam(gfx: Phaser.GameObjects.Graphics, shooter: any, target: any, w: any): void {
    const muzzle = this.getMuzzleWorldPositionFor(shooter, this.resolveMuzzleOffset(shooter, 0, { x: 0, y: 0 }));
    const hitPoint = this.getBeamHitPoint(shooter, target);
    const { anyVisible } = this.getFoWPairVisible(shooter, target);
    gfx.setVisible(anyVisible);
    if (!anyVisible) { return; }

    gfx.clear();
    const { colorHex, outerW, innerW, outerA, innerA } = getBeamVisualParams(w);
    gfx.lineStyle(outerW, Number(colorHex), outerA);
    gfx.beginPath(); gfx.moveTo(muzzle.x, muzzle.y); gfx.lineTo(hitPoint.x, hitPoint.y); gfx.strokePath();
    gfx.lineStyle(innerW, Number(colorHex), innerA);
    gfx.beginPath(); gfx.moveTo(muzzle.x, muzzle.y); gfx.lineTo(hitPoint.x, hitPoint.y); gfx.strokePath();
    gfx.setAlpha(1);
    (gfx as any).__hitPoint = hitPoint;
  }

  // Точность корабля (не оружия) по данным конфига; 1.0 если не задана
  private getShipAccuracy(shooter: any): number {
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
    return shipAccuracy;
  }

  // Унифицированный доступ к времени с учётом pauseManager
  private getNowMs(): number {
    return this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
  }

  // Расстояние между двумя активными объектами (x,y)
  private getDistance(a: any, b: any): number {
    return Math.hypot((b?.x ?? 0) - (a?.x ?? 0), (b?.y ?? 0) - (a?.y ?? 0));
  }

  // В пределах ли цели дальности оружия
  private isTargetInRange(shooter: any, target: any, range: number): boolean {
    return this.getDistance(shooter, target) <= range;
  }

  // Готово ли оружие к выстрелу по кулдауну
  private shouldFireNow(times: Record<string, number>, slotKey: string, w: any): boolean {
    const now = this.getNowMs();
    const cooldownMs = 1000 / Math.max(0.001, (w.fireRatePerSec ?? 1));
    const last = times[slotKey] ?? 0;
    return (now - last) >= cooldownMs;
  }

  // Централизованный emit события Out Of Range (show=true => показать текст OOR)
  private emitWeaponOutOfRange(slotKey: string, show: boolean) {
    try { this.scene.events.emit('weapon-out-of-range', slotKey, show); } catch {}
    // Обратная совместимость: поле называется inRange в типах EventBus, но фактически передаём флаг show
    try { new EventBus(this.scene).emit(EVENTS.WeaponOutOfRange, { slotKey, inRange: show } as any); } catch {}
  }

  /** Прогресс перезарядки оружия игрока [0..1] */
  public getWeaponChargeProgress(slotKey: string): number {
    const now = this.getNowMs();
    const w = this.config.weapons.defs[slotKey];
    return this.cooldowns.getWeaponChargeProgress(slotKey, now, w);
  }

  /** В процессе ли перезарядки оружие игрока */
  public isWeaponCharging(slotKey: string): boolean {
    const now = this.getNowMs();
    return this.cooldowns.isWeaponCharging(slotKey, now, this.combatManager.getPlayerShip());
  }

  /** Прогресс обновления (refresh) лучевого оружия игрока [0..1] */
  public getBeamRefreshProgress(slotKey: string): number {
    const now = this.getNowMs();
    const w = this.config.weapons.defs[slotKey];
    return this.cooldowns.getBeamRefreshProgress(slotKey, now, w, this.combatManager.getPlayerShip());
  }

  /** Очистить цель конкретного слота игрока с эмитами событий */
  private clearPlayerWeaponTarget(slotKey: string, target?: Target) {
    this.targetService.clearSlot(slotKey, target as any);
  }

  /** Унифицированная обработка кулдауна и выстрела игрока для одного слота (single/burst) */
  private updatePlayerCooldownAndFire(
    ship: any,
    slotIndex: number,
    slotKey: string,
    w: any,
    target: any,
    now: number,
    isPaused: boolean
  ) {
    const dist = this.getDistance(ship, target);
    if (dist > w.range) {
      this.cooldowns.clearCharge(slotKey);
      this.emitWeaponOutOfRange(slotKey, true);
      return;
    }
    this.emitWeaponOutOfRange(slotKey, false);
    const cooldownMs = 1000 / Math.max(0.001, (w.fireRatePerSec ?? 1));
    if (!this.cooldowns.getChargeUntil(slotKey)) {
      this.cooldowns.setChargeUntil(slotKey, now + cooldownMs);
      return;
    }
    if (now >= (this.cooldowns.getChargeUntil(slotKey) as number)) {
      if (!isPaused) {
        this.cooldowns.setChargeUntil(slotKey, now + cooldownMs);
        const muzzleOffset = this.resolveMuzzleOffset(ship, slotIndex, { x: 0, y: 0 });
        const w2 = { ...w, muzzleOffset, __slotIndex: slotIndex };
        const isBurst = ((w2?.burst?.count ?? 1) > 1) || (getWeaponType(w2) === 'burst');
        if (isBurst) this.fireBurstWeapon(slotKey, w2, target, ship);
        else this.fireWeapon(slotKey, w2, target, ship);
      }
    }
  }

  public setPlayerWeaponTarget(slotKey: string, target: Target | null) {
    if (target) {
      this.targetService.setTarget(slotKey, target as any);
      const w = this.config.weapons.defs[slotKey];
      if (w) {
        if (getWeaponType(w) === 'beam') {
          // Не откладываем старт луча искусственно — просто останавливаем текущий, чтобы ensureBeam мог стартовать сразу
          this.beamService.stopBeamIfAny(this.combatManager.getPlayerShip(), slotKey);
        } else {
          const times = this.cooldowns.getShooterTimes(this.combatManager.getPlayerShip());
          const cooldownMs = 1000 / Math.max(0.001, (w.fireRatePerSec ?? 1));
          const now = this.getNowMs();
          times[slotKey] = now + cooldownMs;
        }
      }
    } else {
      this.targetService.setTarget(slotKey, null);
    }
  }

  public clearPlayerWeaponTargets() {
    this.targetService.clearAll();
  }

    public getPlayerWeaponTargets(): ReadonlyMap<string, Target> {
        return this.targetService.getTargets() as ReadonlyMap<string, Target>;
    }

    public clearAssignmentsForTarget(target: any) {
        this.targetService.clearAssignmentsForTarget(target);
    }

  public update(isPaused: boolean) {
    this.updatePlayerWeapons(isPaused);
    this.updateNpcWeapons(isPaused);
    this.rangeUi.updateAll();
  }

  /** Обновление оружия игрока: цели, дальность, перезарядка и выстрелы */
  private updatePlayerWeapons(isPaused: boolean) {
    const ship = this.combatManager.getPlayerShip();
    if (!ship) return;

    const playerRadarRange = this.combatManager.getRadarRangeForPublic(ship);
    const slotsToClear: string[] = [];
    for (const [slot, target] of this.targetService.getTargets().entries()) {
        const distToTarget = Phaser.Math.Distance.Between(ship.x, ship.y, target.x, target.y);
        if (distToTarget > playerRadarRange) {
            slotsToClear.push(slot);
        }
    }
    if (slotsToClear.length > 0) {
        for (const slot of slotsToClear) {
            this.clearPlayerWeaponTarget(slot);
        }
        try { this.scene.events.emit('player-weapon-target-cleared', null, slotsToClear); } catch {}
        try { new EventBus(this.scene).emit(EVENTS.PlayerWeaponTargetCleared, { target: null, slots: slotsToClear }); } catch {}
    }
    for (const [slotKey, target] of this.targetService.getTargets().entries()) {
        if (!target.active) {
            this.clearPlayerWeaponTarget(slotKey, target);
        }
    }

    const playerSlots = this.config.player?.weapons ?? [];
    if (playerSlots.length) {
        const now = this.getNowMs();
        for (let i = 0; i < playerSlots.length; i++) {
          const slotKey = playerSlots[i];
          const target = this.targetService.getTargets().get(slotKey) as any;
          if (!target || !target.active) continue;
          const w = this.config.weapons.defs[slotKey];
          if (!w) continue;
          const dist = this.getDistance(ship, target);
          const inRange = dist <= w.range;

          if (getWeaponType(w) === 'beam') {
                const readyAt = this.cooldowns.getBeamReadyAt(this.combatManager.getPlayerShip(), slotKey);
                // Показ Out Of Range зависит ТОЛЬКО от дистанции
                this.emitWeaponOutOfRange(slotKey, !inRange);
                // Запускаем/останавливаем луч для игрока
                if (!isPaused && inRange && now >= readyAt) {
                    this.beamService.ensureBeam(ship, slotKey, w, target, dist);
                } else {
                    this.beamService.stopBeamIfAny(ship, slotKey);
                }
                // Для луча не выполняем общую обработку снарядов
                continue;
          } else {
                // Для нелучевого: показать OOR, если не в радиусе
                this.emitWeaponOutOfRange(slotKey, !inRange);
          }

          // Унифицированная обработка кулдауна и выстрела только для нелучевого оружия
          this.updatePlayerCooldownAndFire(ship, i, slotKey, w, target, now, isPaused);
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
    const times = this.cooldowns.getShooterTimes(shooter);
    const slotsArr = this.weaponSlots;
    for (let i = 0; i < slotsArr.length; i++) {
      const slotKey = slotsArr[i];
      const w = this.config.weapons.defs[slotKey];
      if (!w) continue;
      if (getWeaponType(w) === 'beam') {
        const nowMs = this.getNowMs();
        const readyAt = this.cooldowns.getBeamReadyAt(shooter, slotKey);
        if (nowMs >= readyAt && dist <= w.range) {
          if (!isPaused) {
            this.beamService.ensureBeam(shooter, slotKey, w, target, dist);
          }
        } else {
          this.beamService.stopBeamIfAny(shooter, slotKey);
        }
        continue;
      }
      if (!this.isTargetInRange(shooter, target, w.range)) { this.beamService.stopBeamIfAny(shooter, slotKey); continue; }
      if (this.shouldFireNow(times, slotKey, w)) {
        const now = this.getNowMs();
        if (!isPaused) {
          times[slotKey] = now;
          const muzzleOffset = this.resolveMuzzleOffset(shooter, i, { x: 0, y: 0 });
          const w2 = { ...w, muzzleOffset };
          const isBurst = ((w2?.burst?.count ?? 1) > 1) || (getWeaponType(w2) === 'burst');
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
    const proj: any = this.spawnProjectile(w, shooter, muzzle, angle, target);

    const speed = Math.max(1, w.projectileSpeed || 1);
    const lifetimeMs = Math.max(1,
      (isHoming(w) && w?.homing?.lifetimeMs)
        ? w.homing.lifetimeMs
        : ((w.range / Math.max(1, speed)) * 1000 + 50)
    );
    const shooterEntry = this.combatManager.findTargetEntry(shooter);
    const shooterFaction = shooterEntry?.faction ?? (shooter === this.combatManager.getPlayerShip() ? 'player' : undefined);
    const shooterOverrides = (shooterEntry as any)?.overrides?.factions;
    this.projectileService.startFlight(
      w,
      proj,
      shooter,
      target,
      angle,
      speed,
      lifetimeMs,
      shooterFaction,
      shooterOverrides,
      {
        getNowMs: () => this.getNowMs(),
        isPaused: () => !!(this.pauseManager?.isSystemPausable('combat') && this.pauseManager?.getPaused()),
        setVisibleByFoW: (obj: any) => this.setVisibleByFoW(obj),
        registerUpdateHandler: (id, handler) => { try { this.pauseManager?.registerUpdateHandler?.(id, handler); } catch {} },
        unregisterUpdateHandler: (id) => { try { this.pauseManager?.unregisterUpdateHandler?.(id); } catch {} },
        getWrappedUpdateHandler: (id) => { try { return this.pauseManager?.getWrappedUpdateHandler?.(id); } catch { return null; } },
      }
    );

    if (shooter === this.combatManager.getPlayerShip()) {
      try { this.scene.events.emit('player-weapon-fired', _slot, target); } catch {}
      try { new EventBus(this.scene).emit(EVENTS.PlayerWeaponFired, { slotKey: _slot, target }); } catch {}
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
        const w2 = { ...w, muzzleOffset, __slotIndex: 0, __burstShot: (getWeaponType(w) === 'homing') ? true : undefined };
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

  // getShooterTimes перенесён в CooldownService

  

  private getAimedTargetPoint(shooter: any, target: any, w: any) {
    let weaponAccuracy = typeof w?.accuracy === 'number' ? Phaser.Math.Clamp(w.accuracy, 0, 1) : 1;
    const shipAccuracy = this.getShipAccuracy(shooter);
    const accuracy = Phaser.Math.Clamp(weaponAccuracy * shipAccuracy, 0, 1);
    const { vx, vy } = getTargetVelocity(target);
    
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
      tHit = calculateInterceptTime(rx, ry, vx, vy, projectileSpeed);
      
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

  // ensureBeam/stopBeamIfAny перенесены в BeamService

  private spawnHitEffect(x: number, y: number, w: any) {
    const colorNum = Number((w.hitEffect.color as string).replace('#', '0x'));
    const r = w.hitEffect.radius ?? 16;
    const g = this.scene.add.circle(x, y, r, colorNum, 0.6).setDepth(0.9);
    this.scene.tweens.add({ targets: g, alpha: 0, scale: 1.4, duration: w.hitEffect.durationMs ?? 200, onComplete: () => g.destroy() });
  }

  // Круги дальности вынесены в RangeUiService

  public destroy() { this.rangeUi.destroy(); }
}
