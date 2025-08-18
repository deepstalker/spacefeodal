import type { ConfigManager } from './ConfigManager';

// Определяем все возможные состояния NPC
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

// Система остывания агрессии
interface AggressionState {
  level: number;              // 0-1, текущий уровень агрессии
  lastDamageTime: number;     // время последнего урона
  lastCombatTime: number;     // время последнего боя
  cooldownRate: number;       // скорость остывания агрессии/сек
  sources: Map<any, {         // источники агрессии
    damage: number;
    lastTime: number;
  }>;
}

// Стабилизация выбора целей
interface TargetStabilization {
  currentTarget: any | null;
  targetScore: number;
  targetSwitchTime: number;   // время последней смены цели
  requiredAdvantage: number;  // требуемое преимущество для смены
  stabilityPeriod: number;    // период стабильности после смены
}

// Приоритеты команд движения
export enum MovementPriority {
  EMERGENCY_FLEE = 100,       // Экстренное бегство
  COMBAT = 80,               // Боевые действия
  PLAYER_COMMAND = 60,       // Команды игрока
  SCENARIO = 50,             // Сценарные события
  PATROL = 40,               // Патрулирование
  TRADE = 20,               // Торговые операции
  IDLE = 10                 // Базовое поведение
}

interface MovementCommand {
  mode: string;
  target: { x: number; y: number; targetObject?: any };
  distance?: number;
  priority: MovementPriority;
  source: string;            // откуда пришла команда
  timestamp: number;
}

// Контекст состояния NPC
interface NPCStateContext {
  obj: any;                  // игровой объект
  state: NPCState;
  previousState: NPCState;
  stateEnterTime: number;
  
  // Агрессия и боевое поведение
  aggression: AggressionState;
  targetStabilization: TargetStabilization;
  
  // Движение
  movementQueue: MovementCommand[];
  currentMovement: MovementCommand | null;
  
  // Конфигурация
  aiProfile?: string;
  combatAI?: string;
  faction?: string;
  
  // Сохраняем существующие поля для совместимости
  legacy: {
    __behavior?: string;
    __state?: string;
    intent?: any;
    __targetPatrol?: any;
    __targetPlanet?: any;
    __homeRef?: any;
    forceIntentUntil?: number;
  };
}

export class NPCStateManager {
  private scene: Phaser.Scene;
  private pauseManager?: any; // PauseManager reference
  private config: ConfigManager;
  private contexts: Map<any, NPCStateContext> = new Map();
  
  // Настройки системы
  private readonly AGGRESSION_COOLDOWN_RATE = 0.3; // агрессия снижается на 30%/сек
  private readonly TARGET_SWITCH_THRESHOLD = 1.4;   // требуется 40% преимущество
  private readonly TARGET_STABILITY_TIME = 1500;    // 1.5 сек стабильности
  private readonly DAMAGE_MEMORY_TIME = 30000;      // 30 сек помним урон
  
  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
    
    // Обновляем состояния каждый кадр
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
  }

  setPauseManager(pauseManager: any) {
    this.pauseManager = pauseManager;
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
      state: NPCState.SPAWNING,
      previousState: NPCState.SPAWNING,
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
        this.initializeFromLegacy(currentContext);
      } else if (process.env.NODE_ENV === 'development') {
        console.error(`[NPCState] Context corrupted during delayed init for ${objId}`);
      }
    });
  }

  // Инициализация из существующих полей (для совместимости)
  private initializeFromLegacy(context: NPCStateContext): void {
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

  // Переход между состояниями
  transitionTo(context: NPCStateContext, newState: NPCState): boolean {
    if (!this.canTransition(context.state, newState)) {
      return false;
    }
    
    const oldState = context.state;
    this.exitState(context, oldState);
    
    context.previousState = oldState;
    context.state = newState;
    context.stateEnterTime = this.scene.time.now;
    
    this.enterState(context, newState);
    
    return true;
  }

  // Проверка возможности перехода
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

  // Выход из состояния
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

  // Вход в состояние
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

  // Оценка цели (улучшенная система)
  evaluateTarget(context: NPCStateContext, target: any): number {
    if (!target || !target.active) return -1;
    
    const obj = context.obj;
    const aggression = context.aggression;
    
    let score = 0;
    
    // Урон от цели (важнейший фактор)
    const damageData = aggression.sources.get(target);
    if (damageData) {
      let damageScore = damageData.damage * 2.0; // x2 множитель за урон
      
      // Игрок оценивается наравне с другими целями
      // (убраны специальные бонусы)
      
      score += damageScore;
      
      // Бонус за недавний урон
      const timeSinceDamage = this.scene.time.now - damageData.lastTime;
      if (timeSinceDamage < 5000) {
        score += (5000 - timeSinceDamage) * 0.001; // до +5 очков за свежий урон
      }
    }
    
    // Расчет расстояния до цели
    const distance = Phaser.Math.Distance.Between(obj.x, obj.y, target.x, target.y);
    
    // Расстояние до цели (штраф)
    score -= distance * 0.002; // -2 очка за 1000 единиц расстояния
    
    // Бонус за близость к текущей цели (предотвращает дребезжание)
    if (target === context.targetStabilization.currentTarget) {
      score += 2.0; // бонус за стабильность
    }
    
    return score;
  }

  // Стабильный выбор цели
  selectStableTarget(context: NPCStateContext, candidates: any[]): any | null {
    if (candidates.length === 0) return null;
    
    const stabilization = context.targetStabilization;
    const now = this.scene.time.now;
    const objId = (context.obj as any).__uniqueId || 'unknown';
    
    // Оцениваем всех кандидатов
    let bestTarget: any = null;
    let bestScore = -1;
    
    // Получаем корабль игрока из CombatManager
    const playerShip = (this.scene as any).combatManager?.ship;
    const playerCandidate = candidates.find(candidate => candidate === playerShip);
    
    const candidateScores: any[] = [];
    for (const candidate of candidates) {
      const score = this.evaluateTarget(context, candidate);
      const isPlayerCandidate = candidate === playerCandidate;
      const candidateId = isPlayerCandidate ? 'PLAYER' : `#${(candidate as any).__uniqueId || 'UNK'}`;
      candidateScores.push({ id: candidateId, score: score.toFixed(2), isPlayer: isPlayerCandidate });
      
      // ОТЛАДКА: детально логируем игрока
      if (process.env.NODE_ENV === 'development' && isPlayerCandidate) {
        console.log(`[PlayerCandidate] Found PLAYER in candidates for ${objId}`, {
          playerScore: score.toFixed(2),
          playerTexture: (candidate as any)?.texture?.key,
          playerActive: candidate?.active,
          aggressionLevel: (context.aggression.level * 100).toFixed(0) + '%',
          damageFromPlayer: context.aggression.sources.get(candidate) || 'none'
        });
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestTarget = candidate;
      }
    }
    
    const bestTargetId = !bestTarget ? 'null' : 
                         bestTarget === playerCandidate ? 'PLAYER' : 
                         `#${(bestTarget as any).__uniqueId || 'UNK'}`;
    const currentTargetId = !stabilization.currentTarget ? 'none' :
                           stabilization.currentTarget === playerCandidate ? 'PLAYER' : 
                           `#${(stabilization.currentTarget as any).__uniqueId || 'UNK'}`;
    
    // Проверяем, нужно ли менять цель
    if (bestTarget !== stabilization.currentTarget) {
      const timeSinceSwitch = now - stabilization.targetSwitchTime;
      
      // ИСПРАВЛЕНО: правильная формула для требуемого превосходства
      const currentScore = stabilization.currentTarget ? stabilization.targetScore : 0;
      const requiredScore = currentScore * (1 + stabilization.requiredAdvantage);
      
      const canSwitchByTime = timeSinceSwitch > stabilization.stabilityPeriod;
      const canSwitchByScore = bestScore > requiredScore;
      const hasCurrentTarget = !!stabilization.currentTarget;
      
      // Debug logging disabled
      // if (process.env.NODE_ENV === 'development') {
      //   console.log(`[StableTarget] ${objId} considering switch: ${currentTargetId} → ${bestTargetId}`, {
      //     candidateScores,
      //     currentScore: currentScore.toFixed(2),
      //     bestScore: bestScore.toFixed(2),
      //     requiredScore: requiredScore.toFixed(2),
      //     timeSinceSwitch: timeSinceSwitch + 'ms',
      //     stabilityPeriod: stabilization.stabilityPeriod + 'ms',
      //     canSwitchByTime,
      //     canSwitchByScore,
      //     hasCurrentTarget,
      //     requiredAdvantage: (stabilization.requiredAdvantage * 100).toFixed(0) + '%'
      //   });
      // }
      
      // Меняем цель если:
      // 1. У нас нет текущей цели ИЛИ
      // 2. (Прошел период стабильности И новая цель значительно лучше)
      if (!hasCurrentTarget || (canSwitchByTime && canSwitchByScore)) {
        
        stabilization.currentTarget = bestTarget;
        stabilization.targetScore = bestScore;
        stabilization.targetSwitchTime = now;
        
        // Debug logging disabled
        // if (process.env.NODE_ENV === 'development') {
        //   console.log(`[StableTarget] ${objId} SWITCHED to ${bestTargetId}`, {
        //     reason: !hasCurrentTarget ? 'no_current_target' : 'better_target',
        //     newScore: bestTarget ? bestScore.toFixed(2) : 'null'
        //   });
        // }
        
        // КРИТИЧНАЯ ОТЛАДКА: проверяем что возвращаем при переключении
        // Debug logging disabled
        // if (!bestTarget && process.env.NODE_ENV === 'development') {
        //   console.error(`[StableTarget] ${objId} SWITCHING TO NULL!`, {
        //     candidateScores,
        //     bestScore,
        //     hasCurrentTarget,
        //     canSwitchByTime,
        //     canSwitchByScore,
        //     reason: 'switched_to_null_target'
        //   });
        // }
        
        return bestTarget;
      } else {
        // Остаемся с текущей целью
        // Debug logging disabled
        // if (process.env.NODE_ENV === 'development') {
        //   console.log(`[StableTarget] ${objId} KEEPING ${currentTargetId}`, {
        //     reason: !canSwitchByTime ? 'stabilization_period' : 'insufficient_score_advantage'
        //   });
        // }
        
        // КРИТИЧНАЯ ОТЛАДКА: проверяем что возвращаем при сохранении цели
        // Debug logging disabled
        // if (!stabilization.currentTarget && process.env.NODE_ENV === 'development') {
        //   console.error(`[StableTarget] ${objId} KEEPING NULL TARGET!`, {
        //     candidateScores,
        //     bestScore,
        //     bestTargetId,
        //     hasCurrentTarget,
        //     reason: 'keeping_null_target'
        //   });
        // }
        
        return stabilization.currentTarget;
      }
    } else {
      // Цель не изменилась - обновляем счет
      stabilization.targetScore = bestScore;
      
      // Debug logging disabled
      // if (process.env.NODE_ENV === 'development') {
      //   console.log(`[StableTarget] ${objId} UNCHANGED ${bestTargetId}`, {
      //     score: bestTarget ? bestScore.toFixed(2) : 'null',
      //     candidateCount: candidates.length
      //   });
      // }
      
      // КРИТИЧНАЯ ОТЛАДКА: проверяем что возвращаем
      // Debug logging disabled
      // if (!bestTarget && process.env.NODE_ENV === 'development') {
      //   console.warn(`[StableTarget] ${objId} RETURNING NULL!`, {
      //     candidateScores,
      //     bestScore,
      //     hasCurrentTarget: !!stabilization.currentTarget,
      //     reason: 'no_valid_target_found'
      //   });
      // }
      
      return bestTarget;
    }
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
    // Пропускаем обновление если игра на паузе
    if (this.pauseManager?.getPaused()) return;
    
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
      
      // Обновляем очередь команд движения
      this.updateMovementQueue(context);
      
      // Логика конкретных состояний
      this.updateStateLogic(context, deltaMs);
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
        // Переход в атаку если есть цель, или возврат к мирному поведению
        if (context.aggression.level < 0.1) {
          // Агрессия остыла - возвращаемся к базовому поведению
          const baseProfile = context.aiProfile || context.legacy.__behavior;
          if (baseProfile === 'patrol') {
            this.transitionTo(context, NPCState.PATROLLING);
          } else if (baseProfile === 'planet_trader' || baseProfile === 'orbital_trade') {
            this.transitionTo(context, NPCState.TRADING);
          } else {
            this.transitionTo(context, NPCState.IDLE);
          }
        }
        break;
        
      case NPCState.COMBAT_ATTACKING:
        // Проверяем, есть ли еще цель для атаки
        if (!context.targetStabilization.currentTarget || 
            !context.targetStabilization.currentTarget.active) {
          this.transitionTo(context, NPCState.COMBAT_SEEKING);
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
