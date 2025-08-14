import type { ConfigManager } from './ConfigManager';

export class FogOfWar {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private overlay!: Phaser.GameObjects.Graphics;
  private poiRefs: Array<{ x: number; y: number }>=[];
  private staticRefs: Array<{ x: number; y: number }>=[];

  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
  }

  init() {
    this.overlay = this.scene.add.graphics().setDepth(999).setScrollFactor(1);
    this.overlay.setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.render, this);
  }

  setStatics(starPos: { x: number; y: number }, planetPositions: Array<{ x: number; y: number }>, poiPositions: Array<{ x: number; y: number }>) {
    this.staticRefs = [starPos, ...planetPositions];
    this.poiRefs = poiPositions;
  }

  private render() {
    const shipId = this.config.player?.shipId ?? this.config.ships.current;
    const visRadius = this.config.ships.defs[shipId]?.combat?.sensorRadius ?? 1200;
    const player = (this.scene as any).ship as Phaser.GameObjects.Image | undefined;
    if (!player) return;
    const px = player.x, py = player.y;

    const g = this.overlay;
    g.clear();
    const cam = this.scene.cameras.main;
    const vw = cam.worldView;
    // Dim background slightly
    g.fillStyle(0x000000, 0.25);
    g.fillRect(vw.x, vw.y, vw.width, vw.height);

    // Soft erase helper
    const eraseSoft = (x: number, y: number, r: number) => {
      g.save();
      g.beginPath();
      g.fillStyle(0xffffff, 1);
      g.fillCircle(x, y, r);
      g.restore();
      // Use erase by setting blend mode
      g.setBlendMode(Phaser.BlendModes.ERASE);
      g.fillCircle(x, y, r);
      g.setBlendMode(Phaser.BlendModes.MULTIPLY);
    };

    // Always visible: star/planets/POI
    for (const s of this.staticRefs) eraseSoft(s.x, s.y, 200);
    for (const p of this.poiRefs) eraseSoft(p.x, p.y, 120);

    // Player visibility
    eraseSoft(px, py, visRadius);
  }
}


