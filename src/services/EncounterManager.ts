import type { ConfigManager } from '@/sys/ConfigManager';

/**
 * Управляет POI/энкаунтерами: активация, баннеры, одноразовое удаление меток.
 */
export class EncounterManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private encounters: Array<{ id: string; name: string; x: number; y: number; typeId?: string; activationRange?: number; marker: Phaser.GameObjects.GameObject; label: Phaser.GameObjects.Text }> = [];
  private playerShip?: Phaser.GameObjects.GameObject & { x: number; y: number };

  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
  }

  setPlayerShip(obj: Phaser.GameObjects.GameObject & { x: number; y: number }) {
    this.playerShip = obj;
  }

  attach(encounters: Array<{ id: string; name: string; x: number; y: number; typeId?: string; activationRange?: number; marker: Phaser.GameObjects.GameObject; label: Phaser.GameObjects.Text }>) {
    this.encounters = encounters;
  }

  update() {
    const ship = this.playerShip;
    if (!ship) return;
    for (const e of this.encounters) {
      const d = Math.hypot(e.x - ship.x, e.y - ship.y);
      if (d <= (e.activationRange ?? 400)) {
        this.showBanner(e.name);
        e.marker.destroy();
        e.label.destroy();
        // Визуальные эффекты по типу
        if (e.typeId === 'lost_treasure') {
          this.scene.add.rectangle(e.x, e.y, 48, 48, 0xffe066).setDepth(0.4);
        }
        this.encounters = this.encounters.filter(m => m !== e);
        break;
      }
    }
  }

  private showBanner(name: string) {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const banner = this.scene.add.text(w/2, h/2, `Вы нашли: ${name}`, { color: '#ffffff', fontSize: '28px', fontStyle: 'bold' }).setOrigin(0.5).setScrollFactor(0).setDepth(5000);
    this.scene.tweens.add({ targets: banner, alpha: 0, duration: 2200, ease: 'Sine.easeIn', onComplete: () => banner.destroy() });
  }
}


