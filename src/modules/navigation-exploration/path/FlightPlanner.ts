import type { GameplayConfig } from '@/sys/ConfigManager';

export type ShipState = {
  x: number;
  y: number;
  angle: number; // radians
  speed: number; // units/sec
  state: 'IDLE' | 'MOVING' | 'BRAKING' | 'EXECUTING_PLAN';
};

export type PlanPoint = { x: number; y: number; angle: number };

export type PlannerSettings = { SIMULATION_STEP: number; MAX_STEPS: number };

export function generateFlightPlan(start: ShipState, target: { x: number; y: number }, mv: GameplayConfig['movement'], ps: PlannerSettings): PlanPoint[] {
  // phantom ship copies current ship state but moves toward new target
  const phantom: ShipState & { target: { x: number; y: number } | null } = {
    x: start.x, y: start.y, angle: start.angle, speed: start.speed,
    state: 'MOVING', target
  };

  const plan: PlanPoint[] = [];
  for (let i = 0; i < ps.MAX_STEPS; i++) {
    applyPhysics(phantom, ps.SIMULATION_STEP, mv);
    plan.push({ x: phantom.x, y: phantom.y, angle: phantom.angle });
    if (phantom.state === 'IDLE') break;
  }
  return plan;
}

export function applyPhysics(subject: ShipState & { target?: { x: number; y: number } | null }, dt: number, mv: GameplayConfig['movement']) {
  if (subject.state === 'IDLE' || !subject.target) {
    subject.speed = 0; return;
  }

  if (subject.state === 'BRAKING') {
    subject.speed -= mv.DECELERATION * dt;
    if (subject.speed <= 0) { subject.speed = 0; subject.state = 'IDLE'; }
  } else if (subject.state === 'MOVING') {
    const dx = subject.target.x - subject.x;
    const dy = subject.target.y - subject.y;
    const distance = Math.hypot(dx, dy);
    const brakingDistance = (subject.speed * subject.speed) / (2 * Math.max(1e-3, mv.DECELERATION));
    if (distance <= brakingDistance && brakingDistance > 1) {
      subject.state = 'BRAKING';
    } else {
      const targetAngle = Math.atan2(dy, dx);
      let angleDiff = targetAngle - subject.angle;
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      const needsToTurn = Math.abs(angleDiff) >= mv.THRUST_ANGLE_TOLERANCE;
      if (needsToTurn) {
        if (subject.speed >= mv.MIN_TURN_SPEED) {
          const speedRatio = Math.min(subject.speed / mv.MAX_SPEED, 1);
          const turnMultiplier = 1 - (speedRatio * ((mv as any).HIGH_SPEED_TURN_PENALTY ?? 0.95));
          const turnAmount = mv.TURN_RATE * turnMultiplier * dt;
          const turnDirection = Math.sign(angleDiff);
          subject.angle += (Math.abs(angleDiff) > turnAmount) ? turnDirection * turnAmount : angleDiff;
          const decel = (mv as any).TURN_DECELERATION ?? mv.DECELERATION;
          subject.speed -= decel * dt;
        } else {
          subject.speed += mv.MANEUVER_THRUST * dt;
        }
      } else {
        subject.speed += mv.ACCELERATION * dt;
      }
    }
  }

  if (subject.speed < 0) subject.speed = 0;
  if (subject.speed > mv.MAX_SPEED) subject.speed = mv.MAX_SPEED;
  subject.angle = ((subject.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  subject.x += Math.cos(subject.angle) * subject.speed * dt;
  subject.y += Math.sin(subject.angle) * subject.speed * dt;
}


