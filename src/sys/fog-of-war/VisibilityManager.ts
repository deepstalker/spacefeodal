import type { IVisibilityManager } from './types';

export class VisibilityManager implements IVisibilityManager {
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  updateObjectVisibility(obj: Phaser.GameObjects.GameObject, distance: number, radarRange: number): void {
    // Значение по умолчанию — резкий градиент: почти сразу 1.0 внутри радара, короткая полоса затухания
    const fadeZone = { innerRadius: 0.98, outerRadius: 1.03 };
    const alpha = this.calculateAlpha(distance, radarRange, fadeZone);

    if (alpha <= 0) {
      this.setObjectVisible(obj, false);
    } else {
      this.setObjectVisible(obj, true);
      this.setObjectAlpha(obj, alpha);
    }
  }

  calculateAlpha(distance: number, radarRange: number, fadeZone: { innerRadius: number; outerRadius: number }): number {
    const innerRadius = radarRange * fadeZone.innerRadius;
    const outerRadius = radarRange * fadeZone.outerRadius;

    if (distance <= innerRadius) {
      // Полная видимость
      return 1.0;
    } else if (distance <= radarRange) {
      // Очень короткий переход от полной видимости к ~0.85 у края радара
      const factor = (distance - innerRadius) / Math.max(1, (radarRange - innerRadius));
      return 1.0 - (factor * 0.15);
    } else if (distance <= outerRadius) {
      // Быстрое затухание от 0.85 на границе радара до 0
      const factor = (distance - radarRange) / Math.max(1, (outerRadius - radarRange));
      return 0.85 - (factor * 0.85);
    } else {
      // Полное скрытие
      return 0.0;
    }
  }

  setObjectVisible(obj: Phaser.GameObjects.GameObject, visible: boolean): void {
    if ('setVisible' in obj && typeof obj.setVisible === 'function') {
      obj.setVisible(visible);
    }
  }

  setObjectAlpha(obj: Phaser.GameObjects.GameObject, alpha: number): void {
    if ('setAlpha' in obj && typeof obj.setAlpha === 'function') {
      obj.setAlpha(alpha);
    } else if ('alpha' in obj) {
      (obj as any).alpha = alpha;
    }
  }
}