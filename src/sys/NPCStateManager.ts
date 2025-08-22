import type { ConfigManager } from './ConfigManager';
import type { NPCStateContext } from './combat/CombatTypes';
import { NPCStateMachine, NPCState } from './combat/state/NPCStateMachine';
import { TargetAnalyzer } from './combat/ai/TargetAnalyzer';
import { MovementCoordinator } from './combat/movement/MovementCoordinator';

// Экспортируем NPCState для совместимости
export { NPCState } from './combat/state/NPCStateMachine';

// Экспортируем MovementPriority для совместимости
export { MovementPriority } from './combat/movement/MovementCoordinator';

export class NPCStateManager {
  private scene: Phaser.Scene;
  private pauseManager?: any; // PauseManager reference
  private config: ConfigManager;
  private contexts: Map<any, NPCStateContext> = new Map();
  
  // Новые компоненты (dependency injection)
  private stateMachine: NPCStateMachine;
  private targetAnalyzer: TargetAnalyzer;
  private movementCoordinator: MovementCoordinator;
  
  // Настройки системы
  private readonly AGGRESSION_COOLDOWN_RATE = 0.3; // агрессия снижается на 30%/сек
  private readonly TARGET_SWITCH_THRESHOLD = 1.4;   // требуется 40% преимущество
  private readonly TARGET_STABILITY_TIME = 1500;    // 1.5 сек стабильности
  private readonly DAMAGE_MEMORY_TIME = 30000;      // 30 сек помним урон
  
  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
    
    // Создаем новые компоненты
    this.stateMachine = new NPCStateMachine(scene, config);
    this.targetAnalyzer = new TargetAnalyzer(scene, config);
    this.movementCoordinator = new MovementCoordinator(scene, config);
    
    // Настраиваем зависимости между компонентами
    this.stateMachine.setTargetAnalyzer(this.targetAnalyzer);
    this.stateMachine.setMovementCoordinator(this.movementCoordinator);
    
    // Обновляем состояния каждый кадр
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
  }

  setPauseManager(pauseManager: any) {
    this.pauseManager = pauseManager;
  }

  // === Dependency Injection для интеграции с CombatManager ===
  
  setCombatManager(combatManager: any): void {
    this.stateMachine.setCombatManager(combatManager);
    this.movementCoordinator.setCombatManager(combatManager);
  }
  
  setNpcMovementManager(npcMovementManager: any): void {
    this.movementCoordinator.setNpcMovementManager(npcMovementManager);
  }

  // Регистрация нового NPC (вызывается при спавне)
  registerNPC(obj: any, aiProfile?: string, combatAI?: string, faction?: string): void {
    const objId = (obj as any).__uniqueId || 'unknown';
    
    // КРИТИЧНАЯ ПРОВЕРКА: убеждаемся что объект не уже зарегистрирован
    if (this.contexts.has(obj)) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[NPCState] Attempting to register already registered NPC ${objId}`);
      }
      return;
    }
    
    // Проверяем нет ли "потерянных" контекстов для других объектов с тем же ID
    for (const [existingObj, existingContext] of this.contexts.entries()) {
      if ((existingObj as any).__uniqueId === objId && existingObj !== obj) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[NPCState] Found orphaned context for ID ${objId}, cleaning up`);
        }
        this.contexts.delete(existingObj);
      }
    }
    
    const context: NPCStateContext = {
      obj,
      state: NPCState.SPAWNING as any,
      previousState: NPCState.SPAWNING as any,
      stateEnterTime: this.scene.time.now,
      
      aggression: {
        level: 0,
        lastDamageTime: 0,
        lastCombatTime: 0,
        cooldownRate: this.AGGRESSION_COOLDOWN_RATE,
        sources: new Map()
      },
      
      targetStabilization: {
        currentTarget: null,
        targetScore: 0,
        targetSwitchTime: 0,
        requiredAdvantage: this.TARGET_SWITCH_THRESHOLD,
        stabilityPeriod: this.TARGET_STABILITY_TIME
      },
      
      movementQueue: [],
      currentMovement: null,
      
      aiProfile,
      combatAI,
      faction,
      
      // Сохраняем существующие поля для совместимости
      legacy: {
        __behavior: obj.__behavior,
        __state: obj.__state,
        intent: obj.intent
      }
    };
    
    this.contexts.set(obj, context);
    
    // Debug logging disabled
    // if (process.env.NODE_ENV === 'development') {
    //   console.log(`[NPCState] Registered NPC ${objId}`, {
    //     aiProfile,
    //     combatAI,
    //     faction,
    //     totalContexts: this.contexts.size
    //   });
    // }
    
    // Автоматический переход в начальное состояние через кадр
    this.scene.time.delayedCall(1, () => {
      // Дополнительная проверка что контекст всё ещё валиден
      const currentContext = this.contexts.get(obj);
      if (currentContext && currentContext.obj === obj) {
        this.stateMachine.initializeFromLegacy(currentContext);
      } else if (process.env.NODE_ENV === 'development') {
        console.error(`[NPCState] Context corrupted during delayed init for ${objId}`);
      }
    });
  }

  // Удаление NPC
  unregisterNPC(obj: any): void {
    const objId = (obj as any).__uniqueId || 'unknown';
    const context = this.contexts.get(obj);
    
    if (!context) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[NPCState] Attempting to unregister non-existent NPC ${objId}`);
      }
      return;
    }
    
    // КРИТИЧНАЯ ПРОВЕРКА: убеждаемся что удаляем правильный контекст
    if (context.obj !== obj) {
      if (process.env.NODE_ENV === 'development') {
        console.error(`[NPCState] Context mismatch during unregister! Expected ${objId} but got ${(context.obj as any).__uniqueId}`);
      }
      return;
    }
    
    this.contexts.delete(obj);
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[NPCState] Unregistered NPC ${objId}`, {
        totalContexts: this.contexts.size,
        hadAggression: context.aggression.level > 0,
        aggressionSources: context.aggression.sources.size
      });
    }
  }

  // === Методы делегирования к компонентам ===
  
  // Переход между состояниями (делегирование к StateMachine)
  transitionTo(context: NPCStateContext, newState: NPCState): boolean {
    return this.stateMachine.transitionTo(context, newState);
  }

  // Добавление команды движения
  addMovementCommand(obj: any, mode: string, target: any, distance: number | undefined, priority: MovementPriority, source: string): boolean {
    const context = this.contexts.get(obj);
    if (!context) return false;
    
    const command: MovementCommand = {
      mode,
      target,
      distance,
      priority,
      source,
      timestamp: this.scene.time.now
    };
    
    // Проверяем, можем ли мы добавить команду с таким приоритетом
    if (context.currentMovement && context.currentMovement.priority > priority) {
      // Текущая команда имеет более высокий приоритет
      return false;
    }
    
    // Удаляем старые команды с меньшим приоритетом
    context.movementQueue = context.movementQueue.filter(cmd => cmd.priority >= priority);
    
    // Добавляем новую команду
    context.movementQueue.push(command);
    context.movementQueue.sort((a, b) => b.priority - a.priority);
    
    // Если это команда с более высоким приоритетом, делаем её активной
    if (!context.currentMovement || priority > context.currentMovement.priority) {
      context.currentMovement = command;
    }
    
    return true;
  }

  // Обновление агрессии
  updateAggression(context: NPCStateContext, deltaMs: number): void {
    const now = this.scene.time.now;
    const aggression = context.aggression;
    
    // Очищаем старые источники урона
    for (const [source, data] of aggression.sources.entries()) {
      if (now - data.lastTime > this.DAMAGE_MEMORY_TIME) {
        aggression.sources.delete(source);
      }
    }
    
    // Снижаем агрессию со временем
    const timeSinceLastDamage = now - aggression.lastDamageTime;
    const timeSinceLastCombat = now - aggression.lastCombatTime;
    
    if (timeSinceLastDamage > 5000 && timeSinceLastCombat > 3000) {
      const cooldownAmount = aggression.cooldownRate * (deltaMs / 1000);
      aggression.level = Math.max(0, aggression.level - cooldownAmount);
    }
  }

  // Регистрация урона (для системы агрессии)
  registerDamage(obj: any, damage: number, attacker: any): void {
    const objId = (obj as any).__uniqueId || 'unknown';
    const attackerId = attacker ? (attacker as any).__uniqueId || 'PLAYER_CANDIDATE' : 'unknown';
    
    // ОТЛАДКА: Логируем ВСЕ вызовы registerDamage
    if (process.env.NODE_ENV === 'development') {
      console.log(`[RegisterDamage] ${objId} ← ${damage} from ${attackerId}`, {
        hasAttacker: !!attacker,
        attackerType: attacker?.constructor?.name,
        attackerTexture: (attacker as any)?.texture?.key,
        attackerActive: attacker?.active
      });
    }
    
    const context = this.contexts.get(obj);
    if (!context) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Damage] WARNING: No context found for NPC ${objId}`, {
          hasObj: !!obj,
          objActive: obj?.active,
          totalContexts: this.contexts.size
        });
      }
      return;
    }
    
    // КРИТИЧНАЯ ПРОВЕРКА: убеждаемся что контекст принадлежит правильному объекту
    if (context.obj !== obj) {
      if (process.env.NODE_ENV === 'development') {
        console.error(`[Damage] CONTEXT MISMATCH! Expected obj ${(obj as any).__uniqueId} but got context for ${(context.obj as any).__uniqueId}`);
      }
      return;
    }
    
    const now = this.scene.time.now;
    const aggression = context.aggression;
    const victimId = (obj as any).__uniqueId;
    
    // Определяем является ли атакующий игроком
    const playerShip = (this.scene as any).combatManager?.ship;
    const isPlayerAttacker = attacker === playerShip;
    
    // Увеличиваем общий уровень агрессии (одинаково для всех)
    const aggressionIncrease = damage * 0.01; // +1% за урон от любого источника
    const oldAggression = aggression.level;
    aggression.level = Math.min(1, aggression.level + aggressionIncrease);
    aggression.lastDamageTime = now;
    
    // Запоминаем источник урона
    if (attacker) {
      const existing = aggression.sources.get(attacker) || { damage: 0, lastTime: 0 };
      existing.damage += damage;
      existing.lastTime = now;
      aggression.sources.set(attacker, existing);
      
      // ДЕТАЛЬНАЯ отладочная информация для ВСЕХ атак
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Damage] ${victimId} ← ${damage} dmg from ${attackerId}`, {
          victimContextObj: (context.obj as any).__uniqueId,
          victimRealObj: victimId,
          isContextMatch: context.obj === obj,
          totalFromAttacker: existing.damage,
          aggressionBefore: (oldAggression * 100).toFixed(0) + '%',
          aggressionAfter: (aggression.level * 100).toFixed(0) + '%',
          aggressionSourcesCount: aggression.sources.size,
          currentState: context.state
        });
        
        // Показываем всех источников урона для этого NPC
        if (aggression.sources.size > 1) {
          const sourcesInfo: any = {};
          for (const [source, data] of aggression.sources.entries()) {
            const sourceId = source === this.scene.children.getAll().find(o => (o as any)['__moveRef']) ? 'PLAYER' : 
                           (source as any).__uniqueId || 'unknown';
            sourcesInfo[sourceId] = data.damage;
          }
          console.log(`[Damage] ${victimId} damage sources:`, sourcesInfo);
        }
      }
    }
    
    // Переводим в боевое состояние если нужно
    if (context.state === NPCState.IDLE || 
        context.state === NPCState.PATROLLING || 
        context.state === NPCState.TRADING) {
      this.transitionTo(context, NPCState.COMBAT_SEEKING);
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`[State] ${victimId} entering combat due to damage from ${attackerId}`);
      }
    }
  }

  // Оценка цели (делегирование к TargetAnalyzer)
  evaluateTarget(context: NPCStateContext, target: any): number {
    return this.targetAnalyzer.evaluateTarget(context, target);
  }

  // Стабильный выбор цели (делегирование к TargetAnalyzer)
  selectStableTarget(context: NPCStateContext, candidates: any[]): any | null {
    return this.targetAnalyzer.selectStableTarget(context, candidates);
  }

  // Получение текущего состояния
  getState(obj: any): NPCState | null {
    const context = this.contexts.get(obj);
    return context?.state || null;
  }

  // Получение контекста (для отладки)
  getContext(obj: any): NPCStateContext | null {
    return this.contexts.get(obj) || null;
  }

  // Проверка, находится ли NPC в боевом состоянии
  isInCombat(obj: any): boolean {
    const state = this.getState(obj);
    return state === NPCState.COMBAT_SEEKING || 
           state === NPCState.COMBAT_ATTACKING || 
           state === NPCState.COMBAT_FLEEING;
  }

  // Основной цикл обновления
  private update(_time: number, deltaMs: number): void {
    // Проверяем конфиг паузы
    if (this.pauseManager?.isSystemPausable('npcStateManager') && this.pauseManager?.getPaused()) {
      return;
    }
    
    const toDelete: any[] = [];
    
    for (const [obj, context] of this.contexts.entries()) {
      // КРИТИЧНАЯ ПРОВЕРКА: убеждаемся что контекст соответствует объекту
      if (context.obj !== obj) {
        if (process.env.NODE_ENV === 'development') {
          console.error(`[NPCState] Critical context corruption detected!`, {
            mapKey: (obj as any).__uniqueId,
            contextObj: (context.obj as any).__uniqueId,
            keyActive: obj?.active,
            contextObjActive: context.obj?.active
          });
        }
        toDelete.push(obj);
        continue;
      }
      
      if (!obj.active) {
        toDelete.push(obj);
        continue;
      }
      
      // Обновляем агрессию
      this.updateAggression(context, deltaMs);
      
      // Обновляем очередь команд движения (делегирование к MovementCoordinator)
      this.movementCoordinator.updateMovementCommands(context);
      
      // Логика конкретных состояний (делегирование к StateMachine)
      this.stateMachine.updateStateLogic(context, deltaMs);
    }
    
    // Очищаем поврежденные или неактивные контексты
    for (const obj of toDelete) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[NPCState] Cleaning up inactive/corrupted context for ${(obj as any).__uniqueId}`);
      }
      this.contexts.delete(obj);
    }
  }

  // Обновление очереди команд движения
  private updateMovementQueue(context: NPCStateContext): void {
    // Удаляем устаревшие команды (старше 10 секунд)
    const now = this.scene.time.now;
    context.movementQueue = context.movementQueue.filter(cmd => 
      now - cmd.timestamp < 10000
    );
    
    // Выбираем команду с наивысшим приоритетом
    if (context.movementQueue.length > 0) {
      context.currentMovement = context.movementQueue[0];
    } else {
      context.currentMovement = null;
    }
  }

  // Логика состояний
  private updateStateLogic(context: NPCStateContext, deltaMs: number): void {
    const state = context.state;
    const timeInState = this.scene.time.now - context.stateEnterTime;
    
    switch (state) {
      case NPCState.SPAWNING:
        // Автоматический переход из спавна через 100мс
        if (timeInState > 100) {
          this.initializeFromLegacy(context);
        }
        break;
        
      case NPCState.COMBAT_SEEKING:
        // Централизованный поиск цели и переход в атаку/бегство
        this.handleCombatSeeking(context);
        break;
        
      case NPCState.COMBAT_ATTACKING:
        // Проверяем, есть ли еще цель для атаки
        if (!context.targetStabilization.currentTarget || 
            !context.targetStabilization.currentTarget.active) {
          this.transitionTo(context, NPCState.COMBAT_SEEKING);
        } else {
          // Если цель вышла за радиус интереса — переходим к поиску новой
          const combat = (this.scene as any).combat as any;
          const radar = combat?.getRadarRangeForPublic?.(context.obj) ?? 800;
          const tgt = context.targetStabilization.currentTarget;
          const d = Phaser.Math.Distance.Between(context.obj.x, context.obj.y, tgt.x, tgt.y);
          if (d > radar) {
            this.transitionTo(context, NPCState.COMBAT_SEEKING);
          }
        }
        break;
        
      case NPCState.COMBAT_FLEEING:
        // Проверяем, можно ли остановить бегство
        if (context.aggression.level < 0.3 && timeInState > 5000) {
          this.transitionTo(context, NPCState.COMBAT_SEEKING);
        }
        break;
    }
  }

  // Единая логика поиска/выбора боевой цели и решений (атака/бегство/мирное)
  private handleCombatSeeking(context: NPCStateContext): void {
    const combat = (this.scene as any).combat as any;
    const my = context.obj;
    const myFaction = context.faction;
    const radar = combat?.getRadarRangeForPublic?.(my) ?? 800;
    const all = combat?.getAllNPCs?.() ?? [];
    const selfRec = all.find((r: any) => r.obj === my);
    const myOverrides = selfRec?.overrides?.factions;
    // Профиль ИИ для реакций на фракции
    const profile = context.aiProfile ? this.config.aiProfiles?.profiles?.[context.aiProfile] : undefined as any;
    const behavior = profile?.behavior as string | undefined;
    const reactions = profile?.sensors?.react?.onFaction as Record<'ally'|'neutral'|'confrontation', 'ignore'|'attack'|'flee'|'seekEscort'> | undefined;
    const candidates = all
      .filter((r: any) => r && r.obj !== my && r.obj?.active)
      .filter((r: any) => {
        const d = Phaser.Math.Distance.Between(my.x, my.y, r.obj.x, r.obj.y);
        if (d > radar) return false;
        // враги по отношениям с учетом overrides с обеих сторон (временная вражда)
        const relAB = combat.getRelationPublic(myFaction, r.faction, myOverrides);
        const relBA = combat.getRelationPublic(r.faction, myFaction, r.overrides?.factions);
        return relAB === 'confrontation' || relBA === 'confrontation';
      })
      .map((r: any) => r.obj);
    // Добавляем игрока как потенциальную цель если близко
    const player = combat?.getPlayerShip?.();
    if (player && player.active) {
      const dp = Phaser.Math.Distance.Between(my.x, my.y, player.x, player.y);
      if (dp <= radar) {
        const relToPlayer = combat.getRelationPublic(myFaction, 'player', myOverrides);
        const reactionToRel = reactions?.[relToPlayer] ?? 'ignore';
        const wantsAttackPlayer = (behavior === 'aggressive') || (reactionToRel === 'attack');
        if (wantsAttackPlayer && !candidates.includes(player)) {
          candidates.push(player);
        }
      }
    }
    // Выбор стабильной цели
    let best = this.selectStableTarget(context, candidates);
    // Если ещё нет цели, но игрок рядом и поведение агрессивное — выберем игрока
    if (!best && player && player.active) {
      const dp = Phaser.Math.Distance.Between(my.x, my.y, player.x, player.y);
      const relToPlayer = combat.getRelationPublic(myFaction, 'player', myOverrides);
      const reactionToRel = reactions?.[relToPlayer] ?? 'ignore';
      const wantsAttackPlayer = (behavior === 'aggressive') || (reactionToRel === 'attack');
      if (dp <= radar && wantsAttackPlayer) { best = player; }
    }
    if (best && best.active) {
      context.targetStabilization.currentTarget = best;
      // Решение: бежать или атаковать (порог по агрессии/здоровью может быть из combatAI профиля)
      const retreatPct =  context.combatAI ? (this.config.combatAI?.profiles?.[context.combatAI]?.retreatHpPct ?? 0) : 0;
      const isNonCombat = !!(context.combatAI && this.config.combatAI?.profiles?.[context.combatAI!]?.nonCombat);
      const shouldFlee = isNonCombat; // мирные всегда избегают боя
      if (shouldFlee) {
        this.transitionTo(context, NPCState.COMBAT_FLEEING);
      } else {
        this.transitionTo(context, NPCState.COMBAT_ATTACKING);
        // Добавим движение к цели с приоритетом боя и применим его немедленно через CombatManager
        this.addMovementCommand(my, 'pursue', { x: best.x, y: best.y, targetObject: best }, undefined, MovementPriority.COMBAT, 'npc_fsm_combat');
        (this.scene as any).combat?.applyMovementFromFSM?.(my, 'pursue', { x: best.x, y: best.y, targetObject: best });
      }
    } else {
      // Нет цели в радиусе — немедленный возврат к базовому поведению
      const base = context.aiProfile || context.legacy.__behavior;
      if (base === 'patrol') this.transitionTo(context, NPCState.PATROLLING);
      else if (base === 'planet_trader' || base === 'orbital_trade') this.transitionTo(context, NPCState.TRADING);
      else this.transitionTo(context, NPCState.IDLE);
    }
  }

  // Принудительная смена состояния (для внешних систем)
  forceState(obj: any, state: NPCState): boolean {
    const context = this.contexts.get(obj);
    if (!context) return false;
    
    return this.transitionTo(context, state);
  }

  // Очистка всех данных
  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.update, this);
    this.contexts.clear();
  }
}
