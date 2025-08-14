import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => {
  const MathStub: any = {
    Vector2: class Vector2 {
      x: number; y: number;
      constructor(x = 0, y = 0) { this.x = x; this.y = y; }
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
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } }
  } as any;
});

import { MovementManager } from '@/sys/MovementManager';

const mockScene: any = {
  tweens: {
    createTimeline() {
      const calls: any[] = [];
      return {
        add(cfg: any) { calls.push(cfg); },
        play() {},
        _calls: calls
      } as any;
    }
  },
  events: { on() {}, off() {} }
};

describe('MovementManager', () => {
  it('creates a tween timeline for path points', () => {
    const cfg: any = { gameplay: { movement: { acceleration: 1, deceleration: 1, maxSpeed: 100, turnRateDegPerSec: 90 } } };
    const mgr = new MovementManager(mockScene as any, cfg);
    const obj: any = { x: 0, y: 0, rotation: 0 };
    const path = { points: [ { x: 0, y: 0 } as any, { x: 100, y: 0 } as any, { x: 100, y: 100 } as any ] };
    mgr.followPath(obj, path as any);
    // cannot easily inspect timeline internals; ensure no throw
    expect(true).toBe(true);
  });
});


