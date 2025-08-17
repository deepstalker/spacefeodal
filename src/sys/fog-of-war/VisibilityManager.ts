import type { IVisibilityManager } from './types';

export class VisibilityManager implements IVisibilityManager {
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  updateObjectVisibility(obj: Phaser.GameObjects.GameObject, distance: number, radarRange: number): void {
    const fadeZone = { innerRadius: 0.85, outerRadius: 1.15 };
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
      // Переход от полной видимости к 50%
      const factor = (distance - innerRadius) / (radarRange - innerRadius);
      return 1.0 - (factor * 0.5);
    } else if (distance <= outerRadius) {
      // Переход от 50% к полному скрытию
      const factor = (distance - radarRange) / (outerRadius - radarRange);
      return 0.5 - (factor * 0.5);
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