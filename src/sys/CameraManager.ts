import type { ConfigManager } from './ConfigManager';
import type { SaveManager } from './SaveManager';

export class CameraManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private save: SaveManager;
  private following: Phaser.GameObjects.GameObject | null = null;

  constructor(scene: Phaser.Scene, config: ConfigManager, save: SaveManager) {
    this.scene = scene;
    this.config = config;
    this.save = save;
  }

  enableFollow(target: Phaser.GameObjects.GameObject) {
    this.following = target;
    this.scene.cameras.main.startFollow(target as any, true, 0.08, 0.08);
  }

  disableFollow() {
    this.following = null;
    this.scene.cameras.main.stopFollow();
  }

  setZoom(zoom: number) {
    const { minZoom, maxZoom } = this.config.settings.camera;
    this.scene.cameras.main.setZoom(Phaser.Math.Clamp(zoom, minZoom, maxZoom));
  }

  zoomDelta(delta: number) {
    const cam = this.scene.cameras.main;
    this.setZoom(cam.zoom + delta);
  }

  isFollowing(): boolean {
    return !!this.following;
  }
}


