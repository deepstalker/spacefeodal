import type { ConfigManager } from './ConfigManager';
import type { EnhancedFogOfWar } from './fog-of-war/EnhancedFogOfWar';

export class MinimapManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private g!: Phaser.GameObjects.Graphics;
  private width = 240;
  private height = 180;
  private worldW = 1;
  private worldH = 1;
  private shipRef: Phaser.GameObjects.GameObject | null = null;
  private fogOfWar?: EnhancedFogOfWar;

  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
  }

  init(containerX: number, containerY: number, width?: number, height?: number) {
    // Обновляем размеры миникарты если переданы
    if (width) this.width = width;
    if (height) this.height = height;
    
    const sys = (this.config as any)?.system;
    if (sys?.size) {
      this.worldW = sys.size.width;
      this.worldH = sys.size.height;
    } else {
      // безопасные дефолты до инициализации системы
      this.worldW = 5000;
      this.worldH = 5000;
    }
    this.g = this.scene.add.graphics();
    this.g.setScrollFactor(0).setDepth(1000);
    // Используем локальные координаты, а смещение применяем при рисовании
    (this.g as any)._mx = containerX;
    (this.g as any)._my = containerY;
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.render, this);
  }

  attachShip(ship: Phaser.GameObjects.GameObject) {
    this.shipRef = ship;
  }

  setFogOfWar(fogOfWar: EnhancedFogOfWar) {
    this.fogOfWar = fogOfWar;
  }

  private render() {
    if (!this.g) return;
    const x = (this.g as any)._mx ?? 0;
    const y = (this.g as any)._my ?? 0;
    const sys = (this.config as any)?.system;
    if (!sys) {
      // пока система не готова — рисуем только фон рамки
      this.g.clear();
      const x = (this.g as any)._mx ?? 0;
      const y = (this.g as any)._my ?? 0;
      this.g.fillStyle(0x000000, 0.6);
      this.g.fillRect(x - 4, y - 4, this.width + 8, this.height + 8);
      this.g.lineStyle(1, 0xA28F6E);
      this.g.strokeRect(x, y, this.width, this.height);
      return;
    }
    const scaleX = this.width / this.worldW;
    const scaleY = this.height / this.worldH;
    this.g.clear();
    // background panel
    this.g.fillStyle(0x2c2a2d, 0.97);
    this.g.fillRect(x - 4, y - 4, this.width + 8, this.height + 8);
    this.g.lineStyle(1, 0xA28F6E);
    this.g.strokeRect(x, y, this.width, this.height);

    // Clipping to minimap rect
    const clipX = x, clipY = y, clipW = this.width, clipH = this.height;
    const inRect = (wx: number, wy: number) => wx >= 0 && wy >= 0 && wx <= this.worldW && wy <= this.worldH;
    const toScreen = (wx: number, wy: number) => ({ sx: clipX + wx * scaleX, sy: clipY + wy * scaleY });

    // Star (bigger marker)
    this.g.fillStyle(0xffcc00, 1);
    if (inRect(sys.star.x, sys.star.y)) {
      const { sx, sy } = toScreen(sys.star.x, sys.star.y);
      this.g.fillCircle(sx, sy, 4);
    }

    // Planets
    for (const p of sys.planets) {
      // Берём текущие мировые координаты планет, если StarSystemScene их обновляет и проксирует в config
      const px = (p as any)._x ?? (sys.star.x + p.orbit.radius);
      const py = (p as any)._y ?? sys.star.y;
      if (inRect(px, py)) {
        const { sx, sy } = toScreen(px, py);
        this.g.fillStyle(0x00c2a8, 1);
        this.g.fillRect(sx - 1.5, sy - 1.5, 3, 3);
      }
    }

    // Encounters (POI) — relative to star center
    if (Array.isArray(sys.poi)) {
      for (const e of sys.poi) {
        const ex = sys.star.x + ((e as any).x ?? 0);
        const ey = sys.star.y + ((e as any).y ?? 0);
        if (inRect(ex, ey)) {
          const { sx, sy } = toScreen(ex, ey);
          this.g.fillStyle(0xf0e68c, 1);
          this.g.fillCircle(sx, sy, 3.5);
        }
      }
    }

    // Player ship
    if (this.shipRef) {
      const s: any = this.shipRef;
      if (inRect(s.x, s.y)) {
        const { sx, sy } = toScreen(s.x, s.y);
        this.g.fillStyle(0x5d8a9b, 1);
        this.g.fillRect(sx - 2, sy - 2, 4, 4);
      }
    }

    // NPCs by status (ally/neutral/confrontation) - только видимые в fog of war
    const starScene: any = this.scene.scene.get('StarSystemScene');
    const combat: any = starScene?.combat;
    if (combat && Array.isArray(combat['targets'])) {
      for (const t of combat['targets']) {
        const o: any = t.obj;
        if (!o || !o.active) continue;
        if (o === this.shipRef) continue;
        if (!inRect(o.x, o.y)) continue;
        
        // Проверяем видимость через fog of war
        if (this.fogOfWar && !this.fogOfWar.isObjectVisible(o)) continue;
        
        const { sx, sy } = toScreen(o.x, o.y);
        // derive relation to player
        const factionPlayer = 'player';
        const factionNpc = t.faction;
        const rel = combat['getRelation'] ? combat['getRelation'](factionPlayer, factionNpc, undefined) : 'neutral';
        let color = 0x9e9382; // neutral
        if (rel === 'ally') color = 0x22c55e; // keep ally distinguishable
        else if (rel === 'confrontation') color = 0xa93226;
        this.g.fillStyle(color, 1);
        this.g.fillCircle(sx, sy, 2.2);
      }
    }

    // Radar range ring (тонкое кольцо цвета #5D8A9B)
    if (this.fogOfWar && this.shipRef) {
      const s: any = this.shipRef;
      if (inRect(s.x, s.y)) {
        const radarRange = this.fogOfWar.getRadarRange();
        const { sx, sy } = toScreen(s.x, s.y);
        const radarRadius = radarRange * scaleX; // используем scaleX для радиуса
        
        // Рисуем только если кольцо хотя бы частично видно на миникарте
        if (radarRadius > 2) {
          this.g.lineStyle(1, 0x5D8A9B, 0.6);
          this.g.strokeCircle(sx, sy, radarRadius);
        }
      }
    }

    // Camera viewport rectangle (use world camera from StarSystemScene, not UI camera)
    const worldCam = starScene?.cameras?.main;
    const vw = worldCam?.worldView;
    if (vw) {
      const rx = x + vw.x * scaleX;
      const ry = y + vw.y * scaleY;
      const rw = vw.width * scaleX;
      const rh = vw.height * scaleY;
      
      // Проверяем, что рамка viewport пересекается с областью миникарты
      const minimapLeft = x;
      const minimapTop = y;
      const minimapRight = x + this.width;
      const minimapBottom = y + this.height;
      
      // Проверка пересечения прямоугольников
      const intersects = !(rx > minimapRight || 
                          rx + rw < minimapLeft || 
                          ry > minimapBottom || 
                          ry + rh < minimapTop);
      
      // Рисуем зеленую рамку только если она пересекается с миникартой
      if (intersects) {
        this.g.lineStyle(2, 0x66ff66, 1);
        this.g.strokeRect(rx, ry, rw, rh);
      }
    }
  }
}


