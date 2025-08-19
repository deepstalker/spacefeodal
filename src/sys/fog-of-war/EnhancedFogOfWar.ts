import type { ConfigManager } from '../ConfigManager';
import { RadarSystem } from './RadarSystem';
import { VisibilityManager } from './VisibilityManager';
import type { 
  IEnhancedFogOfWar, 
  StaticObjectType, 
  DynamicObjectType, 
  TrackedObject 
} from './types';

export class EnhancedFogOfWar implements IEnhancedFogOfWar {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private radarSystem: RadarSystem;
  private visibilityManager: VisibilityManager;
  
  private trackedObjects: Map<Phaser.GameObjects.GameObject, TrackedObject> = new Map();
  private playerX: number = 0;
  private playerY: number = 0;
  private enabled: boolean = true;
  private lastUpdateTime: number = 0;
  
  private radarRing?: Phaser.GameObjects.Arc;

  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
    this.radarSystem = new RadarSystem(scene, config);
    this.visibilityManager = new VisibilityManager(scene);
  }

  init(): void {
    const fogConfig = this.config.gameplay?.fogOfWar;
    this.enabled = fogConfig?.enabled ?? true;
    
    if (!this.enabled) return;

    // Создаем кольцо радара для визуализации
    this.createRadarRing();

    // Подключаемся к циклу обновления
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
  }

  update(deltaTime: number): void {
    if (!this.enabled) return;

    try {
      const now = this.scene.time.now;
      const fogConfig = this.config.gameplay?.fogOfWar;
      const updateInterval = fogConfig?.performance?.updateInterval ?? 50;

      if (now - this.lastUpdateTime < updateInterval) return;
      this.lastUpdateTime = now;

      const radarRange = this.radarSystem.getRadarRange();
      const maxObjectsPerFrame = fogConfig?.performance?.maxObjectsPerFrame ?? 20;
      
      let processedCount = 0;
      const objectsToRemove: Phaser.GameObjects.GameObject[] = [];
      
      for (const [gameObject, trackedObj] of this.trackedObjects) {
        if (processedCount >= maxObjectsPerFrame) break;
        
        // Проверяем валидность объекта
        if (!gameObject || !gameObject.active || (gameObject as any).scene !== this.scene) {
          objectsToRemove.push(gameObject);
          continue;
        }

        try {
          const objX = (gameObject as any).x;
          const objY = (gameObject as any).y;
          
          // Проверяем что координаты валидны
          if (typeof objX !== 'number' || typeof objY !== 'number' || 
              isNaN(objX) || isNaN(objY)) {
            continue;
          }

          const distance = Math.hypot(objX - this.playerX, objY - this.playerY);

          // Статические объекты всегда видимы
          if (trackedObj.isStatic) {
            this.visibilityManager.setObjectVisible(gameObject, true);
            this.visibilityManager.setObjectAlpha(gameObject, trackedObj.originalAlpha);
            continue;
          }

          // Обновляем видимость динамических объектов с учётом настройки fadeZone из конфига
          const fogCfg = this.config.gameplay?.fogOfWar;
          const fadeInner = Math.min(Math.max(fogCfg?.fadeZone?.innerRadius ?? 0.98, 0.0), 1.0);
          const fadeOuter = Math.max(fogCfg?.fadeZone?.outerRadius ?? 1.03, 1.0);
          const alpha = this.visibilityManager.calculateAlpha(
            distance,
            radarRange,
            { innerRadius: fadeInner, outerRadius: fadeOuter }
          );
          if (alpha <= 0) {
            this.visibilityManager.setObjectVisible(gameObject, false);
          } else {
            this.visibilityManager.setObjectVisible(gameObject, true);
            this.visibilityManager.setObjectAlpha(gameObject, alpha);
          }
          
          trackedObj.lastDistance = distance;
          processedCount++;
        } catch (error) {
          console.warn('[FogOfWar] Error processing object:', error);
          objectsToRemove.push(gameObject);
        }
      }

      // Удаляем невалидные объекты
      for (const obj of objectsToRemove) {
        this.unregisterObject(obj);
      }

      // Обновляем radar ring
      this.updateRadarRing();
    } catch (error) {
      console.error('[FogOfWar] Critical error in update:', error);
    }
  }

  registerStaticObject(obj: Phaser.GameObjects.GameObject, type: StaticObjectType): void {
    if (!obj || !obj.active) {
      console.warn('[FogOfWar] Attempted to register invalid static object');
      return;
    }

    try {
      const originalAlpha = (obj as any).alpha ?? 1.0;
      
      const trackedObj: TrackedObject = {
        gameObject: obj,
        type,
        isStatic: true,
        lastDistance: 0,
        lastAlpha: originalAlpha,
        needsUpdate: false,
        originalAlpha
      };

      this.trackedObjects.set(obj, trackedObj);
    } catch (error) {
      console.error('[FogOfWar] Error registering static object:', error);
    }
  }

  registerDynamicObject(obj: Phaser.GameObjects.GameObject, type: DynamicObjectType): void {
    if (!obj || !obj.active) {
      console.warn('[FogOfWar] Attempted to register invalid dynamic object');
      return;
    }

    try {
      const originalAlpha = (obj as any).alpha ?? 1.0;
      // Немедленная инициализация видимости для только что созданных динамических объектов
      const radarRange = this.radarSystem.getRadarRange();
      const dx = ((obj as any).x ?? 0) - this.playerX;
      const dy = ((obj as any).y ?? 0) - this.playerY;
      const dist = Math.hypot(dx, dy);
      const fogCfg = this.config.gameplay?.fogOfWar;
      const fadeInner = Math.min(Math.max(fogCfg?.fadeZone?.innerRadius ?? 0.98, 0.0), 1.0);
      const fadeOuter = Math.max(fogCfg?.fadeZone?.outerRadius ?? 1.03, 1.0);
      const alphaNow = this.visibilityManager.calculateAlpha(dist, radarRange, { innerRadius: fadeInner, outerRadius: fadeOuter });
      if (alphaNow <= 0) {
        this.visibilityManager.setObjectVisible(obj, false);
      } else {
        this.visibilityManager.setObjectVisible(obj, true);
        this.visibilityManager.setObjectAlpha(obj, alphaNow);
      }
      
      const trackedObj: TrackedObject = {
        gameObject: obj,
        type,
        isStatic: false,
        lastDistance: 0,
        lastAlpha: originalAlpha,
        needsUpdate: true,
        originalAlpha
      };

      this.trackedObjects.set(obj, trackedObj);
    } catch (error) {
      console.error('[FogOfWar] Error registering dynamic object:', error);
    }
  }

  unregisterObject(obj: Phaser.GameObjects.GameObject): void {
    this.trackedObjects.delete(obj);
  }

  setPlayerPosition(x: number, y: number): void {
    this.playerX = x;
    this.playerY = y;
  }

  setRadarRange(range: number): void {
    this.radarSystem.setRadarRange(range);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    
    if (!enabled) {
      // Восстанавливаем видимость всех объектов
      for (const [gameObject, trackedObj] of this.trackedObjects) {
        this.visibilityManager.setObjectVisible(gameObject, true);
        this.visibilityManager.setObjectAlpha(gameObject, trackedObj.originalAlpha);
      }
      
      // Показываем radar ring
      if (this.radarRing) {
        this.radarRing.setVisible(true);
      }
    } else {
      // Скрываем radar ring
      if (this.radarRing) {
        this.radarRing.setVisible(false);
      }
    }
  }

  // Методы для интеграции с миникартой
  isObjectVisible(obj: Phaser.GameObjects.GameObject): boolean {
    const trackedObj = this.trackedObjects.get(obj);
    // Статические объекты всегда видимы
    if (trackedObj?.isStatic) return true;
    // Для динамических и нетреканных объектов — видимость по радиусу радара
    const objX = (obj as any).x;
    const objY = (obj as any).y;
    if (typeof objX !== 'number' || typeof objY !== 'number') return true;
    const distance = Math.hypot(objX - this.playerX, objY - this.playerY);
    const radarRange = this.radarSystem.getRadarRange();
    return distance <= radarRange;
  }

  getVisibleObjects(): Phaser.GameObjects.GameObject[] {
    const visibleObjects: Phaser.GameObjects.GameObject[] = [];
    
    for (const [gameObject, trackedObj] of this.trackedObjects) {
      if (this.isObjectVisible(gameObject)) {
        visibleObjects.push(gameObject);
      }
    }
    
    return visibleObjects;
  }

  getRadarRange(): number {
    return this.radarSystem.getRadarRange();
  }

  getPlayerPosition(): { x: number; y: number } {
    return { x: this.playerX, y: this.playerY };
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.update, this);
    
    if (this.radarRing) {
      this.radarRing.destroy();
    }
    
    this.trackedObjects.clear();
  }

  private createRadarRing(): void {
    const radarRange = this.radarSystem.getRadarRange();
    
    // Создаем кольцо радара
    this.radarRing = this.scene.add.circle(this.playerX, this.playerY, radarRange, 0x00ff00, 0)
      .setStrokeStyle(2, 0x00ff00, 0.3)
      .setDepth(1000);
  }



  private updateRadarRing(): void {
    if (!this.radarRing) return;

    try {
      const radarRange = this.radarSystem.getRadarRange();
      
      // Обновляем позицию и размер кольца
      this.radarRing.setPosition(this.playerX, this.playerY);
      this.radarRing.setRadius(radarRange);
    } catch (error) {
      console.error('[FogOfWar] Error updating radar ring:', error);
    }
  }
}