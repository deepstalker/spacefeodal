import type { ConfigManager } from '../../ConfigManager';
import type { TargetEntry, ITargetManager, CombatDependencies } from '../CombatTypes';
import type { NPCStateManager } from '../../NPCStateManager';
import type { EnhancedFogOfWar } from '../../fog-of-war/EnhancedFogOfWar';
import { DynamicObjectType } from '../../fog-of-war/types';

/**
 * Менеджер управления целями в боевой системе
 * Отвечает за регистрацию, удаление, поиск и валидацию целей
 */
export class TargetManager implements ITargetManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private targets: TargetEntry[] = [];
  private static npcCounter = 0;
  
  // Зависимости
  private npcStateManager?: NPCStateManager;
  private fogOfWar?: EnhancedFogOfWar;
  private npcMovement?: any; // NPCMovementManager
  private indicatorManager?: any; // IndicatorManager
  
  constructor(scene: Phaser.Scene, config: ConfigManager, dependencies?: Partial<CombatDependencies>) {
    this.scene = scene;
    this.config = config;
    
    // Опциональные зависимости будут установлены позже через setters
    if (dependencies) {
      this.fogOfWar = dependencies.fogOfWar;
      this.indicatorManager = dependencies.indicatorManager;
    }
  }
  
  // === Dependency Injection ===
  
  setNpcStateManager(manager: NPCStateManager): void {
    this.npcStateManager = manager;
  }
  
  setFogOfWar(fog: EnhancedFogOfWar): void {
    this.fogOfWar = fog;
  }
  
  setNpcMovement(movement: any): void {
    this.npcMovement = movement;
  }
  
  setIndicatorManager(indicators: any): void {
    this.indicatorManager = indicators;
  }
  
  // === Core Target Management ===
  
  /**
   * Добавить новую цель в систему с валидацией регистрации
   * @returns true если все регистрации прошли успешно, false в противном случае
   */
  addTargetWithValidation(entry: TargetEntry): boolean {
    const uniqueId = (entry.obj as any).__uniqueId;
    
    // Проверяем что цель еще не зарегистрирована
    const existing = this.targets.find(t => t.obj === entry.obj);
    if (existing) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[TargetManager] Target already registered: ${uniqueId}`);
      }
      return false;
    }
    
    // КРИТИЧНАЯ ПРОВЕРКА: проверяем что __uniqueId уникален
    if (uniqueId) {
      const duplicateById = this.targets.find(t => (t.obj as any).__uniqueId === uniqueId);
      if (duplicateById) {
        console.error(`[TargetManager] CRITICAL: Duplicate __uniqueId detected! ${uniqueId}`, {
          existing: {
            prefab: (duplicateById.obj as any).__prefabKey,
            shipId: duplicateById.shipId,
            active: duplicateById.obj.active
          },
          new: {
            prefab: (entry.obj as any).__prefabKey,
            shipId: entry.shipId,
            active: entry.obj.active
          }
        });
        
        // Принудительно присваиваем новый ID для нового объекта
        (entry.obj as any).__uniqueId = ++TargetManager.npcCounter;
        if (process.env.NODE_ENV === 'development') {
          console.log(`[TargetManager] Assigned new ID: ${(entry.obj as any).__uniqueId}`);
        }
      }
    }
    
    // Валидация объекта перед регистрацией
    if (!entry.obj || typeof entry.obj.x !== 'number' || typeof entry.obj.y !== 'number') {
      console.error(`[TargetManager] Invalid object for registration:`, {
        hasObj: !!entry.obj,
        uniqueId,
        hasPosition: entry.obj && typeof entry.obj.x === 'number'
      });
      return false;
    }
    
    // Попытка регистрации во всех подсистемах ПЕРЕД добавлением в targets
    let allRegistrationsSuccessful = true;
    const registrationResults: { system: string; success: boolean; error?: any }[] = [];
    
    // 1. Регистрация в NPC Movement
    if (this.npcMovement) {
      try {
        this.npcMovement.registerNPC(entry.obj, entry.shipId, entry.combatAI);
        registrationResults.push({ system: 'NPCMovement', success: true });
        if (process.env.NODE_ENV === 'development') {
          console.log(`[TargetManager] ✓ NPC movement registration successful: ${uniqueId}`);
        }
      } catch (e) {
        allRegistrationsSuccessful = false;
        registrationResults.push({ system: 'NPCMovement', success: false, error: e });
        console.error('[TargetManager] ✗ Failed to register in NPC movement:', e);
      }
    }
    
    // 2. КРИТИЧНО: Регистрация в NPCStateManager
    if (this.npcStateManager) {
      try {
        this.npcStateManager.registerNPC(entry.obj, entry.aiProfileKey, entry.combatAI, entry.faction);
        registrationResults.push({ system: 'NPCStateManager', success: true });
        if (process.env.NODE_ENV === 'development') {
          console.log(`[TargetManager] ✓ NPC state manager registration successful: ${uniqueId}`);
        }
      } catch (e) {
        allRegistrationsSuccessful = false;
        registrationResults.push({ system: 'NPCStateManager', success: false, error: e });
        console.error('[TargetManager] ✗ CRITICAL: Failed to register in NPC state manager:', {
          error: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : undefined,
          npcDetails: {
            uniqueId,
            prefab: (entry.obj as any).__prefabKey,
            shipId: entry.shipId,
            aiProfile: entry.aiProfileKey,
            combatAI: entry.combatAI,
            faction: entry.faction,
            position: { x: entry.obj.x, y: entry.obj.y },
            active: entry.obj.active,
            destroyed: entry.obj.destroyed,
            hasRequiredProps: {
              x: typeof entry.obj.x === 'number',
              y: typeof entry.obj.y === 'number',
              objExists: !!entry.obj
            }
          },
          existingContexts: this.npcStateManager ? this.npcStateManager.getAllContexts().size : 'N/A'
        });
      }
    }
    
    // 3. Регистрация в Fog of War (некритично)
    if (this.fogOfWar) {
      try {
        this.fogOfWar.registerDynamicObject(entry.obj, DynamicObjectType.NPC);
        registrationResults.push({ system: 'FogOfWar', success: true });
        if (process.env.NODE_ENV === 'development') {
          console.log(`[TargetManager] ✓ Fog of war registration successful: ${uniqueId}`);
        }
      } catch (e) {
        registrationResults.push({ system: 'FogOfWar', success: false, error: e });
        console.warn('[TargetManager] Failed to register in fog of war:', e);
        // Fog of war failures are not critical for gameplay
      }
    }
    
    // Если критичные регистрации не удались, откатываем все изменения
    if (!allRegistrationsSuccessful) {
      console.error(`[TargetManager] Registration validation FAILED for ${uniqueId}, rolling back all changes`, {
        registrationResults
      });
      
      // Откатываем успешные регистрации
      for (const result of registrationResults) {
        if (result.success) {
          try {
            if (result.system === 'NPCMovement' && this.npcMovement) {
              this.npcMovement.unregisterNPC(entry.obj);
            } else if (result.system === 'NPCStateManager' && this.npcStateManager) {
              this.npcStateManager.unregisterNPC(entry.obj);
            } else if (result.system === 'FogOfWar' && this.fogOfWar) {
              this.fogOfWar.unregisterObject(entry.obj);
            }
          } catch (rollbackError) {
            console.error(`[TargetManager] Failed to rollback ${result.system} registration:`, rollbackError);
          }
        }
      }
      
      return false;
    }
    
    // Все критичные регистрации прошли успешно - добавляем в targets
    this.targets.push(entry);
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[TargetManager] ✓ Target registration SUCCESSFUL: ${uniqueId}`, {
        prefab: (entry.obj as any).__prefabKey,
        shipId: entry.shipId,
        faction: entry.faction,
        totalTargets: this.targets.length,
        registrationResults
      });
    }
    
    return true;
  }
  
  /**
   * Добавить новую цель в систему (старый метод для совместимости)
   */
  addTarget(entry: TargetEntry): void {
    const uniqueId = (entry.obj as any).__uniqueId;
    
    // Проверяем что цель еще не зарегистрирована
    const existing = this.targets.find(t => t.obj === entry.obj);
    if (existing) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[TargetManager] Target already registered: ${uniqueId}`);
      }
      return;
    }
    
    // КРИТИЧНАЯ ПРОВЕРКА: проверяем что __uniqueId уникален
    if (uniqueId) {
      const duplicateById = this.targets.find(t => (t.obj as any).__uniqueId === uniqueId);
      if (duplicateById) {
        console.error(`[TargetManager] CRITICAL: Duplicate __uniqueId detected! ${uniqueId}`, {
          existing: {
            prefab: (duplicateById.obj as any).__prefabKey,
            shipId: duplicateById.shipId,
            active: duplicateById.obj.active
          },
          new: {
            prefab: (entry.obj as any).__prefabKey,
            shipId: entry.shipId,
            active: entry.obj.active
          }
        });
        
        // Принудительно присваиваем новый ID для нового объекта
        (entry.obj as any).__uniqueId = ++TargetManager.npcCounter;
        if (process.env.NODE_ENV === 'development') {
          console.log(`[TargetManager] Assigned new ID: ${(entry.obj as any).__uniqueId}`);
        }
      }
    }
    
    // Валидация объекта перед регистрацией
    if (!entry.obj || typeof entry.obj.x !== 'number' || typeof entry.obj.y !== 'number') {
      console.error(`[TargetManager] Invalid object for registration:`, {
        hasObj: !!entry.obj,
        uniqueId,
        hasPosition: entry.obj && typeof entry.obj.x === 'number'
      });
      return;
    }
    
    this.targets.push(entry);
    
    let registrationSuccess = true;
    
    // Регистрируем в подсистемах с детальной отчетностью
    if (this.npcMovement) {
      try {
        this.npcMovement.registerNPC(entry.obj, entry.shipId, entry.combatAI);
        if (process.env.NODE_ENV === 'development') {
          console.log(`[TargetManager] ✓ NPC movement registration successful: ${uniqueId}`);
        }
      } catch (e) {
        console.error('[TargetManager] ✗ Failed to register in NPC movement:', e);
        registrationSuccess = false;
      }
    }
    
    if (this.npcStateManager) {
      try {
        this.npcStateManager.registerNPC(entry.obj, entry.aiProfileKey, entry.combatAI, entry.faction);
        if (process.env.NODE_ENV === 'development') {
          console.log(`[TargetManager] ✓ NPC state manager registration successful: ${uniqueId}`);
        }
      } catch (e) {
        console.error('[TargetManager] ✗ CRITICAL: Failed to register in NPC state manager:', {
          error: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : undefined,
          npcDetails: {
            uniqueId,
            prefab: (entry.obj as any).__prefabKey,
            shipId: entry.shipId,
            aiProfile: entry.aiProfileKey,
            combatAI: entry.combatAI,
            faction: entry.faction,
            position: { x: entry.obj.x, y: entry.obj.y },
            active: entry.obj.active,
            destroyed: entry.obj.destroyed,
            hasRequiredProps: {
              x: typeof entry.obj.x === 'number',
              y: typeof entry.obj.y === 'number',
              objExists: !!entry.obj
            }
          },
          existingContexts: this.npcStateManager ? this.npcStateManager.getAllContexts().size : 'N/A'
        });
        registrationSuccess = false;
        
        // Если регистрация в NPCStateManager не удалась, это критическая ошибка
        // Удаляем из targets чтобы избежать "NO CONTEXT" ошибок
        const index = this.targets.indexOf(entry);
        if (index >= 0) {
          this.targets.splice(index, 1);
          console.error(`[TargetManager] Removing target due to failed NPCStateManager registration: ${uniqueId}`);
          
          // Также очищаем визуальные элементы
          try { entry.hpBarBg.destroy(); } catch {}
          try { entry.hpBarFill.destroy(); } catch {}
          try { entry.nameLabel?.destroy(); } catch {}
          
          // Возвращаем null, так как NPC не был успешно создан
          return;
        }
      }
    }
    
    if (this.fogOfWar) {
      try {
        this.fogOfWar.registerDynamicObject(entry.obj, DynamicObjectType.NPC);
        if (process.env.NODE_ENV === 'development') {
          console.log(`[TargetManager] ✓ Fog of war registration successful: ${uniqueId}`);
        }
      } catch (e) {
        console.warn('[TargetManager] Failed to register in fog of war:', e);
        // Fog of war failures are not critical for gameplay
      }
    }
    
    if (process.env.NODE_ENV === 'development') {
      const status = registrationSuccess ? '✓ SUCCESS' : '✗ PARTIAL FAILURE';
      console.log(`[TargetManager] Target registration ${status}: ${uniqueId}`, {
        prefab: (entry.obj as any).__prefabKey,
        shipId: entry.shipId,
        faction: entry.faction,
        totalTargets: this.targets.length
      });
    }
  }
  
  /**
   * Удалить цель из системы с улучшенной очисткой
   */
  removeTarget(obj: any): void {
    const targetIndex = this.targets.findIndex(t => t.obj === obj);
    if (targetIndex === -1) {
      return; // Цель не найдена
    }
    
    const target = this.targets[targetIndex];
    const uniqueId = (obj as any).__uniqueId;
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[TargetManager] Removing target: ${uniqueId}`, {
        prefab: (obj as any).__prefabKey,
        faction: target.faction,
        shipId: target.shipId,
        totalTargets: this.targets.length
      });
    }
    
    // КРИТИЧНО: Сначала очищаем все ссылки на удаляемый объект в других целях
    this.clearReferencesToTarget(obj);
    
    // Очищаем визуальные элементы
    try { target.hpBarBg.destroy(); } catch {}
    try { target.hpBarFill.destroy(); } catch {}
    try { target.nameLabel?.destroy(); } catch {}
    
    // Очищаем индикаторы
    if (this.indicatorManager) {
      try {
        this.indicatorManager.destroyNPCBadge(obj);
      } catch {}
    }
    
    // Дерегистрируем из подсистем с детальной отчетностью
    if (this.npcMovement) {
      try {
        this.npcMovement.unregisterNPC(obj);
        if (process.env.NODE_ENV === 'development') {
          console.log(`[TargetManager] ✓ Unregistered from NPC movement: ${uniqueId}`);
        }
      } catch (e) {
        console.error(`[TargetManager] ✗ Failed to unregister from NPC movement: ${uniqueId}`, e);
      }
    }
    
    if (this.npcStateManager) {
      try {
        this.npcStateManager.unregisterNPC(obj);
        if (process.env.NODE_ENV === 'development') {
          console.log(`[TargetManager] ✓ Unregistered from NPC state manager: ${uniqueId}`);
        }
      } catch (e) {
        console.error(`[TargetManager] ✗ Failed to unregister from NPC state manager: ${uniqueId}`, e);
      }
    }
    
    if (this.fogOfWar) {
      try {
        this.fogOfWar.unregisterObject(obj);
        if (process.env.NODE_ENV === 'development') {
          console.log(`[TargetManager] ✓ Unregistered from fog of war: ${uniqueId}`);
        }
      } catch (e) {
        console.error(`[TargetManager] ✗ Failed to unregister from fog of war: ${uniqueId}`, e);
      }
    }
    
    // Удаляем из массива
    this.targets.splice(targetIndex, 1);
    
    // Безопасное уничтожение игрового объекта
    try {
      if (obj && typeof obj.destroy === 'function') {
        obj.destroy();
        if (process.env.NODE_ENV === 'development') {
          console.log(`[TargetManager] ✓ Destroyed game object: ${uniqueId}`);
        }
      }
    } catch (e) {
      console.error(`[TargetManager] ✗ Failed to destroy game object: ${uniqueId}`, e);
    }
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[TargetManager] ✓ Target removal complete: ${uniqueId}`, {
        remainingTargets: this.targets.length
      });
    }
  }
  
  /**
   * Очистить все ссылки на удаляемую цель в других целях
   */
  private clearReferencesToTarget(dyingObj: any): void {
    const dyingId = (dyingObj as any).__uniqueId;
    let clearedCount = 0;
    
    for (const target of this.targets) {
      if (target.obj === dyingObj) continue;
      
      let wasCleared = false;
      
      // Очищаем intent ссылки
      if (target.intent?.target === dyingObj) {
        target.intent = null;
        wasCleared = true;
      }
      
      // Очищаем из damage log
      if (target.damageLog) {
        if (target.damageLog.totalDamageBySource?.has(dyingObj)) {
          target.damageLog.totalDamageBySource.delete(dyingObj);
          wasCleared = true;
        }
        if (target.damageLog.lastDamageTimeBySource?.has(dyingObj)) {
          target.damageLog.lastDamageTimeBySource.delete(dyingObj);
          wasCleared = true;
        }
        if (target.damageLog.firstAttacker === dyingObj) {
          target.damageLog.firstAttacker = undefined;
          wasCleared = true;
        }
      }
      
      // Очищаем в новой системе состояний
      if (this.npcStateManager) {
        const context = this.npcStateManager.getContext(target.obj);
        if (context) {
          if (context.targetStabilization.currentTarget === dyingObj) {
            context.targetStabilization.currentTarget = null;
            context.targetStabilization.targetScore = 0;
            wasCleared = true;
          }
          
          if (context.aggression.sources.has(dyingObj)) {
            context.aggression.sources.delete(dyingObj);
            wasCleared = true;
          }
        }
      }
      
      if (wasCleared) {
        clearedCount++;
        if (process.env.NODE_ENV === 'development') {
          console.log(`[TargetManager] Cleared references in ${(target.obj as any).__uniqueId} to dying ${dyingId}`);
        }
      }
    }
    
    if (process.env.NODE_ENV === 'development' && clearedCount > 0) {
      console.log(`[TargetManager] Cleared references to ${dyingId} in ${clearedCount} targets`);
    }
  }
  
  /**
   * Получить запись цели по объекту
   */
  getTarget(obj: any): TargetEntry | null {
    return this.targets.find(t => t.obj === obj) || null;
  }
  
  /**
   * Получить все цели
   */
  getAllTargets(): TargetEntry[] {
    return [...this.targets]; // Возвращаем копию для безопасности
  }
  
  /**
   * Найти цели в радиусе от центра
   */
  getTargetsInRange(center: { x: number; y: number }, range: number): TargetEntry[] {
    return this.targets.filter(target => {
      if (!target.obj.active) return false;
      
      const distance = Phaser.Math.Distance.Between(
        center.x, center.y,
        target.obj.x, target.obj.y
      );
      
      return distance <= range;
    });
  }
  
  /**
   * Найти цель по координатам клика (для UI)
   */
  findTargetAt(worldX: number, worldY: number): TargetEntry | null {
    // Фильтруем цели в состоянии docking/docked/undocking - их нельзя выбирать для боя
    const availableTargets = this.targets.filter(t => {
      const state = (t.obj as any).__state;
      const isDockingState = state === 'docking' || state === 'docked' || state === 'undocking';
      return !isDockingState && t.obj.active;
    });
    
    // Сначала проверим попадание по кругу вокруг объекта
    let hit = availableTargets.find(t => {
      const rad = this.getEffectiveRadius(t.obj) + 12;
      return Phaser.Math.Distance.Between(t.obj.x, t.obj.y, worldX, worldY) <= rad;
    });
    if (hit) return hit;
    
    // Также считаем попаданием клики по области HP-бара
    hit = availableTargets.find(t => {
      const bg = t.hpBarBg;
      if (!bg || !bg.visible) return false;
      const x1 = bg.x, y1 = bg.y - bg.height * 0.5;
      const x2 = bg.x + bg.width, y2 = bg.y + bg.height * 0.5;
      return worldX >= x1 && worldX <= x2 && worldY >= y1 && worldY <= y2;
    });
    if (hit) return hit;
    
    // Последняя попытка: клик рядом с объектом в прямоугольнике дисплея
    hit = availableTargets.find(t => {
      const obj = t.obj;
      const w = (obj as any).displayWidth ?? (obj as any).width ?? 128;
      const h = (obj as any).displayHeight ?? (obj as any).height ?? 128;
      const x1 = obj.x - w * 0.5, y1 = obj.y - h * 0.5;
      const x2 = obj.x + w * 0.5, y2 = obj.y + h * 0.5;
      return worldX >= x1 && worldX <= x2 && worldY >= y1 && worldY <= y2;
    });
    
    return hit || null;
  }
  
  /**
   * Создать новый NPC используя префаб конфигурацию
   */
  spawnNPCPrefab(prefabKey: string, x: number, y: number): Phaser.GameObjects.GameObject | null {
    const prefab = this.config.stardwellers?.prefabs?.[prefabKey];
    const shipDefId = prefab?.shipId ?? prefabKey; // allow direct ship id fallback
    const ship = this.config.ships.defs[shipDefId] ?? this.config.ships.defs[this.config.ships.current];
    if (!ship) { 
      console.warn(`[TargetManager] Ship definition not found: ${shipDefId}`);
      return null; 
    }
    
    let obj: any;
    const s = ship.sprite;
    const texKey = (s.key && this.scene.textures.exists(s.key)) ? s.key : 
                   (this.scene.textures.exists('ship_alpha') ? 'ship_alpha' : 'ship_alpha_public');
    
    obj = this.scene.add.image(x, y, texKey).setDepth(0.8);
    (obj as any).__prefabKey = prefabKey;
    obj.setOrigin(s.origin?.x ?? 0.5, s.origin?.y ?? 0.5);
    obj.setDisplaySize(s.displaySize?.width ?? 64, s.displaySize?.height ?? 128);
    
    // Присваиваем уникальный ID
    (obj as any).__uniqueId = ++TargetManager.npcCounter;
    
    // Начальная ориентация — по носу из конфига
    obj.setRotation(Phaser.Math.DegToRad(s.noseOffsetDeg ?? 0));
    
    // Запомним базовый масштаб после применения displaySize
    (obj as any).__baseScaleX = obj.scaleX;
    (obj as any).__baseScaleY = obj.scaleY;
    obj.setAlpha(1);
    obj.setVisible(true);
    (obj as any).__noseOffsetRad = Phaser.Math.DegToRad(s.noseOffsetDeg ?? 0);
    
    // Создаем HP бары
    const barW = 192;
    const above = (Math.max(obj.displayWidth, obj.displayHeight) * 0.5) + 16;
    const bg = this.scene.add.rectangle(obj.x - barW/2, obj.y - above, barW, 8, 0x111827)
      .setOrigin(0, 0.5).setDepth(0.5);
    (bg as any).__baseWidth = barW;
    const fill = this.scene.add.rectangle(obj.x - barW/2, obj.y - above, barW, 8, 0x22c55e)
      .setOrigin(0, 0.5).setDepth(0.6);
    bg.setVisible(false); 
    fill.setVisible(false);
    
    // Создаем AI конфигурацию
    const aiProfileName = prefab?.aiProfile ?? 'planet_trader';
    const profile = this.config.aiProfiles.profiles[aiProfileName] ?? { behavior: 'static' } as any;
    const ai = { 
      preferRange: 0, 
      retreatHpPct: profile.combat?.retreatHpPct ?? 0, 
      type: 'ship' as const, 
      behavior: profile.behavior 
    } as any;
    
    // Создаем запись цели
    const entry: TargetEntry = { 
      obj, 
      hp: ship.hull ?? 100, 
      hpMax: ship.hull ?? 100, 
      hpBarBg: bg, 
      hpBarFill: fill, 
      ai, 
      shipId: prefab?.shipId ?? shipDefId, 
      faction: prefab?.faction, 
      combatAI: prefab?.combatAI, 
      aiProfileKey: aiProfileName, 
      intent: null 
    };
    
    if (prefab?.weapons && Array.isArray(prefab.weapons)) {
      entry.weaponSlots = prefab.weapons.slice(0);
    }
    
    // Добавляем цель в систему с немедленной валидацией
    // КРИТИЧНО: Проверяем что все регистрации прошли успешно
    const registrationSuccess = this.addTargetWithValidation(entry);
    
    if (!registrationSuccess) {
      // Если регистрация не удалась, немедленно очищаем созданные ресурсы
      const uniqueId = (obj as any).__uniqueId;
      console.error(`[TargetManager] SPAWN FAILED - Registration validation failed for ${prefabKey} #${uniqueId}`);
      
      // Очистка визуальных элементов
      try { bg.destroy(); } catch {}
      try { fill.destroy(); } catch {}
      try { obj.destroy(); } catch {}
      
      return null;
    }
    
    if (process.env.NODE_ENV === 'development') {
      const uniqueId = (obj as any).__uniqueId;
      console.log(`[TargetManager] ✓ NPC spawn successful: ${prefabKey} #${uniqueId}`, {
        faction: prefab?.faction,
        aiProfile: aiProfileName,
        combatAI: prefab?.combatAI,
        position: { x, y }
      });
    }
    
    return obj;
  }
  
  /**
   * Корректно удалить NPC из всех систем (например, после успешного докинга)
   */
  despawnNPC(target: any, reason?: string): void {
    if (process.env.NODE_ENV === 'development' && reason) {
      console.log(`[TargetManager] Despawning NPC: ${reason}`, {
        uniqueId: (target as any).__uniqueId,
        prefab: (target as any).__prefabKey
      });
    }
    
    // Удаляем из системы целей
    this.removeTarget(target);
    
    // Убираем из массива NPC сцены, если используется
    this.removeFromSceneNPCArray(target);
  }
  
  /**
   * Удалить NPC из массива npcs сцены
   */
  private removeFromSceneNPCArray(target: any): void {
    try {
      const arr: any[] | undefined = (this.scene as any).npcs;
      if (Array.isArray(arr)) {
        const idx = arr.indexOf(target);
        if (idx >= 0) {
          arr.splice(idx, 1);
          if (process.env.NODE_ENV === 'development') {
            console.log(`[TargetManager] Removed from scene.npcs array: ${(target as any).__uniqueId}`);
          }
        }
      }
    } catch (e) {
      console.error('[TargetManager] Error removing from scene.npcs array:', e);
    }
  }
  
  /**
   * Массовая очистка неактивных NPC из всех массивов сцены
   */
  cleanupSceneNPCArrays(): void {
    try {
      const arr: any[] | undefined = (this.scene as any).npcs;
      if (Array.isArray(arr)) {
        const before = arr.length;
        const toRemove: number[] = [];
        
        for (let i = 0; i < arr.length; i++) {
          const npc = arr[i];
          if (!npc || !npc.active || npc.destroyed) {
            toRemove.push(i);
          }
        }
        
        // Удаляем в обратном порядке чтобы не сбить индексы
        for (let i = toRemove.length - 1; i >= 0; i--) {
          arr.splice(toRemove[i], 1);
        }
        
        if (toRemove.length > 0 && process.env.NODE_ENV === 'development') {
          console.log(`[TargetManager] Cleaned ${toRemove.length} inactive NPCs from scene.npcs array (${before} → ${arr.length})`);
        }
      }
    } catch (e) {
      console.error('[TargetManager] Error cleaning scene.npcs array:', e);
    }
  }
  
  /**
   * Принудительная очистка неактивных целей с улучшенной диагностикой
   */
  forceCleanupInactiveTargets(): void {
    const before = this.targets.length;
    const toRemove: any[] = [];
    const reasons: string[] = [];
    
    for (const target of this.targets) {
      let shouldRemove = false;
      let reason = '';
      
      // Проверка активности объекта
      if (!target.obj || !(target.obj as any).active) {
        shouldRemove = true;
        reason = 'inactive object';
      }
      // Проверка дублирования ID
      else if ((target.obj as any).__uniqueId) {
        const duplicates = this.targets.filter(t => 
          t !== target && (t.obj as any).__uniqueId === (target.obj as any).__uniqueId
        );
        if (duplicates.length > 0) {
          shouldRemove = true;
          reason = `duplicate ID ${(target.obj as any).__uniqueId}`;
        }
      }
      // Проверка что объект еще существует в Phaser
      else if (target.obj.scene && !target.obj.scene.sys.displayList.exists(target.obj)) {
        shouldRemove = true;
        reason = 'object not in display list';
      }
      
      if (shouldRemove) {
        toRemove.push(target.obj);
        reasons.push(reason);
      }
    }
    
    if (toRemove.length > 0) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[TargetManager] Cleaning up ${toRemove.length} targets:`, {
          before,
          toRemove: toRemove.map((obj, i) => ({
            id: (obj as any).__uniqueId,
            prefab: (obj as any).__prefabKey,
            reason: reasons[i]
          }))
        });
      }
      
      for (const obj of toRemove) {
        this.removeTarget(obj);
      }
      
      const after = this.targets.length;
      if (process.env.NODE_ENV === 'development') {
        console.log(`[TargetManager] Cleanup complete: ${before} → ${after} targets`);
      }
    }
  }
  
  // === Weapon Assignment Management ===
  
  /**
   * Назначить цель для оружия (вызывается из WeaponManager)
   */
  assignTarget(obj: any, weapon: string): void {
    // Реализация будет зависеть от интеграции с WeaponManager
    // Пока оставляем заглушку для совместимости с интерфейсом
  }
  
  /**
   * Очистить назначения оружия для цели
   */
  clearAssignments(obj: any): void {
    // Реализация будет зависеть от интеграции с WeaponManager
    // Пока оставляем заглушку для совместимости с интерфейсом
  }
  
  // === Utility Methods ===
  
  /**
   * Получить эффективный радиус объекта для определения попаданий
   */
  private getEffectiveRadius(obj: any): number {
    if (typeof obj.displayWidth === 'number' && typeof obj.displayHeight === 'number') {
      return Math.max(obj.displayWidth, obj.displayHeight) * 0.5;
    }
    if (typeof obj.radius === 'number') return obj.radius;
    const w = (typeof obj.width === 'number' ? obj.width : 128);
    const h = (typeof obj.height === 'number' ? obj.height : 128);
    return Math.max(w, h) * 0.5;
  }
  
  /**
   * Получить публичную информацию о целях (для других систем)
   */
  getPublicTargetEntries(): ReadonlyArray<{
    obj: any; 
    faction?: string; 
    overrides?: any; 
    intent?: any; 
    combatAI?: string; 
    weaponSlots?: string[]; 
    shipId?: string 
  }> {
    return this.targets.map(t => ({ 
      obj: t.obj, 
      faction: t.faction, 
      overrides: t.overrides, 
      intent: t.intent, 
      combatAI: t.combatAI, 
      weaponSlots: t.weaponSlots, 
      shipId: t.shipId 
    }));
  }
  
  /**
   * Найти публичную запись цели
   */
  findPublicTargetEntry(obj: any): {
    obj: any; 
    faction?: string; 
    overrides?: any; 
    intent?: any; 
    combatAI?: string; 
    weaponSlots?: string[]; 
    shipId?: string 
  } | undefined {
    const t = this.targets.find(tt => tt.obj === obj);
    return t ? { 
      obj: t.obj, 
      faction: t.faction, 
      overrides: t.overrides, 
      intent: t.intent, 
      combatAI: t.combatAI, 
      weaponSlots: t.weaponSlots, 
      shipId: t.shipId 
    } : undefined;
  }
  
  /**
   * Получить игровые объекты всех целей
   */
  getTargetObjects(): Phaser.GameObjects.GameObject[] {
    return this.targets.map(t => t.obj as Phaser.GameObjects.GameObject);
  }
  
  /**
   * Получить количество активных целей
   */
  getTargetCount(): number {
    return this.targets.filter(t => t.obj.active).length;
  }
  
  /**
   * Проверить существует ли цель
   */
  hasTarget(obj: any): boolean {
    return this.targets.some(t => t.obj === obj);
  }
  
  /**
   * Проверка и исправление дубликатов __uniqueId
   */
  validateAndFixDuplicateIds(): number {
    const idCounts = new Map<number, any[]>();
    let fixedCount = 0;
    
    // Собираем статистику по ID
    for (const target of this.targets) {
      const id = (target.obj as any).__uniqueId;
      if (typeof id === 'number') {
        if (!idCounts.has(id)) {
          idCounts.set(id, []);
        }
        idCounts.get(id)!.push(target);
      }
    }
    
    // Исправляем дубликаты
    for (const [id, targets] of idCounts.entries()) {
      if (targets.length > 1) {
        console.warn(`[TargetManager] Found ${targets.length} targets with duplicate ID ${id}`);
        
        // Оставляем первый, остальным присваиваем новые ID
        for (let i = 1; i < targets.length; i++) {
          const target = targets[i];
          const oldId = (target.obj as any).__uniqueId;
          const newId = ++TargetManager.npcCounter;
          (target.obj as any).__uniqueId = newId;
          fixedCount++;
          
          if (process.env.NODE_ENV === 'development') {
            console.log(`[TargetManager] Fixed duplicate ID: ${oldId} → ${newId}`, {
              prefab: (target.obj as any).__prefabKey,
              shipId: target.shipId
            });
          }
        }
      }
    }
    
    return fixedCount;
  }
  
  /**
   * Проверка интегритета регистраций для диагностики
   */
  validateRegistrationIntegrity(): {
    totalTargets: number;
    registeredInNpcState: number;
    registeredInMovement: number;
    registeredInFog: number;
    missingRegistrations: Array<{
      id: string;
      prefab: string;
      missingIn: string[];
    }>;
  } {
    const result = {
      totalTargets: this.targets.length,
      registeredInNpcState: 0,
      registeredInMovement: 0,
      registeredInFog: 0,
      missingRegistrations: [] as Array<{
        id: string;
        prefab: string;
        missingIn: string[];
      }>
    };
    
    for (const target of this.targets) {
      const id = (target.obj as any).__uniqueId || 'unknown';
      const prefab = (target.obj as any).__prefabKey || 'unknown';
      const missing: string[] = [];
      
      // Проверяем регистрацию в NPCStateManager
      if (this.npcStateManager) {
        const hasContext = this.npcStateManager.getContext(target.obj);
        if (hasContext) {
          result.registeredInNpcState++;
        } else {
          missing.push('NPCStateManager');
        }
      }
      
      // Проверяем регистрацию в NpcMovement (если есть метод проверки)
      if (this.npcMovement && typeof this.npcMovement.hasNPC === 'function') {
        if (this.npcMovement.hasNPC(target.obj)) {
          result.registeredInMovement++;
        } else {
          missing.push('NPCMovement');
        }
      }
      
      // Проверяем регистрацию в FogOfWar (если есть метод проверки)
      if (this.fogOfWar && typeof this.fogOfWar.hasObject === 'function') {
        if (this.fogOfWar.hasObject(target.obj)) {
          result.registeredInFog++;
        } else {
          missing.push('FogOfWar');
        }
      }
      
      if (missing.length > 0) {
        result.missingRegistrations.push({ id, prefab, missingIn: missing });
      }
    }
    
    return result;
  }
  
  /**
   * Метод для корректного завершения работы
   */
  destroy(): void {
    // Очищаем все цели
    const targetsToRemove = [...this.targets];
    for (const target of targetsToRemove) {
      this.removeTarget(target.obj);
    }
    
    this.targets.length = 0;
  }
}