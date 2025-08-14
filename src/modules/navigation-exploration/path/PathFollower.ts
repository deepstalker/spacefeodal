import type { GameplayConfig } from '@/sys/ConfigManager';

export class PathFollower {
  private scene: Phaser.Scene;
  private obj: Phaser.GameObjects.GameObject & { x: number; y: number; rotation: number };
  private cfg: GameplayConfig['movement'];

  private pathPoints: Phaser.Math.Vector2[] = [];
  private segLen: number[] = [];
  private cumLen: number[] = [];
  private totalLen = 0;
  private speed = 0;
  private active = false;

  constructor(scene: Phaser.Scene, obj: Phaser.GameObjects.GameObject & { x: number; y: number; rotation: number }, cfg: GameplayConfig['movement']) {
    this.scene = scene;
    this.obj = obj;
    this.cfg = cfg;
  }

  follow(points: Phaser.Math.Vector2[]) {
    if (!points || points.length < 2) return;
    this.pathPoints = points;
    this.segLen = [];
    this.cumLen = [0];
    this.totalLen = 0;
    for (let i = 1; i < points.length; i++) {
      const len = Phaser.Math.Distance.BetweenPoints(points[i - 1], points[i]);
      this.segLen.push(len);
      this.totalLen += len;
      this.cumLen.push(this.totalLen);
    }
    if (!this.active) {
      this.active = true;
      this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
    }
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.update, this);
  }

  private update(_time: number, deltaMs: number) {
    if (!this.active || this.pathPoints.length < 2) return;
    const dt = deltaMs / 1000;

    // 1) Проекция текущей позиции на ломаную для получения пройденного пути s
    const proj = this.projectOnPath(this.obj.x, this.obj.y);
    const s = proj.s;
    const remaining = Math.max(0, this.totalLen - s);

    // 2) Выбираем lookahead точку впереди по пути
    const lookahead = Math.max(50, this.speed * 0.6);
    const sTarget = Math.min(this.totalLen, s + lookahead);
    const target = this.pointAtS(sTarget);

    // 3) Поворот к lookahead с ограничением угловой скорости
    const desired = Math.atan2(target.y - this.obj.y, target.x - this.obj.x);
    const maxTurn = Phaser.Math.DegToRad(this.cfg.turnRateDegPerSec) * dt;
    let current = this.obj.rotation;
    const diff = Phaser.Math.Angle.Wrap(desired - current);
    if (Math.abs(diff) <= maxTurn) current = desired; else current += Math.sign(diff) * maxTurn;
    this.obj.rotation = current;

    // 4) Профиль скорости по оставшейся длине пути
    const sStop = (this.speed * this.speed) / (2 * Math.max(1e-3, this.cfg.deceleration));
    let accel = this.cfg.acceleration;
    if (remaining <= sStop + 2) accel = -this.cfg.deceleration;
    this.speed = Phaser.Math.Clamp(this.speed + accel * dt, 0, this.cfg.maxSpeed);

    // 5) Движение вперёд по текущему курсу
    const vx = Math.cos(this.obj.rotation) * this.speed;
    const vy = Math.sin(this.obj.rotation) * this.speed;
    this.obj.x += vx * dt;
    this.obj.y += vy * dt;

    // 6) Завершение у конца пути
    if (remaining < Math.max(4, this.speed * dt + 2) && this.speed < 10) {
      const last = this.pathPoints[this.pathPoints.length - 1];
      this.obj.x = last.x;
      this.obj.y = last.y;
      this.speed = 0;
      this.stop();
    }
  }

  private projectOnPath(x: number, y: number): { s: number; segIndex: number; t: number } {
    let bestDist = Number.POSITIVE_INFINITY;
    let bestS = 0;
    let bestSeg = 0;
    let bestT = 0;
    let acc = 0;
    for (let i = 0; i < this.segLen.length; i++) {
      const a = this.pathPoints[i];
      const b = this.pathPoints[i + 1];
      const abx = b.x - a.x, aby = b.y - a.y;
      const abLen2 = abx * abx + aby * aby || 1;
      const apx = x - a.x, apy = y - a.y;
      let t = (apx * abx + apy * aby) / abLen2;
      t = Phaser.Math.Clamp(t, 0, 1);
      const px = a.x + abx * t;
      const py = a.y + aby * t;
      const d2 = (x - px) * (x - px) + (y - py) * (y - py);
      if (d2 < bestDist) {
        bestDist = d2;
        bestS = acc + this.segLen[i] * t;
        bestSeg = i;
        bestT = t;
      }
      acc += this.segLen[i];
    }
    return { s: bestS, segIndex: bestSeg, t: bestT };
  }

  private pointAtS(s: number): Phaser.Math.Vector2 {
    s = Phaser.Math.Clamp(s, 0, this.totalLen);
    // бинарный поиск по cumLen
    let lo = 0, hi = this.cumLen.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (this.cumLen[mid] < s) lo = mid + 1; else hi = mid;
    }
    const idx = Math.max(1, lo);
    const prevLen = this.cumLen[idx - 1];
    const segIdx = idx - 1;
    const segLength = Math.max(1e-6, this.segLen[segIdx]);
    const t = (s - prevLen) / segLength;
    const a = this.pathPoints[segIdx];
    const b = this.pathPoints[segIdx + 1];
    return new Phaser.Math.Vector2(
      Phaser.Math.Linear(a.x, b.x, t),
      Phaser.Math.Linear(a.y, b.y, t)
    );
  }
}


