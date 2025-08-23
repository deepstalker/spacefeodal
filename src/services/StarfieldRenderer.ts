import type { ConfigManager } from '@/sys/ConfigManager';

/**
 * Отвечает за многослойный фон (звёзды/небулы) и дополнительный starfield-слой.
 */
export class StarfieldRenderer {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private starsLayer: any | null = null;
  private nebulaLayer: any | null = null;
  private starfieldGfx?: Phaser.GameObjects.Graphics;
  private readonly depthStars = -20;
  private readonly depthNebula = -18;
  private readonly depthStarfield = -15;

  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
  }

  async init() {
    const sysSize = this.config.system.size;
    const { BackgroundTiler } = await import('@/sys/BackgroundTiler');

    try { this.scene.textures.get('bg_stars1').setFilter(Phaser.Textures.FilterMode.LINEAR); } catch {}
    this.starsLayer = new BackgroundTiler(this.scene, 'bg_stars1', -30, 0.6, 1.0, Phaser.BlendModes.SCREEN);
    this.starsLayer.setDepth?.(this.depthStars);
    this.starsLayer.init(sysSize.width, sysSize.height);

    if (this.scene.textures.exists('bg_nebula_blue')) {
      try { this.scene.textures.get('bg_nebula_blue').setFilter(Phaser.Textures.FilterMode.LINEAR); } catch {}
      this.nebulaLayer = new BackgroundTiler(this.scene, 'bg_nebula_blue', -25, 0.8, 0.8, Phaser.BlendModes.SCREEN);
      this.nebulaLayer.setDepth?.(this.depthNebula);
      this.nebulaLayer.init(sysSize.width, sysSize.height);
    }

    // Дополнительный слой со «звёздной пылью»
    this.starfieldGfx = this.scene.add.graphics().setDepth(this.depthStarfield);
    this.drawStarfield();

    // Единый UPDATE-хук для слоёв (фон работает даже на паузе)
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, () => {
      this.starsLayer?.update();
      if (this.nebulaLayer) this.nebulaLayer.update();
    });
  }

  private drawStarfield() {
    const g = this.starfieldGfx!;
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
  
  /**
   * Корректно уничтожить рендерер и освободить ресурсы
   */
  public destroy(): void {
    try {
      this.scene.events.off(Phaser.Scenes.Events.UPDATE);
    } catch (e) {
      console.warn('[StarfieldRenderer] Error removing UPDATE listener:', e);
    }
    
    try {
      this.starfieldGfx?.destroy();
    } catch (e) {
      console.warn('[StarfieldRenderer] Error destroying starfieldGfx:', e);
    }
    
    try {
      this.starsLayer?.destroy();
    } catch (e) {
      console.warn('[StarfieldRenderer] Error destroying starsLayer:', e);
    }
    
    try {
      this.nebulaLayer?.destroy();
    } catch (e) {
      console.warn('[StarfieldRenderer] Error destroying nebulaLayer:', e);
    }
    
    this.starfieldGfx = undefined;
    this.starsLayer = null;
    this.nebulaLayer = null;
  }
}


