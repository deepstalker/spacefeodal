export interface GameTimeEvent {
  type: 'cycle_complete' | 'quarter_cycle' | 'half_cycle';
  cycle: number;
  progress: number; // 0.0 - 1.0
}

export class TimeManager {
  private scene: Phaser.Scene;
  private currentCycle: number = 10; // Начинаем с цикла 0010
  private cycleTimer: Phaser.Time.TimerEvent | null = null;
  private cycleStartTime: number = 0;
  private isPaused: boolean = false;
  
  // Константы
  private readonly CYCLE_DURATION_MS = 3 * 60 * 1000; // 3 минуты в миллисекундах
  private readonly INITIAL_CYCLE = 10;
  
  // События для уведомлений
  private eventListeners: Map<string, Function[]> = new Map();
  
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }
  
  /**
   * Инициализация системы времени
   */
  public init(): void {
    this.currentCycle = this.INITIAL_CYCLE;
    this.startNewCycle();
    
    // TimeManager initialized
  }
  
  /**
   * Начать новый цикл
   */
  private startNewCycle(): void {
    this.cycleStartTime = this.scene.time.now;
    
    // Создаем таймер на полный цикл
    this.cycleTimer = this.scene.time.delayedCall(
      this.CYCLE_DURATION_MS,
      this.onCycleComplete,
      [],
      this
    );
    
    this.emitEvent('cycle_start', {
      type: 'cycle_complete',
      cycle: this.currentCycle,
      progress: 0
    });
    
    // Cycle started
  }
  
  /**
   * Обработчик завершения цикла
   */
  private onCycleComplete(): void {
    this.currentCycle++;
    
    this.emitEvent('cycle_complete', {
      type: 'cycle_complete',
      cycle: this.currentCycle - 1,
      progress: 1.0
    });
    
    // Начинаем следующий цикл
    this.startNewCycle();
    
    // Cycle completed
  }
  
  /**
   * Получить текущий номер цикла
   */
  public getCurrentCycle(): number {
    return this.currentCycle;
  }
  
  /**
   * Получить текущий номер цикла в формате отображения (0010)
   */
  public getCurrentCycleFormatted(): string {
    return this.currentCycle.toString().padStart(4, '0');
  }
  
  /**
   * Получить прогресс текущего цикла (0.0 - 1.0)
   */
  public getCycleProgress(): number {
    if (!this.cycleTimer || this.isPaused) {
      return 0;
    }
    
    const elapsed = this.scene.time.now - this.cycleStartTime;
    const progress = Math.min(elapsed / this.CYCLE_DURATION_MS, 1.0);
    return progress;
  }
  
  /**
   * Получить оставшееся время цикла в миллисекундах
   */
  public getCycleTimeRemaining(): number {
    if (!this.cycleTimer || this.isPaused) {
      return this.CYCLE_DURATION_MS;
    }
    
    const elapsed = this.scene.time.now - this.cycleStartTime;
    return Math.max(0, this.CYCLE_DURATION_MS - elapsed);
  }
  
  /**
   * Получить оставшееся время цикла в удобном формате (мм:сс)
   */
  public getCycleTimeRemainingFormatted(): string {
    const remainingMs = this.getCycleTimeRemaining();
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  
  /**
   * Поставить систему времени на паузу
   */
  public pause(): void {
    if (this.isPaused) return;
    
    this.isPaused = true;
    
    if (this.cycleTimer) {
      this.cycleTimer.paused = true;
    }
    
    // Time system paused
  }
  
  /**
   * Возобновить систему времени
   */
  public resume(): void {
    if (!this.isPaused) return;
    
    this.isPaused = false;
    
    if (this.cycleTimer) {
      this.cycleTimer.paused = false;
    }
    
    // Time system resumed
  }
  
  /**
   * Принудительно завершить текущий цикл (для отладки)
   */
  public forceCompleteCycle(): void {
    if (this.cycleTimer) {
      this.cycleTimer.remove();
    }
    this.onCycleComplete();
  }
  
  /**
   * Установить конкретный номер цикла (для отладки)
   */
  public setCycle(cycle: number): void {
    this.currentCycle = Math.max(1, cycle);
    
    if (this.cycleTimer) {
      this.cycleTimer.remove();
    }
    
    this.startNewCycle();
    
    // Cycle manually set
  }
  
  /**
   * Добавить обработчик событий времени
   */
  public addEventListener(event: string, callback: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }
  
  /**
   * Удалить обработчик событий времени
   */
  public removeEventListener(event: string, callback: Function): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }
  
  /**
   * Эмитить событие
   */
  private emitEvent(event: string, data: GameTimeEvent): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[TimeManager] Error in event listener for ${event}:`, error);
        }
      });
    }
    
    // Также эмитим через систему событий Phaser
    this.scene.events.emit(`time-${event}`, data);
  }
  
  /**
   * Получить статистику времени для отладки
   */
  public getTimeStats(): any {
    return {
      currentCycle: this.currentCycle,
      cycleFormatted: this.getCurrentCycleFormatted(),
      progress: this.getCycleProgress(),
      remainingMs: this.getCycleTimeRemaining(),
      remainingFormatted: this.getCycleTimeRemainingFormatted(),
      isPaused: this.isPaused,
      cycleDurationMs: this.CYCLE_DURATION_MS
    };
  }
  
  /**
   * Очистка ресурсов при уничтожении
   */
  public destroy(): void {
    if (this.cycleTimer) {
      this.cycleTimer.remove();
      this.cycleTimer = null;
    }
    
    this.eventListeners.clear();
  }
}
