export class BackgroundTiler {
  private scene: Phaser.Scene;
  private textureKey: string;
  private depth: number;
  private parallax = 1;
  private alpha = 1;
  private blendMode: Phaser.BlendModes = Phaser.BlendModes.NORMAL;
  private worldW = 0;
  private worldH = 0;
  private tileW = 1024;
  private tileH = 1024;
  private pool: Phaser.GameObjects.Image[] = [];
  private activeKeys = new Set<string>();
  private rotationByKey = new Map<string, number>();

  constructor(scene: Phaser.Scene, textureKey: string, depth = -20, parallax = 1, alpha = 1, blendMode: Phaser.BlendModes = Phaser.BlendModes.NORMAL) {
    this.scene = scene;
    this.textureKey = textureKey;
    this.depth = depth;
    this.parallax = parallax;
    this.alpha = alpha;
    this.blendMode = blendMode;
  }

  init(worldW: number, worldH: number) {
    this.worldW = worldW;
    this.worldH = worldH;
    const tex = this.scene.textures.get(this.textureKey);
    const img = tex.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    if (img && img.width && img.height) {
      this.tileW = img.width;
      this.tileH = img.height;
    }
  }

  update() {
    const cam = this.scene.cameras.main;
    const vw = cam.worldView;
    const px = vw.x * this.parallax;
    const py = vw.y * this.parallax;
    const margin = 1;
    const minTX = Math.max(0, Math.floor(px / this.tileW) - margin);
    const maxTX = Math.min(Math.floor((this.worldW - 1) / this.tileW), Math.floor(((px + vw.width) - 1) / this.tileW) + margin);
    const minTY = Math.max(0, Math.floor(py / this.tileH) - margin);
    const maxTY = Math.min(Math.floor((this.worldH - 1) / this.tileH), Math.floor(((py + vw.height) - 1) / this.tileH) + margin);

    const needed = new Set<string>();
    for (let ty = minTY; ty <= maxTY; ty++) {
      for (let tx = minTX; tx <= maxTX; tx++) {
        needed.add(`${tx}:${ty}`);
      }
    }

    // Hide tiles no longer needed
    for (let i = 0; i < this.pool.length; i++) {
      const spr = this.pool[i];
      const key = (spr as any).__tileKey as string | undefined;
      if (key && !needed.has(key)) {
        spr.setVisible(false);
        (spr as any).__tileKey = undefined;
      }
    }

    // Place/make tiles
    needed.forEach((key) => {
      // find if exists
      let spr = this.pool.find(s => (s as any).__tileKey === key);
      if (!spr) {
        // find an unused
        spr = this.pool.find(s => !(s as any).__tileKey);
        if (!spr) {
          spr = this.scene.add.image(0, 0, this.textureKey).setOrigin(0, 0).setDepth(this.depth);
          spr.setScrollFactor(1);
          spr.setAlpha(this.alpha);
          spr.setBlendMode(this.blendMode);
          this.pool.push(spr);
        }
        (spr as any).__tileKey = key;
      }
      const [sx, sy] = key.split(':').map(n => parseInt(n, 10));
      spr.setPosition(sx * this.tileW - (px % this.tileW), sy * this.tileH - (py % this.tileH));
      // Disable rotation to avoid checkerboard artifacts with non-rotatable seamless tiles
      spr.setAngle(0);
      spr.setVisible(true);
    });
  }

  private getAngleForKey(key: string): number {
    let ang = this.rotationByKey.get(key);
    if (ang == null) {
      // simple hash → 0..3
      let h = 0;
      for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
      // Use only 0 or 180 deg to keep seamless edges on standard tiles
      const idx = Math.abs(h) % 2; // 0..1
      ang = idx * 180;
      this.rotationByKey.set(key, ang);
    }
    return ang;
  }
}


