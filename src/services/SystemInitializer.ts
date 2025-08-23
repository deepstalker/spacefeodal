import type { ConfigManager } from '@/sys/ConfigManager';
import { StaticObjectType } from '@/sys/fog-of-war/types';

/**
 * Создание и первичная инициализация объектов системы: звезда, планеты, POI/энкаунтеры.
 * Проксирует координаты планет обратно в конфиг для миникарты.
 */
export class SystemInitializer {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private fog: any;
  public planets: { obj: Phaser.GameObjects.Image; data: any; label?: Phaser.GameObjects.Text }[] = [];
  public encounterMarkers: Array<{ id: string; name: string; x: number; y: number; typeId?: string; activationRange?: number; marker: Phaser.GameObjects.GameObject; label: Phaser.GameObjects.Text }> = [];

  constructor(scene: Phaser.Scene, config: ConfigManager, fogOfWar: any) {
    this.scene = scene;
    this.config = config;
    this.fog = fogOfWar;
  }

  initStarAndStatics() {
    const system = this.config.system;
    // Звезда
    const star = this.scene.add.circle(system.star.x, system.star.y, 80, 0xffcc00).setDepth(0);
    this.fog.registerStaticObject(star, StaticObjectType.STAR);
    return star;
  }

  initPOI() {
    const system: any = this.config.system;
    for (const e of system.poi as any[]) {
      const ex = system.star.x + (e.x ?? 0);
      const ey = system.star.y + (e.y ?? 0);
      const q = this.scene.add.circle(ex, ey, 24, 0x999999, 0.4).setDepth(0.5);
      const t = this.scene.add.text(ex, ey, '?', { color: '#ffffff', fontSize: '24px', fontStyle: 'bold' }).setOrigin(0.5).setDepth(0.6);
      const typesArr = (this.config.systemProfiles as any)?.profiles?.default?.encounters?.types as Array<any> | undefined;
      const type = typesArr?.find((k: any)=>k.name === e.name);
      const activationRange = (type && typeof type.activation_range === 'number') ? type.activation_range : 400;
      this.encounterMarkers.push({ id: e.id, name: e.name, x: ex, y: ey, typeId: type?.id, activationRange, marker: q, label: t });

      this.fog.registerStaticObject(q, e.discovered ? StaticObjectType.POI_VISIBLE : StaticObjectType.POI_HIDDEN);
      this.fog.registerStaticObject(t, e.discovered ? StaticObjectType.POI_VISIBLE : StaticObjectType.POI_HIDDEN);
    }
  }

  initPlanets() {
    const system = this.config.system;
    for (let i = 0; i < system.planets.length; i++) {
      const p = system.planets[i];
      const key = `planet_${(i % 10).toString().padStart(2,'0')}`;
      const img = this.scene.add.image(0, 0, key).setDepth(0);
      img.setDisplaySize(512, 512).setOrigin(0.5);
      const initAng = Math.random() * 360;
      const record = { obj: img, data: { ...p, angleDeg: initAng } } as any;
      this.planets.push(record);
      const rad = Phaser.Math.DegToRad(initAng);
      const px0 = system.star.x + Math.cos(rad) * p.orbit.radius;
      const py0 = system.star.y + Math.sin(rad) * p.orbit.radius;
      img.x = px0; img.y = py0;
      this.fog.registerStaticObject(img, StaticObjectType.PLANET);

      // Старую текстовую метку скрываем — теперь её заменяет IndicatorManager в StarSystemScene
      try {
        const label = this.scene.add.text(px0, py0 - 180, p.id, {
          fontFamily: 'HooskaiChamferedSquare',
          fontSize: '36px',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 6
        }).setOrigin(0.5).setDepth(2);
        label.setVisible(false);
        (record as any).label = label;
      } catch {}

      const confPlanet = (system.planets as any[]).find(pl => pl.id === p.id) as any;
      if (confPlanet) { confPlanet._x = px0; confPlanet._y = py0; }
    }
  }
  
  /**
   * Корректно уничтожить все инициализированные объекты
   */
  public destroy(): void {
    // Уничтожить все планеты
    for (const planet of this.planets) {
      try {
        planet.obj?.destroy();
      } catch (e) {
        console.warn('[SystemInitializer] Error destroying planet:', e);
      }
      
      try {
        planet.label?.destroy();
      } catch (e) {
        console.warn('[SystemInitializer] Error destroying planet label:', e);
      }
    }
    this.planets = [];
    
    // Уничтожить все encounter маркеры
    for (const marker of this.encounterMarkers) {
      try {
        marker.marker?.destroy();
      } catch (e) {
        console.warn('[SystemInitializer] Error destroying encounter marker:', e);
      }
      
      try {
        marker.label?.destroy();
      } catch (e) {
        console.warn('[SystemInitializer] Error destroying encounter label:', e);
      }
    }
    this.encounterMarkers = [];
  }
}


