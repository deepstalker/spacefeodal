import type { ConfigManager } from './ConfigManager';

export class MinimapManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private g!: Phaser.GameObjects.Graphics;
  private width = 240;
  private height = 180;
  private worldW = 1;
  private worldH = 1;
  private shipRef: Phaser.GameObjects.GameObject | null = null;

  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
  }

  init(containerX: number, containerY: number) {
    this.worldW = this.config.system.size.width;
    this.worldH = this.config.system.size.height;
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

  private render() {
    if (!this.g) return;
    const x = (this.g as any)._mx ?? 0;
    const y = (this.g as any)._my ?? 0;
    const sys = this.config.system;
    const scaleX = this.width / this.worldW;
    const scaleY = this.height / this.worldH;
    this.g.clear();
    // background panel
    this.g.fillStyle(0x000000, 0.6);
    this.g.fillRect(x - 4, y - 4, this.width + 8, this.height + 8);
    this.g.lineStyle(1, 0x99aaff);
    this.g.strokeRect(x, y, this.width, this.height);

    // Star
    this.g.fillStyle(0xffcc00, 1);
    this.g.fillCircle(x + sys.star.x * scaleX, y + sys.star.y * scaleY, 2);

    // Planets
    for (const p of sys.planets) {
      // Берём текущие мировые координаты планет, если StarSystemScene их обновляет и проксирует в config
      const px = (p as any)._x ?? (sys.star.x + p.orbit.radius);
      const py = (p as any)._y ?? sys.star.y;
      this.g.fillStyle(0x88f, 1);
      this.g.fillRect(x + px * scaleX - 1, y + py * scaleY - 1, 2, 2);
    }

    // Ship
    if (this.shipRef) {
      const s: any = this.shipRef;
      this.g.fillStyle(0x7fd1f3, 1);
      this.g.fillRect(x + s.x * scaleX - 1, y + s.y * scaleY - 1, 2, 2);
    }

    // Camera viewport rectangle (use world camera from StarSystemScene, not UI camera)
    const starScene: any = this.scene.scene.get('StarSystemScene');
    const worldCam = starScene?.cameras?.main;
    const vw = worldCam?.worldView;
    if (vw) {
      const rx = x + vw.x * scaleX;
      const ry = y + vw.y * scaleY;
      const rw = vw.width * scaleX;
      const rh = vw.height * scaleY;
      this.g.lineStyle(2, 0x66ff66, 1);
      this.g.strokeRect(rx, ry, rw, rh);
    }
  }
}


