// Минимальный стабаут Phaser для юнит-тестов без реального canvas
const MathStub: any = {
  Vector2: class Vector2 {
    x: number; y: number;
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    add(v: any) { this.x += v.x; this.y += v.y; return this; }
    scale(s: number) { this.x *= s; this.y *= s; return this; }
  },
  Distance: {
    Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    BetweenPoints: (a: any, b: any) => Math.hypot(b.x - a.x, b.y - a.y)
  },
  Linear: (a: number, b: number, t: number) => a + (b - a) * t,
  DegToRad: (d: number) => d * Math.PI / 180,
  RadToDeg: (r: number) => r * 180 / Math.PI,
  Angle: { Wrap: (v: number) => ((v + Math.PI) % (2 * Math.PI)) - Math.PI },
  Clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
};

(globalThis as any).Phaser = {
  Math: MathStub,
  Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
  Input: { Keyboard: { KeyCodes: { F: 70 } } }
};


