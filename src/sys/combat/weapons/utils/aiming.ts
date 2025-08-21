// Итеративный расчёт времени перехвата цели при скорости снаряда projectileSpeed
export function calculateInterceptTime(rx: number, ry: number, vx: number, vy: number, projectileSpeed: number): number {
  const maxIterations = 10;
  const tolerance = 0.1;

  let t = Math.hypot(rx, ry) / projectileSpeed;

  for (let i = 0; i < maxIterations; i++) {
    const futureX = rx + vx * t;
    const futureY = ry + vy * t;
    const distanceToFuture = Math.hypot(futureX, futureY);
    const newT = distanceToFuture / projectileSpeed;
    if (Math.abs(newT - t) < tolerance / 1000) {
      return newT;
    }
    t = newT;
  }

  return t;
}

// Скорость цели из moveRef; 0,0 если нет данных
export function getTargetVelocity(target: any): { vx: number; vy: number } {
  let vx = 0, vy = 0;
  const moveRef = (target as any)?.__moveRef;
  if (moveRef && typeof moveRef.speed === 'number' && typeof moveRef.headingRad === 'number') {
    const sp = Math.max(0, moveRef.speed);
    const hr = moveRef.headingRad;
    vx = Math.cos(hr) * sp;
    vy = Math.sin(hr) * sp;
  }
  return { vx, vy };
}
