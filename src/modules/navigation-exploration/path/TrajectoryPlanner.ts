import type { GameplayConfig } from '@/sys/ConfigManager';

export type KinematicState = {
  x: number;
  y: number;
  headingRad: number;
  speed: number;
};

export type Trajectory = { points: Phaser.Math.Vector2[]; length: number };

function computeTurnRadius(speed: number, turnRateRadPerSec: number): number {
  const omega = Math.max(1e-6, turnRateRadPerSec);
  return Math.max(1e-3, speed / omega);
}

function leftNormal(headingRad: number): Phaser.Math.Vector2 {
  return new Phaser.Math.Vector2(-Math.sin(headingRad), Math.cos(headingRad));
}

export function planDubinsLike(state: KinematicState, goal: { x: number; y: number }, mv: GameplayConfig['movement']): Trajectory {
  // Первый проход: черновой радиус по текущей/номинальной скорости
  const desired = Math.atan2(goal.y - state.y, goal.x - state.x);
  const dthetaRaw = Phaser.Math.Angle.Wrap(desired - state.headingRad);
  const turnSign = Math.sign(dthetaRaw) || 1;
  const angleToTurn = Math.abs(dthetaRaw);

  let speedGuess = Math.max(state.speed, mv.MAX_SPEED * 0.6);
  let R = computeTurnRadius(speedGuess, mv.TURN_RATE);

  const pointsArc = (rad: number) => {
    const center = new Phaser.Math.Vector2(state.x, state.y).add(leftNormal(state.headingRad).scale(rad * turnSign));
    const startVec = new Phaser.Math.Vector2(state.x - center.x, state.y - center.y);
    const steps = Math.max(4, Math.ceil((angleToTurn / (Math.PI * 2)) * 32));
    const pts: Phaser.Math.Vector2[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ang = turnSign * angleToTurn * t;
      const rotX = startVec.x * Math.cos(ang) - startVec.y * Math.sin(ang);
      const rotY = startVec.x * Math.sin(ang) + startVec.y * Math.cos(ang);
      pts.push(new Phaser.Math.Vector2(center.x + rotX, center.y + rotY));
    }
    return { pts, end: pts[pts.length - 1] };
  };

  // Черновая дуга и прямой отрезок
  let { pts: arcPts, end } = pointsArc(R);
  let straightLen = Phaser.Math.Distance.Between(end.x, end.y, goal.x, goal.y);
  // Подбор крейсерской скорости так, чтобы затормозить к нулю в прямом участке
  const vStopFit = Math.sqrt(Math.max(0, 2 * mv.DECELERATION * straightLen));
  speedGuess = Math.min(mv.MAX_SPEED, Math.max(state.speed, vStopFit));
  R = computeTurnRadius(speedGuess, mv.TURN_RATE);
  // Пересчёт дуги с новым R
  ({ pts: arcPts, end } = pointsArc(R));
  straightLen = Phaser.Math.Distance.Between(end.x, end.y, goal.x, goal.y);

  const straightSteps = Math.max(2, Math.ceil(straightLen / 64));
  const points: Phaser.Math.Vector2[] = [...arcPts];
  for (let i = 1; i <= straightSteps; i++) {
    const t = i / straightSteps;
    points.push(new Phaser.Math.Vector2(
      Phaser.Math.Linear(end.x, goal.x, t),
      Phaser.Math.Linear(end.y, goal.y, t)
    ));
  }

  const arcLen = R * angleToTurn;
  const length = arcLen + straightLen;
  return { points, length };
}

export function simulateKinematicPath(state: KinematicState, goal: { x: number; y: number }, mv: GameplayConfig['movement']): Trajectory {
  let x = state.x;
  let y = state.y;
  let heading = state.headingRad;
  let v = Math.max(0, state.speed || 0);

  const dt = 1 / 60;
  const points: Phaser.Math.Vector2[] = [new Phaser.Math.Vector2(x, y)];
  let length = 0;
  let accDistSinceLast = 0;

  const maxSteps = 60 * 20; // до ~20 секунд симуляции
  let isBraking = false;
  for (let i = 0; i < maxSteps; i++) {
    const dx = goal.x - x;
    const dy = goal.y - y;
    const dist = Math.hypot(dx, dy);
    const desired = Math.atan2(dy, dx);

    // Решение о торможении (строго по ТЗ): моментальный переход в BRAKING, без поворота
    const brakingDistance = (v * v) / (2 * Math.max(1e-3, mv.DECELERATION));
    if (!isBraking && dist <= brakingDistance) {
      isBraking = true;
    }

    if (isBraking) {
      // В BRAKING запрещены поворот и ускорение — только замедление по инерции
      v = Math.max(0, v - mv.DECELERATION * dt);
    } else {
      // MOVING: поворот/набор скорости по правилам
      const angleDiff = Phaser.Math.Angle.Wrap(desired - heading);
      const needsToTurn = Math.abs(angleDiff) > mv.THRUST_ANGLE_TOLERANCE;
      if (needsToTurn) {
        if (v >= mv.MIN_TURN_SPEED) {
          const maxTurn = mv.TURN_RATE * dt;
          if (Math.abs(angleDiff) <= maxTurn) heading = desired; else heading += Math.sign(angleDiff) * maxTurn;
          const speedRatio = Math.min(v / mv.MAX_SPEED, 1);
          const turnPenalty = (mv as any).HIGH_SPEED_TURN_PENALTY ?? 0.9;
          const decel = (mv as any).TURN_DECELERATION ?? mv.DECELERATION;
          v = Math.max(0, v - decel * (1 + speedRatio * turnPenalty) * dt);
        } else {
          // Недостаточно скорости для поворота: разгон маневровыми двигателями, курс не меняем
          v = Math.min(mv.MAX_SPEED, v + mv.MANEUVER_THRUST * dt);
        }
      } else {
        // В допуске — основной двигатель
        v = Math.min(mv.MAX_SPEED, v + mv.ACCELERATION * dt);
      }
    }

    // Интеграция позиции
    const vx = Math.cos(heading) * v;
    const vy = Math.sin(heading) * v;
    const stepDx = vx * dt;
    const stepDy = vy * dt;
    x += stepDx;
    y += stepDy;
    const stepLen = Math.hypot(stepDx, stepDy);
    length += stepLen;
    accDistSinceLast += stepLen;

    if (accDistSinceLast >= 12) {
      points.push(new Phaser.Math.Vector2(x, y));
      accDistSinceLast = 0;
    }

    if ((dist < Math.max(4, v * dt + 2) && v < 10) || (isBraking && v <= 0.01)) {
      points.push(new Phaser.Math.Vector2(goal.x, goal.y));
      break;
    }
  }

  return { points, length };
}

export function estimateRemainingDistance(state: KinematicState, goal: { x: number; y: number }, mv: GameplayConfig['movement']): number {
  return planDubinsLike(state, goal, mv).length;
}


