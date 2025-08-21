export function getDistance(a: { x?: number; y?: number } | null | undefined, b: { x?: number; y?: number } | null | undefined): number {
  const ax = a?.x ?? 0;
  const ay = a?.y ?? 0;
  const bx = b?.x ?? 0;
  const by = b?.y ?? 0;
  return Math.hypot(bx - ax, by - ay);
}

// Минимальная дистанция от точки до отрезка AB
export function distPointToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const vx = x2 - x1, vy = y2 - y1;
  const wx = px - x1, wy = py - y1;
  const vv = vx*vx + vy*vy;
  const t = vv > 0 ? Phaser.Math.Clamp((wx*vx + wy*vy) / vv, 0, 1) : 0;
  const cx = x1 + t * vx;
  const cy = y1 + t * vy;
  return Math.hypot(px - cx, py - cy);
}
