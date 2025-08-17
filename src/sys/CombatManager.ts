import type { ConfigManager } from './ConfigManager';
import { NPCMovementManager } from './NPCMovementManager';
import type { EnhancedFogOfWar } from './fog-of-war/EnhancedFogOfWar';
import { DynamicObjectType } from './fog-of-war/types';
import { NPCStateManager, NPCState, MovementPriority } from './NPCStateManager';

type Target = Phaser.GameObjects.GameObject & { x: number; y: number; active: boolean };

export class CombatManager {
  private static npcCounter = 0; // Счетчик для уникальных ID
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private npcMovement: NPCMovementManager;
  private fogOfWar?: EnhancedFogOfWar;
  private npcStateManager: NPCStateManager;
  private ship!: Phaser.GameObjects.Image;
  private selectedTarget: Target | null = null;
  private selectionCircle?: Phaser.GameObjects.Arc;
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
    intent?: { type: 'attack' | 'flee'; target: any } | null;
    overrides?: { factions?: Record<string, 'ally'|'neutral'|'confrontation'> };
    damageLog?: {
      firstAttacker?: any;
      totalDamageBySource?: Map<any, number>;
      lastDamageTimeBySource?: Map<any, number>;
    };
  }>=[];
  private combatRings: Map<any, Phaser.GameObjects.Arc> = new Map();

  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
    this.npcMovement = new NPCMovementManager(scene, config);
    this.npcStateManager = new NPCStateManager(scene, config);
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
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
      // try { console.debug('[Combat] onLeftClick', { wx, wy }); } catch {}
      const hit = this.findTargetAt(wx, wy);
      if (hit) {
        // try { console.debug('[Combat] hit target', { x: hit.obj.x, y: hit.obj.y, shipId: (hit as any).shipId }); } catch {}
        this.selectTarget(hit.obj as any);
      } else {
        // Пустой клик: сбрасываем выбор, только если нет ни одного оружия, нацеленного на текущую выбранную цель
        if (!this.selectedTarget || !this.isTargetCombatSelected(this.selectedTarget)) {
          // try { console.debug('[Combat] no target, clearSelection'); } catch {}
          this.clearSelection();
        } else {
          // try { console.debug('[Combat] no target, keep selected info target (combat-selected)'); } catch {}
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
        // try { console.debug('[Combat] findTargetAt: filtering out target in state', state, { x: (t.obj as any).x, y: (t.obj as any).y }); } catch {}
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
      this.playerWeaponTargets.set(slotKey, target);
      // Новое назначение цели: начинаем с перезарядки
      const w = this.config.weapons.defs[slotKey];
      if (w) {
        if ((w.type ?? 'single') === 'beam') {
          const refreshMs = Math.max(0, w?.beam?.refreshMs ?? 500);
          const shooterTimes = this.beamCooldowns.get(this.ship) ?? {}; this.beamCooldowns.set(this.ship, shooterTimes);
          shooterTimes[slotKey] = this.scene.time.now + refreshMs;
          this.stopBeamIfAny(this.ship, slotKey);
        } else {
          const times = this.getShooterTimes(this.ship);
          const cooldownMs = 1000 / Math.max(0.001, (w.fireRatePerSec ?? 1));
          times[slotKey] = this.scene.time.now + cooldownMs;
        }
      }
      // try { console.debug('[Combat] setPlayerWeaponTarget', slotKey, { tx: (target as any).x, ty: (target as any).y, hadOldTarget: !!oldTarget }); } catch {}
    } else {
      this.playerWeaponTargets.delete(slotKey);
      // try { console.debug('[Combat] clearPlayerWeaponTarget', slotKey); } catch {}
    }
    
    this.refreshSelectionCircleColor();
    this.refreshCombatRings();
    this.refreshCombatUIAssigned();
  }

  public clearPlayerWeaponTargets() {
    if (this.playerWeaponTargets.size > 0) {
      // try { console.debug('[Combat] clearPlayerWeaponTargets: clearing', this.playerWeaponTargets.size, 'assignments'); } catch {}
      // Уведомляем UI о сбросе всех назначений
      const clearedSlots = Array.from(this.playerWeaponTargets.keys());
      this.playerWeaponTargets.clear();
      if (clearedSlots.length > 0) {
        // try { this.scene.events.emit('player-weapon-target-cleared', null, clearedSlots); } catch {}
      }
    }
    this.refreshSelectionCircleColor();
    this.refreshCombatRings();
    this.refreshCombatUIAssigned();
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
        const rel = this.getRelation('player', t.faction, t.overrides?.factions);
        const color = (rel === 'confrontation') ? '#A93226' : '#9E9382';
        const baseName = this.resolveDisplayName(t) || 'Unknown';
        const uniqueName = `${baseName} #${(t.obj as any).__uniqueId || ''}`;
        
        // Добавляем отладочную информацию о цели
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
            const aggrLevel = stateContext ? (stateContext.aggression.level * 100).toFixed(0) + '%' : '?';
            
            // Дополнительная проверка источников урона
            if (stateContext && stateContext.aggression.sources.size > 0) {
              const sourcesCount = stateContext.aggression.sources.size;
              const sourcesInfo = Array.from(stateContext.aggression.sources.entries()).map(([source, data]) => {
                const sourceId = source === this.ship ? 'PLAYER' : `#${(source as any).__uniqueId || 'UNK'}`;
                return `${sourceId}:${data.damage}`;
              }).join(',');
              debugInfo = `\n→ ${targetName} (${intentType}) [${aggrLevel}]\nSources(${sourcesCount}): ${sourcesInfo}`;
            } else {
              debugInfo = `\n→ ${targetName} (${intentType}) [${aggrLevel}]`;
            }
          } else {
            const aggrLevel = stateContext ? (stateContext.aggression.level * 100).toFixed(0) + '%' : '?';
            debugInfo = `\n→ NO TARGET [${aggrLevel}]`;
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
    // hide all HP bars
    for (const t of this.targets) { t.hpBarBg.setVisible(false); t.hpBarFill.setVisible(false); t.nameLabel?.setVisible(false); }
  }

  private update(_time: number, deltaMs: number) {
    // pulse selection
    if (this.selectedTarget && this.selectionCircle) {
      this.selectionPulsePhase += deltaMs * 0.01;
      const r = this.selectionBaseRadius + Math.sin(this.selectionPulsePhase) * 3;
      this.selectionCircle.setRadius(r);
      this.selectionCircle.setPosition((this.selectedTarget as any).x, (this.selectedTarget as any).y);
    }

    // auto logic
    if (!this.ship) return;
    
    // ВАЖНО: Порядок имеет значение!
    // 1. Сначала sensors logic - обнаруживает новые цели и устанавливает базовые intent
    this.updateSensors(deltaMs);
    // 2. Затем AI logic - принимает решения о тактике и движении на основе intent
    this.updateEnemiesAI(deltaMs);

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
      }
      try { this.scene.events.emit('player-weapon-target-cleared', null, slotsToClear); } catch {}
      this.refreshCombatRings();
      this.refreshCombatUIAssigned();
      this.refreshSelectionCircleColor();
    }
    if (this.selectedTarget) {
      const distToSelected = Phaser.Math.Distance.Between(this.ship.x, this.ship.y, this.selectedTarget.x, this.selectedTarget.y);
      if (distToSelected > playerRadarRange) {
        this.clearSelection();
      }
    }

    // Player fire only по назначенным целям для каждого слота оружия
    const playerSlots = this.config.player?.weapons ?? [];
    if (playerSlots.length) {
      const now = this.scene.time.now;
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
            if (prepUntil) { delete prepObj[slotKey]; try { this.scene.events.emit('weapon-charge-cancel', slotKey); } catch {} }
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
            try { this.scene.events.emit('weapon-charge-start', slotKey, refreshMs); } catch {}
            continue;
          }
          if (now >= prepUntil) {
            delete prepObj[slotKey];
            this.ensureBeam(this.ship, slotKey, w, target, dist);
          }
          continue;
        }
        // Небимовое оружие: подготовка/зарядка в зоне, выстрел по завершении
        const cooldownMs = 1000 / Math.max(0.001, (w.fireRatePerSec ?? 1));
        if (dist > w.range) {
          if (this.playerChargeUntil[slotKey]) { delete this.playerChargeUntil[slotKey]; try { this.scene.events.emit('weapon-charge-cancel', slotKey); } catch {} }
          try { this.scene.events.emit('weapon-out-of-range', slotKey, true); } catch {}
          continue;
        }
        try { this.scene.events.emit('weapon-out-of-range', slotKey, false); } catch {}
        if (!this.playerChargeUntil[slotKey]) {
          this.playerChargeUntil[slotKey] = now + cooldownMs;
          try { this.scene.events.emit('weapon-charge-start', slotKey, cooldownMs); } catch {}
          continue;
        }
        if (now >= this.playerChargeUntil[slotKey]) {
          this.playerChargeUntil[slotKey] = now + cooldownMs;
          const muzzleOffset = this.resolveMuzzleOffset(this.ship, i, w.muzzleOffset);
          const w2 = { ...w, muzzleOffset };
          const type = (w2.type ?? 'single');
          if (type === 'burst') this.fireBurstWeapon(slotKey, w2, target as any, this.ship);
          else this.fireWeapon(slotKey, w2, target as any, this.ship);
        }
      }
    }
    // enemies auto fire by intent
    for (const t of this.targets) {
      if (!t.ai || !t.intent || t.intent.type !== 'attack') {
        // Отладочная информация почему NPC не атакует
        if (process.env.NODE_ENV === 'development' && Math.random() < 0.005) { // 0.5% логов
          const hasAI = !!t.ai;
          const hasIntent = !!t.intent;
          const intentType = t.intent?.type;
          console.log(`[AutoFire] NPC ${t.shipId} #${(t.obj as any).__uniqueId} not firing`, {
            hasAI, hasIntent, intentType,
            reason: !hasAI ? 'no_ai' : !hasIntent ? 'no_intent' : `intent_is_${intentType}`
          });
        }
        continue;
      }
      const targetObj = t.intent.target;
      if (!targetObj || !targetObj.active) {
        if (process.env.NODE_ENV === 'development' && Math.random() < 0.01) { // 1% логов
          console.log(`[AutoFire] NPC ${t.shipId} #${(t.obj as any).__uniqueId} has attack intent but invalid target`, {
            hasTarget: !!targetObj,
            targetActive: targetObj?.active
          });
        }
        continue;
      }
      
      const saved = this.weaponSlots;
      const slots = (t as any).weaponSlots as string[] | undefined;
      if (slots && slots.length) this.weaponSlots = slots;
      
      // Отладочная информация о стрельбе
      if (process.env.NODE_ENV === 'development' && Math.random() < 0.02) { // 2% логов
        const targetName = targetObj === this.ship ? 'PLAYER' : `#${(targetObj as any).__uniqueId}`;
        console.log(`[AutoFire] NPC ${t.shipId} #${(t.obj as any).__uniqueId} firing at ${targetName}`, {
          weapons: slots || ['default'],
          distance: Math.hypot(targetObj.x - t.obj.x, targetObj.y - t.obj.y).toFixed(0)
        });
      }
      
      this.autoFire(t.obj as any, targetObj);
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
  }

  private refreshSelectionCircleColor() {
    const t = this.selectedTarget;
    if (!t || !this.selectionCircle) return;
    // если хоть одно оружие нацелено на выбранную цель — выделение красным
    const anyOnThis = Array.from(this.playerWeaponTargets.values()).some(v => v === t);
    if (anyOnThis) {
      this.selectionCircle.setFillStyle(0xA93226, 0.15);
      this.selectionCircle.setStrokeStyle(2, 0xA93226, 1);
    } else {
      this.selectionCircle.setFillStyle(0x9e9382, 0.15);
      this.selectionCircle.setStrokeStyle(2, 0x9e9382, 1);
    }
  }

  private isTargetCombatSelected(target: Target | null): boolean {
    if (!target) return false;
    for (const t of this.playerWeaponTargets.values()) { if (t === target) return true; }
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
        
        this.updateHpBar(t as any); 
        continue; 
      }
      
      const retreat = ((): number => {
        if (t.combatAI) {
          const cp = this.config.combatAI?.profiles?.[t.combatAI];
          if (cp && typeof cp.retreatHpPct === 'number') return cp.retreatHpPct;
        }
        return t.ai.retreatHpPct ?? 0;
      })();
      
      let targetObj = (t.intent && t.intent.type === 'attack') ? t.intent.target : this.ship;
      const fleeObj = (t.intent && t.intent.type === 'flee') ? t.intent.target : null;
      
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
      
      if (fleeObj && (!fleeObj.active || fleeObj.destroyed)) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[AI] ${t.shipId} #${(obj as any).__uniqueId} clearing invalid flee target`);
        }
        t.intent = null;
      }
      
      let target: { x: number; y: number };
      if (fleeObj) {
        // Flee: фиксируем направление от top-dps источника и не меняем
        if (!(t as any).__fleeDir) {
          let source = fleeObj;
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
          if (t.faction === 'pirate') { try { console.log('[AI] Pirate flee lock dir', { id: (obj as any).__uniqueId }); } catch {} }
        }
        const fleeDistance = 1000;
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
          const dist = Math.hypot(dx, dy);
          const retreatDistance = 800;
          target = {
            x: targetObj.x + (dx / dist) * retreatDistance,
            y: targetObj.y + (dy / dist) * retreatDistance
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
          const candidates = this.targets
            .filter(o => o.obj !== obj && o.obj.active)
            .filter(o => this.getRelation(t.faction, o.faction, t.overrides?.factions) === 'confrontation')
            .map(o => o.obj);
            
          // КРИТИЧНО: Добавляем игрока в кандидаты если отношения враждебные
          const playerRelation = this.getRelation(t.faction, 'player', t.overrides?.factions);
          const shouldIncludePlayer = playerRelation === 'confrontation' && this.ship && this.ship.active;
          
          if (shouldIncludePlayer && !candidates.includes(this.ship)) {
            candidates.push(this.ship);
          }
            
          // ОТЛАДКА: проверяем включен ли игрок в кандидаты
          if (process.env.NODE_ENV === 'development') {
            const includesPlayer = candidates.includes(this.ship);
            console.log(`[Candidates] ${t.shipId} #${(obj as any).__uniqueId} candidate check`, {
              totalCandidates: candidates.length,
              includesPlayer,
              shouldIncludePlayer,
              playerRelation,
              faction: t.faction,
              shipIsActive: this.ship?.active,
              candidateIds: candidates.map(c => (c === this.ship ? 'PLAYER' : (c as any).__uniqueId))
            });
          }
            
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
              
              console.log(`[TargetSelection] ${t.shipId} #${(obj as any).__uniqueId} stable system result`, {
                candidates: candidates.length,
                selectedTarget: bestId,
                currentTarget: currentId,
                stabilizationActive: !!stateContext.targetStabilization.currentTarget,
                hasValidTarget: !!best
              });
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
          if (targetObj && targetObj.active && !targetObj.destroyed) {
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
          if (t.intent?.type === 'attack' && t.intent.target && t.intent.target.active && !t.intent.target.destroyed) {
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
            t.intent = { type: 'attack', target: prev };
            this.npcMovement.setNPCTarget(obj, { x: prev.x, y: prev.y, targetObject: prev });
            
            if (process.env.NODE_ENV === 'development') {
              const targetName = prev === this.ship ? 'PLAYER' : `#${(prev as any).__uniqueId}`;
              console.log(`[AI] ${t.shipId} #${(obj as any).__uniqueId} flee ended -> ATTACK ${targetName}`);
            }
          } else {
            const hadIntent = !!t.intent;
            t.intent = null;
            
            if (process.env.NODE_ENV === 'development' && hadIntent) {
              console.log(`[AI] ${t.shipId} #${(obj as any).__uniqueId} flee ended -> NO TARGET`);
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
    const muzzle = this.getMuzzleWorldPositionFor(shooter, w.muzzleOffset);
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
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;

    // Рассчитываем время жизни снаряда: дистанция / скорость. Добавляем небольшой буфер (50 мс).
    const lifetimeMs = (w.range / Math.max(1, speed)) * 1000 + 50;
    // Capture shooter's faction once for friendly-fire filtering
    const shooterEntry = this.targets.find(t => t.obj === shooter);
    const shooterFaction = shooterEntry?.faction ?? (shooter === this.ship ? 'player' : undefined);
    const shooterOverrides = (shooterEntry as any)?.overrides?.factions;

    const onUpdate = (_t: number, dt: number) => {
      (proj as any).x += vx * (dt/1000);
      (proj as any).y += vy * (dt/1000);
      // collision simple distance check
      if (!target || !target.active) {
        this.scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
        (proj as any).destroy?.();
        return;
      }
      // Check collisions with any other valid enemy target along the path (no ally/neutral hits)
      for (let i = 0; i < this.targets.length; i++) {
        const rec = this.targets[i];
        const obj = rec.obj as any;
        if (!obj || !obj.active) continue;
        if (obj === shooter) continue;
        const st = obj.__state;
        const invulnerable = st === 'docking' || st === 'docked' || st === 'undocking' || (typeof obj.alpha === 'number' && obj.alpha <= 0.05) || obj.visible === false;
        if (invulnerable) continue;
        const hitR = this.getEffectiveRadius(obj);
        const dAny = Phaser.Math.Distance.Between((proj as any).x, (proj as any).y, obj.x, obj.y);
        if (dAny <= hitR) {
          // Relation filter: only damage if shooter considers target as confrontation
          const victimFaction = rec.faction;
          const rel = this.getRelation(shooterFaction, victimFaction, shooterOverrides);
          if (rel === 'confrontation') {
            this.applyDamage(obj, w.damage, shooter);
            this.spawnHitEffect((proj as any).x, (proj as any).y, w);
          }
          this.scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
          // Дерегистрируем снаряд из fog of war
          if (this.fogOfWar) {
            this.fogOfWar.unregisterObject(proj);
          }
          (proj as any).destroy?.();
          return;
        }
      }
      const hitDist = this.getEffectiveRadius(target as any);
      const d = Phaser.Math.Distance.Between((proj as any).x, (proj as any).y, target.x, target.y);
      if (d <= hitDist) {
        // Пропускаем визуальные эффекты и урон, если цель в доке/андоке или невидима
        const st = (target as any).__state;
        const invulnerable = st === 'docking' || st === 'docked' || st === 'undocking' || (typeof (target as any).alpha === 'number' && (target as any).alpha <= 0.05) || (target as any).visible === false;
        if (!invulnerable) {
          // try { console.debug('[Combat] hit target, applyDamage', w.damage); } catch {}
          this.applyDamage(target, w.damage, shooter);
          this.spawnHitEffect((proj as any).x, (proj as any).y, w);
        }
        this.scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
        // Дерегистрируем снаряд из fog of war
        if (this.fogOfWar) {
          this.fogOfWar.unregisterObject(proj);
        }
        (proj as any).destroy?.();
      }
    };
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
    this.scene.time.delayedCall(lifetimeMs, () => {
      this.scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
      // Дерегистрируем снаряд из fog of war при истечении времени жизни
      if (this.fogOfWar) {
        this.fogOfWar.unregisterObject(proj);
      }
      (proj as any).destroy?.();
    });
    // Сигнализируем UI о выстреле игрока для мигания иконки
    if (shooter === this.ship) {
      try { this.scene.events.emit('player-weapon-fired', _slot, target); } catch {}
    }
  }

  private fireBurstWeapon(slot: string, w: any, target: any, shooter: any) {
    const count = Math.max(1, w?.burst?.count ?? 3);
    const delayMs = Math.max(1, w?.burst?.delayMs ?? 80);
    for (let k = 0; k < count; k++) {
      this.scene.time.delayedCall(k * delayMs, () => {
        if (!shooter?.active || !target?.active) return;
        const muzzleOffset = w.muzzleOffset;
        const w2 = { ...w, muzzleOffset };
        this.fireWeapon(slot, w2, target, shooter);
      });
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
        const nowMs = this.scene.time.now;
        const shooterTimes = this.beamCooldowns.get(shooter) ?? {}; this.beamCooldowns.set(shooter, shooterTimes);
        const readyAt = shooterTimes[slotKey] ?? 0;
        if (nowMs >= readyAt && dist <= w.range) this.ensureBeam(shooter, slotKey, w, target, dist); else this.stopBeamIfAny(shooter, slotKey);
        continue;
      }
      if (dist > w.range) { this.stopBeamIfAny(shooter, slotKey); continue; }
      const now = this.scene.time.now;
      const cooldownMs = 1000 / Math.max(0.001, (w.fireRatePerSec ?? 1));
      const last = times[slotKey] ?? 0;
      if (now - last >= cooldownMs) {
        times[slotKey] = now;
        const muzzleOffset = this.resolveMuzzleOffset(shooter, i, w.muzzleOffset);
        const w2 = { ...w, muzzleOffset };
        const type = (w2.type ?? 'single');
        if (type === 'burst') this.fireBurstWeapon(slotKey, w2, target, shooter);
        else this.fireWeapon(slotKey, w2, target, shooter);
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
        mapT.set(attacker, this.scene.time.now);
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
            (t as any).forceIntentUntil = this.scene.time.now + 4000; // 4s удержания реакции
            
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
            (t as any).forceIntentUntil = this.scene.time.now + 4000; // 4s удержания реакции
            
            if (process.env.NODE_ENV === 'development') {
              console.log(`[OutdistanceAttack] ${t.shipId} #${(t.obj as any).__uniqueId} fleeing from distant target`, {
                distance: distToAttacker.toFixed(0),
                radarRange: npcRadarRange,
                action: 'flee'
              });
            }
          }
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

  private getRelation(ofFaction: string | undefined, otherFaction: string | undefined, overrides?: Record<string, 'ally'|'neutral'|'confrontation'>): 'ally'|'neutral'|'confrontation' {
    if (!ofFaction || !otherFaction) return 'neutral';
    if (overrides && overrides[otherFaction]) return overrides[otherFaction];
    const rel = this.config.factions?.factions?.[ofFaction]?.relations?.[otherFaction];
    return rel ?? 'neutral';
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
      if (forcedUntil && this.scene.time.now < forcedUntil) {
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
      let decided: { type: 'attack'|'flee'; target: any } | null = null;
      // prefer non-pirate targets first to avoid mutual pirate-pirate selection
      const sorted = sensed.sort((a,b) => (a.faction === 'pirate' ? 1 : 0) - (b.faction === 'pirate' ? 1 : 0));
      for (const s of sorted) {
        const rel = this.getRelation(myFaction, s.faction, t.overrides?.factions);
        const act = reactions?.[rel] ?? 'ignore';
        // пропускаем докованных целей
        if ((s.obj as any)?.__state === 'docked' || (s.obj as any)?.__state === 'docking') continue;
        if (act === 'attack') { decided = { type: 'attack', target: s.obj }; break; }
        if (act === 'flee') { decided = { type: 'flee', target: s.obj }; break; }
      }
      // If current intent target is invalid (docked/docking/inactive) — clear it
      const curIntent: any = (t as any).intent;
      const curTarget: any = curIntent?.target;
      if (curTarget && (!curTarget.active || curTarget.__state === 'docked' || curTarget.__state === 'docking')) {
        (t as any).intent = null;
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
        const timeSinceLastDamage = this.scene.time.now - context.aggression.lastDamageTime;
        const timeSinceLastCombat = this.scene.time.now - context.aggression.lastCombatTime;
        
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
    const prev = (target as any).__prevPos || { x: target.x, y: target.y };
    const dt = Math.max(1 / 60, this.scene.game.loop.delta / 1000);
    const vx = (target.x - prev.x) / dt;
    const vy = (target.y - prev.y) / dt;
    (target as any).__prevPos = { x: target.x, y: target.y };
    const projectileSpeed = w.projectileSpeed;
    const sx = shooter.x;
    const sy = shooter.y;
    const tx = target.x;
    const ty = target.y;
    const rx = tx - sx;
    const ry = ty - sy;
    const a2 = vx * vx + vy * vy - projectileSpeed * projectileSpeed;
    const b = 2 * (rx * vx + ry * vy);
    const c = rx * rx + ry * ry;
    let tHit: number;
    if (Math.abs(a2) < 1e-3) {
      tHit = c / Math.max(1, -b);
    } else {
      const disc = b * b - 4 * a2 * c;
      if (disc < 0) tHit = 0; else {
        const t1 = (-b - Math.sqrt(disc)) / (2 * a2);
        const t2 = (-b + Math.sqrt(disc)) / (2 * a2);
        tHit = Math.min(t1, t2);
        if (tHit < 0) tHit = Math.max(t1, t2);
        if (tHit < 0) tHit = 0;
      }
    }
    const leadX = tx + vx * tHit * accuracy;
    const leadY = ty + vy * tHit * accuracy;
    const aimX = Phaser.Math.Linear(tx, leadX, accuracy);
    const aimY = Phaser.Math.Linear(ty, leadY, accuracy);
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
    // Старт нового луча (ниже корабля-стрелка)
    const baseDepth = ((((shooter as any)?.depth) ?? 1) - 0.05);
    const gfx = this.scene.add.graphics().setDepth(baseDepth);
    const tickMs = Math.max(10, w?.beam?.tickMs ?? 100);
    const durationMs = Math.max(tickMs, w?.beam?.durationMs ?? 1000);
    const refreshMs = Math.max(0, w?.beam?.refreshMs ?? 500);
    const dmgTick = typeof w?.beam?.damagePerTick === 'number' ? w.beam.damagePerTick : Math.max(1, Math.round((w.damage ?? 1) * (tickMs / 1000)));
    const timer = this.scene.time.addEvent({ delay: tickMs, loop: true, callback: () => {
      if (!shooter?.active || !target?.active) { this.stopBeamIfAny(shooter, slotKey); return; }
      const dx = target.x - shooter.x; const dy = target.y - shooter.y; const d = Math.hypot(dx, dy);
      if (d > w.range) { this.stopBeamIfAny(shooter, slotKey); return; }
      // Наносим урон по тикам
      this.applyDamage(target, dmgTick, shooter);
    }});
    // Перерисовка луча на каждом кадре (не наносит урон)
    const redraw = () => {
      if (!shooter?.active || !target?.active) { this.stopBeamIfAny(shooter, slotKey); return; }
      const dx = target.x - shooter.x; const dy = target.y - shooter.y; const d = Math.hypot(dx, dy);
      if (d > w.range) { this.stopBeamIfAny(shooter, slotKey); return; }
      const muzzle = this.getMuzzleWorldPositionFor(shooter, w.muzzleOffset);
      gfx.clear();
      const colorHex = (w?.beam?.color || w?.hitEffect?.color || w?.projectile?.color || '#60a5fa').replace('#','0x');
      const outerW = Math.max(1, Math.floor(w?.beam?.outerWidth ?? 6));
      const innerW = Math.max(1, Math.floor(w?.beam?.innerWidth ?? 3));
      const outerA = Phaser.Math.Clamp(w?.beam?.outerAlpha ?? 0.25, 0, 1);
      const innerA = Phaser.Math.Clamp(w?.beam?.innerAlpha ?? 0.9, 0, 1);
      gfx.lineStyle(outerW, Number(colorHex), outerA);
      gfx.beginPath(); gfx.moveTo(muzzle.x, muzzle.y); gfx.lineTo(target.x, target.y); gfx.strokePath();
      gfx.lineStyle(innerW, Number(colorHex), innerA);
      gfx.beginPath(); gfx.moveTo(muzzle.x, muzzle.y); gfx.lineTo(target.x, target.y); gfx.strokePath();
      gfx.setAlpha(1);
    };
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, redraw);
    (gfx as any).__beamRedraw = redraw;
    map.set(slotKey, { gfx, timer, target });
    // Сообщаем HUD о начале работы луча (показывать 100% бары duration)
    if (shooter === this.ship) {
      try { this.scene.events.emit('beam-start', slotKey, durationMs); } catch {}
    }
    // Автоматическое отключение по duration и установка refresh
    this.scene.time.delayedCall(durationMs, () => {
      const shooterTimes = this.beamCooldowns.get(shooter) ?? {}; this.beamCooldowns.set(shooter, shooterTimes);
      shooterTimes[slotKey] = this.scene.time.now + refreshMs;
      // HUD: сразу после окончания duration запустить индикацию refresh
      if (shooter === this.ship) {
        try { this.scene.events.emit('beam-refresh', slotKey, refreshMs); } catch {}
      }
      this.stopBeamIfAny(shooter, slotKey);
    });
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
      if (t.intent?.target === this.ship) {
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
      if (t.intent?.target === this.ship) {
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
        const rel = this.getRelation('player', rec.faction, rec.overrides?.factions);
        const color = (rel === 'confrontation') ? '#A93226' : '#9E9382';
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
  }
}


