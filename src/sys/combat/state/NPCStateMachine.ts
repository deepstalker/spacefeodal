import type { ConfigManager } from '../../ConfigManager';
import type { NPCStateContext } from '../CombatTypes';
import { MovementPriority } from '../../NPCStateManager';
import { CombatAI } from '../ai/CombatAI';

// Перечисление состояний NPC (извлечено из NPCStateManager)
export enum NPCState {
  SPAWNING = 'spawning',           // Только что заспавнился
  IDLE = 'idle',                   // Бездействие
  PATROLLING = 'patrolling',       // Патрулирование
  TRADING = 'trading',             // Торговля (движение к планетам)
  COMBAT_SEEKING = 'combat_seeking', // Ищет цель для атаки
  COMBAT_ATTACKING = 'combat_attacking', // Активно атакует
  COMBAT_FLEEING = 'combat_fleeing', // Бегство от противника
  DOCKING = 'docking',             // Процесс стыковки
  DOCKED = 'docked',               // Пристыкован
  UNDOCKING = 'undocking',         // Процесс отстыковки
  RETURNING_HOME = 'returning_home', // Возвращается домой
  DESTROYED = 'destroyed'          // Уничтожен
}

/**
 * Машина состояний для NPC - извлеченная логика управления состояниями
 * Отвечает за переходы между состояниями, валидацию переходов и поведение в состояниях
 */
export class NPCStateMachine {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  
  // Зависимости (инжектируются извне)
  private targetAnalyzer?: any; // TargetAnalyzer для анализа целей
  private movementCoordinator?: any; // MovementCoordinator для команд движения
  private combatManager?: any; // CombatManager для интеграции
  
  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
  }
  
  // === Dependency Injection ===
  
  setTargetAnalyzer(analyzer: any): void {
    this.targetAnalyzer = analyzer;
  }
  
  setMovementCoordinator(coordinator: any): void {
    this.movementCoordinator = coordinator;
  }
  
  setCombatManager(manager: any): void {
    this.combatManager = manager;
  }
  
  // === Основные методы управления состояниями ===
  
  /**
   * Переход между состояниями
   * ПЕРЕНЕСЕНО ИЗ NPCStateManager.transitionTo()
   */
  transitionTo(context: NPCStateContext, newState: NPCState): boolean {
    if (!this.canTransition(context.state as NPCState, newState)) {
      return false;
    }
    
    const oldState = context.state as NPCState;
    this.exitState(context, oldState);
    
    context.previousState = oldState as any;
    context.state = newState as any;
    context.stateEnterTime = this.scene.time.now;
    
    this.enterState(context, newState);
    
    return true;
  }
  
  /**
   * Обновление логики состояний
   * ПЕРЕНЕСЕНО ИЗ NPCStateManager.updateStateLogic()
   */
  updateStateLogic(context: NPCStateContext, deltaMs: number): void {
    const state = context.state as NPCState;
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
          const combat = this.combatManager || (this.scene as any).combat;
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
  
  /**
   * Инициализация состояния из существующих полей
   * ПЕРЕНЕСЕНО ИЗ NPCStateManager.initializeFromLegacy()
   */
  initializeFromLegacy(context: NPCStateContext): void {
    const obj = context.obj;
    const behavior = obj.__behavior || context.aiProfile;
    
    // Определяем начальное состояние на основе поведения
    switch (behavior) {
      case 'patrol':
        this.transitionTo(context, NPCState.PATROLLING);
        break;
      case 'planet_trader':
      case 'orbital_trade':
        this.transitionTo(context, NPCState.TRADING);
        break;
      case 'aggressive':
        this.transitionTo(context, NPCState.COMBAT_SEEKING);
        break;
      case 'static':
        this.transitionTo(context, NPCState.IDLE);
        break;
      default:
        this.transitionTo(context, NPCState.IDLE);
    }
  }
  
  /**
   * Логика поиска и выбора боевой цели
   * ПЕРЕНЕСЕНО ИЗ NPCStateManager.handleCombatSeeking()
   */
  handleCombatSeeking(context: NPCStateContext): void {
    const combat = this.combatManager || (this.scene as any).combat;
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
    
    // Поиск враждебных целей
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
    
    // Выбор стабильной цели через TargetAnalyzer
    let best: any = null;
    if (this.targetAnalyzer) {
      best = this.targetAnalyzer.selectStableTarget(context, candidates);
    } else {
      // Fallback: простой выбор ближайшей цели
      best = candidates.length > 0 ? candidates[0] : null;
    }
    
    // Если ещё нет цели, но игрок рядом и поведение агрессивное — выберем игрока
    if (!best && player && player.active) {
      const dp = Phaser.Math.Distance.Between(my.x, my.y, player.x, player.y);
      const relToPlayer = combat.getRelationPublic(myFaction, 'player', myOverrides);
      const reactionToRel = reactions?.[relToPlayer] ?? 'ignore';
      const wantsAttackPlayer = (behavior === 'aggressive') || (reactionToRel === 'attack');
      if (dp <= radar && wantsAttackPlayer) { 
        best = player; 
      }
    }
    
    if (best && best.active) {
      context.targetStabilization.currentTarget = best;
      
      // Решение: бежать или атаковать (порог по агрессии/здоровью может быть из combatAI профиля)
      const retreatPct = context.combatAI ? (this.config.combatAI?.profiles?.[context.combatAI]?.retreatHpPct ?? 0) : 0;
      const isNonCombat = !!(context.combatAI && this.config.combatAI?.profiles?.[context.combatAI!]?.nonCombat);
      const shouldFlee = isNonCombat; // мирные всегда избегают боя
      
      if (shouldFlee) {
        this.transitionTo(context, NPCState.COMBAT_FLEEING);
      } else {
        this.transitionTo(context, NPCState.COMBAT_ATTACKING);
        
        // Добавляем движение к цели через MovementCoordinator
        if (this.movementCoordinator) {
          this.movementCoordinator.addMovementCommand(
            context,
            'pursue', 
            { x: best.x, y: best.y, targetObject: best }, 
            undefined, 
            MovementPriority.COMBAT, 
            'npc_fsm_combat'
          );
        }
        
        // Применяем движение немедленно через CombatManager
        if (this.combatManager?.applyMovementFromFSM) {
          this.combatManager.applyMovementFromFSM(my, 'pursue', { x: best.x, y: best.y, targetObject: best });
        }
      }
    } else {
      // Нет цели в радиусе — немедленный возврат к базовому поведению
      const base = context.aiProfile || context.legacy.__behavior;
      if (base === 'patrol') this.transitionTo(context, NPCState.PATROLLING);
      else if (base === 'planet_trader' || base === 'orbital_trade') this.transitionTo(context, NPCState.TRADING);
      else this.transitionTo(context, NPCState.IDLE);
    }
  }
  
  /**
   * Принудительная смена состояния (для внешних систем)
   */
  forceState(context: NPCStateContext, state: NPCState): boolean {
    return this.transitionTo(context, state);
  }
  
  /**
   * Получение текущего состояния
   */
  getCurrentState(context: NPCStateContext): NPCState {
    return context.state as NPCState;
  }
  
  /**
   * Получение предыдущего состояния
   */
  getPreviousState(context: NPCStateContext): NPCState {
    return context.previousState as NPCState;
  }
  
  /**
   * Время нахождения в текущем состоянии
   */
  getTimeInState(context: NPCStateContext): number {
    return this.scene.time.now - context.stateEnterTime;
  }
  
  /**
   * Проверка, находится ли NPC в боевом состоянии
   */
  isInCombat(context: NPCStateContext): boolean {
    const state = context.state as NPCState;
    return state === NPCState.COMBAT_SEEKING || 
           state === NPCState.COMBAT_ATTACKING || 
           state === NPCState.COMBAT_FLEEING;
  }
  
  /**
   * Проверка, находится ли NPC в состоянии стыковки
   */
  isDocking(context: NPCStateContext): boolean {
    const state = context.state as NPCState;
    return state === NPCState.DOCKING || 
           state === NPCState.DOCKED || 
           state === NPCState.UNDOCKING;
  }
  
  // === Приватные методы ===
  
  /**
   * Проверка возможности перехода
   * ПЕРЕНЕСЕНО ИЗ NPCStateManager.canTransition()
   */
  private canTransition(from: NPCState, to: NPCState): boolean {
    // Определяем запрещенные переходы
    const forbidden = [
      [NPCState.DESTROYED, '*'], // из уничтоженного никуда нельзя
      [NPCState.DOCKING, NPCState.TRADING], // из стыковки сразу в торговлю нельзя
      [NPCState.UNDOCKING, NPCState.DOCKING] // из отстыковки сразу в стыковку нельзя
    ];
    
    for (const [fromState, toState] of forbidden) {
      if ((fromState === from || fromState === '*') && 
          (toState === to || toState === '*')) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Выход из состояния
   * ПЕРЕНЕСЕНО ИЗ NPCStateManager.exitState()
   */
  private exitState(context: NPCStateContext, state: NPCState): void {
    // Очистка специфичных для состояния данных
    switch (state) {
      case NPCState.COMBAT_ATTACKING:
      case NPCState.COMBAT_SEEKING:
        // Сохраняем время последнего боя
        context.aggression.lastCombatTime = this.scene.time.now;
        break;
    }
  }
  
  /**
   * Вход в состояние
   * ПЕРЕНЕСЕНО ИЗ NPCStateManager.enterState()
   */
  private enterState(context: NPCStateContext, state: NPCState): void {
    const obj = context.obj;
    
    // Синхронизируем с legacy полями
    switch (state) {
      case NPCState.DOCKING:
        obj.__state = 'docking';
        break;
      case NPCState.DOCKED:
        obj.__state = 'docked';
        break;
      case NPCState.UNDOCKING:
        obj.__state = 'undocking';
        break;
      case NPCState.TRADING:
        obj.__state = 'travel';
        break;
      default:
        // Для остальных состояний очищаем __state
        delete obj.__state;
    }
  }
}