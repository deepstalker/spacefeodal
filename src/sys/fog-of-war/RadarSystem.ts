import type { ConfigManager } from '../ConfigManager';
import type { IRadarSystem, VisibilityZone } from './types';

export class RadarSystem implements IRadarSystem {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private currentRadarRange: number = 1200;

  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
  }

  getRadarRange(): number {
    // Получаем радиус радара из конфигурации корабля игрока
    const shipId = this.config.player?.shipId ?? this.config.ships.current;
    const shipDef = this.config.ships.defs[shipId];
    
    if (shipDef?.sensors?.radar_range) {
      this.currentRadarRange = shipDef.sensors.radar_range;
    } else if (shipDef?.combat?.sensorRadius) {
      this.currentRadarRange = shipDef.combat.sensorRadius;
    }
    
    return this.currentRadarRange;
  }

  setRadarRange(range: number): void {
    this.currentRadarRange = range;
  }

  calculateVisibilityZones(radarRange: number): VisibilityZone {
    const fogConfig = this.config.gameplay?.fogOfWar;
    const innerFactor = fogConfig?.fadeZone?.innerRadius ?? 0.85;
    const outerFactor = fogConfig?.fadeZone?.outerRadius ?? 1.15;

    return {
      innerRadius: radarRange * innerFactor,
      fadeStartRadius: radarRange * innerFactor,
      fadeEndRadius: radarRange,
      outerRadius: radarRange * outerFactor
    };
  }

  isInRadarRange(x: number, y: number, playerX: number, playerY: number): boolean {
    const distance = Math.hypot(x - playerX, y - playerY);
    return distance <= this.getRadarRange();
  }
}