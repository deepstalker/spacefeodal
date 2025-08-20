import type { ConfigManager } from './ConfigManager';
import { NPCMovementManager } from './NPCMovementManager';
import type { EnhancedFogOfWar } from './fog-of-war/EnhancedFogOfWar';
import { DynamicObjectType } from './fog-of-war/types';
import { NPCStateManager, NPCState, MovementPriority } from './NPCStateManager';
import { RelationOverrideManager } from './RelationOverrideManager';

type Target = Phaser.GameObjects.GameObject & { x: number; y: number; active: boolean };

export class CombatManager {
  private static npcCounter = 0;
  private pauseManager?: any; // PauseManager reference
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private npcMovement: NPCMovementManager;
  private fogOfWar?: EnhancedFogOfWar;
  private npcStateManager: NPCStateManager;
  private ship!: Phaser.GameObjects.Image;
  private selectedTarget: Target | null = null;
  private selectionCircle?: Phaser.GameObjects.Arc;
  private radarCircle?: Phaser.GameObjects.Arc; // Кольцо радиуса радара NPC
  private selectionBaseRadius = 70;
  private selectionPulsePhase = 0;
  private lastFireTimesByShooter: WeakMap<any, Record<string, number>> = new WeakMap();
  private lastPirateLogMs: WeakMap<any, number> = new WeakMap();
  private weaponSlots: string[] = ['laser', 'cannon', 'missile'];
  // Назначения целей для оружия игрока: slotKey -> target
  private playerWeaponTargets: Map<string, Target> = new Map();
  // Активные лучи для beam-оружий: shooter -> (slotKey -> beamState)
  private activeBeams: WeakMap<any, Map<string, { gfx: Phaser.GameObjects.Graphics; timer: Phaser.Time.TimerEvent; target: any }>> = new WeakMap();
  // Beam refresh-тайминги (готовность к следующей активации)
  private beamCooldowns: WeakMap<any, Record<string, number>> = new WeakMap();
  // Подготовка к выстрелу (player): когда закончится зарядка до выстрела
  private playerChargeUntil: Record<string, number> = {};
  // Подготовка к лучу (beam) до активации
  private beamPrepUntil: WeakMap<any, Record<string, number>> = new WeakMap();
  private targets: Array<{
    obj: Phaser.GameObjects.GameObject & { x: number; y: number; active: boolean; rotation?: number };
    hp: number; hpMax: number;
    hpBarBg: Phaser.GameObjects.Rectangle; hpBarFill: Phaser.GameObjects.Rectangle;
    nameLabel?: Phaser.GameObjects.Text;
    ai?: { preferRange: number; retreatHpPct: number; type: 'ship' | 'static'; speed: number; disposition?: 'neutral' | 'enemy' | 'ally'; behavior?: string };
    weaponSlots?: string[];
    shipId?: string;
    faction?: string;
    combatAI?: string;
    aiProfileKey?: string;
    intent?: { type: 'attack' | 'flee' | 'retreat'; target: any } | null;
    overrides?: { factions?: Record<string, 'ally'|'neutral'|'confrontation'> };
    damageLog?: {
      firstAttacker?: any;
      totalDamageBySource?: Map<any, number>;
      lastDamageTimeBySource?: Map<any, number>;
    };
  }>=[];
  private combatRings: Map<any, Phaser.GameObjects.Arc> = new Map();
  // Кольца радиусов оружия игрока: slotKey -> graphics circle
  private playerWeaponRangeCircles: Map<string, Phaser.GameObjects.Arc> = new Map();
  private relationOverrides!: RelationOverrideManager;

  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
    this.npcMovement = new NPCMovementManager(scene, config);
    this.npcStateManager = new NPCStateManager(scene, config);
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
    // Централизованный менеджер временных переопределений отношений
    this.relationOverrides = new RelationOverrideManager(scene, {
      getTargets: () => this.targets.map(t => ({ obj: t.obj, faction: t.faction, overrides: t.overrides })),
      getPlayer: () => this.ship,
      getRadarRangeFor: (o: any) => this.getRadarRangeFor(o),
      getNpcContext: (o: any) => this.npcStateManager.getContext(o),
      clearAssignmentsForTarget: (o: any) => this.clearAssignmentsForTarget(o)
    });

    // Обработка снятия паузы для корректировки временных меток
    this.scene.events.on('game-resumed', this.onGameResumed, this);
    // Подписка на визуальные события выбора слотов оружия (только визуал)
    this.scene.events.on('weapon-slot-selected', (slotKey: string, selected: boolean) => {
      try { this.togglePlayerWeaponRangeCircle(slotKey, !!selected); } catch {}
    });
    

  }

  public clearIntentFor(obj: any) {
    const entry = this.targets.find(t => t.obj === obj);
    if (entry) (entry as any).intent = null;
  }
  public setAIProfileFor(obj: any, profileKey: string) {
    const entry = this.targets.find(t => t.obj === obj);
    if (!entry) return;
    const profile = this.config.aiProfiles.profiles[profileKey];
    if (!profile) return;
    entry.aiProfileKey = profileKey;
    entry.ai = entry.ai || ({ type: 'ship', preferRange: 0, speed: 0 } as any);
    (entry.ai as any).behavior = profile.behavior;
    (entry.ai as any).retreatHpPct = profile.combat?.retreatHpPct ?? 0;
  }

  attachShip(ship: Phaser.GameObjects.Image) {
    this.ship = ship;
  }

  setFogOfWar(fogOfWar: EnhancedFogOfWar) {
    this.fogOfWar = fogOfWar;
  }

  setPauseManager(pauseManager: any) {
    this.pauseManager = pauseManager;
    // Передаем pauseManager в систему движения NPC
    this.npcMovement.setPauseManager(pauseManager);
  }

  private onGameResumed(data: { pauseDuration: number; totalPausedTime: number }) {
    // Не нужно корректировать таймеры вручную, так как PauseManager.getAdjustedTime() уже делает это
    // Пауза и снятие паузы корректно обрабатываются через getAdjustedTime()
    
    if (this.pauseManager?.getDebugSetting('log_pause_events')) {
      console.log('[CombatManager] Game resumed, no manual timer adjustment needed');
    }
  }
  
  private onWeaponChargeCompletedDuringPause(slotKey: string) {
    // Не нужно - HUD теперь только отображает состояние, не управляет им
  }

  /**
   * Получить текущий прогресс зарядки оружия (0-1)
   */
  public getWeaponChargeProgress(slotKey: string): number {
    const chargeUntil = this.playerChargeUntil[slotKey];
    if (!chargeUntil) return 1; // Не заряжается = готово
    
    const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
    if (now >= chargeUntil) return 1; // Зарядка завершена
    
    // Находим когда началась зарядка
    const w = this.config.weapons.defs[slotKey];
    if (!w) return 1;
    
    const cooldownMs = 1000 / Math.max(0.001, (w.fireRatePerSec ?? 1));
    const chargeStartTime = chargeUntil - cooldownMs;
    const elapsed = now - chargeStartTime;
    
    return Math.max(0, Math.min(1, elapsed / cooldownMs));
  }

  /**
   * Проверить, заряжается ли оружие
   */
  public isWeaponCharging(slotKey: string): boolean {
    const chargeUntil = this.playerChargeUntil[slotKey];
    if (chargeUntil) {
      const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
      if (now < chargeUntil) return true;
    }
    
    // Проверяем beam refresh
    const beamCooldowns = this.beamCooldowns.get(this.ship);
    if (beamCooldowns && beamCooldowns[slotKey]) {
      const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
      return now < beamCooldowns[slotKey];
    }
    
    return false;
  }
  
  /**
   * Получить прогресс beam refresh (0-1)
   */
  public getBeamRefreshProgress(slotKey: string): number {
    const beamCooldowns = this.beamCooldowns.get(this.ship);
    if (!beamCooldowns || !beamCooldowns[slotKey]) return 1;
    
    const refreshUntil = beamCooldowns[slotKey];
    const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
    if (now >= refreshUntil) return 1;
    
    // Находим длительность refresh
    const w = this.config.weapons.defs[slotKey];
    if (!w) return 1;
    
    const refreshMs = Math.max(0, w?.beam?.refreshMs ?? 500);
    const refreshStartTime = refreshUntil - refreshMs;
    const elapsed = now - refreshStartTime;
    
    return Math.max(0, Math.min(1, elapsed / refreshMs));
  }

  getTargetObjects(): Phaser.GameObjects.GameObject[] {
    return this.targets.map(t => t.obj as Phaser.GameObjects.GameObject);
  }

  getSelectedTarget(): Target | null { return this.selectedTarget; }

  spawnNPCPrefab(prefabKey: string, x: number, y: number) {
    const prefab = this.config.stardwellers?.prefabs?.[prefabKey];
    const shipDefId = prefab?.shipId ?? prefabKey; // allow direct ship id fallback
    const ship = this.config.ships.defs[shipDefId] ?? this.config.ships.defs[this.config.ships.current];
    if (!ship) { return null; }
    let obj: any;
    const s = ship.sprite;
    const texKey = (s.key && this.scene.textures.exists(s.key)) ? s.key : (this.scene.textures.exists('ship_alpha') ? 'ship_alpha' : 'ship_alpha_public');
    obj = this.scene.add.image(x, y, texKey).setDepth(0.8);
    (obj as any).__prefabKey = prefabKey;
    obj.setOrigin(s.origin?.x ?? 0.5, s.origin?.y ?? 0.5);
    obj.setDisplaySize(s.displaySize?.width ?? 64, s.displaySize?.height ?? 128);
    // Присваиваем уникальный ID
    (obj as any).__uniqueId = ++CombatManager.npcCounter;
    // Начальная ориентация — по носу из конфига
    obj.setRotation(Phaser.Math.DegToRad(s.noseOffsetDeg ?? 0));
    // Запомним базовый масштаб после применения displaySize
    (obj as any).__baseScaleX = obj.scaleX;
    (obj as any).__baseScaleY = obj.scaleY;
    obj.setAlpha(1);
    obj.setVisible(true);
    (obj as any).__noseOffsetRad = Phaser.Math.DegToRad(s.noseOffsetDeg ?? 0);
    const barW = 128;
    const above = (Math.max(obj.displayWidth, obj.displayHeight) * 0.5) + 16;
    const bg = this.scene.add.rectangle(obj.x - barW/2, obj.y - above, barW, 8, 0x111827).setOrigin(0, 0.5).setDepth(0.5);
    const fill = this.scene.add.rectangle(obj.x - barW/2, obj.y - above, barW, 8, 0x22c55e).setOrigin(0, 0.5).setDepth(0.6);
    bg.setVisible(false); fill.setVisible(false);
    const aiProfileName = prefab?.aiProfile ?? 'planet_trader';
    const profile = this.config.aiProfiles.profiles[aiProfileName] ?? { behavior: 'static' } as any;
    const ai = { preferRange: 0, retreatHpPct: profile.combat?.retreatHpPct ?? 0, type: 'ship', behavior: profile.behavior } as any;
    const entry: any = { obj, hp: ship.hull ?? 100, hpMax: ship.hull ?? 100, hpBarBg: bg, hpBarFill: fill, ai, shipId: prefab?.shipId ?? shipDefId, faction: prefab?.faction, combatAI: prefab?.combatAI, aiProfileKey: aiProfileName, intent: null };
    if (prefab?.weapons && Array.isArray(prefab.weapons)) entry.weaponSlots = prefab.weapons.slice(0);
    this.targets.push(entry);
    
    // Регистрируем NPC в системе движения
    this.npcMovement.registerNPC(obj, shipDefId, prefab?.combatAI);
    
    // Регистрируем NPC в новой системе состояний
    this.npcStateManager.registerNPC(obj, aiProfileName, prefab?.combatAI, prefab?.faction);
    
    // Регистрируем NPC в fog of war как динамический объект
    if (this.fogOfWar) {
      this.fogOfWar.registerDynamicObject(obj, DynamicObjectType.NPC);
    }
    
    return obj as Target;
  }

  // enemies-by-config removed — use spawnNPCPrefab with stardwellers prefabs

  bindInput(inputMgr: any) {
    inputMgr.onLeftClick((wx: number, wy: number) => {

      const hit = this.findTargetAt(wx, wy);
      if (hit) {

        this.selectTarget(hit.obj as any);
      } else {
        // Пустой клик: сбрасываем выбор, только если нет ни одного оружия, нацеленного на текущую выбранную цель
        if (!this.selectedTarget || !this.isTargetCombatSelected(this.selectedTarget)) {

          this.clearSelection();
        } else {

        }
      }
    });
  }

  public findTargetAt(wx: number, wy: number) {
    // Фильтруем цели в состоянии docking/docked/undocking - их нельзя выбирать для боя
    const availableTargets = this.targets.filter(t => {
      const state = (t.obj as any).__state;
      const isDockingState = state === 'docking' || state === 'docked' || state === 'undocking';
      if (isDockingState) {

      }
      return !isDockingState;
    });
    
    // Сначала проверим попадание по кругу вокруг объекта
    let hit = availableTargets.find(t => {
      const rad = this.getEffectiveRadius(t.obj as any) + 12;
      return Phaser.Math.Distance.Between(t.obj.x, t.obj.y, wx, wy) <= rad;
    });
    if (hit) return hit;
    // Также считаем попаданием клики по области HP-бара
    hit = availableTargets.find(t => {
      const bg = t.hpBarBg;
      if (!bg || !bg.visible) return false;
      const x1 = bg.x, y1 = bg.y - bg.height * 0.5;
      const x2 = bg.x + bg.width, y2 = bg.y + bg.height * 0.5;
      return wx >= x1 && wx <= x2 && wy >= y1 && wy <= y2;
    }) as any;
    if (hit) return hit;
    // Последняя попытка: клик рядом с объектом в прямоугольнике дисплея
    hit = availableTargets.find(t => {
      const obj: any = t.obj;
      // Если цель NPC — игрок, но игрок вне радара этого NPC, сбрасываем атакующий intent
      if (t.intent?.type === 'attack' && t.intent.target === this.ship) {
        const radar = this.getRadarRangeFor(t.obj);
        const dToPlayer = Phaser.Math.Distance.Between(t.obj.x, t.obj.y, this.ship.x, this.ship.y);
        if (dToPlayer > radar) {
          t.intent = null;
          const context = this.npcStateManager.getContext(obj);
          if (context) {
            context.targetStabilization.currentTarget = null;
            context.targetStabilization.targetScore = 0;
          }
        }
      }
      const w = obj.displayWidth ?? obj.width ?? 128;
      const h = obj.displayHeight ?? obj.height ?? 128;
      const x1 = obj.x - w * 0.5, y1 = obj.y - h * 0.5;
      const x2 = obj.x + w * 0.5, y2 = obj.y + h * 0.5;
      return wx >= x1 && wx <= x2 && wy >= y1 && wy <= y2;
    }) as any;
    return hit ?? null;
  }

  public forceSelectTarget(target: Target) {
    this.selectTarget(target);
  }

  public setPlayerWeaponTarget(slotKey: string, target: Target | null) {
    const oldTarget = this.playerWeaponTargets.get(slotKey);
    
    if (target) {
      // Если цель не враждебна — делаем временно враждебной к игроку через RelationOverrideManager
      try { this.relationOverrides?.markObjectHostileToPlayer(target as any, { reason: 'aim', expireOnOutOfRadar: true }); } catch {}
      this.playerWeaponTargets.set(slotKey, target);
      // Новое назначение цели: начинаем с перезарядки
      const w = this.config.weapons.defs[slotKey];
      if (w) {
        if ((w.type ?? 'single') === 'beam') {
          const refreshMs = Math.max(0, w?.beam?.refreshMs ?? 500);
          const shooterTimes = this.beamCooldowns.get(this.ship) ?? {}; this.beamCooldowns.set(this.ship, shooterTimes);
          const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
          shooterTimes[slotKey] = now + refreshMs;
          this.stopBeamIfAny(this.ship, slotKey);
        } else {
          const times = this.getShooterTimes(this.ship);
          const cooldownMs = 1000 / Math.max(0.001, (w.fireRatePerSec ?? 1));
          const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
          times[slotKey] = now + cooldownMs;
        }
      }

    } else {
      this.playerWeaponTargets.delete(slotKey);
      // Скрываем out-of-range текст при снятии цели
      try { this.scene.events.emit('weapon-out-of-range', slotKey, false); } catch {}
    }
    
    this.refreshSelectionCircleColor();
    this.refreshCombatRings();
    this.refreshCombatUIAssigned();
  }

  /**
   * Сделать цель временно враждебной к игроку через overrides
   */
  public markTargetHostileToPlayer(targetObj: any) {
    const t = this.targets.find(tt => tt.obj === targetObj);
    if (!t) return;
    const relAB = this.getRelation('player', t.faction, undefined);
    const relBA = this.getRelation(t.faction, 'player', t.overrides?.factions);
    const isEnemyNow = (relAB === 'confrontation') || (relBA === 'confrontation');
    if (isEnemyNow) return;
    (t as any).overrides = (t as any).overrides ?? {};
    (t as any).overrides.factions = (t as any).overrides.factions ?? {};
    (t as any).overrides.factions['player'] = 'confrontation';
  }

  public clearPlayerWeaponTargets() {
    if (this.playerWeaponTargets.size > 0) {

      // Уведомляем UI о сбросе всех назначений
      const clearedSlots = Array.from(this.playerWeaponTargets.keys());
      this.playerWeaponTargets.clear();
      if (clearedSlots.length > 0) {
        // Скрываем out-of-range текст для всех очищенных слотов
        for (const slotKey of clearedSlots) {
          try { this.scene.events.emit('weapon-out-of-range', slotKey, false); } catch {}
        }
        // try { this.scene.events.emit('player-weapon-target-cleared', null, clearedSlots); } catch {}
      }
    }
    this.refreshSelectionCircleColor();
    this.refreshCombatRings();
    this.refreshCombatUIAssigned();
  }

  // === Relation Override API (для использования сценариями/системами) ===
  public markObjectHostileToPlayerViaManager(obj: any, opts?: { reason?: string; expireOnOutOfRadar?: boolean; expiresInCycles?: number; expiresAtCycle?: number }) {
    try { this.relationOverrides?.markObjectHostileToPlayer(obj, opts); } catch {}
  }
  public clearObjectHostilityToPlayerViaManager(obj: any) {
    try { this.relationOverrides?.unmarkObjectHostilityToPlayer(obj); } catch {}
  }
  public setFactionRelationOverrideAgainstPlayer(faction: string, relation: 'ally'|'neutral'|'confrontation'|'cautious', durationCycles?: number) {
    try { this.relationOverrides?.setFactionAgainstPlayer(faction, relation, { durationCycles }); } catch {}
  }
  public clearFactionRelationOverrideAgainstPlayer(faction: string) {
    try { this.relationOverrides?.clearFactionAgainstPlayer(faction); } catch {}
  }

  public getPlayerWeaponTargets(): ReadonlyMap<string, Target> {
    return this.playerWeaponTargets;
  }

  public getHpBarInfoFor(target: Target): { x: number; y: number; width: number; height: number } | null {
    const t = this.targets.find(tt => tt.obj === target);
    if (!t) return null;
    return { x: t.hpBarBg.x, y: t.hpBarBg.y, width: t.hpBarBg.width, height: t.hpBarBg.height };
  }

  private selectTarget(target: Target) {
    this.selectedTarget = target;
    const base = this.getEffectiveRadius(target as any) + 5;
    this.selectionBaseRadius = base;
    if (!this.selectionCircle) {
      // начально — нейтральный цвет; позже может смениться на красный, если есть цель для оружия
      this.selectionCircle = this.scene.add.circle(target.x, target.y, base, 0x9e9382, 0.15).setDepth(0.45);
      this.selectionCircle.setStrokeStyle(2, 0x9e9382, 1);
    } else {
      this.selectionCircle.setPosition(target.x, target.y).setVisible(true);
      this.selectionCircle.setRadius(base);
      this.selectionCircle.setFillStyle(0x9e9382, 0.15);
      this.selectionCircle.setStrokeStyle(2, 0x9e9382, 1);
    }
    
    // Отображаем радиус радара для NPC (не для игрока)
    if (target !== this.ship) {
      const radarRange = this.getRadarRangeFor(target);
      if (radarRange > 0) {
        if (!this.radarCircle) {
          this.radarCircle = this.scene.add.circle(target.x, target.y, radarRange, 0x6b7280, 0.08).setDepth(0.4);
          this.radarCircle.setStrokeStyle(1, 0x6b7280, 0.6);
        } else {
          this.radarCircle.setPosition(target.x, target.y).setVisible(true);
          this.radarCircle.setRadius(radarRange);
          this.radarCircle.setFillStyle(0x6b7280, 0.08);
          this.radarCircle.setStrokeStyle(1, 0x6b7280, 0.6);
        }
      } else {
        this.radarCircle?.setVisible(false);
      }
    } else {
      // Скрываем радар для игрока
      this.radarCircle?.setVisible(false);
    }
    // toggle HP bars visibility
    for (const t of this.targets) {
      const vis = t.obj === target;
      t.hpBarBg.setVisible(vis);
      t.hpBarFill.setVisible(vis);
      this.updateHpBar(t);
      // Имя цели над HP баром
      if (vis) {
        if (!t.nameLabel) {
          const baseName = this.resolveDisplayName(t) || 'Unknown';
          const uniqueName = `${baseName} #${(t.obj as any).__uniqueId || ''}`;
          t.nameLabel = this.scene.add.text(0, 0, uniqueName, { color: '#ffffff', fontSize: '20px', fontFamily: 'HooskaiChamferedSquare' }).setOrigin(0.5, 1).setDepth(0.7);
        }
        // Цвет имени по отношению к игроку: neutral -> 0x9E9382, enemy -> 0xA93226
        const relAB = this.getRelation('player', t.faction, undefined);
        const relBA = this.getRelation(t.faction, 'player', t.overrides?.factions);
        const isEnemyNow = (relAB === 'confrontation') || (relBA === 'confrontation');
        const color = isEnemyNow ? '#A93226' : '#9E9382';
        const baseName = this.resolveDisplayName(t) || 'Unknown';
        const uniqueName = `${baseName} #${(t.obj as any).__uniqueId || ''}`;
        
        // Добавляем отладочную информацию о цели (только цель/статус)
        let debugInfo = '';
        if (process.env.NODE_ENV === 'development') {
          const currentTarget = t.intent?.target;
          const stateContext = this.npcStateManager.getContext(t.obj);
          const stableTarget = stateContext?.targetStabilization?.currentTarget;
          
          // КРИТИЧНАЯ ПРОВЕРКА: убеждаемся что контекст принадлежит правильному объекту
          if (stateContext && stateContext.obj !== t.obj) {
            debugInfo = `\n❌ CONTEXT MISMATCH! (${(stateContext.obj as any).__uniqueId})`;
            console.error(`[Display] Context mismatch for ${(t.obj as any).__uniqueId}: got context for ${(stateContext.obj as any).__uniqueId}`);
          } else if (currentTarget || stableTarget) {
            const targetToShow = stableTarget || currentTarget;
            const targetName = targetToShow === this.ship ? 'PLAYER' : 
                              `#${(targetToShow as any).__uniqueId || 'UNK'}`;
            const intentType = t.intent?.type || 'none';
            
            // Показываем только цель и статус, убираем агрессию и источники урона
            debugInfo = `\n→ ${targetName} (${intentType})`;
          } else {
            debugInfo = `\n→ NO TARGET`;
          }
        }
        
        t.nameLabel.setText(uniqueName + debugInfo);
        t.nameLabel.setColor(color);
        t.nameLabel.setVisible(true);
        this.updateHpBar(t); // позиция имени обновится внутри
      } else {
        t.nameLabel?.setVisible(false);
      }
    }
    this.refreshSelectionCircleColor();
  }

  private clearSelection() {
    this.selectedTarget = null;
    this.selectionCircle?.setVisible(false);
    this.radarCircle?.setVisible(false); // Скрываем радар
    // hide all HP bars
    for (const t of this.targets) { t.hpBarBg.setVisible(false); t.hpBarFill.setVisible(false); t.nameLabel?.setVisible(false); }
  }

  private update(_time: number, deltaMs: number) {
    // НЕ блокируем весь update на паузе - только конкретные действия
    const isPaused = this.pauseManager?.isSystemPausable('combat') && this.pauseManager?.getPaused();
    
    // pulse selection
    if (this.selectedTarget && this.selectionCircle) {
      this.selectionPulsePhase += deltaMs * 0.01;
      const r = this.selectionBaseRadius + Math.sin(this.selectionPulsePhase) * 3;
      this.selectionCircle.setRadius(r);
      this.selectionCircle.setPosition((this.selectedTarget as any).x, (this.selectedTarget as any).y);
      
      // Обновляем позицию радара NPC
      if (this.radarCircle && this.radarCircle.visible) {
        this.radarCircle.setPosition((this.selectedTarget as any).x, (this.selectedTarget as any).y);
      }
    }

    // auto logic
    if (!this.ship) return;
    
    // ВАЖНО: Порядок имеет значение!
    // 1. Sensors logic - но только если не на паузе
    if (!isPaused) {
      this.updateSensors(deltaMs);
    }
    // 2. AI logic - но только если не на паузе  
    if (!isPaused) {
      this.updateEnemiesAI(deltaMs);
    }

    // Сброс назначенных оружий и выбранной цели вне радара
    const playerRadarRange = this.getRadarRangeFor(this.ship);
    const slotsToClear: string[] = [];
    for (const [slot, target] of this.playerWeaponTargets.entries()) {
      const distToTarget = Phaser.Math.Distance.Between(this.ship.x, this.ship.y, target.x, target.y);
      if (distToTarget > playerRadarRange) {
        slotsToClear.push(slot);
      }
    }
    if (slotsToClear.length > 0) {
      const clearedTargets = new Set<Target>();
      for (const slot of slotsToClear) {
        const target = this.playerWeaponTargets.get(slot);
        if (target) clearedTargets.add(target);
        this.playerWeaponTargets.delete(slot);
        // Скрываем надпись OUT OF RANGE, т.к. назначение цели снято
        try { this.scene.events.emit('weapon-out-of-range', slot, false); } catch {}
      }
      try { this.scene.events.emit('player-weapon-target-cleared', null, slotsToClear); } catch {}
      this.refreshCombatRings();
      this.refreshCombatUIAssigned();
      this.refreshSelectionCircleColor();
    }
    if (this.selectedTarget) {
      const distToSelected = Phaser.Math.Distance.Between(this.ship.x, this.ship.y, this.selectedTarget.x, this.selectedTarget.y);
      if (distToSelected > playerRadarRange) {
        // Если за пределами радара и нет наведённых слотов на цель — снимаем временную конфронтацию и сбрасываем выбор
        const t = this.targets.find(tt => tt.obj === this.selectedTarget);
        const anyOnThis = this.isTargetCombatSelected(this.selectedTarget);
        if (t && !anyOnThis) {
          (t as any).overrides = (t as any).overrides ?? {};
          (t as any).overrides.factions = (t as any).overrides.factions ?? {};
          if ((t as any).overrides.factions['player'] === 'confrontation') {
            delete (t as any).overrides.factions['player'];
          }
        }
        this.clearSelection();
      }
    }

    // Проверка действительности назначенных целей и сброс недействительных
    for (const [slotKey, target] of this.playerWeaponTargets.entries()) {
      if (!target.active) {
        this.playerWeaponTargets.delete(slotKey);
        // Отправляем событие weapon-out-of-range для скрытия текста при сбросе недействительной цели
        try { this.scene.events.emit('weapon-out-of-range', slotKey, false); } catch {}
        // Уведомляем UI о сбросе назначения
        try { this.scene.events.emit('player-weapon-target-cleared', target, [slotKey]); } catch {}
      }
    }
    
    // Player fire only по назначенным целям для каждого слота оружия
    const playerSlots = this.config.player?.weapons ?? [];
    if (playerSlots.length) {
      // Используем скорректированное время с учетом паузы
      const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
      const times = this.getShooterTimes(this.ship);
      for (let i = 0; i < playerSlots.length; i++) {
        const slotKey = playerSlots[i];
        const target = this.playerWeaponTargets.get(slotKey);
        if (!target || !target.active) continue;
        const w = this.config.weapons.defs[slotKey];
        if (!w) continue;
        const dx = (target as any).x - this.ship.x;
        const dy = (target as any).y - this.ship.y;
        const dist = Math.hypot(dx, dy);
        // Beam: подготовка в зоне действия, активация после подготовки, затем duration/refresh
        if ((w.type ?? 'single') === 'beam') {
          const readyObj = this.beamCooldowns.get(this.ship) ?? {}; this.beamCooldowns.set(this.ship, readyObj);
          const readyAt = readyObj[slotKey] ?? 0;
          const prepObj = this.beamPrepUntil.get(this.ship) ?? {}; this.beamPrepUntil.set(this.ship, prepObj);
          const prepUntil = prepObj[slotKey] ?? 0;
          if (dist > w.range) {
            // выйти из зоны — отменяем подготовку и луч
            if (prepUntil) { delete prepObj[slotKey]; }
            try { this.scene.events.emit('weapon-out-of-range', slotKey, true); } catch {}
            this.stopBeamIfAny(this.ship, slotKey);
            continue;
          }
          try { this.scene.events.emit('weapon-out-of-range', slotKey, false); } catch {}
          // В зоне: если на кулдауне — ждём; если нет подготовки — начинаем
          if (now < readyAt) { this.stopBeamIfAny(this.ship, slotKey); continue; }
          if (!prepUntil) {
            const refreshMs = Math.max(0, w?.beam?.refreshMs ?? 500);
            prepObj[slotKey] = now + refreshMs;
            continue;
          }
          if (now >= prepUntil) {
            delete prepObj[slotKey];
            // Активируем beam только если не на паузе
            if (!isPaused) {
              this.ensureBeam(this.ship, slotKey, w, target, dist);
            }
          }
          continue;
        }
        // Небимовое оружие: подготовка/зарядка в зоне, выстрел по завершении
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
          // Стреляем только если не на паузе
          if (!isPaused) {
            if (this.pauseManager?.getDebugSetting('log_pause_events')) {
              console.log(`[CombatManager] Weapon ${slotKey} fired: now=${now}, nextReady=${now + cooldownMs}`);
            }
            this.playerChargeUntil[slotKey] = now + cooldownMs;
            const muzzleOffset = this.resolveMuzzleOffset(this.ship, i, { x: 0, y: 0 });
            const w2 = { ...w, muzzleOffset };
            const isBurst = ((w2?.burst?.count ?? 1) > 1) || ((w2.type ?? 'single') === 'burst');
            if (isBurst) this.fireBurstWeapon(slotKey, w2, target as any, this.ship);
            else this.fireWeapon(slotKey, w2, target as any, this.ship);
          }
        }
      }
    }
    // enemies auto fire by intent
    for (const t of this.targets) {
      // Используем FSM, но допускаем легаси intent как триггер боя
      const ctx = this.npcStateManager.getContext(t.obj);
      const st = ctx?.state;
      const legacyAttack = t.intent?.type === 'attack' && t.intent.target?.active;
      const legacyFlee = t.intent?.type === 'flee' && t.intent.target?.active; // retreat не считается боевым
      // Мирные профили (nonCombat) никогда не стреляют
      const combatProfile = t.combatAI ? this.config.combatAI?.profiles?.[t.combatAI] : undefined;
      const isNonCombat = !!combatProfile?.nonCombat;
      const canShoot = !isNonCombat && ((st === NPCState.COMBAT_ATTACKING) || (st === NPCState.COMBAT_FLEEING) || legacyAttack || legacyFlee);
      const targetObj = ctx?.targetStabilization?.currentTarget ?? t.intent?.target;
      if (!targetObj) { continue; }
      if (!targetObj || !targetObj.active) {
  
        continue;
      }
      
      const saved = this.weaponSlots;
      const slots = (t as any).weaponSlots as string[] | undefined;
      if (slots && slots.length) this.weaponSlots = slots;
      
      // Стреляем в режимах ATTACKING и FLEEING, а также при легаси intent attack/flee
      if (canShoot) {
        this.autoFire(t.obj as any, targetObj);
      }
      this.weaponSlots = saved;
    }
    // update red rings for combat-selected targets
    for (const [tgt, ring] of this.combatRings.entries()) {
      if (!tgt || !tgt.active) { ring.destroy(); this.combatRings.delete(tgt); continue; }
      const base = this.getEffectiveRadius(tgt as any) + 5;
      ring.setRadius(base);
      ring.setPosition((tgt as any).x, (tgt as any).y);
    }
    // ensure HP bars for all combat targets remain visible
    this.refreshCombatUIAssigned();

    // Обновляем позиции кругов радиуса оружия игрока (закреплены на корабле)
    if (this.ship && this.playerWeaponRangeCircles.size > 0) {
      for (const [slotKey, circle] of this.playerWeaponRangeCircles.entries()) {
        if (!circle || !circle.active) continue;
        circle.setPosition(this.ship.x, this.ship.y);
        // на случай изменения конфига оружия на лету — обновим радиус
        const w = this.config.weapons?.defs?.[slotKey];
        if (w && typeof w.range === 'number') {
          circle.setRadius(w.range);
        }
      }
    }
  }

  private refreshSelectionCircleColor() {
    const t = this.selectedTarget;
    if (!t || !this.selectionCircle) return;
    // Красим красным если: (а) цель назначена на оружие игрока ИЛИ (б) цель держит игрока как свою цель
    const anyOnThis = Array.from(this.playerWeaponTargets.values()).some(v => v === t);
    const rec = this.targets.find(tt => tt.obj === t);
    const targetsPlayer = !!rec?.intent && rec.intent.type === 'attack' && rec.intent.target === this.ship;
    if (anyOnThis || targetsPlayer) {
      this.selectionCircle.setFillStyle(0xA93226, 0.15);
      this.selectionCircle.setStrokeStyle(2, 0xA93226, 1);
    } else {
      this.selectionCircle.setFillStyle(0x9e9382, 0.15);
      this.selectionCircle.setStrokeStyle(2, 0x9e9382, 1);
    }
  }

  private isTargetCombatSelected(target: Target | null): boolean {
    if (!target) return false;
    for (const t of this.playerWeaponTargets.values()) if (t === target) return true;
    return false;
  }

  private updateEnemiesAI(deltaMs: number) {
    for (const t of this.targets) {
      if (!t.ai || t.ai.type !== 'ship') continue;
      // If object is returning home (e.g., wave despawn), skip combat steering
      if ((t.obj as any).__returningHome) continue;
      const obj: any = t.obj;
      
      // If no combat intent and behavior isn't aggressive — let regular logic handle
      if ((!t.intent || t.intent.type === undefined) && t.ai.behavior && t.ai.behavior !== 'aggressive') { 
        // Отладочная информация для не-агрессивного поведения
        if (process.env.NODE_ENV === 'development' && Math.random() < 0.002) { // 0.2% логов
          console.log(`[AI] ${t.shipId} #${(obj as any).__uniqueId} non-aggressive behavior`, {
            behavior: t.ai.behavior,
            hasIntent: !!t.intent,
            intentType: t.intent?.type
          });
        }
        // Не выходим из функции: ниже отработает логика сенсоров (flee/escort/прочее)
        this.updateHpBar(t as any);
      }
      
      const retreat = ((): number => {
        if (t.combatAI) {
          const cp = this.config.combatAI?.profiles?.[t.combatAI];
          if (cp && typeof cp.retreatHpPct === 'number') return cp.retreatHpPct;
        }
        return t.ai.retreatHpPct ?? 0;
      })();
      
      let targetObj = (t.intent && t.intent.type === 'attack') ? t.intent.target : null;
      const evadeObj = (t.intent && (t.intent.type === 'flee' || t.intent.type === 'retreat')) ? t.intent.target : null;
      
      // КРИТИЧНО: Проверяем валидность цели перед использованием
      if (targetObj && (!targetObj.active || targetObj.destroyed)) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[AI] ${t.shipId} #${(obj as any).__uniqueId} clearing invalid attack target`, {
            targetActive: targetObj.active,
            targetDestroyed: targetObj.destroyed
          });
        }
        targetObj = null;
        t.intent = null;
        // Очищаем в новой системе тоже
        const context = this.npcStateManager.getContext(obj);
        if (context) {
          context.targetStabilization.currentTarget = null;
          context.targetStabilization.targetScore = 0;
        }
      }
      
      if (evadeObj && (!evadeObj.active || evadeObj.destroyed)) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[AI] ${t.shipId} #${(obj as any).__uniqueId} clearing invalid flee target`);
        }
        t.intent = null;
      }
      
      let target: { x: number; y: number };
      if (evadeObj) {
        // Flee/Retreat sensor-driven: flee держит изначальную точку, retreat корректирует направление
        const nowMs = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
        const recalcInterval = this.config.aiProfiles?.profiles?.[t.aiProfileKey!]?.retreat?.recalcIntervalMs ?? 3500;
        const mode = (t as any).__fleeMode as ('flee'|'retreat'|undefined);
        const needRecalc = mode === 'retreat' ? (!(t as any).__fleeDir || !(t as any).__fleeDirTime || (nowMs - (t as any).__fleeDirTime > recalcInterval)) : !(t as any).__fleeDir;
        if (needRecalc) {
          let source = evadeObj;
          if (t.damageLog?.totalDamageBySource?.size) {
            let b: any = null; let v = -1;
            for (const [src, sum] of t.damageLog.totalDamageBySource.entries()) {
              if (!src?.active) continue; if (sum > v) { v = sum; b = src; }
            }
            if (b) source = b;
          }
          const dx0 = obj.x - (source as any).x;
          const dy0 = obj.y - (source as any).y;
          const d0 = Math.hypot(dx0, dy0) || 1;
          (t as any).__fleeDir = { x: dx0 / d0, y: dy0 / d0 };
          (t as any).__fleeDirTime = nowMs;
        }
        const fleeDistance = this.config.aiProfiles?.profiles?.[t.aiProfileKey!]?.retreat?.distance ?? 1000;
                          target = { x: obj.x + (t as any).__fleeDir.x * fleeDistance, y: obj.y + (t as any).__fleeDir.y * fleeDistance };
        this.npcMovement.setNPCTarget(obj, target);
        
        // Добавляем команду бегства с высоким приоритетом
        this.npcStateManager.addMovementCommand(
          obj, 'move_to', 
          target, 
          undefined, 
          MovementPriority.EMERGENCY_FLEE, 
          'combat_manager_flee'
        );
      } else if (targetObj && targetObj.active && !targetObj.destroyed) {
        // Attack: используем режим движения из профиля ИИ
        const shouldRetreat = t.hp / t.hpMax <= retreat;
        if (shouldRetreat) {
          // Логируем начало отступления, если состояние изменилось.
          if (t.intent?.type !== 'flee') {
              if (process.env.NODE_ENV === 'development') {
                  const shipId = t.shipId ?? 'unknown_ship';
                  const uniqueId = (obj as any).__uniqueId || '';
                  const targetName = targetObj === this.ship ? 'PLAYER' : `#${(targetObj as any).__uniqueId}`;
                  console.log(`[Combat AI] ${shipId} #${uniqueId} starting to flee from ${targetName}`, {
                    hp: `${t.hp}/${t.hpMax} (${((t.hp/t.hpMax)*100).toFixed(0)}%)`,
                    retreatThreshold: `${(retreat*100).toFixed(0)}%`
                  });
              }
          }
          t.intent = { type: 'flee', target: targetObj };

          // Отступаем
          const dx = obj.x - targetObj.x;
          const dy = obj.y - targetObj.y;
          const dist = Math.hypot(dx, dy) || 1;
          const retreatDistance = 800;
          target = {
            x: obj.x + (dx / dist) * retreatDistance,
            y: obj.y + (dy / dist) * retreatDistance
          };
          this.npcMovement.setNPCTarget(obj, target);
          
          // Добавляем команду отступления с высоким приоритетом
          this.npcStateManager.addMovementCommand(
            obj, 'move_to', 
            target, 
            undefined, 
            MovementPriority.EMERGENCY_FLEE, 
            'combat_manager_retreat'
          );
        } else {
          // Выбор цели: сначала пробуем новую стабильную систему, затем fallback к старой
          let best: any = null;
          const current = (t.intent?.type === 'attack') ? t.intent.target : null;
          
          // Пробуем новую систему выбора цели
          const radar = this.getRadarRangeFor(t.obj);
          const candidates = this.targets
            .filter(o => o.obj !== obj && o.obj.active)
            .filter(o => {
              const rel = this.getRelation(t.faction, o.faction, t.overrides?.factions);
              if (rel !== 'confrontation') return false;
              const d = Phaser.Math.Distance.Between(t.obj.x, t.obj.y, o.obj.x, o.obj.y);
              return d <= radar;
            })
            .map(o => o.obj);
            
          // КРИТИЧНО: Добавляем игрока в кандидаты если отношения враждебные
          const playerRelation = this.getRelation(t.faction, 'player', t.overrides?.factions);
          const shouldIncludePlayer = playerRelation === 'confrontation' && this.ship && this.ship.active &&
            Phaser.Math.Distance.Between(t.obj.x, t.obj.y, this.ship.x, this.ship.y) <= this.getRadarRangeFor(t.obj);
          
          if (shouldIncludePlayer && !candidates.includes(this.ship)) {
            candidates.push(this.ship);
          }
            
          // ОТЛАДКА: проверяем включен ли игрок в кандидаты
          // Debug logging disabled
          // if (process.env.NODE_ENV === 'development') {
          //   const includesPlayer = candidates.includes(this.ship);
          //   console.log(`[Candidates] ${t.shipId} #${(obj as any).__uniqueId} candidate check`, {
          //     totalCandidates: candidates.length,
          //     includesPlayer,
          //     shouldIncludePlayer,
          //     playerRelation,
          //     faction: t.faction,
          //     shipIsActive: this.ship?.active,
          //     candidateIds: candidates.map(c => (c === this.ship ? 'PLAYER' : (c as any).__uniqueId))
          //   });
          // }
            
          const stateContext = this.npcStateManager.getContext(obj);
          
          if (stateContext && candidates.length > 0) {
            // Используем ТОЛЬКО новую стабильную систему выбора цели
            best = this.npcStateManager.selectStableTarget(stateContext, candidates);
            
            if (process.env.NODE_ENV === 'development') {
              const bestId = !best ? 'null' : 
                           best === this.ship ? 'PLAYER' : 
                           `#${(best as any).__uniqueId || 'UNK'}`;
              const currentId = !current ? 'none' :
                              current === this.ship ? 'PLAYER' :
                              `#${(current as any).__uniqueId || 'UNK'}`;
              

            }
          } else if (process.env.NODE_ENV === 'development') {
            console.warn(`[TargetSelection] ${t.shipId} #${(obj as any).__uniqueId} NO CONTEXT - NPC not registered!`, {
              hasContext: !!stateContext,
              candidatesCount: candidates.length
            });
          }
          
          // КРИТИЧНО: проверяем что best это валидная цель
          if (best && best !== current && best.active && !best.destroyed) {
            // Отладочная информация для всех кораблей в dev режиме
            if (process.env.NODE_ENV === 'development') {
              try {
                const now = this.scene.time.now;
                const lastLog = this.lastPirateLogMs.get(obj) ?? 0;
                if (now - lastLog > 500) { // 500ms между логами для всех
                  const bestId = best === this.ship ? 'PLAYER' : `#${(best as any).__uniqueId || 'UNK'}`;
                  const currentId = current === this.ship ? 'PLAYER' : 
                                  current ? `#${(current as any).__uniqueId || 'UNK'}` : 'none';
                  
                  console.log(`[AI] ${t.shipId || 'Unknown'} #${(obj as any).__uniqueId} target switch`, {
                    faction: t.faction,
                    from: currentId,
                    to: bestId,
                    system: stateContext ? 'new' : 'legacy',
                    hp: `${t.hp}/${t.hpMax} (${((t.hp/t.hpMax)*100).toFixed(0)}%)`,
                    aggressionLevel: stateContext ? (stateContext.aggression.level * 100).toFixed(0) + '%' : 'n/a'
                  });
                  this.lastPirateLogMs.set(obj, now);
                }
              } catch {}
            }
            targetObj = best;
          }
          
          // КРИТИЧНО: Устанавливаем intent только если цель валидна
          // Профиль nonCombat запрещает установку атаки
          const combatProfile = t.combatAI ? this.config.combatAI?.profiles?.[t.combatAI] : undefined;
          const isNonCombat = !!combatProfile?.nonCombat;
          if (!isNonCombat && targetObj && targetObj.active && !targetObj.destroyed) {
            const wasAttacking = t.intent?.type === 'attack';
            const oldTarget = t.intent?.target;
            t.intent = { type: 'attack', target: targetObj };
            
            // Отладочная информация об изменении intent
            if (process.env.NODE_ENV === 'development' && (!wasAttacking || oldTarget !== targetObj)) {
              const targetName = targetObj === this.ship ? 'PLAYER' : `#${(targetObj as any).__uniqueId}`;
              console.log(`[AI] ${t.shipId} #${(t.obj as any).__uniqueId} intent -> ATTACK ${targetName}`, {
                wasAttacking,
                targetChanged: oldTarget !== targetObj,
                hp: `${t.hp}/${t.hpMax}`
              });
            }
          } else {
            // Если цель невалидна - сбрасываем intent
            if (t.intent?.type === 'attack') {
              if (process.env.NODE_ENV === 'development') {
                console.log(`[AI] ${t.shipId} #${(t.obj as any).__uniqueId} CLEARING INVALID TARGET`, {
                  hadTarget: !!targetObj,
                  targetActive: targetObj?.active,
                  targetDestroyed: targetObj?.destroyed
                });
              }
              t.intent = null;
            }
          }
          
          // Двигаемся к цели только если intent установлен корректно
          if (!isNonCombat && t.intent?.type === 'attack' && t.intent.target && t.intent.target.active && !t.intent.target.destroyed) {
            // Атакуем: по умолчанию орбита 500, если профиль не переопределяет
            const atkProfile = t.combatAI ? this.config.combatAI?.profiles?.[t.combatAI] : undefined;
            const atkMode = (atkProfile?.movementMode as any) ?? 'orbit';
            const atkDist = atkProfile?.movementDistance ?? 500;
            this.npcMovement.setNPCMode(obj, atkMode, atkDist);
            this.npcMovement.setNPCTarget(obj, { x: t.intent.target.x, y: t.intent.target.y, targetObject: t.intent.target });
            
            // Также добавляем команду в новую систему приоритетов
            this.npcStateManager.addMovementCommand(
              obj, atkMode, 
              { x: t.intent.target.x, y: t.intent.target.y, targetObject: t.intent.target }, 
              atkDist, 
              MovementPriority.COMBAT, 
              'combat_manager_attack'
            );
          }
        }
      } else if (t.intent?.type === 'flee') {
          // Если мы были в состоянии бегства, но угрозы больше нет — логируем завершение.
          if (process.env.NODE_ENV === 'development') {
              const shipId = t.shipId ?? 'unknown_ship';
              const uniqueId = (obj as any).__uniqueId || '';
              console.log(`[Combat AI] ${shipId} #${uniqueId} is no longer fleeing and is returning to normal behavior.`);
          }
          // Возвращаемся к атаке предыдущей цели, если она ещё валидна, иначе нейтральное поведение
          const prev = (t as any).__lastIntentObj;
          if (prev && prev.active) {
            const combatProfile = t.combatAI ? this.config.combatAI?.profiles?.[t.combatAI] : undefined;
            const isNonCombat = !!combatProfile?.nonCombat;
            if (!isNonCombat) {
              t.intent = { type: 'attack', target: prev };
              this.npcMovement.setNPCTarget(obj, { x: prev.x, y: prev.y, targetObject: prev });
            } else {
              t.intent = null;
            }
            
            if (process.env.NODE_ENV === 'development') {
              const targetName = prev === this.ship ? 'PLAYER' : `#${(prev as any).__uniqueId}`;

            }
          } else {
            const hadIntent = !!t.intent;
            t.intent = null;
            
            if (process.env.NODE_ENV === 'development' && hadIntent) {

            }
          }
          // Сбросить патрульную цель, чтобы нейтральная логика задала новую и корабль не «зависал»
          try { (obj as any).__targetPatrol = null; } catch {}
      } else {
        // Нет валидной цели - очищаем intent если он был
        if (t.intent) {
          if (process.env.NODE_ENV === 'development') {
            console.log(`[AI] ${t.shipId} #${(obj as any).__uniqueId} no valid target, clearing intent`, {
              hadIntent: t.intent.type,
              targetStillExists: !!t.intent.target,
              targetActive: t.intent.target?.active
            });
          }
          t.intent = null;
          
          // Очищаем в новой системе тоже
          const context = this.npcStateManager.getContext(obj);
          if (context) {
            context.targetStabilization.currentTarget = null;
            context.targetStabilization.targetScore = 0;
          }
        }
        // Немедленный выход из боевого режима: нет целей в радиусе радара
        const radar = this.getRadarRangeFor(t.obj);
        const anyHostileInRadar = this.targets.some(o => {
          if (o === t) return false;
          if (!o.obj?.active) return false;
          const d = Phaser.Math.Distance.Between(t.obj.x, t.obj.y, o.obj.x, o.obj.y);
          if (d > radar) return false;
          const rel = this.getRelation(t.faction, o.faction, t.overrides?.factions);
          return rel === 'confrontation';
        });
        if (!anyHostileInRadar) {
          delete (t as any).__fleeDir;
          delete (t as any).__fleeDirTime;
        }
      }
      
      // Ограничиваем движение границами системы
      const sz = this.config.system?.size;
      if (sz) {
        const mx = Math.max(0, sz.width * 0.2);
        const my = Math.max(0, sz.height * 0.2);
        const maxX = Math.max(mx, sz.width - mx);
        const maxY = Math.max(my, sz.height - my);
        obj.x = Phaser.Math.Clamp(obj.x, mx, maxX);
        obj.y = Phaser.Math.Clamp(obj.y, my, maxY);
      }
      
      // update HP bar follow
      this.updateHpBar(t as any);
    }
  }

  private fireWeapon(_slot: string, w: any, target: any, shooter: any) {
    const slotIndex = 0; // слот уже разрешен на уровне вызова, здесь защищаемся
    const fallbackOffset = { x: 0, y: 0 };
    const mo = this.resolveMuzzleOffset(shooter, slotIndex, fallbackOffset);
    const muzzle = this.getMuzzleWorldPositionFor(shooter, mo);
    const aim = this.getAimedTargetPoint(shooter, target, w);
    const angle = Math.atan2(aim.y - muzzle.y, aim.x - muzzle.x);
    // projectile visual
    let proj: Phaser.GameObjects.GameObject & { x: number; y: number };
    if (w.projectile.shape === 'rect') {
      proj = this.scene.add.rectangle(muzzle.x, muzzle.y, w.projectile.width, w.projectile.height, Number((w.projectile.color as string).replace('#','0x'))).setDepth(0.8) as any;
      (proj as any).setRotation?.(angle);
    } else {
      const r = w.projectile.radius ?? 4;
      proj = this.scene.add.circle(muzzle.x, muzzle.y, r, Number((w.projectile.color as string).replace('#','0x'))).setDepth(0.8) as any;
    }
    (proj as any).__combat = { damage: w.damage, target };
    // under shooter
    (proj as any).setDepth?.(((shooter as any).depth ?? 1) - 0.1);
    
    // Регистрируем снаряд в fog of war как динамический объект
    if (this.fogOfWar) {
      this.fogOfWar.registerDynamicObject(proj, DynamicObjectType.PROJECTILE);
    }

    const speed = w.projectileSpeed;
    
    // Рассчитываем время жизни снаряда: для homing приоритет фиксированному; иначе дистанция/скорость
    const lifetimeMs = Math.max(1,
      (w?.type === 'homing' && w?.homing?.lifetimeMs)
        ? w.homing.lifetimeMs
        : ((w.range / Math.max(1, speed)) * 1000 + 50)
    );
    // Capture shooter's faction once for friendly-fire filtering
    const shooterEntry = this.targets.find(t => t.obj === shooter);
    const shooterFaction = shooterEntry?.faction ?? (shooter === this.ship ? 'player' : undefined);
    const shooterOverrides = (shooterEntry as any)?.overrides?.factions;

    // Общая функция проверки столкновений и нанесения урона/эффектов
    const tryCollisions = () => {
      // collision simple distance check
      if (!target || !target.active) {
        return 'target_lost' as const;
      }
      // Check collisions with any other valid enemy target along the path
      for (let i = 0; i < this.targets.length; i++) {
        const rec = this.targets[i];
        const obj = rec.obj as any;
        if (!obj || !obj.active) continue;
        if (obj === shooter) continue;
        // Пропускаем основную целевую точку здесь — она обрабатывается ниже отдельной веткой,
        // чтобы не потерять урон по нейтральной цели из-за фильтра союзников
        if (obj === target) continue;
        const st = obj.__state;
        const invulnerable = st === 'docking' || st === 'docked' || st === 'undocking' || (typeof obj.alpha === 'number' && obj.alpha <= 0.05) || obj.visible === false;
        if (invulnerable) continue;
        const hitR = this.getEffectiveRadius(obj);
        const dAny = Phaser.Math.Distance.Between((proj as any).x, (proj as any).y, obj.x, obj.y);
        if (dAny <= hitR) {
          // Relation filter: projectiles pass through non-hostile targets
          const victimFaction = rec.faction;
          const relSV = this.getRelation(shooterFaction, victimFaction, shooterOverrides);
          const relVS = this.getRelation(victimFaction, shooterFaction, rec.overrides?.factions);
          const hostile = (relSV === 'confrontation') || (relVS === 'confrontation');
          if (hostile) {
            this.applyDamage(obj, w.damage, shooter);
            this.spawnHitEffect((proj as any).x, (proj as any).y, w);
            return 'hit' as const;
          }
        }
      }
      const hitDist = this.getEffectiveRadius(target as any);
      const d = Phaser.Math.Distance.Between((proj as any).x, (proj as any).y, target.x, target.y);
      if (d <= hitDist) {
        // Пропускаем визуальные эффекты и урон, если цель в доке/андоке или невидима
        const st = (target as any).__state;
        const invulnerable = st === 'docking' || st === 'docked' || st === 'undocking' || (typeof (target as any).alpha === 'number' && (target as any).alpha <= 0.05) || (target as any).visible === false;
        if (!invulnerable) {
          // Фильтр отношений учитывает overrides с обеих сторон: дружественные цели пропускаем
          const targetEntry = this.targets.find(t => t.obj === target);
          const targetFaction = targetEntry?.faction ?? (target === this.ship ? 'player' : undefined);
          const targetOverrides = (targetEntry as any)?.overrides?.factions;
          const relSV = this.getRelation(shooterFaction, targetFaction, shooterOverrides);
          const relVS = this.getRelation(targetFaction, shooterFaction, targetOverrides);
          const hostile = (relSV === 'confrontation') || (relVS === 'confrontation');
          if (hostile) {
            this.applyDamage(target, w.damage, shooter);
            this.spawnHitEffect((proj as any).x, (proj as any).y, w);
            return 'hit' as const;
          }
        } else {
          // цель в состоянии дока — не принимаем урон, но снаряд уничтожаем
          return 'expire' as const;
        }
      }
      return 'none' as const;
    };

    // HOMING: управляемый снаряд со временем жизни
    if ((w.type ?? 'single') === 'homing') {
      // Цель для наведения с учетом точности оружия/корабля; обновление не чаще чем раз в 300мс
      const adjustIntervalMs = Math.max(50, this.config.weaponTypes?.homing?.adjustIntervalMs ?? 300);
      let desiredAngleCached = angle;
      let lastDesiredUpdate = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
      const recomputeDesired = () => {
        try {
          // Получаем прицельную точку с учетом общей логики точности
          const ap = this.getAimedTargetPoint(shooter, target, w) || { x: (target?.x ?? aim.x), y: (target?.y ?? aim.y) };
          // Нелинейное сглаживание точности для homing
          let wAcc = typeof w?.accuracy === 'number' ? Phaser.Math.Clamp(w.accuracy, 0, 1) : 1;
          let sAcc = 1;
          const entry = this.targets.find(t => t.obj === shooter);
          if (shooter === this.ship) {
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
          const effAcc = Math.pow(baseAcc, exp); // 0..1, выше — точнее
          // уменьшение влияния неточности
          const influence = Math.max(0, Math.min(1, w?.homing?.accuracyInfluenceMultiplier ?? this.config.weaponTypes?.homing?.accuracyInfluenceMultiplier ?? 0.35));
          const cx = (target?.x ?? ap.x);
          const cy = (target?.y ?? ap.y);
          let aimX = cx + (ap.x - cx) * influence;
          let aimY = cy + (ap.y - cy) * influence;
          // Ограничиваем максимальную угловую ошибку
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
      const reverseLaunch = !!(w.__burstShot === true); // признак выстрела в серии для обратного старта
      // Дополнительный "выброс" сверх 180° и случайность
      const backfireDeg = (w?.homing?.backfireDeg ?? this.config.weaponTypes?.homing?.backfireDeg ?? 0);
      const backfireRand = (w?.homing?.backfireRandomDeg ?? this.config.weaponTypes?.homing?.backfireRandomDeg ?? 0);
      const backfireJitter = reverseLaunch ? ((backfireDeg + (Math.random()*2 - 1) * backfireRand) * Math.PI/180) : 0;
      // Постоянное случайное смещение траектории на снаряд
      const biasDeg = (w?.homing?.biasDeg ?? this.config.weaponTypes?.homing?.biasDeg ?? 0);
      const biasRad = (biasDeg !== 0) ? ((Math.random()*2 - 1) * Math.abs(biasDeg) * Math.PI/180) : 0;
      let currentAngle = (reverseLaunch ? angle + Math.PI + backfireJitter : angle) + biasRad;
      (proj as any).setRotation?.(currentAngle);
      const turnDegPerSec = (typeof w?.homing?.turnSpeedDegPerSec === 'number' && w.homing.turnSpeedDegPerSec > 0) ? w.homing.turnSpeedDegPerSec : (this.config.weaponTypes?.homing?.turnSpeedDegPerSec ?? 0);
      const maxTurnRadPerMs = (turnDegPerSec > 0)
        ? (turnDegPerSec * Math.PI / 180) / 1000
        : Infinity;
      // Параметры периодического шума направления
      const jitterAmp = Math.max(0, (w?.homing?.jitterDeg ?? this.config.weaponTypes?.homing?.jitterDeg ?? 0)) * Math.PI/180;
      const jitterHz = Math.max(0, (w?.homing?.jitterHz ?? this.config.weaponTypes?.homing?.jitterHz ?? 0));
      let jitterPhase = Math.random() * Math.PI * 2;

      const onUpdateHoming = (_t: number, dt: number) => {
        // Проверяем паузу боевых систем
        if (this.pauseManager?.isSystemPausable('combat') && this.pauseManager?.getPaused()) {
          return;
        }

        // Быстрое скрытие снаряда вне радара игрока
        if (this.fogOfWar) {
          try {
            const visible = this.fogOfWar.isObjectVisible(proj as any);
            (proj as any).setVisible?.(visible);
          } catch {}
        }

        // Поворот к цели с ограничением скорости поворота
        const nowMs = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
        if (nowMs - lastDesiredUpdate >= adjustIntervalMs) {
          recomputeDesired();
          lastDesiredUpdate = nowMs;
        }
        let desired = desiredAngleCached;
        // Периодический шум
        if (jitterAmp > 0 && jitterHz > 0) {
          jitterPhase += (Math.PI * 2) * jitterHz * (dt/1000);
          desired += Math.sin(jitterPhase) * jitterAmp;
        }
        let delta = Phaser.Math.Angle.Wrap(desired - currentAngle);
        const maxStep = maxTurnRadPerMs === Infinity ? Math.abs(delta) : (maxTurnRadPerMs * dt);
        delta = Phaser.Math.Clamp(delta, -maxStep, maxStep);
        currentAngle = Phaser.Math.Angle.Wrap(currentAngle + delta);
        (proj as any).setRotation?.(currentAngle);

        // Перемещение с постоянной скоростью
        const vxH = Math.cos(currentAngle) * speed;
        const vyH = Math.sin(currentAngle) * speed;
        (proj as any).x += vxH * (dt/1000);
        (proj as any).y += vyH * (dt/1000);

        const col = tryCollisions();
        if (col === 'hit' || col === 'target_lost' || col === 'expire') {
          this.scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdateHoming);
          // Дерегистрируем снаряд из fog of war
          if (this.fogOfWar) {
            this.fogOfWar.unregisterObject(proj);
          }
          // Взрыв только визуально при истечении/потере цели
          if (col !== 'hit' && w.hitEffect) {
            this.spawnHitEffect((proj as any).x, (proj as any).y, w);
          }
          (proj as any).destroy?.();
        }
      };
      this.scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdateHoming);
      // Таймер жизни: по окончании — взрыв в текущей точке
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

      // Сигнализируем UI о выстреле игрока для мигания иконки
      if (shooter === this.ship) {
        try { this.scene.events.emit('player-weapon-fired', _slot, target); } catch {}
      }
      return;
    }

    // Прямая баллистика (single/burst)
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;

    const onUpdate = (_t: number, dt: number) => {
      // Проверяем паузу боевых систем
      if (this.pauseManager?.isSystemPausable('combat') && this.pauseManager?.getPaused()) {
        return;
      }
      
      // Быстрое скрытие снаряда вне радара игрока (не ждём батч-апдейт FoW)
      if (this.fogOfWar) {
        try {
          const visible = this.fogOfWar.isObjectVisible(proj as any);
          (proj as any).setVisible?.(visible);
        } catch {}
      }
      (proj as any).x += vx * (dt/1000);
      (proj as any).y += vy * (dt/1000);
      const col = tryCollisions();
      if (col === 'hit' || col === 'target_lost' || col === 'expire') {
        this.scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
        if (this.fogOfWar) { this.fogOfWar.unregisterObject(proj); }
        (proj as any).destroy?.();
      }
    };
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
    // Создаем таймер жизни снаряда (без немедленной постановки на паузу)
    const projId = `projectile_${(proj as any)._uid ?? Phaser.Utils.String.UUID()}`;
    const lifetimeTimer = this.scene.time.delayedCall(lifetimeMs, () => {
      this.scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
      // Дерегистрируем снаряд из fog of war при истечении времени жизни
      if (this.fogOfWar) {
        this.fogOfWar.unregisterObject(proj);
      }
      (proj as any).destroy?.();
      // Снимаем регистрацию таймера
      try { this.pauseManager?.unregisterTimer?.(projId); } catch {}
    });
    // Регистрируем таймер в PauseManager, чтобы он замораживался на паузе
    try { this.pauseManager?.registerTimer?.(projId, lifetimeTimer); } catch {}

    // Сигнализируем UI о выстреле игрока для мигания иконки
    if (shooter === this.ship) {
      try { this.scene.events.emit('player-weapon-fired', _slot, target); } catch {}
    }
  }

  private fireBurstWeapon(slot: string, w: any, target: any, shooter: any) {
    const count = Math.max(1, w?.burst?.count ?? 3);
    const delayMs = Math.max(1, w?.burst?.delayMs ?? 80);
    for (let k = 0; k < count; k++) {
      const burstId = `burst_${slot}_${k}_${Date.now()}`;
      const burstTimer = this.scene.time.delayedCall(k * delayMs, () => {
        // Проверяем паузу боевых систем
        if (this.pauseManager?.isSystemPausable('combat') && this.pauseManager?.getPaused()) {
          return;
        }
        
        if (!shooter?.active || !target?.active) return;
        const muzzleOffset = this.resolveMuzzleOffset(shooter, 0, { x: 0, y: 0 });
        // Для homing серии отмечаем обратный старт при создании снаряда
        const w2 = { ...w, muzzleOffset, __burstShot: (w.type === 'homing') ? true : undefined };
        this.fireWeapon(slot, w2, target, shooter);
        try { this.pauseManager?.unregisterTimer?.(burstId); } catch {}
      });
      try { this.pauseManager?.registerTimer?.(burstId, burstTimer); } catch {}

    }
  }

  private getMuzzleWorldPositionFor(shooter: any, offset: { x: number; y: number }) {
    // offset is relative to shooter local space where +Y is down in Phaser, shooter rotated
    const rot = shooter.rotation;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const lx = offset.x;
    const ly = offset.y;
    const wx = shooter.x + lx * cos - ly * sin;
    const wy = shooter.y + lx * sin + ly * cos;
    return { x: wx, y: wy };
  }

  private resolveMuzzleOffset(shooter: any, slotIndex: number, defaultOffset: { x: number; y: number }) {
    // Player
    if (shooter === this.ship) {
      const shipId = this.config.player?.shipId ?? this.config.ships.current;
      const def = this.config.ships.defs[shipId];
      const off = def?.combat?.slots?.[slotIndex]?.offset;
      if (off) return off;
    }
    // Enemy -> try enemy ship slots, fallback to player's layout
    const entry = this.targets.find(t => t.obj === shooter);
    const eShipId = entry?.shipId;
    if (eShipId) {
      const offE = this.config.ships.defs[eShipId]?.combat?.slots?.[slotIndex]?.offset;
      if (offE) return offE;
    }
    const offP = this.config.ships.defs[this.config.player?.shipId ?? this.config.ships.current]?.combat?.slots?.[slotIndex]?.offset;
    return offP ?? defaultOffset;
  }

  private autoFire(shooter: any, target: any) {
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
        // NPC стреляют только если не на паузе
        if (nowMs >= readyAt && dist <= w.range) {
          const isPaused = this.pauseManager?.isSystemPausable('combat') && this.pauseManager?.getPaused();
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
        // NPC стреляют только если не на паузе
        const isPaused = this.pauseManager?.isSystemPausable('combat') && this.pauseManager?.getPaused();
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

  private getShooterTimes(shooter: any): Record<string, number> {
    let times = this.lastFireTimesByShooter.get(shooter);
    if (!times) { times = {}; this.lastFireTimesByShooter.set(shooter, times); }
    return times;
  }

  private applyDamage(target: any, damage: number, attacker?: any) {
    // Инвульнера во время докинга/дока/андокинга
    const state = (target as any)?.__state;
    if (state === 'docking' || state === 'docked' || state === 'undocking') {
      return;
    }
    const t = this.targets.find(tt => tt.obj === target);
    if (t) {
      t.hp -= damage;
      if (t.hp < 0) t.hp = 0;
      this.updateHpBar(t);
      this.floatDamageText(target.x, target.y - 70, damage);
      
      // ОТЛАДКА: логируем все атаки ПЕРЕД registerDamage
      if (process.env.NODE_ENV === 'development') {
        const targetId = (target as any).__uniqueId || 'unknown';
        const attackerId = attacker ? (attacker as any).__uniqueId || 'ATTACKER_CANDIDATE' : 'unknown';
        const isPlayerAttacker = attacker === this.ship || 
                                (attacker as any)?.texture?.key === 'ship_alpha' ||
                                (attacker as any)?.texture?.key === 'ship_alpha_public';
        
        console.log(`[ApplyDamage] ${targetId} ← ${damage} from ${attackerId}`, {
          hasAttacker: !!attacker,
          isPlayerAttacker,
          attackerIsShip: attacker === this.ship,
          attackerTexture: (attacker as any)?.texture?.key,
          shipTexture: (this.ship as any)?.texture?.key,
          attackerType: attacker?.constructor?.name
        });
      }
      
      // Регистрируем урон в новой системе состояний
      this.npcStateManager.registerDamage(target, damage, attacker);
      // log damage sources for target prioritization
      if (!t.damageLog) t.damageLog = { firstAttacker: undefined, totalDamageBySource: new Map(), lastDamageTimeBySource: new Map() };
      if (attacker) {
        if (!t.damageLog.firstAttacker) t.damageLog.firstAttacker = attacker;
        const mapA = t.damageLog.totalDamageBySource as Map<any, number>;
        const mapT = t.damageLog.lastDamageTimeBySource as Map<any, number>;
        const prev = mapA.get(attacker) ?? 0;
        mapA.set(attacker, prev + damage);
        const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
        mapT.set(attacker, now);
      }
      // Реакция на урон издалека: проверяем профиль outdistance_attack
      if (attacker) {
        const npcRadarRange = this.getRadarRangeFor(t.obj);
        const ax = (attacker as any).x ?? t.obj.x;
        const ay = (attacker as any).y ?? t.obj.y;
        const distToAttacker = Phaser.Math.Distance.Between(t.obj.x, t.obj.y, ax, ay);
        
        if (distToAttacker > npcRadarRange) {
          // Проверяем настройку outdistance_attack из combatAI профиля
          const combatProfile = t.combatAI ? this.config.combatAI?.profiles?.[t.combatAI] : undefined;
          const outdistanceAction = combatProfile?.outdistance_attack ?? 'flee'; // default: flee
          
          if (outdistanceAction === 'target') {
            // Атакуем дальнюю цель
            t.intent = { type: 'attack', target: attacker };
            const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
            (t as any).forceIntentUntil = now + 4000; // 4s удержания реакции
            
            if (process.env.NODE_ENV === 'development') {
              console.log(`[OutdistanceAttack] ${t.shipId} #${(t.obj as any).__uniqueId} attacking distant target`, {
                distance: distToAttacker.toFixed(0),
                radarRange: npcRadarRange,
                action: 'target'
              });
            }
          } else if (outdistanceAction === 'flee') {
            // Убегаем от дальней цели
            t.intent = { type: 'flee', target: attacker };
            const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
            (t as any).forceIntentUntil = now + 4000; // 4s удержания реакции
            
            if (process.env.NODE_ENV === 'development') {
              console.log(`[OutdistanceAttack] ${t.shipId} #${(t.obj as any).__uniqueId} fleeing from distant target`, {
                distance: distToAttacker.toFixed(0),
                radarRange: npcRadarRange,
                action: 'flee'
              });
            }
          }
        } else {
          // В радиусе радара: немедленно переходим в атаку на атакующего (временный враг)
          t.intent = { type: 'attack', target: attacker };
          // Удерживаем реакцию некоторое время, чтобы sensors не сбросил раньше
          const now2 = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
          (t as any).forceIntentUntil = now2 + 4000; // 4s
          // Подстрахуем новую систему приоритетов движения
          this.npcStateManager.addMovementCommand(
            t.obj as any,
            'pursue',
            { x: (attacker as any).x, y: (attacker as any).y, targetObject: attacker },
            undefined,
            MovementPriority.COMBAT,
            'combat_manager_reactive_aggro'
          );
          // без лишнего спама в проде
        }
        // Проставляем конфронтацию к фракции атакера
        (t as any).overrides = (t as any).overrides ?? {};
        (t as any).overrides.factions = (t as any).overrides.factions ?? {};
        if (attacker === this.ship) {
          (t as any).overrides.factions['player'] = 'confrontation';
        } else {
          const srcEntry = this.targets.find(e => e.obj === attacker);
          const srcFaction = srcEntry?.faction;
          if (srcFaction) (t as any).overrides.factions[srcFaction] = 'confrontation';
        }
      }
      if (t.hp <= 0) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Combat] Destroying NPC ${t.shipId} #${(target as any).__uniqueId}`, {
            wasTargetOf: this.targets.filter(tt => tt.intent?.target === target).map(tt => `${tt.shipId}#${(tt.obj as any).__uniqueId}`)
          });
        }
        
        // КРИТИЧНО: Сначала очищаем все ссылки на умирающий объект
        for (const otherTarget of this.targets) {
          if (otherTarget.intent?.target === target) {
            if (process.env.NODE_ENV === 'development') {
              console.log(`[Combat] Clearing intent for ${otherTarget.shipId} #${(otherTarget.obj as any).__uniqueId} targeting dead ${t.shipId}`);
            }
            otherTarget.intent = null;
            // Очищаем в новой системе тоже
            const context = this.npcStateManager.getContext(otherTarget.obj);
            if (context) {
              context.targetStabilization.currentTarget = null;
              context.targetStabilization.targetScore = 0;
            }
          }
          
          // Очищаем из damage log
          if (otherTarget.damageLog) {
            if (otherTarget.damageLog.totalDamageBySource?.has(target)) {
              otherTarget.damageLog.totalDamageBySource.delete(target);
            }
            if (otherTarget.damageLog.lastDamageTimeBySource?.has(target)) {
              otherTarget.damageLog.lastDamageTimeBySource.delete(target);
            }
            if (otherTarget.damageLog.firstAttacker === target) {
              otherTarget.damageLog.firstAttacker = undefined;
            }
          }
          
          // Очищаем из новой системы агрессии
          const context = this.npcStateManager.getContext(otherTarget.obj);
          if (context) {
            context.aggression.sources.delete(target);
          }
        }
        
        // Полное удаление NPC: объект, HP элементы, имя, боевые кольца, назначения
        try { (t.obj as any).destroy?.(); } catch {}
        try { t.hpBarBg.destroy(); } catch {}
        try { t.hpBarFill.destroy(); } catch {}
        try { t.nameLabel?.destroy(); } catch {}
        // удалить боевое кольцо если было
        const ring = this.combatRings.get(target);
        if (ring) { try { ring.destroy(); } catch {} this.combatRings.delete(target); }
        // снять информационную цель при необходимости
        if (this.selectedTarget === target) this.clearSelection();
        // очистить назначения слотов на этот таргет и уведомить UI
        const removedSlots: string[] = [];
        for (const [slot, tgt] of this.playerWeaponTargets.entries()) {
          if (tgt === target) { this.playerWeaponTargets.delete(slot); removedSlots.push(slot); }
        }
        if (removedSlots.length) {
          // Отправляем событие weapon-out-of-range для скрытия надписи перед удалением назначений
          for (const slot of removedSlots) {
            try { this.scene.events.emit('weapon-out-of-range', slot, false); } catch {}
          }
          try { this.scene.events.emit('player-weapon-target-cleared', target, removedSlots); } catch {}
        }
        // убираем из системы движения NPC
        this.npcMovement.unregisterNPC(target);
        // убираем из системы состояний NPC
        this.npcStateManager.unregisterNPC(target);
        // дерегистрируем из fog of war
        if (this.fogOfWar) {
          this.fogOfWar.unregisterObject(target);
        }
        // вычистить из массива целей
        this.targets = this.targets.filter(rec => rec.obj !== target);
        return;
      }
      return;
    }
    // if target is player
    if ((target as any) === (this.ship as any)) {
      const star = this.scene as any;
      if (star?.applyDamageToPlayer) {
        star.applyDamageToPlayer(damage);
      }
    }
  }

  private updateHpBar(t: { obj: any; hp: number; hpMax: number; hpBarBg: Phaser.GameObjects.Rectangle; hpBarFill: Phaser.GameObjects.Rectangle; nameLabel?: Phaser.GameObjects.Text }) {
    const pct = Phaser.Math.Clamp(t.hp / Math.max(1, t.hpMax), 0, 1);
    const barW = 128;
    t.hpBarFill.width = barW * pct;
    const above = (this.getEffectiveRadius(t.obj as any) + 16);
    t.hpBarBg.setPosition(t.obj.x - barW/2, t.obj.y - above);
    t.hpBarFill.setPosition(t.obj.x - barW/2, t.obj.y - above);
    if (t.nameLabel) {
      t.nameLabel.setPosition(t.obj.x, t.hpBarBg.y - 4);
    }
  }

  private getEffectiveRadius(obj: any): number {
    if (typeof obj.displayWidth === 'number' && typeof obj.displayHeight === 'number') {
      return Math.max(obj.displayWidth, obj.displayHeight) * 0.5;
    }
    if (typeof obj.radius === 'number') return obj.radius;
    const w = (typeof obj.width === 'number' ? obj.width : 128);
    const h = (typeof obj.height === 'number' ? obj.height : 128);
    return Math.max(w, h) * 0.5;
  }

  private getRadarRangeFor(obj: any): number {
    const entry = this.targets.find(t => t.obj === obj);
    const shipId = entry?.shipId ?? (obj === this.ship ? (this.config.player?.shipId ?? this.config.ships.current) : undefined);
    const def = shipId ? this.config.ships.defs[shipId] : undefined;
    const overrideR = (entry as any)?.radarRange;
    if (typeof overrideR === 'number') return overrideR;
    const r = (def as any)?.sensors?.radar_range ?? def?.combat?.sensorRadius ?? 800;
    return r;
  }

  private getRelation(ofFaction: string | undefined, otherFaction: string | undefined, overrides?: Record<string, 'ally'|'neutral'|'confrontation'|'cautious'>): 'ally'|'neutral'|'confrontation'|'cautious' {
    if (!ofFaction || !otherFaction) return 'neutral';
    if (overrides && overrides[otherFaction]) return overrides[otherFaction];
    const rel = this.config.factions?.factions?.[ofFaction]?.relations?.[otherFaction];
    return (rel ?? 'neutral') as any;
  }

  private updateSensors(deltaMs: number) {
    for (const t of this.targets) {
      // Проверяем состояние в новой системе
      const npcState = this.npcStateManager.getState(t.obj);
      const isInCombat = this.npcStateManager.isInCombat(t.obj);
      const context = this.npcStateManager.getContext(t.obj);
      
      // ВАЖНО: НЕ переопределяем intent для кораблей в боевом состоянии
      // updateEnemiesAI уже управляет intent, sensors логика только для обнаружения
      if (isInCombat && context) {
        // Просто пропускаем sensors логику, updateEnemiesAI уже управляет intent
        if (process.env.NODE_ENV === 'development' && Math.random() < 0.01) { // 1% логов
          console.log(`[Sensors] Skipping sensors for combat NPC ${t.shipId} #${(t.obj as any).__uniqueId}`, {
            currentIntent: t.intent?.type,
            aggressionLevel: (context.aggression.level * 100).toFixed(0) + '%'
          });
        }
        continue;
      }
      
      const forcedUntil = (t as any).forceIntentUntil;
      const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
      if (forcedUntil && now < forcedUntil) {
        if (!t.intent?.target?.active) {
            t.intent = null;
            (t as any).forceIntentUntil = 0;
        }
        continue;
      }
      if (forcedUntil) {
          (t as any).forceIntentUntil = 0;
      }
      
      // Проверяем агрессию для плавного перехода
      if (context && context.aggression.level < 0.3) {
        // Низкая агрессия - возможен переход к мирному поведению
        t.intent = null;
      } else {
        // Стандартная sensors логика для не-боевых состояний
        t.intent = null;
      }
      const myFaction = t.faction;
      const radar = this.getRadarRangeFor(t.obj);
      const sensed: any[] = [];
      for (const o of this.targets) {
        if (o === t) continue;
        const objAny: any = o.obj;
        // пропускаем цели в состоянии докинга/дока
        const st = objAny?.__state;
        const invisible = (typeof objAny?.alpha === 'number' && objAny.alpha <= 0.05) || objAny?.visible === false;
        if (!objAny?.active) continue;
        if (st === 'docked' || st === 'docking') {
          // авто-сброс назначений игрока на цели, которые начинают док
          this.clearAssignmentsForTarget(objAny);
          continue;
        }
        if (invisible) continue;
        const d = Phaser.Math.Distance.Between(t.obj.x, t.obj.y, objAny.x, objAny.y);
        if (d <= radar) sensed.push(o);
      }
      const playerObj = this.ship as any;
      const dp = Phaser.Math.Distance.Between(t.obj.x, t.obj.y, playerObj.x, playerObj.y);
      const seesPlayer = dp <= radar;
      if (seesPlayer) sensed.push({ obj: playerObj, faction: 'player' });

      const profileKey = t.aiProfileKey;
      const profile = profileKey ? this.config.aiProfiles.profiles[profileKey] : undefined;
      const reactions = profile?.sensors?.react?.onFaction;
      let decided: { type: 'attack'|'flee'|'retreat'; target: any } | null = null;
      // prefer non-pirate targets first to avoid mutual pirate-pirate selection
      const sorted = sensed.sort((a,b) => (a.faction === 'pirate' ? 1 : 0) - (b.faction === 'pirate' ? 1 : 0));
      for (const s of sorted) {
        const rel = this.getRelation(myFaction, s.faction, t.overrides?.factions) as 'ally'|'neutral'|'confrontation'|'cautious';
        let act = reactions?.[rel] ?? 'ignore';
        // Специальное правило: пираты, видя игрока в радиусе СВОЕГО оружия, выбирают retreat вместо attack
        if (t.faction === 'pirate' && s.obj === (this.ship as any) && act === 'attack') {
          try {
            // Определяем макс.радиус оружия этого NPC
            const maxRange = (t.weaponSlots ?? []).reduce((mx, slot) => {
              const def = this.config.weapons?.defs?.[slot];
              return Math.max(mx, def?.range ?? 0);
            }, 0);
            const dToPlayer = Phaser.Math.Distance.Between(t.obj.x, t.obj.y, (this.ship as any).x, (this.ship as any).y);
            if (maxRange > 0 && dToPlayer <= maxRange) {
              act = 'retreat' as any;
            }
          } catch {}
        }
        // пропускаем докованных целей
        if ((s.obj as any)?.__state === 'docked' || (s.obj as any)?.__state === 'docking') continue;
        if (act === 'attack') { (t as any).__fleeMode = undefined; decided = { type: 'attack', target: s.obj }; break; }
        if (act === 'flee')   { (t as any).__fleeMode = 'flee'; decided = { type: 'flee', target: s.obj }; break; }
        if (act === 'retreat'){ (t as any).__fleeMode = 'retreat'; decided = { type: 'retreat', target: s.obj }; break; }
      }
      // If current intent target is invalid (docked/docking/inactive) — clear it
      const curIntent: any = (t as any).intent;
      const curTarget: any = curIntent?.target;
      if (curTarget && (!curTarget.active || curTarget.__state === 'docked' || curTarget.__state === 'docking')) {
        (t as any).intent = null;
        (t as any).__fleeMode = undefined;
      } else {
        (t as any).intent = decided;
      }
      // debug: pirates intents — только при изменении
      if (t.faction === 'pirate') {
        const lastType = (t as any).__lastIntentType;
        const lastObj = (t as any).__lastIntentObj;
        const changed = (!!decided?.type !== !!lastType) || (decided?.type !== lastType) || (decided?.target !== lastObj);
        if (decided && changed) {
          // try { console.debug('[AI] Pirate intent', decided.type, 'to', decided.target?.x, decided.target?.y); } catch {}
        }
        (t as any).__lastIntentType = decided?.type;
        (t as any).__lastIntentObj = decided?.target ?? null;
      }

      // Улучшенная логика остывания агрессии
      if (!seesPlayer && context) {
        const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
        const timeSinceLastDamage = now - context.aggression.lastDamageTime;
        const timeSinceLastCombat = now - context.aggression.lastCombatTime;
        
        // Сбрасываем враждебность к игроку только если прошло достаточно времени
        // и уровень агрессии низкий
        if (timeSinceLastDamage > 15000 && // 15 сек с последнего урона
            timeSinceLastCombat > 10000 &&  // 10 сек с последнего боя
            context.aggression.level < 0.2) { // очень низкая агрессия
          
          (t as any).overrides = (t as any).overrides ?? {};
          (t as any).overrides.factions = (t as any).overrides.factions ?? {};
          if ((t as any).overrides.factions['player'] === 'confrontation') {
            delete (t as any).overrides.factions['player'];
            
            if (process.env.NODE_ENV === 'development') {
              console.log('[AI] NPC cooled down, clearing player hostility', {
                shipId: t.shipId, id: (t.obj as any).__uniqueId,
                aggressionLevel: context.aggression.level.toFixed(2)
              });
            }
          }
        }
      } else if (!context) {
        // Fallback к старой логике для NPC без нового состояния
        (t as any).overrides = (t as any).overrides ?? {};
        (t as any).overrides.factions = (t as any).overrides.factions ?? {};
        if ((t as any).overrides.factions['player'] === 'confrontation') {
          delete (t as any).overrides.factions['player'];
        }
      }
    }
  }

  /**
   * Итеративный расчет времени перехвата для более точного наведения
   * Особенно важно для прямых углов и больших расстояний
   */
  private calculateInterceptTime(rx: number, ry: number, vx: number, vy: number, projectileSpeed: number): number {
    const maxIterations = 10;
    const tolerance = 0.1;
    
    // Начальная оценка времени
    let t = Math.sqrt(rx * rx + ry * ry) / projectileSpeed;
    
    for (let i = 0; i < maxIterations; i++) {
      // Позиция цели в момент времени t
      const futureX = rx + vx * t;
      const futureY = ry + vy * t;
      
      // Расстояние до будущей позиции цели
      const distanceToFuture = Math.sqrt(futureX * futureX + futureY * futureY);
      
      // Время полета снаряда до этой позиции
      const newT = distanceToFuture / projectileSpeed;
      
      // Проверяем сходимость
      if (Math.abs(newT - t) < tolerance / 1000) {
        return newT;
      }
      
      t = newT;
    }
    
    return t;
  }

  private getAimedTargetPoint(shooter: any, target: any, w: any) {
    // Итоговая точность = точность оружия * модификатор точности корабля
    let weaponAccuracy = typeof w?.accuracy === 'number' ? Phaser.Math.Clamp(w.accuracy, 0, 1) : 1;
    let shipAccuracy = 1.0;
    const entry = this.targets.find(t => t.obj === shooter);
    if (shooter === this.ship) {
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
    

    // Получаем реальную скорость цели из её системы движения
    let vx = 0, vy = 0;
    
    // Проверяем есть ли у цели движение (NPC и player имеют __moveRef)
    const moveRef = (target as any).__moveRef;
    if (moveRef && typeof moveRef.speed === 'number' && typeof moveRef.headingRad === 'number') {
      // Получаем скорость напрямую из MovementManager
      // MovementManager.speed в пикселях/кадр, нужно конвертировать в пикселях/сек
      const speedPerFrame = moveRef.speed;
      const speedPerSecond = speedPerFrame * 60; // предполагаем 60 FPS
      const heading = moveRef.headingRad;
      
      vx = Math.cos(heading) * speedPerSecond;
      vy = Math.sin(heading) * speedPerSecond;
    }
    

    const projectileSpeed = w.projectileSpeed;
    const sx = shooter.x;
    const sy = shooter.y;
    const tx = target.x;
    const ty = target.y;
    const rx = tx - sx;
    const ry = ty - sy;
    const targetSpeed = Math.sqrt(vx * vx + vy * vy);
    const distance = Math.sqrt(rx * rx + ry * ry);
    
    let tHit: number;
    
    // Для неподвижной или очень медленной цели - простой расчет
    if (targetSpeed < 1) {
      tHit = distance / projectileSpeed;
    } else {
      // Используем итеративный метод для более точного расчета
      // Особенно важно для прямых углов и больших расстояний
      tHit = this.calculateInterceptTime(rx, ry, vx, vy, projectileSpeed);
      
      // Для сравнения - старый метод
      const oldMethod = () => {
        const a2 = vx * vx + vy * vy - projectileSpeed * projectileSpeed;
        const b = 2 * (rx * vx + ry * vy);
        const c = rx * rx + ry * ry;
        
        if (Math.abs(a2) < 1e-6) {
          return c / Math.max(1, -b);
        } else {
          const disc = b * b - 4 * a2 * c;
          if (disc < 0) {
            return distance / projectileSpeed;
          } else {
            const t1 = (-b - Math.sqrt(disc)) / (2 * a2);
            const t2 = (-b + Math.sqrt(disc)) / (2 * a2);
            let oldT = Math.min(t1, t2);
            if (oldT < 0) oldT = Math.max(t1, t2);
            if (oldT < 0) oldT = distance / projectileSpeed;
            return oldT;
          }
        }
      };
      
      const oldTHit = oldMethod();
      console.log(`🔍 Time calculation comparison: Old=${oldTHit.toFixed(3)}, New=${tHit.toFixed(3)}, Diff=${Math.abs(oldTHit - tHit).toFixed(3)}`);
      
      // Fallback: если итеративный метод не дал результата
      if (tHit <= 0 || isNaN(tHit)) {
        tHit = distance / projectileSpeed;
      }
    }
    // Рассчитываем идеальную точку упреждения (где будет цель)
    const perfectLeadX = tx + vx * tHit;
    const perfectLeadY = ty + vy * tHit;
    
    // При 100% точности стреляем точно в упрежденную позицию
    // При меньшей точности добавляем случайную ошибку
    const accuracyError = 1 - accuracy; // Величина ошибки (0 = идеально, 1 = максимальная ошибка)
    
    // Фиксированная максимальная ошибка + небольшая зависимость от расстояния
    // При нулевой точности максимальная ошибка = 100 пикселей + 2% от расстояния
    const maxErrorRadius = 100 + distance * 0.02;
    
    // Генерируем случайную ошибку в круге
    const errorRadius = maxErrorRadius * accuracyError * Math.random();
    const errorAngle = Math.random() * Math.PI * 2;
    const errorX = Math.cos(errorAngle) * errorRadius;
    const errorY = Math.sin(errorAngle) * errorRadius;
    
    const aimX = perfectLeadX + errorX;
    const aimY = perfectLeadY + errorY;
    


    
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
      // обновление визуала произойдет в тиках
      return;
    }
    // Принудительно останавливаем существующий beam перед созданием нового
    this.stopBeamIfAny(shooter, slotKey);
    
    // Старт нового луча (ниже корабля-стрелка)
    const baseDepth = ((((shooter as any)?.depth) ?? 1) - 0.05);
    const gfx = this.scene.add.graphics().setDepth(baseDepth);
    const tickMs = Math.max(10, w?.beam?.tickMs ?? 100);
    const durationMs = Math.max(tickMs, w?.beam?.durationMs ?? 1000);
    const refreshMs = Math.max(0, w?.beam?.refreshMs ?? 500);
    const dmgTick = w?.beam?.damagePerTick ?? 1; // Для beam оружия всегда используем damagePerTick
    
    const timer = this.scene.time.addEvent({ delay: tickMs, loop: true, callback: () => {
      // Проверяем паузу боевых систем
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
      
      // Наносим урон по тикам
      // Если цель вне радара игрока и не видима по FoW — не рисуем эффект, но урон сохраняем
      this.applyDamage(target, dmgTick, shooter);
      
      // Вычисляем точку попадания в край цели для эффекта
      if (w.hitEffect) {
        const targetRadius = this.getEffectiveRadius(target);
        const beamVector = new Phaser.Math.Vector2(dx, dy).normalize();
        const hitPoint = {
          x: target.x - beamVector.x * targetRadius,
          y: target.y - beamVector.y * targetRadius
        };
        // Порождаем эффект только если видим хотя бы стрелка или цель в FoW
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
    
    // ПРИМЕЧАНИЕ: Регистрация таймеров в PauseManager отключена из-за конфликтов
    // Beam таймеры работают как обычные Phaser таймеры, паузы обрабатываются вручную в callback
    // Перерисовка луча на каждом кадре (не наносит урон)
    const redraw = () => {
      // Проверяем паузу боевых систем
      if (this.pauseManager?.isSystemPausable('combat') && this.pauseManager?.getPaused()) {
        return;
      }
      
      if (!shooter?.active || !target?.active) { this.stopBeamIfAny(shooter, slotKey); return; }
      const dx = target.x - shooter.x; const dy = target.y - shooter.y; const d = Math.hypot(dx, dy);
      if (d > w.range) { this.stopBeamIfAny(shooter, slotKey); return; }
      const muzzle = this.getMuzzleWorldPositionFor(shooter, this.resolveMuzzleOffset(shooter, 0, { x: 0, y: 0 }));
      
      // Для beam оружия целимся в край цели вместо центра
      const targetRadius = this.getEffectiveRadius(target);
      const beamVector = new Phaser.Math.Vector2(dx, dy).normalize();
      const hitPoint = {
        x: target.x - beamVector.x * targetRadius,
        y: target.y - beamVector.y * targetRadius
      };
      
      // Скрываем луч, если и стрелок, и цель находятся вне радара игрока (fog of war)
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
      
      // Сохраняем точку попадания для эффекта урона
      (gfx as any).__hitPoint = hitPoint;
    };
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, redraw);
    (gfx as any).__beamRedraw = redraw;
    map.set(slotKey, { gfx, timer, target });
    // Сообщаем HUD о начале работы луча (показывать 100% бары duration)
    if (shooter === this.ship) {
      try { this.scene.events.emit('beam-start', slotKey, durationMs); } catch {}
    }
    // Автоматическое отключение по duration и установка refresh
    const durationId = `beam_duration_${slotKey}_${Date.now()}`;
    const durationTimer = this.scene.time.delayedCall(durationMs, () => {
      const shooterTimes = this.beamCooldowns.get(shooter) ?? {}; this.beamCooldowns.set(shooter, shooterTimes);
      const now = this.pauseManager?.getAdjustedTime() ?? this.scene.time.now;
      shooterTimes[slotKey] = now + refreshMs;
      // HUD: сразу после окончания duration запустить индикацию refresh
      if (shooter === this.ship) {
        try { this.scene.events.emit('beam-refresh', slotKey, refreshMs); } catch {}
      }
      this.stopBeamIfAny(shooter, slotKey);
      try { this.pauseManager?.unregisterTimer?.(durationId); } catch {}
    });
    try { this.pauseManager?.registerTimer?.(durationId, durationTimer); } catch {}
    
    // ПРИМЕЧАНИЕ: Регистрация таймеров в PauseManager отключена из-за конфликтов
    // Duration таймер работает как обычный Phaser таймер
    if (shooter === this.ship) { try { this.scene.events.emit('player-weapon-fired', slotKey, target); } catch {} }
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

  private floatDamageText(x: number, y: number, dmg: number) {
    const t = this.scene.add.text(x, y, `-${dmg}`, { color: '#f87171', fontSize: '24px' }).setOrigin(0.5).setDepth(1.2);
    this.scene.tweens.add({ targets: t, y: y - 30, alpha: 0, duration: 700, ease: 'Sine.easeOut', onComplete: () => t.destroy() });
  }

  private resolveDisplayName(t: { shipId?: string; obj: any }): string | null {
    const sid = t.shipId;
    if (sid && this.config.ships?.defs?.[sid]?.displayName) return this.config.ships.defs[sid].displayName;
    return null;
  }

  private refreshCombatRings() {
    const assigned = new Set<any>();
    for (const t of this.playerWeaponTargets.values()) if (t && (t as any).active) assigned.add(t);
    // Добавляем NPC, которые целятся в игрока
    for (const t of this.targets) {
      if (t.intent?.target === this.ship && (t.intent.type === 'attack' || t.intent.type === 'flee')) {
        assigned.add(t.obj);
      }
    }
    for (const [t, ring] of this.combatRings.entries()) {
      if (!assigned.has(t)) { ring.destroy(); this.combatRings.delete(t); }
    }
    for (const t of assigned.values()) {
      if (!this.combatRings.has(t)) {
        const base = this.getEffectiveRadius(t as any) + 5;
        const r = this.scene.add.circle((t as any).x, (t as any).y, base, 0xA93226, 0.12).setDepth(0.44);
        r.setStrokeStyle(2, 0xA93226, 1);
        this.combatRings.set(t, r);
      }
    }
  }
  private refreshCombatUIAssigned() {
    const assigned = new Set<any>();
    for (const t of this.playerWeaponTargets.values()) if (t && (t as any).active) assigned.add(t);
    // Добавляем NPC, которые целятся в игрока, для отображения HP-бара
    for (const t of this.targets) {
      if (t.intent?.target === this.ship && (t.intent.type === 'attack' || t.intent.type === 'flee')) {
        assigned.add(t.obj);
      }
    }
    for (const rec of this.targets) {
      const isAssigned = assigned.has(rec.obj);
      if (isAssigned) {
        rec.hpBarBg.setVisible(true);
        rec.hpBarFill.setVisible(true);
        if (!rec.nameLabel) {
          const name = this.resolveDisplayName(rec) || 'Unknown';
          const baseName = this.resolveDisplayName(rec) || 'Unknown';
          const uniqueName = `${baseName} #${(rec.obj as any).__uniqueId || ''}`;
          rec.nameLabel = this.scene.add.text(0, 0, uniqueName, { color: '#ffffff', fontSize: '16px', fontFamily: 'HooskaiChamferedSquare' }).setOrigin(0.5, 1).setDepth(0.7);
        }
        const relAB = this.getRelation('player', rec.faction, undefined);
        const relBA = this.getRelation(rec.faction, 'player', rec.overrides?.factions);
        const isEnemyNow = (relAB === 'confrontation') || (relBA === 'confrontation');
        const color = isEnemyNow ? '#A93226' : '#9E9382';
        rec.nameLabel.setColor(color);
        const baseName = this.resolveDisplayName(rec) || 'Unknown';
        const uniqueName = `${baseName} #${(rec.obj as any).__uniqueId || ''}`;
        
        // Добавляем отладочную информацию о цели (для боевых целей)
        let debugInfo = '';
        if (process.env.NODE_ENV === 'development') {
          const currentTarget = rec.intent?.target;
          const stateContext = this.npcStateManager.getContext(rec.obj);
          const stableTarget = stateContext?.targetStabilization?.currentTarget;
          
          // КРИТИЧНАЯ ПРОВЕРКА: убеждаемся что контекст принадлежит правильному объекту
          if (stateContext && stateContext.obj !== rec.obj) {
            debugInfo = `\n❌ CONTEXT MISMATCH! (${(stateContext.obj as any).__uniqueId})`;
            console.error(`[Combat Display] Context mismatch for ${(rec.obj as any).__uniqueId}: got context for ${(stateContext.obj as any).__uniqueId}`);
          } else if (currentTarget || stableTarget) {
            const targetToShow = stableTarget || currentTarget;
            const targetName = targetToShow === this.ship ? 'PLAYER' : 
                              `#${(targetToShow as any).__uniqueId || 'UNK'}`;
            const intentType = rec.intent?.type || 'none';
            const aggrLevel = stateContext ? (stateContext.aggression.level * 100).toFixed(0) + '%' : '?';
            
            // Дополнительная проверка источников урона для боевых целей
            if (stateContext && stateContext.aggression.sources.size > 0) {
              const sourcesCount = stateContext.aggression.sources.size;
              const sourcesInfo = Array.from(stateContext.aggression.sources.entries()).map(([source, data]) => {
                const sourceId = source === this.ship ? 'PLAYER' : `#${(source as any).__uniqueId || 'UNK'}`;
                return `${sourceId}:${data.damage}`;
              }).join(',');
              debugInfo = `\n→ ${targetName} (${intentType}) [${aggrLevel}]\nSources: ${sourcesInfo}`;
            } else {
              debugInfo = `\n→ ${targetName} (${intentType}) [${aggrLevel}]`;
            }
          } else {
            const aggrLevel = stateContext ? (stateContext.aggression.level * 100).toFixed(0) + '%' : '?';
            debugInfo = `\n→ NO TARGET [${aggrLevel}]`;
          }
        }
        
        rec.nameLabel.setText(uniqueName + debugInfo);
        rec.nameLabel.setVisible(true);
        this.updateHpBar(rec as any);
      } else {
        // Hide UI if not assigned and not the player's selected info target
        if (rec.obj !== this.selectedTarget) {
          rec.hpBarBg.setVisible(false);
          rec.hpBarFill.setVisible(false);
          rec.nameLabel?.setVisible(false);
        }
      }
    }
  }

  // Публичные помощники для FSM NPC
  public getAllNPCs(): Array<{ obj: any; faction?: string; overrides?: { factions?: Record<string, 'ally'|'neutral'|'confrontation'|'cautious'> } }> {
    return this.targets.map(t => ({ obj: t.obj, faction: t.faction, overrides: t.overrides }));
  }
  public getPlayerShip(): any { return this.ship; }
  public getRelationPublic(ofFaction: string | undefined, otherFaction: string | undefined, overrides?: Record<string, 'ally'|'neutral'|'confrontation'|'cautious'>): 'ally'|'neutral'|'confrontation'|'cautious' {
    return this.getRelation(ofFaction, otherFaction, overrides);
  }
  public getRadarRangeForPublic(obj: any): number { return this.getRadarRangeFor(obj); }

  // Применение команды движения от FSM (без прямого доступа FSM к NPCMovementManager)
  public applyMovementFromFSM(
    obj: any,
    mode: 'move_to' | 'follow' | 'orbit' | 'pursue',
    target: { x: number; y: number; targetObject?: any },
    distance?: number
  ) {
    try {
      this.npcMovement.setNPCMode(obj, mode as any, distance);
      this.npcMovement.setNPCTarget(obj, target);
    } catch {}
  }

  // ВКЛ/ВЫКЛ визуального круга радиуса оружия игрока (строго визуально)
  private togglePlayerWeaponRangeCircle(slotKey: string, show: boolean) {
    const def = this.config.weapons?.defs?.[slotKey];
    if (!def || typeof def.range !== 'number') {
      // если нет данных — просто скрываем существующий круг
      const old = this.playerWeaponRangeCircles.get(slotKey);
      if (old) { try { old.setVisible(false); } catch {} }
      return;
    }
    // создаем при необходимости
    let circle = this.playerWeaponRangeCircles.get(slotKey);
    if (show) {
      if (!circle) {
        const wr = this.config.settings?.ui?.combat?.weaponRanges ?? {} as any;
        const fillColorNum = Number((wr.color ?? '#4ade80').replace('#','0x'));
        const fillAlpha = typeof wr.fillAlpha === 'number' ? Phaser.Math.Clamp(wr.fillAlpha, 0, 1) : 0.08;
        const strokeColorNum = Number((wr.strokeColor ?? wr.color ?? '#4ade80').replace('#','0x'));
        const strokeAlpha = typeof wr.strokeAlpha === 'number' ? Phaser.Math.Clamp(wr.strokeAlpha, 0, 1) : 0.8;
        const strokeWidth = typeof wr.strokeWidth === 'number' ? Math.max(0, Math.floor(wr.strokeWidth)) : 1;
        circle = this.scene.add.circle(this.ship?.x ?? 0, this.ship?.y ?? 0, def.range, fillColorNum, fillAlpha).setDepth(0.35);
        circle.setStrokeStyle(strokeWidth, strokeColorNum, strokeAlpha);
        this.playerWeaponRangeCircles.set(slotKey, circle);
      }
      // на случай, если параметры были изменены в рантайме — обновим стиль
      const wr2 = this.config.settings?.ui?.combat?.weaponRanges ?? {} as any;
      const fillColorNum2 = Number((wr2.color ?? '#4ade80').replace('#','0x'));
      const fillAlpha2 = typeof wr2.fillAlpha === 'number' ? Phaser.Math.Clamp(wr2.fillAlpha, 0, 1) : 0.08;
      const strokeColorNum2 = Number((wr2.strokeColor ?? wr2.color ?? '#4ade80').replace('#','0x'));
      const strokeAlpha2 = typeof wr2.strokeAlpha === 'number' ? Phaser.Math.Clamp(wr2.strokeAlpha, 0, 1) : 0.8;
      const strokeWidth2 = typeof wr2.strokeWidth === 'number' ? Math.max(0, Math.floor(wr2.strokeWidth)) : 1;
      circle.setFillStyle(fillColorNum2, fillAlpha2);
      circle.setStrokeStyle(strokeWidth2, strokeColorNum2, strokeAlpha2);
      circle.setRadius(def.range);
      circle.setPosition(this.ship?.x ?? 0, this.ship?.y ?? 0);
      circle.setVisible(true);
    } else {
      if (circle) {
        circle.setVisible(false);
      }
    }
  }
  private clearAssignmentsForTarget(objAny: any) {
    const clearedSlots: string[] = [];
    for (const [slot, tgt] of Array.from(this.playerWeaponTargets.entries())) {
      if (tgt === objAny) { this.playerWeaponTargets.delete(slot); clearedSlots.push(slot); }
    }
    if (clearedSlots.length) {
      try { this.scene.events.emit('player-weapon-target-cleared', objAny, clearedSlots); } catch {}
      this.refreshCombatRings();
      this.refreshCombatUIAssigned();
    }
  }

  /**
   * Корректно удалить NPC из всех систем (например, после успешного докинга)
   */
  public despawnNPC(target: any, reason?: string) {
    const t = this.targets.find(tt => tt.obj === target);
    if (!t) {
      try { (target as any)?.destroy?.(); } catch {}
      return;
    }

    // Снимаем назначенные слоты игрока на цель
    this.clearAssignmentsForTarget(target);

    // Удаляем визуальные элементы HP/имён/колец
    try { t.hpBarBg.destroy(); } catch {}
    try { t.hpBarFill.destroy(); } catch {}
    try { t.nameLabel?.destroy(); } catch {}
    const ring = this.combatRings.get(target);
    if (ring) { try { ring.destroy(); } catch {} this.combatRings.delete(target); }

    // Удаляем из систем движения/состояний/тумана войны
    try { this.npcMovement.unregisterNPC(target); } catch {}
    try { this.npcStateManager.unregisterNPC(target); } catch {}
    try { if (this.fogOfWar) this.fogOfWar.unregisterObject(target); } catch {}

    // Снимаем выделение если это был выбранный таргет
    if (this.selectedTarget === target) this.clearSelection();

    // Убираем из списка целей и уничтожаем объект
    this.targets = this.targets.filter(rec => rec.obj !== target);
    // Убираем из массива NPC сцены, если используется
    try {
      const arr: any[] | undefined = (this.scene as any).npcs;
      if (Array.isArray(arr)) {
        const idx = arr.indexOf(target);
        if (idx >= 0) arr.splice(idx, 1);
      }
    } catch {}
    try { (target as any).destroy?.(); } catch {}
  }

  public forceCleanupInactiveTargets() {
    // вспомогательно: вызывается при необходимости, удаляет все неактивные объекты
    const removed: any[] = [];
    for (const rec of this.targets) {
      if (!rec.obj || !(rec.obj as any).active) {
        try { (rec.obj as any).destroy?.(); } catch {}
        try { rec.hpBarBg.destroy(); } catch {}
        try { rec.hpBarFill.destroy(); } catch {}
        try { rec.nameLabel?.destroy(); } catch {}
        removed.push(rec.obj);
      }
    }
    if (removed.length) {
      this.targets = this.targets.filter(rec => !removed.includes(rec.obj));
      removed.forEach(t => { 
        // Удаляем из всех систем
        this.npcStateManager.unregisterNPC(t);
        const ring = this.combatRings.get(t); 
        if (ring) { try { ring.destroy(); } catch {} this.combatRings.delete(t); } 
      });
    }
  }

  // Метод для корректного завершения работы
  public destroy() {
    this.npcStateManager.destroy();
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.update, this);
    // Очистка визуальных кругов радиусов
    for (const c of this.playerWeaponRangeCircles.values()) { try { c.destroy(); } catch {} }
    this.playerWeaponRangeCircles.clear();
  }
}


