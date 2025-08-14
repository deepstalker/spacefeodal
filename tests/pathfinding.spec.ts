import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => {
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
  return {
    default: { Math: MathStub },
    Math: MathStub,
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    Input: { Keyboard: { KeyCodes: { F: 70 } } }
  } as any;
});

import { PathfindingManager } from '@/sys/PathfindingManager';

const mockScene: any = { add: {}, tweens: {}, cameras: { main: {} }, input: {} };

describe('PathfindingManager', () => {
  it('returns a simple path approximating a turning arc then straight', () => {
    const cfg: any = { gameplay: { movement: { maxSpeed: 100, acceleration: 50, deceleration: 60, turnRateDegPerSec: 90 }, pathfinder: {} } };
    const mgr = new PathfindingManager(mockScene, cfg);
    const path = mgr.planPath({ start: { x: 0, y: 0, headingDeg: 0 }, goal: { x: 100, y: 0 }, dynamics: [] });
    expect(path.points.length).toBeGreaterThan(0);
    const last = path.points.at(-1)!;
    expect(last.x).toBeTypeOf('number');
  });
});


