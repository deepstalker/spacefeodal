export class PauseManager {
  private scene: Phaser.Scene;
  private isPaused: boolean = false;
  private pausedTimers: Map<string, Phaser.Time.TimerEvent> = new Map();
  private pausedTweens: Phaser.Tweens.Tween[] = [];
  private pausedPhysics: boolean = false;
  
  // Обработчики событий, которые нужно приостановить
  private pausedUpdateHandlers: Map<string, Function> = new Map();
  
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }
  
  /**
   * Переключить состояние паузы
   */
  public togglePause(): boolean {
    if (this.isPaused) {
      this.resume();
    } else {
      this.pause();
    }
    return this.isPaused;
  }
  
  /**
   * Поставить игру на паузу
   */
  public pause(): void {
    if (this.isPaused) return;
    
    this.isPaused = true;
    
    // Останавливаем все таймеры сцены
    this.pauseTimers();
    
    // Останавливаем все твины
    this.pauseTweens();
    
    // Уведомляем систему о паузе
    this.scene.events.emit('game-paused');
    
    // Эмитим событие для UI
    this.scene.scene.get('UIScene')?.events.emit('game-paused');
    
    // Game paused
  }
  
  /**
   * Снять игру с паузы
   */
  public resume(): void {
    if (!this.isPaused) return;
    
    this.isPaused = false;
    
    // Возобновляем таймеры
    this.resumeTimers();
    
    // Возобновляем твины
    this.resumeTweens();
    
    // Уведомляем систему о снятии паузы
    this.scene.events.emit('game-resumed');
    
    // Эмитим событие для UI
    this.scene.scene.get('UIScene')?.events.emit('game-resumed');
    
    // Game resumed
  }
  
  /**
   * Проверить, находится ли игра на паузе
   */
  public getPaused(): boolean {
    return this.isPaused;
  }
  
  /**
   * Приостановить конкретный таймер с возможностью его восстановления
   */
  public pauseTimer(timer: Phaser.Time.TimerEvent, id: string): void {
    if (timer && timer.getProgress() < 1) {
      timer.paused = true;
      this.pausedTimers.set(id, timer);
    }
  }
  
  /**
   * Возобновить конкретный таймер
   */
  public resumeTimer(id: string): void {
    const timer = this.pausedTimers.get(id);
    if (timer) {
      timer.paused = false;
      this.pausedTimers.delete(id);
    }
  }
  
  /**
   * Зарегистрировать обработчик UPDATE для приостановки
   */
  public registerUpdateHandler(id: string, handler: Function): void {
    this.pausedUpdateHandlers.set(id, handler);
  }
  
  /**
   * Отписать обработчик UPDATE
   */
  public unregisterUpdateHandler(id: string): void {
    this.pausedUpdateHandlers.delete(id);
  }
  
  /**
   * Проверить, должен ли обработчик UPDATE выполняться
   */
  public shouldProcessUpdate(id: string): boolean {
    if (!this.isPaused) return true;
    
    // Некоторые системы должны работать даже на паузе (UI, камера)
    const alwaysActiveHandlers = ['ui', 'camera', 'input'];
    return alwaysActiveHandlers.includes(id);
  }
  
  private pauseTimers(): void {
    // Автоматическое управление таймерами отключено - управляем через registerTimer
    // В данной версии Phaser нет прямого доступа к списку всех таймеров
  }
  
  private resumeTimers(): void {
    // Возобновляем все приостановленные таймеры
    for (const [id, timer] of this.pausedTimers.entries()) {
      if (timer) {
        timer.paused = false;
      }
    }
    this.pausedTimers.clear();
  }
  
  private pauseTweens(): void {
    // Останавливаем все активные твины
    const tweens = this.scene.tweens.getTweens?.() || [];
    for (const tween of tweens) {
      if (tween && tween.isPlaying()) {
        tween.pause();
        this.pausedTweens.push(tween);
      }
    }
  }
  
  private resumeTweens(): void {
    // Возобновляем все приостановленные твины
    for (const tween of this.pausedTweens) {
      if (tween && tween.isPaused()) {
        tween.resume();
      }
    }
    this.pausedTweens = [];
  }
  
  /**
   * Очистка ресурсов при уничтожении
   */
  public destroy(): void {
    this.pausedTimers.clear();
    this.pausedTweens = [];
    this.pausedUpdateHandlers.clear();
  }
}
