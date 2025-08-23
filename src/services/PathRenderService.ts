import type { MovementManager } from '@/sys/MovementManager';

/**
 * Отрисовка путей и линии цели для корабля игрока.
 */
export class PathRenderService {
  private scene: Phaser.Scene;
  private movement: MovementManager;
  private ship: any;
  private routeGraphics!: Phaser.GameObjects.Graphics;
  private aimLine!: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, movement: MovementManager, ship: any) {
    this.scene = scene;
    this.movement = movement;
    this.ship = ship;
  }

  init() {
    this.routeGraphics = this.scene.add.graphics({ lineStyle: { width: 2, color: 0x4dd2ff, alpha: 0.85 } }).setDepth(0.5);
    this.aimLine = this.scene.add.graphics({}).setDepth(0.6);
  }

  updateAimLine() {
    if (!this.aimLine) return;
    this.aimLine.clear();
    const target = this.movement.getTarget();
    if (!target) return;
    this.aimLine.lineStyle(2, 0xffffff, 0.2);
    this.aimLine.beginPath();
    this.aimLine.moveTo(this.ship.x, this.ship.y);
    this.aimLine.lineTo(target.x, target.y);
    this.aimLine.strokePath();
    // target circle
    this.aimLine.lineStyle(2, 0xffffff, 1);
    this.aimLine.strokeCircle(target.x, target.y, 8);
    this.aimLine.fillStyle(0xff6464, 1);
    this.aimLine.fillCircle(target.x, target.y, 8);
    this.aimLine.lineStyle(2, 0xffffff, 1);
    this.aimLine.strokeCircle(target.x, target.y, 8);
  }

  drawPath(points: Phaser.Math.Vector2[]) {
    if (!this.routeGraphics) return;
    this.routeGraphics.clear();
    if (points.length === 0) return;
    this.routeGraphics.beginPath();
    this.routeGraphics.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) this.routeGraphics.lineTo(points[i].x, points[i].y);
    this.routeGraphics.strokePath();
    const n = points.length;
    if (n >= 2) {
      const a = points[n - 2];
      const b = points[n - 1];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const ah = 14;
      const left = new Phaser.Math.Vector2(
        b.x - Math.cos(ang) * ah + Math.cos(ang + Math.PI / 2) * (ah * 0.5),
        b.y - Math.sin(ang) * ah + Math.sin(ang + Math.PI / 2) * (ah * 0.5)
      );
      const right = new Phaser.Math.Vector2(
        b.x - Math.cos(ang) * ah + Math.cos(ang - Math.PI / 2) * (ah * 0.5),
        b.y - Math.sin(ang) * ah + Math.sin(ang - Math.PI / 2) * (ah * 0.5)
      );
      this.routeGraphics.fillStyle(0x4dd2ff, 0.9);
      this.routeGraphics.fillTriangle(b.x, b.y, left.x, left.y, right.x, right.y);
    }
  }
  
  /**
   * Корректно уничтожить сервис и освободить ресурсы
   */
  public destroy(): void {
    try {
      this.routeGraphics?.destroy();
    } catch (e) {
      console.warn('[PathRenderService] Error destroying routeGraphics:', e);
    }
    
    try {
      this.aimLine?.destroy();
    } catch (e) {
      console.warn('[PathRenderService] Error destroying aimLine:', e);
    }
    
    this.routeGraphics = undefined as any;
    this.aimLine = undefined as any;
    this.ship = undefined;
    this.movement = undefined as any;
  }
}


