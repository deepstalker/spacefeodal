export enum StaticObjectType {
  STAR = 'star',
  PLANET = 'planet',
  STATION = 'station',
  POI_VISIBLE = 'poi_visible',
  POI_HIDDEN = 'poi_hidden',
  CELESTIAL_BODY = 'celestial_body'
}

export enum DynamicObjectType {
  NPC = 'npc',
  PROJECTILE = 'projectile',
  EFFECT = 'effect',
  DEBRIS = 'debris'
}

export interface VisibilityZone {
  innerRadius: number;    // Полная видимость (alpha = 1.0)
  fadeStartRadius: number; // Начало затухания
  fadeEndRadius: number;   // Конец затухания (alpha = 0.5)
  outerRadius: number;     // Полное скрытие (alpha = 0.0)
}

export interface TrackedObject {
  gameObject: Phaser.GameObjects.GameObject;
  type: StaticObjectType | DynamicObjectType;
  isStatic: boolean;
  lastDistance: number;
  lastAlpha: number;
  needsUpdate: boolean;
  originalAlpha: number;
}

export interface IEnhancedFogOfWar {
  init(): void;
  update(deltaTime: number): void;
  registerStaticObject(obj: Phaser.GameObjects.GameObject, type: StaticObjectType): void;
  registerDynamicObject(obj: Phaser.GameObjects.GameObject, type: DynamicObjectType): void;
  unregisterObject(obj: Phaser.GameObjects.GameObject): void;
  setPlayerPosition(x: number, y: number): void;
  setRadarRange(range: number): void;
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

export interface IVisibilityManager {
  updateObjectVisibility(obj: Phaser.GameObjects.GameObject, distance: number, radarRange: number): void;
  calculateAlpha(distance: number, radarRange: number, fadeZone: { innerRadius: number; outerRadius: number }): number;
  setObjectVisible(obj: Phaser.GameObjects.GameObject, visible: boolean): void;
  setObjectAlpha(obj: Phaser.GameObjects.GameObject, alpha: number): void;
}

export interface IRadarSystem {
  getRadarRange(): number;
  setRadarRange(range: number): void;
  calculateVisibilityZones(radarRange: number): VisibilityZone;
  isInRadarRange(x: number, y: number, playerX: number, playerY: number): boolean;
}