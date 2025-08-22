import type { ConfigManager } from '../../ConfigManager';
import type { MovementCommand, NPCStateContext } from '../CombatTypes';

/**
 * Приоритеты команд движения (экспортируем для совместимости)
 */
export enum MovementPriority {
  EMERGENCY_FLEE = 100,       // Экстренное бегство
  COMBAT = 80,               // Боевые действия
  PLAYER_COMMAND = 60,       // Команды игрока
  SCENARIO = 50,             // Сценарные события
  PATROL = 40,               // Патрулирование
  TRADE = 20,                // Торговые операции
  IDLE = 10                  // Базовое поведение
}

/**
 * Координатор движения для NPC - извлеченная логика управления приоритетными командами движения
 * Отвечает за очередь команд, приоритеты и координацию с NPCMovementManager
 */
export class MovementCoordinator {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  
  // Зависимости (инжектируются извне)
  private npcMovementManager?: any; // NPCMovementManager
  private combatManager?: any; // CombatManager для применения движения
  
  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
  }
  
  // === Dependency Injection ===
  
  setNpcMovementManager(manager: any): void {
    this.npcMovementManager = manager;
  }
  
  setCombatManager(manager: any): void {
    this.combatManager = manager;
  }
  
  // === Основные методы управления движением ===
  
  /**
   * Добавление команды движения
   * ПЕРЕНЕСЕНО ИЗ NPCStateManager.addMovementCommand()
   */
  addMovementCommand(
    context: NPCStateContext,
    mode: string, 
    target: any, 
    distance: number | undefined, 
    priority: MovementPriority, 
    source: string
  ): boolean {
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
      
      // Применяем команду немедленно
      this.executeMovementCommand(context.obj, command);
    }
    
    return true;
  }
  
  /**
   * Обновление команд движения для контекста
   */
  updateMovementCommands(context: NPCStateContext): void {
    if (!context.movementQueue.length) {
      return;
    }
    
    // Удаляем истёкшие команды (старше 30 секунд)
    const now = this.scene.time.now;
    const maxAge = 30000; // 30 секунд
    context.movementQueue = context.movementQueue.filter(cmd => now - cmd.timestamp < maxAge);
    
    // Если текущая команда была удалена или завершена, выбираем следующую
    if (!context.currentMovement || !this.isCommandStillValid(context.currentMovement)) {
      const nextCommand = context.movementQueue[0]; // уже отсортирована по приоритету
      if (nextCommand) {
        context.currentMovement = nextCommand;
        this.executeMovementCommand(context.obj, nextCommand);
      } else {
        context.currentMovement = null;
      }
    }
  }
  
  /**
   * Очистка команд движения с определенным приоритетом или источником
   */
  clearMovementCommands(context: NPCStateContext, filter?: {
    priority?: MovementPriority;
    source?: string;
    lowerPriority?: MovementPriority; // удалить все команды с приоритетом ниже указанного
  }): void {
    if (!filter) {
      // Очистить все
      context.movementQueue = [];
      context.currentMovement = null;
      return;
    }
    
    let shouldClearCurrent = false;
    
    context.movementQueue = context.movementQueue.filter(cmd => {
      // Проверяем фильтры
      if (filter.priority !== undefined && cmd.priority === filter.priority) {
        if (context.currentMovement === cmd) shouldClearCurrent = true;
        return false;
      }
      
      if (filter.source !== undefined && cmd.source === filter.source) {
        if (context.currentMovement === cmd) shouldClearCurrent = true;
        return false;
      }
      
      if (filter.lowerPriority !== undefined && cmd.priority < filter.lowerPriority) {
        if (context.currentMovement === cmd) shouldClearCurrent = true;
        return false;
      }
      
      return true;
    });
    
    // Если текущая команда была удалена, выбираем новую
    if (shouldClearCurrent) {
      context.currentMovement = context.movementQueue[0] || null;
      if (context.currentMovement) {
        this.executeMovementCommand(context.obj, context.currentMovement);
      }
    }
  }
  
  /**
   * Получение текущей команды движения
   */
  getCurrentMovementCommand(context: NPCStateContext): MovementCommand | null {
    return context.currentMovement;
  }
  
  /**
   * Получение очереди команд движения
   */
  getMovementQueue(context: NPCStateContext): ReadonlyArray<MovementCommand> {
    return [...context.movementQueue];
  }
  
  /**
   * Проверка есть ли команды с определенным приоритетом
   */
  hasCommandsWithPriority(context: NPCStateContext, priority: MovementPriority): boolean {
    return context.movementQueue.some(cmd => cmd.priority === priority) ||
           (context.currentMovement?.priority === priority);
  }
  
  /**
   * Экстренная остановка всего движения
   */
  emergencyStop(context: NPCStateContext): void {
    context.movementQueue = [];
    context.currentMovement = null;
    
    // Останавливаем NPC через NPCMovementManager если доступен
    if (this.npcMovementManager) {
      try {
        // Устанавливаем цель в текущую позицию для остановки
        this.npcMovementManager.setNPCTarget(context.obj, { 
          x: context.obj.x, 
          y: context.obj.y 
        });
      } catch (e) {
        console.warn('[MovementCoordinator] Failed to emergency stop NPC:', e);
      }
    }
  }
  
  /**
   * Добавление приоритетной команды боевого движения
   */
  addCombatMovementCommand(
    context: NPCStateContext,
    mode: 'pursue' | 'flee' | 'orbit' | 'move_to',
    target: any,
    distance?: number,
    source: string = 'combat_coordinator'
  ): boolean {
    return this.addMovementCommand(
      context,
      mode,
      target,
      distance,
      MovementPriority.COMBAT,
      source
    );
  }
  
  /**
   * Добавление команды экстренного бегства
   */
  addFleeCommand(
    context: NPCStateContext,
    target: any,
    source: string = 'emergency_flee'
  ): boolean {
    return this.addMovementCommand(
      context,
      'move_to',
      target,
      undefined,
      MovementPriority.EMERGENCY_FLEE,
      source
    );
  }
  
  /**
   * Добавление команды патрулирования
   */
  addPatrolCommand(
    context: NPCStateContext,
    target: any,
    source: string = 'patrol_coordinator'
  ): boolean {
    return this.addMovementCommand(
      context,
      'move_to',
      target,
      undefined,
      MovementPriority.PATROL,
      source
    );
  }
  
  /**
   * Получение статистики по командам движения
   */
  getMovementStats(context: NPCStateContext): {
    totalCommands: number;
    currentPriority: number | null;
    highestPriority: number | null;
    commandsByPriority: Record<number, number>;
    oldestCommandAge: number | null;
  } {
    const now = this.scene.time.now;
    const stats = {
      totalCommands: context.movementQueue.length,
      currentPriority: context.currentMovement?.priority || null,
      highestPriority: null as number | null,
      commandsByPriority: {} as Record<number, number>,
      oldestCommandAge: null as number | null
    };
    
    if (context.movementQueue.length > 0) {
      stats.highestPriority = Math.max(...context.movementQueue.map(cmd => cmd.priority));
      stats.oldestCommandAge = Math.max(...context.movementQueue.map(cmd => now - cmd.timestamp));
      
      // Подсчет команд по приоритету
      for (const cmd of context.movementQueue) {
        stats.commandsByPriority[cmd.priority] = (stats.commandsByPriority[cmd.priority] || 0) + 1;
      }
    }
    
    return stats;
  }
  
  // === Приватные методы ===
  
  /**
   * Выполнение команды движения через NPCMovementManager
   */
  private executeMovementCommand(obj: any, command: MovementCommand): void {
    if (!this.npcMovementManager) {
      console.warn('[MovementCoordinator] NPCMovementManager not set, cannot execute command');
      return;
    }
    
    try {
      // Устанавливаем режим и дистанцию если указана
      if (command.distance !== undefined) {
        this.npcMovementManager.setNPCMode(obj, command.mode, command.distance);
      }
      
      // Устанавливаем цель
      this.npcMovementManager.setNPCTarget(obj, command.target);
      
      // Также применяем через CombatManager для интеграции с FSM если доступно
      if (this.combatManager?.applyMovementFromFSM) {
        this.combatManager.applyMovementFromFSM(obj, command.mode, command.target, command.distance);
      }
    } catch (e) {
      console.warn('[MovementCoordinator] Failed to execute movement command:', e);
    }
  }
  
  /**
   * Проверка валидности команды
   */
  private isCommandStillValid(command: MovementCommand): boolean {
    // Проверяем возраст команды
    const age = this.scene.time.now - command.timestamp;
    if (age > 30000) { // 30 секунд максимум
      return false;
    }
    
    // Проверяем валидность цели если это объект
    if (command.target.targetObject) {
      const targetObj = command.target.targetObject;
      if (!targetObj || !targetObj.active) {
        return false;
      }
    }
    
    return true;
  }
}