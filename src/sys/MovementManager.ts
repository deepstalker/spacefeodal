import type { ConfigManager } from './ConfigManager';
import type { PlannedPath } from './PathfindingManager';
// Удаляем планировщик и исполняем реальную логику по ТЗ v6

export class MovementManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private speed = 0;
  private target: Phaser.Math.Vector2 | null = null;
  private headingRad: number | null = null;

  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
  }

  followPath(obj: Phaser.GameObjects.GameObject & { x: number; y: number; rotation: number }, path: PlannedPath) {
    const last = path.points[path.points.length - 1];
    this.target = new Phaser.Math.Vector2(last.x, last.y);
    // Use player's ship nose offset from ships.json
    const shipId = this.config.player?.shipId ?? this.config.ships?.current;
    const noseOffsetRad = Phaser.Math.DegToRad(this.config.ships?.defs?.[shipId!]?.sprite?.noseOffsetDeg ?? 0);
    this.headingRad = obj.rotation - noseOffsetRad;
    (obj as any).__moveRef = this;
  }

  getTarget(): Phaser.Math.Vector2 | null {
    return this.target;
  }

  getRenderPathPoints(currentX: number, currentY: number): Phaser.Math.Vector2[] {
    if (this.flightPlan.length <= 1) return [];
    const ps = this.config.planner ?? { SIMULATION_STEP: 0.05, MAX_STEPS: 400 };
    const idx = Math.floor(this.planTime / ps.SIMULATION_STEP);
    const points: Phaser.Math.Vector2[] = [];
    points.push(new Phaser.Math.Vector2(currentX, currentY));
    for (let i = Math.max(0, idx + 1); i < this.flightPlan.length; i++) {
      const p = this.flightPlan[i];
      points.push(new Phaser.Math.Vector2(p.x, p.y));
    }
    return points;
  }

  private update(_time: number, deltaMs: number) {
    const dt = deltaMs / 1000;
    // Найдём активный объект (на прототипе — корабль один)
    const obj = this.scene.children.getAll().find(o => (o as any)['__moveRef'] === this) as any;
    if (!obj) return;

    // Параметры движения и визуальный сдвиг носа берём из выбранного корабля игрока
    const selectedId = this.config.player?.shipId ?? this.config.ships?.current;
    const selected = selectedId ? this.config.ships.defs[selectedId] : undefined;
    const mv = selected?.movement ?? this.config.gameplay.movement;
    const noseOffsetRad = Phaser.Math.DegToRad(selected?.sprite?.noseOffsetDeg ?? 0);
    if (this.headingRad == null) this.headingRad = obj.rotation - noseOffsetRad;
    let speed = this.speed;
    if (!this.target) {
      // плавная остановка, если целей нет
      this.speed = Math.max(0, this.speed - mv.DECELERATION);
      return;
    }

    const dx = this.target.x - obj.x;
    const dy = this.target.y - obj.y;
    const distance = Math.hypot(dx, dy);
    // Желаемая скорость с предсказанием торможения
    const desiredSpeed = distance < mv.SLOWING_RADIUS ? mv.MAX_SPEED * (distance / mv.SLOWING_RADIUS) : mv.MAX_SPEED;
    if (speed < desiredSpeed) speed = Math.min(speed + mv.ACCELERATION, desiredSpeed);
    else speed = Math.max(speed - mv.DECELERATION, desiredSpeed);

    // Поворот
    const targetAngle = Math.atan2(dy, dx);
    let angleDiff = targetAngle - this.headingRad;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    let effectiveTurnSpeed = 0;
    if (speed > 0.1) {
      const speedRatio = speed / mv.MAX_SPEED;
      const turnPenaltyFactor = 1 / (1 + speedRatio * mv.TURN_PENALTY_MULTIPLIER);
      effectiveTurnSpeed = mv.TURN_SPEED * turnPenaltyFactor;
    }

    const isAligned = Math.abs(angleDiff) < 0.02;
    if (!isAligned && effectiveTurnSpeed > 0) {
      const turnAmount = Math.min(Math.abs(angleDiff), effectiveTurnSpeed);
      this.headingRad += Math.sign(angleDiff) * turnAmount;
      speed = Math.max(speed - (mv.DECELERATION * mv.TURN_DECELERATION_FACTOR), 0);
    }

    if (distance < 2) this.target = null;

    // apply heading to sprite with visual offset
    this.headingRad = ((this.headingRad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    obj.rotation = this.headingRad + noseOffsetRad;
    if (speed > 0) {
      obj.x += Math.cos(this.headingRad) * speed;
      obj.y += Math.sin(this.headingRad) * speed;
    }
    this.speed = speed;
  }
}


