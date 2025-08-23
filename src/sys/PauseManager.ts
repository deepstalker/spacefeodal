interface PauseConfig {
  systems: {
    pausable: {
      core: { [key: string]: boolean };
      npc: { [key: string]: boolean };
      world: { [key: string]: boolean };
      phaser: { [key: string]: boolean };
    };
    non_pausable: {
      ui: { [key: string]: boolean };
      visual: { [key: string]: boolean };
      infrastructure: { [key: string]: boolean };
      systems: { [key: string]: boolean };
    };
  };
  special_cases: { [key: string]: any };
  debug: { [key: string]: boolean };
}

export class PauseManager {
  private scene: Phaser.Scene;
  private isPaused: boolean = false;
  private pausedTimers: Map<string, Phaser.Time.TimerEvent> = new Map();
  private managedTimers: Map<string, Phaser.Time.TimerEvent> = new Map();
  private pausedTweens: Phaser.Tweens.Tween[] = [];
  private pausedPhysics: boolean = false;
  private config: PauseConfig | null = null;
  private pauseStartTime: number = 0;
  private totalPausedTime: number = 0;
  
  // Обработчики событий, которые нужно приостановить
  private pausedUpdateHandlers: Map<string, Function> = new Map();
  
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    // Критические системы должны сразу ставиться на паузу, поэтому загружаем конфиг немедленно
    this.loadConfigSync();
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
    this.pauseStartTime = this.scene.time.now;
    
    // Останавливаем все таймеры сцены
    this.pauseTimers();
    
    // Останавливаем все твины (кроме UI)
    this.pauseTweens();
    
    // Уведомляем систему о паузе
    this.scene.events.emit('game-paused');
    
    // Эмитим событие для UI
    this.scene.scene.get('UIScene')?.events.emit('game-paused');
    
    if (this.getDebugSetting('log_pause_events')) {
      console.log('[PauseManager] Game paused at', this.pauseStartTime);
    }
  }
  
  /**
   * Снять игру с паузы
   */
  public resume(): void {
    if (!this.isPaused) return;
    
    // Вычисляем время паузы
    const pauseDuration = this.scene.time.now - this.pauseStartTime;
    this.totalPausedTime += pauseDuration;
    
    this.isPaused = false;
    
    // Возобновляем таймеры
    this.resumeTimers();
    
    // Возобновляем твины
    this.resumeTweens();
    
    // Уведомляем систему о снятии паузы (с информацией о времени паузы)
    this.scene.events.emit('game-resumed', { pauseDuration, totalPausedTime: this.totalPausedTime });
    
    // Эмитим событие для UI
    this.scene.scene.get('UIScene')?.events.emit('game-resumed');
    
    if (this.getDebugSetting('log_pause_events')) {
      console.log('[PauseManager] Game resumed, pause duration:', pauseDuration, 'total paused:', this.totalPausedTime);
    }
  }
  
  /**
   * Проверить, находится ли игра на паузе
   */
  public getPaused(): boolean {
    return this.isPaused;
  }
  
  /**
   * Получить время с учетом паузы (для кулдаунов и таймеров)
   */
  public getAdjustedTime(): number {
    const currentTime = this.scene.time.now;
    if (this.isPaused) {
      // Во время паузы возвращаем время начала паузы
      return this.pauseStartTime;
    }
    // Вычитаем общее время паузы из текущего времени
    return currentTime - this.totalPausedTime;
  }
  
  /**
   * Скорректировать временную метку с учетом пауз
   */
  public adjustTimestamp(timestamp: number): number {
    if (this.totalPausedTime === 0) return timestamp;
    // Добавляем время паузы к старым временным меткам чтобы они остались актуальными
    return timestamp + this.totalPausedTime;
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

  /** Зарегистрировать таймер для автоматической паузы/резюма */
  public registerTimer(id: string, timer: Phaser.Time.TimerEvent): void {
    this.managedTimers.set(id, timer);
    // Если уже на паузе — приостанавливаем немедленно
    if (this.isPaused) {
      try { timer.paused = true; } catch {}
      this.pausedTimers.set(id, timer);
    }
  }

  /** Отменить регистрацию таймера */
  public unregisterTimer(id: string): void {
    this.managedTimers.delete(id);
    this.pausedTimers.delete(id);
  }
  

  
  /**
   * Зарегистрировать обработчик UPDATE для приостановки
   * КРИТИЧЕСКИЙ ФИКС: Теперь PauseManager сам контролирует выполнение обработчиков
   */
  public registerUpdateHandler(id: string, handler: Function): void {
    this.pausedUpdateHandlers.set(id, handler);
    
    // Создаем обертку, которая проверяет паузу перед выполнением
    const wrappedHandler = (...args: any[]) => {
      if (this.shouldProcessUpdate(id)) {
        handler(...args);
      }
    };
    
    // Сохраняем обертку для возможности отписки
    (handler as any).__wrappedHandler = wrappedHandler;
    
    if (this.getDebugSetting('log_pause_events')) {
      console.log(`[PauseManager] Registered UPDATE handler: ${id}`);
    }
  }
  
  /**
   * Отписать обработчик UPDATE
   */
  public unregisterUpdateHandler(id: string): void {
    const handler = this.pausedUpdateHandlers.get(id);
    if (handler && (handler as any).__wrappedHandler) {
      // Удаляем обертку из сцены
      try {
        this.scene.events.off(Phaser.Scenes.Events.UPDATE, (handler as any).__wrappedHandler);
      } catch {}
    }
    
    this.pausedUpdateHandlers.delete(id);
    
    if (this.getDebugSetting('log_pause_events')) {
      console.log(`[PauseManager] Unregistered UPDATE handler: ${id}`);
    }
  }
  
  /**
   * Получить обернутый обработчик для регистрации в Phaser
   * Используется боевыми системами для получения pause-aware обработчика
   */
  public getWrappedUpdateHandler(id: string): Function | null {
    const handler = this.pausedUpdateHandlers.get(id);
    if (handler && (handler as any).__wrappedHandler) {
      return (handler as any).__wrappedHandler;
    }
    return null;
  }
  
  /**
   * Проверить, должен ли обработчик UPDATE выполняться
   */
  public shouldProcessUpdate(id: string): boolean {
    if (!this.isPaused) return true;
    
    // Проверяем конфиг, если он загружен
    if (this.config) {
      return this.isSystemNonPausable(id);
    }
    
    // Фолбэк для совместимости
    const alwaysActiveHandlers = ['ui', 'camera', 'input'];
    return alwaysActiveHandlers.includes(id);
  }
  
  /**
   * Загрузить конфигурацию паузы (синхронно)
   * Критично для корректной работы проектильной системы
   */
  private loadConfigSync(): void {
    try {
      // Пробуем синхронную загрузку (XMLHttpRequest)
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/configs/general/pause.json', false); // false = синхронно
      xhr.send();
      
      if (xhr.status === 200) {
        this.config = JSON.parse(xhr.responseText);
        
        if (this.config?.debug?.log_pause_events) {
          console.log('[PauseManager] Config loaded synchronously:', this.config);
        }
      } else {
        throw new Error(`HTTP ${xhr.status}: ${xhr.statusText}`);
      }
    } catch (error) {
      console.warn('[PauseManager] Failed to load pause config synchronously, using defaults:', error);
      this.config = null;
      
      // Асинхронный фолбэк
      this.loadConfig();
    }
  }
  
  /**
   * Загрузить конфигурацию паузы (асинхронно для фолбэка)
   */
  private async loadConfig(): Promise<void> {
    try {
      const response = await fetch('/configs/general/pause.json');
      this.config = await response.json();
      
      if (this.config?.debug?.log_pause_events) {
        console.log('[PauseManager] Config loaded:', this.config);
      }
    } catch (error) {
      console.warn('[PauseManager] Failed to load pause config, using defaults:', error);
      this.config = null;
    }
  }
  
  /**
   * Проверить, должна ли система останавливаться при паузе
   */
  public isSystemPausable(systemName: string): boolean {
    if (!this.config) {
      // КРИТИЧЕСКИЙ ФИКС: Если конфиг еще не загружен, используем безопасные значения по умолчанию
      // для ключевых игровых систем чтобы они корректно ставились на паузу
      const defaultPausableSystems = ['combat', 'movement', 'pathfinding', 'npcStateManager', 'npcMovementManager'];
      const shouldPause = defaultPausableSystems.includes(systemName);
      
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[PauseManager] Config not loaded yet, using default for '${systemName}': ${shouldPause}`);
      }
      
      return shouldPause;
    }
    
    const pausable = this.config.systems.pausable;
    
    // Проверяем во всех категориях pausable систем
    return (
      pausable.core[systemName] === true ||
      pausable.npc[systemName] === true ||
      pausable.world[systemName] === true ||
      pausable.phaser[systemName] === true
    );
  }
  
  /**
   * Проверить, должна ли система продолжать работать при паузе
   */
  public isSystemNonPausable(systemName: string): boolean {
    if (!this.config) {
      // Фолбэк для систем без конфига
      const defaultNonPausable = ['ui', 'camera', 'input', 'minimap', 'background'];
      return defaultNonPausable.includes(systemName);
    }
    
    const nonPausable = this.config.systems.non_pausable;
    
    // Проверяем во всех категориях non_pausable систем
    return (
      nonPausable.ui[systemName] === true ||
      nonPausable.visual[systemName] === true ||
      nonPausable.infrastructure[systemName] === true ||
      nonPausable.systems[systemName] === true
    );
  }
  
  /**
   * Получить специальную настройку из конфига
   */
  public getSpecialCase(caseName: string): any {
    return this.config?.special_cases?.[caseName] || null;
  }
  
  /**
   * Проверить отладочную настройку
   */
  public getDebugSetting(setting: string): boolean {
    return this.config?.debug?.[setting] === true;
  }
  
  /**
   * Получить информацию о системах для отладки
   */
  public getSystemsInfo(): { pausable: string[]; nonPausable: string[] } {
    if (!this.config) {
      return { pausable: [], nonPausable: [] };
    }
    
    const pausable: string[] = [];
    const nonPausable: string[] = [];
    
    // Собираем все pausable системы
    const p = this.config.systems.pausable;
    Object.keys(p.core).concat(Object.keys(p.npc), Object.keys(p.world), Object.keys(p.phaser))
      .forEach(key => pausable.push(key));
    
    // Собираем все non-pausable системы
    const np = this.config.systems.non_pausable;
    Object.keys(np.ui).concat(Object.keys(np.visual), Object.keys(np.infrastructure), Object.keys(np.systems))
      .forEach(key => nonPausable.push(key));
    
    return { pausable, nonPausable };
  }
  
  /**
   * Вывести информацию о конфиге в консоль (для отладки)
   */
  public debugLogConfig(): void {
    if (!this.config) {
      console.log('[PauseManager] No config loaded');
      return;
    }
    
    const info = this.getSystemsInfo();
    console.group('[PauseManager] Configuration Info');
    console.log('🔴 Pausable systems:', info.pausable);
    console.log('🟢 Non-pausable systems:', info.nonPausable);
    console.log('⚙️ Special cases:', Object.keys(this.config.special_cases || {}));
    console.log('🐛 Debug settings:', this.config.debug);
    console.groupEnd();
  }
  
  private pauseTimers(): void {
    // Приостанавливаем только те таймеры, которые были явно зарегистрированы
    for (const [id, timer] of this.managedTimers.entries()) {
      if (!timer) continue;
      // Не трогаем уже завершённые или уже приостановленные таймеры
      const done = typeof timer.getProgress === 'function' ? timer.getProgress() >= 1 : false;
      if (done || (timer as any).paused === true) continue;
      try {
        (timer as any).paused = true;
        this.pausedTimers.set(id, timer);
      } catch {}
    }
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
    // Останавливаем все активные твины, кроме UI tweens и HUD charge bars
    const tweens = this.scene.tweens.getTweens?.() || [];
    let paused = 0;
    let skipped = 0;
    let notPlaying = 0;
    
    for (const tween of tweens) {
      if (tween && tween.isPlaying()) {
        // Проверяем, не является ли это UI tween (по специальному флагу)
        if ((tween as any).__isUITween) {
          skipped++;
          if (this.getDebugSetting('log_pause_events')) {
            console.log(`[PauseManager] Skipped UI tween: id=${(tween as any).id}, targets=${tween.targets?.length}`);
          }
          continue; // Пропускаем UI tweens
        }
        
        tween.pause();
        this.pausedTweens.push(tween);
        paused++;
        
        if (this.getDebugSetting('log_pause_events')) {
          console.log(`[PauseManager] Paused tween: id=${(tween as any).id}, targets=${tween.targets?.length}`);
        }
      } else {
        notPlaying++;
      }
    }
    
    if (this.getDebugSetting('log_pause_events')) {
      console.log(`[PauseManager] Tween summary: ${paused} paused, ${skipped} skipped (UI), ${notPlaying} not playing, ${tweens.length} total`);
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
    // Очищаем все зарегистрированные UPDATE обработчики
    for (const [id, handler] of this.pausedUpdateHandlers.entries()) {
      if (handler && (handler as any).__wrappedHandler) {
        try {
          this.scene.events.off(Phaser.Scenes.Events.UPDATE, (handler as any).__wrappedHandler);
        } catch {}
      }
    }
    
    this.pausedTimers.clear();
    this.managedTimers.clear();
    this.pausedTweens = [];
    this.pausedUpdateHandlers.clear();
  }
}
