import Phaser from 'phaser';
import { ConfigManager } from '@/sys/ConfigManager';
import { SaveManager } from '@/sys/SaveManager';
import { CameraManager } from '@/sys/CameraManager';
import { InputManager } from '@/sys/InputManager';
import { PathfindingManager } from '@/sys/PathfindingManager';
import { MovementManager } from '@/sys/MovementManager';

export default class StarSystemScene extends Phaser.Scene {
  private config!: ConfigManager;
  private save!: SaveManager;
  private cameraMgr!: CameraManager;
  private inputMgr!: InputManager;
  private pathfinding!: PathfindingManager;
  private movement!: MovementManager;

  private ship!: Phaser.GameObjects.Triangle;
  private routeGraphics!: Phaser.GameObjects.Graphics;
  private clickMarker?: Phaser.GameObjects.Arc;
  private planets: { obj: Phaser.GameObjects.Arc; data: any }[] = [];
  private starfield?: Phaser.GameObjects.Graphics;
  private aimLine?: Phaser.GameObjects.Graphics;

  constructor() {
    super('StarSystemScene');
  }

  async create() {
    this.config = new ConfigManager(this);
    await this.config.loadAll();

    this.save = new SaveManager(this, this.config);
    this.cameraMgr = new CameraManager(this, this.config, this.save);
    this.inputMgr = new InputManager(this, this.config);
    this.pathfinding = new PathfindingManager(this, this.config);
    this.movement = new MovementManager(this, this.config);

    const system = this.config.system;
    this.cameras.main.setBounds(0, 0, system.size.width, system.size.height);

    // Starfield procedural background (semi-transparent)
    this.starfield = this.add.graphics().setDepth(-10);
    this.drawStarfield();

    // Star placeholder
    this.add.circle(system.star.x, system.star.y, 80, 0xffcc00).setDepth(0);

    // Planets placeholders (will rotate)
    for (const p of system.planets) {
      const c = this.add.circle(
        system.star.x + p.orbit.radius,
        system.star.y,
        36,
        Number(p.color?.replace('#', '0x')) || 0x8888ff
      ).setDepth(0);
      this.planets.push({ obj: c, data: { ...p, angleDeg: 0 } });
    }

    // Ship sprite (256x128)
    const start = this.save.getLastPlayerState() ?? { x: system.star.x + 300, y: system.star.y, headingDeg: 0, zoom: 1 };
    const shipKey = this.textures.exists('ship_alpha') ? 'ship_alpha' : 'ship_alpha_public';
    const cfg = this.config.assets.sprites?.ship;
    const keyToUse = cfg?.key ?? shipKey;
    this.ship = this.add.image(start.x, start.y, keyToUse) as any;
    const ox = cfg?.origin?.x ?? 0.5;
    const oy = cfg?.origin?.y ?? 0.5;
    this.ship.setOrigin(ox, oy);
    const dw = cfg?.displaySize?.width ?? 64;
    const dh = cfg?.displaySize?.height ?? 128;
    this.ship.setDisplaySize(dw, dh);
    this.ship.setDepth(1);
    const noseOffsetRad = Phaser.Math.DegToRad(cfg?.noseOffsetDeg ?? 0);
    this.ship.setRotation(Phaser.Math.DegToRad(start.headingDeg) + noseOffsetRad);

    this.cameraMgr.enableFollow(this.ship);
    this.cameraMgr.setZoom(start.zoom ?? 1);

    this.routeGraphics = this.add.graphics({ lineStyle: { width: 2, color: 0x4dd2ff, alpha: 0.85 } }).setDepth(0.5);
    this.aimLine = this.add.graphics({}).setDepth(0.6);

    // Optional: if we had a tilemap and collision indices, here we would build a navmesh
    // Example (commented until tilemap exists):
    // const navMesh = (this as any).navMeshPlugin.buildFromTileLayer(tilemap, layer, { collisionIndices: [1], debug: { navMesh: false } });
    // this.pathfinding.setNavMesh(navMesh);

    // Сообщаем другим сценам, что система готова (конфиги загружены, корабль создан)
    this.events.emit('system-ready', { config: this.config, ship: this.ship });

    const onSelect = async (worldX: number, worldY: number) => {
      // Показать маркер клика
      if (!this.clickMarker) {
        // Маркер цели под кораблём
        this.clickMarker = this.add.circle(worldX, worldY, 10, 0x00ff88).setDepth(0.55).setAlpha(0.7);
      } else {
        this.clickMarker.setPosition(worldX, worldY).setVisible(true);
      }
      // Строим сценарный план тем же алгоритмом, что и исполнитель, чтобы не было расхождений
      this.movement.followPath(this.ship as any, { points: [ new Phaser.Math.Vector2(worldX, worldY) ] } as any);
      this.drawAimLine();
    };
    this.inputMgr.onRightClick(onSelect);
    // Только правая кнопка ставит цель

    // Toggle follow camera (F)
    const followKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    followKey?.on('down', () => {
      if (this.cameraMgr.isFollowing()) this.cameraMgr.disableFollow();
      else this.cameraMgr.enableFollow(this.ship);
    });

    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.save.setLastPlayerState({
        x: this.ship.x,
        y: this.ship.y,
        headingDeg: Phaser.Math.RadToDeg(this.ship.rotation),
        zoom: this.cameras.main.zoom
      });
      this.save.flush();
    });

    this.events.on(Phaser.Scenes.Events.UPDATE, this.updateSystem, this);
    this.events.on(Phaser.Scenes.Events.UPDATE, () => this.drawAimLine());
  }

  private drawPath(points: Phaser.Math.Vector2[]) {
    this.routeGraphics.clear();
    if (points.length === 0) return;
    this.routeGraphics.beginPath();
    this.routeGraphics.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      this.routeGraphics.lineTo(points[i].x, points[i].y);
    }
    this.routeGraphics.strokePath();
    // рисуем стрелку направления в конце
    const n = points.length;
    if (n >= 2) {
      const a = points[n - 2];
      const b = points[n - 1];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const ah = 14;
      const left = new Phaser.Math.Vector2(b.x - Math.cos(ang) * ah + Math.cos(ang + Math.PI / 2) * (ah * 0.5), b.y - Math.sin(ang) * ah + Math.sin(ang + Math.PI / 2) * (ah * 0.5));
      const right = new Phaser.Math.Vector2(b.x - Math.cos(ang) * ah + Math.cos(ang - Math.PI / 2) * (ah * 0.5), b.y - Math.sin(ang) * ah + Math.sin(ang - Math.PI / 2) * (ah * 0.5));
      this.routeGraphics.fillStyle(0x4dd2ff, 0.9);
      this.routeGraphics.fillTriangle(b.x, b.y, left.x, left.y, right.x, right.y);
    }
  }

  private updateSystem(_time: number, delta: number) {
    // Update planets along circular orbits
    const sys = this.config.system;
    const dt = delta / 1000;
    for (const pl of this.planets) {
      pl.data.angleDeg = (pl.data.angleDeg + pl.data.orbit.angularSpeedDegPerSec * dt) % 360;
      const rad = Phaser.Math.DegToRad(pl.data.angleDeg);
      const px = sys.star.x + Math.cos(rad) * pl.data.orbit.radius;
      const py = sys.star.y + Math.sin(rad) * pl.data.orbit.radius;
      pl.obj.x = px;
      pl.obj.y = py;
      // проксируем текущие координаты планет обратно в конфиг (для миникарты)
      const confPlanet = sys.planets.find(q => q.id === pl.data.id) as any;
      if (confPlanet) { confPlanet._x = px; confPlanet._y = py; }
    }
  }

  private drawAimLine() {
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

  // navmesh удалён — работаем только с кинематическим планированием

  private drawStarfield() {
    const g = this.starfield!;
    g.clear();
    const sys = this.config.system;
    const count = 600;
    g.fillStyle(0xffffff, 0.3);
    for (let i = 0; i < count; i++) {
      const x = Math.random() * sys.size.width;
      const y = Math.random() * sys.size.height;
      const r = Math.random() * 1.5 + 0.2;
      g.fillCircle(x, y, r);
    }
  }
}


