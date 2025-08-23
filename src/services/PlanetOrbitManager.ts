import type { ConfigManager } from '@/sys/ConfigManager';

type PlanetRecord = { obj: Phaser.GameObjects.Image; data: any; label?: Phaser.GameObjects.Text };

/**
 * Обновляет орбиты планет: позиционирование спрайтов/лейблов и проксирование координат в конфиг.
 */
export class PlanetOrbitManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private planets: PlanetRecord[];
  private orbitalSpeedScale: number;

  constructor(scene: Phaser.Scene, config: ConfigManager, planets: PlanetRecord[], orbitalSpeedScale = 0.1) {
    this.scene = scene;
    this.config = config;
    this.planets = planets;
    this.orbitalSpeedScale = orbitalSpeedScale;
  }

  update(deltaMs: number) {
    const sys: any = this.config?.system;
    if (!sys || !sys.star || !sys.planets) return;
    const dt = deltaMs / 1000;
    for (const pl of this.planets) {
      pl.data.angleDeg = (pl.data.angleDeg + pl.data.orbit.angularSpeedDegPerSec * dt * this.orbitalSpeedScale) % 360;
      const rad = Phaser.Math.DegToRad(pl.data.angleDeg);
      const px = sys.star.x + Math.cos(rad) * pl.data.orbit.radius;
      const py = sys.star.y + Math.sin(rad) * pl.data.orbit.radius;
      pl.obj.x = px;
      pl.obj.y = py;
      if (pl.label) pl.label.setPosition(px, py - 180);
      const confPlanet = (sys.planets as Array<any>).find((q: any) => q.id === pl.data.id) as any;
      if (confPlanet) { confPlanet._x = px; confPlanet._y = py; }
    }
  }
  
  /**
   * Корректно уничтожить менеджер и освободить ресурсы
   */
  public destroy(): void {
    // Очистить ссылки
    this.scene = undefined as any;
    this.config = undefined as any;
    this.planets = [];
  }
}


