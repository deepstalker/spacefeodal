import type { ConfigManager } from './ConfigManager';
import type { PlannedPath } from './PathfindingManager';

// Типы режимов движения
export type MovementMode = 'move_to' | 'follow' | 'orbit' | 'pursue';

export interface MovementCommand {
  mode: MovementMode;
  target: Phaser.Math.Vector2;
  distance?: number; // для follow и orbit режимов
  targetObject?: any; // для динамических целей (pursue, orbit с объектом)
}

export class MovementManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private pauseManager?: any;
  private pauseSystemName: string = 'movement'; // По умолчанию для игрока // PauseManager reference
  private speed = 0;
  private target: Phaser.Math.Vector2 | null = null;
  private headingRad: number | null = null;
  
  // Новые свойства для режимов
  private command: MovementCommand | null = null;
  private orbitAngle = 0; // текущий угол орбиты
  private lastTargetUpdate = 0; // время последнего обновления цели
  private controlledObject: any = null; // ссылка на управляемый объект
  private targetVelocity: Phaser.Math.Vector2 = new Phaser.Math.Vector2(0, 0);
  private shipId: string | undefined;

  constructor(scene: Phaser.Scene, config: ConfigManager, shipId?: string) {
    this.scene = scene;
    this.config = config;
    this.shipId = shipId;
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
  }

  setPauseManager(pauseManager: any) {
    this.pauseManager = pauseManager;
  }

  setPauseSystemName(systemName: string) {
    this.pauseSystemName = systemName;
  }

  init() {
    // Добавляем глобальную переменную для отладки частоты обновления
    (window as any).setTargetUpdateRate = (intervalMs: number) => {
      this.config.gameplay.movement.TARGET_UPDATE_INTERVAL_MS = intervalMs;
      console.log(`[Movement] Target update interval set to ${intervalMs}ms`);
    };
  }

  followPath(obj: Phaser.GameObjects.GameObject & { x: number; y: number; rotation: number }, path: PlannedPath) {
    const last = path.points[path.points.length - 1];
    this.setMovementCommand({
      mode: 'move_to',
      target: new Phaser.Math.Vector2(last.x, last.y)
    }, obj);
  }

  // Новый универсальный метод для установки команд движения
  setMovementCommand(command: MovementCommand, obj: Phaser.GameObjects.GameObject & { x: number; y: number; rotation: number }) {
    this.command = command;
    // Если есть targetObject, всегда используем его позицию как основную цель.
    if (command.targetObject) {
      this.target = new Phaser.Math.Vector2(command.targetObject.x, command.targetObject.y);
      // Обновляем и команду, чтобы избежать рассинхронизации.
      command.target = this.target;
    } else {
      this.target = command.target;
    }
    this.controlledObject = obj; // сохраняем ссылку на управляемый объект
    
    // Use player's ship nose offset from ships.json
    const shipId = this.shipId ?? this.config.player?.shipId ?? this.config.ships?.current;
    const noseOffsetRad = Phaser.Math.DegToRad(this.config.ships?.defs?.[shipId!]?.sprite?.noseOffsetDeg ?? 0);
    this.headingRad = obj.rotation - noseOffsetRad;
    (obj as any).__moveRef = this;

    // Инициализация орбитального угла для orbit режима
    if (command.mode === 'orbit') {
      const dx = obj.x - command.target.x;
      const dy = obj.y - command.target.y;
      this.orbitAngle = Math.atan2(dy, dx);
      
      // Для динамических целей немедленно запускаем первое обновление
      if (command.targetObject) {
        this.lastTargetUpdate = 0; // принудительное обновление на следующем кадре
      }
    }
  }

  getTarget(): Phaser.Math.Vector2 | null {
    return this.target;
  }

  getCurrentCommand(): MovementCommand | null {
    return this.command;
  }

  private normalizeMovement(mv: any) {
    if (!mv) return mv;
    const fps = 60;
    // Эвристика: старые значения заданы «на кадр», если скорости выглядят очень маленькими
    const looksPerFrame = (typeof mv.MAX_SPEED === 'number' && mv.MAX_SPEED > 0 && mv.MAX_SPEED <= 5)
      || (typeof mv.ACCELERATION === 'number' && mv.ACCELERATION > 0 && mv.ACCELERATION <= 0.2);
    if (!looksPerFrame) return mv;
    return {
      ...mv,
      MAX_SPEED: (mv.MAX_SPEED ?? 0) * fps,                 // units/s
      ACCELERATION: (mv.ACCELERATION ?? 0) * fps * fps,     // units/s^2 (перевод из units/frame^2)
      DECELERATION: (mv.DECELERATION ?? 0) * fps * fps,     // units/s^2
      TURN_SPEED: (mv.TURN_SPEED ?? 0) * fps,
      // Остальные коэффициенты — без изменений (бессРазмерные)
    };
  }

  // Текущая скорость объекта в игровых единицах в секунду
  public getCurrentSpeedUnitsPerSec(): number {
    return Math.max(0, this.speed);
  }

  private applyGlobalMultipliers(mv: any) {
    if (!mv) return mv;
    const gm = (this.config.gameplay as any)?.movement || {};
    const speedMul = typeof gm.GLOBAL_SPEED_MULTIPLIER === 'number' ? gm.GLOBAL_SPEED_MULTIPLIER : 1;
    const accelMul = typeof gm.GLOBAL_ACCEL_MULTIPLIER === 'number' ? gm.GLOBAL_ACCEL_MULTIPLIER : speedMul;
    const turnMul = typeof gm.GLOBAL_TURN_MULTIPLIER === 'number' ? gm.GLOBAL_TURN_MULTIPLIER : 1;
    return {
      ...mv,
      MAX_SPEED: (mv.MAX_SPEED ?? 0) * speedMul,
      ACCELERATION: (mv.ACCELERATION ?? 0) * accelMul,
      DECELERATION: (mv.DECELERATION ?? 0) * accelMul,
      TURN_SPEED: (mv.TURN_SPEED ?? 0) * turnMul
    };
  }

  // Установка начальной скорости как доли от MAX_SPEED (для плавного "выплывания")
  public setInitialSpeedFraction(fraction: number) {
    const clamped = Phaser.Math.Clamp(fraction, 0, 1);
    const selectedId = this.shipId ?? this.config.player?.shipId ?? this.config.ships?.current;
    const selected = selectedId ? this.config.ships.defs[selectedId] : undefined;
    const mv = selected?.movement ?? this.config.gameplay.movement;
    const max = Math.max(0, mv?.MAX_SPEED ?? 0);
    this.speed = max * clamped;
  }

  // Для совместимости с существующим кодом - получение простого движения к цели
  moveTo(target: Phaser.Math.Vector2, obj: Phaser.GameObjects.GameObject & { x: number; y: number; rotation: number }) {
    this.setMovementCommand({ mode: 'move_to', target }, obj);
  }

  // Следование на заданном расстоянии
  followTarget(target: Phaser.Math.Vector2, distance: number, obj: Phaser.GameObjects.GameObject & { x: number; y: number; rotation: number }) {
    this.setMovementCommand({ mode: 'follow', target, distance }, obj);
  }

  // Следование за объектом (динамическая цель)
  followObject(targetObject: any, distance: number, obj: Phaser.GameObjects.GameObject & { x: number; y: number; rotation: number }) {
    this.setMovementCommand({ 
      mode: 'follow', 
      target: new Phaser.Math.Vector2(targetObject.x, targetObject.y), 
      distance, 
      targetObject 
    }, obj);
  }

  // Орбитальное движение
  orbitTarget(target: Phaser.Math.Vector2, distance: number, obj: Phaser.GameObjects.GameObject & { x: number; y: number; rotation: number }) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Movement] Starting orbit around static target (${target.x.toFixed(1)}, ${target.y.toFixed(1)}) at distance ${distance}`);
    }
    this.setMovementCommand({ mode: 'orbit', target, distance }, obj);
  }

  // Орбитальное движение вокруг объекта (динамическая цель)
  orbitObject(targetObject: any, distance: number, obj: Phaser.GameObjects.GameObject & { x: number; y: number; rotation: number }) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Movement] Starting orbit around dynamic target (${targetObject.x.toFixed(1)}, ${targetObject.y.toFixed(1)}) at distance ${distance}`);
    }
    this.setMovementCommand({ 
      mode: 'orbit', 
      target: new Phaser.Math.Vector2(targetObject.x, targetObject.y), 
      distance, 
      targetObject 
    }, obj);
  }

  // Преследование объекта
  pursueTarget(targetObject: any, obj: Phaser.GameObjects.GameObject & { x: number; y: number; rotation: number }) {
    this.setMovementCommand({ 
      mode: 'pursue', 
      target: new Phaser.Math.Vector2(targetObject.x, targetObject.y), 
      distance: 100, 
      targetObject 
    }, obj);
  }

  // getRenderPathPoints удалён как неиспользуемый (визуальный путь рисуется напрямую по текущей цели)

  private update(time: number, deltaMs: number) {
    // Проверяем конфиг паузы
    if (this.pauseManager?.isSystemPausable(this.pauseSystemName) && this.pauseManager?.getPaused()) {
      if (this.pauseManager?.getDebugSetting('log_system_states')) {
        console.log(`[MovementManager] ${this.pauseSystemName} paused, skipping update`);
      }
      return;
    }
    
    const dt = deltaMs / 1000;
    // Используем сохранённую ссылку на управляемый объект; фолбэк — поиск один раз
    let obj = this.controlledObject as any;
    if (!obj || !obj.active) {
      obj = this.scene.children.getAll().find(o => (o as any)['__moveRef'] === this) as any;
      if (!obj) return;
      this.controlledObject = obj;
    }

    // Параметры движения и визуальный сдвиг носа берём из выбранного корабля игрока
    const selectedId = this.shipId ?? this.config.player?.shipId ?? this.config.ships?.current;
    const selected = selectedId ? this.config.ships.defs[selectedId] : undefined;
    const mvRaw = selected?.movement ?? this.config.gameplay.movement;
    const mv = this.applyGlobalMultipliers(this.normalizeMovement(mvRaw)); // единые единицы + глобальные множители
    
    // ОТЛАДКА: проверяем откуда берутся характеристики движения
    if (process.env.NODE_ENV === 'development' && Math.random() < 0.001) { // 0.1% логов
      console.log(`[MovementManager] Ship movement config for ${selectedId}`, {
        hasShipMovement: !!selected?.movement,
        hasGameplayMovement: !!this.config.gameplay.movement,
        usingFallback: !selected?.movement,
        maxSpeed: mv?.MAX_SPEED,
        acceleration: mv?.ACCELERATION,
        turnSpeed: mv?.TURN_SPEED
      });
    }
    const noseOffsetRad = Phaser.Math.DegToRad(selected?.sprite?.noseOffsetDeg ?? 0);
    if (this.headingRad == null) this.headingRad = obj.rotation - noseOffsetRad;
    
    if (!this.command || !this.target) {
      // Плавная остановка по текущему вектору: замедляемся и продолжаем двигаться до полной остановки (dt-нормализация)
      this.speed = Math.max(0, this.speed - mv.DECELERATION * dt);
      // Применяем текущий курс и позицию даже без активной команды
      this.headingRad = ((this.headingRad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      obj.rotation = this.headingRad + noseOffsetRad;
      if (this.speed > 0) {
        obj.x += Math.cos(this.headingRad) * this.speed * dt;
        obj.y += Math.sin(this.headingRad) * this.speed * dt;
      }
      return;
    }

    // Обновляем динамические цели с частотой из конфига
    // Для орбиты обновляем чаще
    const baseInterval = this.config.gameplay.movement.TARGET_UPDATE_INTERVAL_MS || 100;
    const updateInterval = this.command?.mode === 'orbit' ? Math.min(baseInterval, 50) : baseInterval;
    
    if (time - this.lastTargetUpdate > updateInterval) {
      this.updateDynamicTarget(time - this.lastTargetUpdate);
      this.lastTargetUpdate = time;
    }

    // Если updateDynamicTarget обнулил команду (цель умерла) — начинаем плавное торможение по вектору
    if (!this.command) {
      this.speed = Math.max(0, this.speed - mv.DECELERATION * dt);
      this.headingRad = ((this.headingRad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      obj.rotation = this.headingRad + noseOffsetRad;
      if (this.speed > 0) {
        obj.x += Math.cos(this.headingRad) * this.speed * dt;
        obj.y += Math.sin(this.headingRad) * this.speed * dt;
      }
      return;
    }

    // Выполняем движение в зависимости от режима
    this.executeMovementMode(obj, deltaMs, mv, noseOffsetRad);

    // apply heading to sprite with visual offset
    this.headingRad = ((this.headingRad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    obj.rotation = this.headingRad + noseOffsetRad;
    if (this.speed > 0) {
      obj.x += Math.cos(this.headingRad) * this.speed * dt;
      obj.y += Math.sin(this.headingRad) * this.speed * dt;
    }
  }

  private updateDynamicTarget(dtMs: number) {
    if (!this.command || !this.command.targetObject) {
      this.targetVelocity.set(0, 0);
      return;
    }
    
    // Проверяем, что объект-цель все еще существует и активен
    if (!this.command.targetObject.active || this.command.targetObject.destroyed) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[MovementManager] Target became invalid`, {
          active: this.command.targetObject.active,
          destroyed: this.command.targetObject.destroyed
        });
      }
      this.command = null;
      this.target = null;
      this.targetVelocity.set(0, 0);
      return;
    }
    
    const oldX = this.target!.x;
    const oldY = this.target!.y;
    this.target!.x = this.command.targetObject.x;
    this.target!.y = this.command.targetObject.y;
    
    const dtSec = dtMs / 1000;
    if (dtSec > 0) {
        const vx = (this.target!.x - oldX) / dtSec;
        const vy = (this.target!.y - oldY) / dtSec;
        this.targetVelocity.set(vx, vy);
    }
    
    const distMoved = Math.hypot(this.target!.x - oldX, this.target!.y - oldY);
    // Отладочный вывод при значительном изменении позиции (только в dev режиме)
    if (distMoved > 5 && process.env.NODE_ENV === 'development') {
      // console.log(`[Movement] Target moved ${distMoved.toFixed(1)} units to (${this.target!.x.toFixed(1)}, ${this.target!.y.toFixed(1)}) - Mode: ${this.command.mode}`);
    }
  }

  private executeMovementMode(obj: any, deltaMs: number, mv: any, noseOffsetRad: number) {
    const command = this.command!;
    
    switch (command.mode) {
      case 'move_to':
        this.executeMoveToMode(obj, deltaMs, mv);
        break;
      case 'follow':
        this.executeFollowMode(obj, deltaMs, mv, command.distance || 300);
        break;
      case 'orbit':
        this.executeOrbitMode(obj, deltaMs, mv, command.distance || 500);
        break;
      case 'pursue':
        this.executePursueMode(obj, deltaMs, mv, command.distance || 100);
        break;
    }
  }

  private executeMoveToMode(obj: any, deltaMs: number, mv: any) {
    const dx = this.target!.x - obj.x;
    const dy = this.target!.y - obj.y;
    const distance = Math.hypot(dx, dy);
    
    // Остановиться при достижении цели
    if (distance < 2) {
      this.command = null;
      this.target = null;
      return;
    }

    // Желаемая скорость с предсказанием торможения
    const desiredSpeed = distance < mv.SLOWING_RADIUS ? mv.MAX_SPEED * (distance / mv.SLOWING_RADIUS) : mv.MAX_SPEED;
    // Штраф на ускорение пропорционально текущей доле от MAX_SPEED
    const accelPenaltyAtMax = typeof mv.ACCELERATION_PENALTY_AT_MAX === 'number' ? Phaser.Math.Clamp(mv.ACCELERATION_PENALTY_AT_MAX, 0, 1) : 0;
    const speedRatio = Phaser.Math.Clamp(this.speed / Math.max(1e-6, mv.MAX_SPEED), 0, 1);
    const accelPenalty = accelPenaltyAtMax * speedRatio; // 0..accelPenaltyAtMax
    const effectiveAcceleration = mv.ACCELERATION * (1 - accelPenalty);
    const dt = deltaMs / 1000;
    if (this.speed < desiredSpeed) this.speed = Math.min(this.speed + effectiveAcceleration * dt, desiredSpeed);
    else this.speed = Math.max(this.speed - mv.DECELERATION * dt, desiredSpeed);

    // Поворот к цели (возвращаем к исходной логике)
    const targetAngle = Math.atan2(dy, dx);
    let angleDiff = targetAngle - this.headingRad!;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    let effectiveTurnSpeed = 0;
    if (this.speed > 0.1) {
      const speedRatio = this.speed / mv.MAX_SPEED;
      const turnPenaltyFactor = 1 / (1 + speedRatio * mv.TURN_PENALTY_MULTIPLIER);
      effectiveTurnSpeed = mv.TURN_SPEED * turnPenaltyFactor;
    }

    const isAligned = Math.abs(angleDiff) < 0.02;
    if (!isAligned && effectiveTurnSpeed > 0) {
      const dt = deltaMs / 1000;
      const turnAmount = Math.min(Math.abs(angleDiff), effectiveTurnSpeed * dt);
      this.headingRad! += Math.sign(angleDiff) * turnAmount;
      this.speed = Math.max(this.speed - (mv.DECELERATION * mv.TURN_DECELERATION_FACTOR) * dt, 0);
    }
  }

  private executeFollowMode(obj: any, deltaMs: number, mv: any, followDistance: number) {
    const dx = this.target!.x - obj.x;
    const dy = this.target!.y - obj.y;
    const distance = Math.hypot(dx, dy);
    
    const distanceError = distance - followDistance;
    
    // "Мертвая зона" для предотвращения дрожания на идеальной дистанции.
    if (Math.abs(distanceError) < 20) {
      // Находясь на дистанции, стремимся к скорости и направлению цели.
      const targetSpeed = this.targetVelocity.length();
      
      // Плавно меняем скорость до скорости цели
      const dt = deltaMs / 1000;
      if (this.speed < targetSpeed) {
        this.speed = Math.min(this.speed + mv.ACCELERATION * dt, targetSpeed);
      } else {
        this.speed = Math.max(this.speed - mv.DECELERATION * dt, targetSpeed);
      }
      
      // Если цель движется, поворачиваем в ее направлении.
      if (targetSpeed > 1) {
        const targetAngle = this.targetVelocity.angle();
        this.turnTowardsOriginal(targetAngle, mv, deltaMs);
      }
      return;
    }

    // Желаемая скорость зависит от величины ошибки (как далеко мы от нужной дистанции).
    const desiredSpeed = mv.MAX_SPEED * Phaser.Math.Clamp(Math.abs(distanceError) / (mv.SLOWING_RADIUS || 200), 0, 1);

    const dt2 = deltaMs / 1000;
    if (this.speed < desiredSpeed) {
        this.speed = Math.min(this.speed + mv.ACCELERATION * dt2, desiredSpeed);
    } else {
        this.speed = Math.max(this.speed - mv.DECELERATION * dt2, desiredSpeed);
    }
    
    let targetAngle = Math.atan2(dy, dx);
    
    // Если мы слишком близко, разворачиваемся для движения от цели.
    if (distanceError < 0) {
      targetAngle += Math.PI; // Разворот на 180 градусов.
    }
    
    this.turnTowardsOriginal(targetAngle, mv, deltaMs);
  }

  private executeOrbitMode(obj: any, deltaMs: number, mv: any, orbitDistance: number) {
    const center = this.target!;
    
    const vectorFromCenter = new Phaser.Math.Vector2(obj.x - center.x, obj.y - center.y);
    if (vectorFromCenter.lengthSq() < 1) {
        // Находимся в центре, не можем определить направление. Просто ждем.
        this.speed = Math.max(0, this.speed - mv.DECELERATION * (deltaMs/1000));
        return;
    }
    const currentDistance = vectorFromCenter.length();

    // 1. Тангенциальный вектор для движения по кругу.
    const tangent = vectorFromCenter.clone().normalize().rotate(Math.PI / 2);
    const orbitVelocity = tangent.scale(mv.MAX_SPEED * 0.7);

    // 2. Радиальный вектор для коррекции дистанции (приближение/отдаление от орбиты).
    const distanceError = currentDistance - orbitDistance;
    // Скорость коррекции зависит от величины ошибки.
    const radialSpeed = Phaser.Math.Clamp(distanceError * -1, -mv.MAX_SPEED * 0.5, mv.MAX_SPEED * 0.5);
    const radialVelocity = vectorFromCenter.clone().normalize().scale(radialSpeed);

    // 3. Комбинируем оба вектора для получения итогового направления движения.
    const desiredVelocity = orbitVelocity.add(radialVelocity);
    
    // 4. Направляем корабль по этому вектору и задаем ему нужную скорость.
    const targetAngle = desiredVelocity.angle();
    const desiredSpeed = Phaser.Math.Clamp(desiredVelocity.length(), 0, mv.MAX_SPEED);

    const dt = deltaMs / 1000;
    if (this.speed < desiredSpeed) {
        this.speed = Math.min(this.speed + mv.ACCELERATION * dt, desiredSpeed);
    } else {
        this.speed = Math.max(this.speed - mv.DECELERATION * dt, desiredSpeed);
    }

    this.turnTowardsOriginal(targetAngle, mv, deltaMs);
  }

  private executePursueMode(obj: any, deltaMs: number, mv: any, stopDistance: number) {
    const dx = this.target!.x - obj.x;
    const dy = this.target!.y - obj.y;
    const distance = Math.hypot(dx, dy);
    
    // Остановиться при достижении нужной дистанции
    if (distance <= stopDistance) {
      this.speed = Math.max(0, this.speed - mv.DECELERATION * 2 * (deltaMs/1000));
      return;
    }

    // Движемся к цели с учетом дистанции остановки
    const slowingRadius = Math.max(stopDistance + 50, mv.SLOWING_RADIUS);
    const desiredSpeed = distance < slowingRadius ? mv.MAX_SPEED * ((distance - stopDistance) / (slowingRadius - stopDistance)) : mv.MAX_SPEED;
    
    const dt = deltaMs / 1000;
    if (this.speed < desiredSpeed) this.speed = Math.min(this.speed + mv.ACCELERATION * dt, desiredSpeed);
    else this.speed = Math.max(this.speed - mv.DECELERATION * dt, Math.max(0, desiredSpeed));

    // Поворот к цели
    const targetAngle = Math.atan2(dy, dx);
    this.turnTowardsOriginal(targetAngle, mv, deltaMs);
  }

  private turnTowardsOriginal(targetAngle: number, mv: any, deltaMs: number) {
    let angleDiff = targetAngle - this.headingRad!;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    let effectiveTurnSpeed = mv.TURN_SPEED; // рад/сек
    if (this.speed > 0.1) {
      const speedRatio = this.speed / mv.MAX_SPEED;
      const turnPenaltyFactor = 1 / (1 + speedRatio * mv.TURN_PENALTY_MULTIPLIER);
      effectiveTurnSpeed = mv.TURN_SPEED * turnPenaltyFactor;
    }

    const isAligned = Math.abs(angleDiff) < 0.02;
    if (!isAligned && effectiveTurnSpeed > 0) {
      const dt = deltaMs / 1000;
      const turnAmount = Math.min(Math.abs(angleDiff), effectiveTurnSpeed * dt);
      this.headingRad! += Math.sign(angleDiff) * turnAmount;
      this.speed = Math.max(this.speed - (mv.DECELERATION * mv.TURN_DECELERATION_FACTOR) * dt, 0);
    }
  }
}


