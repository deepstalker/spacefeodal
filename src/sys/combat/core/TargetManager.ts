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
   * Добавить новую цель в систему
   */
  addTarget(entry: TargetEntry): void {
    // Проверяем что цель еще не зарегистрирована
    const existing = this.targets.find(t => t.obj === entry.obj);
    if (existing) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[TargetManager] Target already registered: ${(entry.obj as any).__uniqueId}`);
      }
      return;
    }
    
    this.targets.push(entry);
    
    // Регистрируем в подсистемах
    if (this.npcMovement) {
      try {
        this.npcMovement.registerNPC(entry.obj, entry.shipId, entry.combatAI);
      } catch (e) {
        console.warn('[TargetManager] Failed to register in NPC movement:', e);
      }
    }
    
    if (this.npcStateManager) {
      try {
        this.npcStateManager.registerNPC(entry.obj, entry.aiProfileKey, entry.combatAI, entry.faction);
      } catch (e) {
        console.warn('[TargetManager] Failed to register in NPC state manager:', e);
      }
    }
    
    if (this.fogOfWar) {
      try {
        this.fogOfWar.registerDynamicObject(entry.obj, DynamicObjectType.NPC);
      } catch (e) {
        console.warn('[TargetManager] Failed to register in fog of war:', e);
      }
    }
  }
  
  /**
   * Удалить цель из системы
   */
  removeTarget(obj: any): void {
    const targetIndex = this.targets.findIndex(t => t.obj === obj);
    if (targetIndex === -1) {
      return; // Цель не найдена
    }
    
    const target = this.targets[targetIndex];
    
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
    
    // Дерегистрируем из подсистем
    if (this.npcMovement) {
      try {
        this.npcMovement.unregisterNPC(obj);
      } catch {}
    }
    
    if (this.npcStateManager) {
      try {
        this.npcStateManager.unregisterNPC(obj);
      } catch {}
    }
    
    if (this.fogOfWar) {
      try {
        this.fogOfWar.unregisterObject(obj);
      } catch {}
    }
    
    // Удаляем из массива
    this.targets.splice(targetIndex, 1);
    
    // Уничтожаем игровой объект
    try {
      (obj as any).destroy?.();
    } catch {}
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
    
    // Добавляем цель в систему
    this.addTarget(entry);
    
    return obj;
  }
  
  /**
   * Корректно удалить NPC из всех систем (например, после успешного докинга)
   */
  despawnNPC(target: any, reason?: string): void {
    if (process.env.NODE_ENV === 'development' && reason) {
      console.log(`[TargetManager] Despawning NPC: ${reason}`, {
        uniqueId: (target as any).__uniqueId
      });
    }
    
    this.removeTarget(target);
    
    // Убираем из массива NPC сцены, если используется
    try {
      const arr: any[] | undefined = (this.scene as any).npcs;
      if (Array.isArray(arr)) {
        const idx = arr.indexOf(target);
        if (idx >= 0) arr.splice(idx, 1);
      }
    } catch {}
  }
  
  /**
   * Принудительная очистка неактивных целей
   */
  forceCleanupInactiveTargets(): void {
    const toRemove: any[] = [];
    
    for (const target of this.targets) {
      if (!target.obj || !(target.obj as any).active) {
        toRemove.push(target.obj);
      }
    }
    
    if (toRemove.length > 0) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[TargetManager] Cleaning up ${toRemove.length} inactive targets`);
      }
      
      for (const obj of toRemove) {
        this.removeTarget(obj);
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