import type { ConfigManager } from './ConfigManager';
// Для v6 планировщик не используется; путь — только конечная точка для новой цели

export type PathRequest = {
  start: { x: number; y: number; headingDeg: number };
  goal: { x: number; y: number };
  dynamics: Array<any>;
};

export type PlannedPath = { points: Phaser.Math.Vector2[] };

export class PathfindingManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;

  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
    // Попытка инициализировать navmesh из динамических препятствий позже (когда появятся тайлы)
  }

  // navmesh удалён — используем только предиктивную кинематическую траекторию

  planPath(req: PathRequest): PlannedPath {
    return { points: [new Phaser.Math.Vector2(req.goal.x, req.goal.y)] };
  }
}


