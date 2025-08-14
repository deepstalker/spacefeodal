import Phaser from 'phaser';
import { MinimapManager } from '@/sys/MinimapManager';
import type { ConfigManager } from '@/sys/ConfigManager';

export default class UIScene extends Phaser.Scene {
  private minimap!: MinimapManager;
  private debugText!: Phaser.GameObjects.Text;
  private configRef?: ConfigManager;
  private minimapHit?: Phaser.GameObjects.Zone;
  private followLabel?: Phaser.GameObjects.Text;
  constructor() {
    super('UIScene');
  }

  create() {
    const label = this.add.text(16, 16, 'SF A2', { color: '#a0b4ff' }).setScrollFactor(0).setDepth(1000);
    this.debugText = this.add.text(16, 40, '', { color: '#99ff99' }).setScrollFactor(0).setDepth(1000);

    // Миникарта: ждём готовности StarSystemScene
    const starScene = this.scene.get('StarSystemScene') as Phaser.Scene & any;
    const onReady = (payload: { config: ConfigManager; ship: Phaser.GameObjects.GameObject }) => {
      this.configRef = payload.config;
      this.minimap = new MinimapManager(this, payload.config);
      this.minimap.init(this.scale.width - 260, 20);
      this.minimap.attachShip(payload.ship);
      // интерактив: клик по миникарте переводит камеру к области клика
      const x = this.scale.width - 260;
      const y = 20;
      this.minimapHit = this.add.zone(x, y, 240, 180).setOrigin(0, 0).setScrollFactor(0).setDepth(1001);
      this.minimapHit.setInteractive({ useHandCursor: true });
      this.minimapHit.on('pointerdown', (p: Phaser.Input.Pointer) => {
        const sys = this.configRef!.system;
        const relX = (p.x - x) / 240;
        const relY = (p.y - y) / 180;
        const worldX = Phaser.Math.Clamp(relX * sys.size.width, 0, sys.size.width);
        const worldY = Phaser.Math.Clamp(relY * sys.size.height, 0, sys.size.height);
        const star = this.scene.get('StarSystemScene') as any;
        star.cameras.main.centerOn(worldX, worldY);
      });
    };
    // Если уже создана — попробуем сразу
    if ((starScene as any).config && (starScene as any).ship) {
      onReady({ config: (starScene as any).config, ship: (starScene as any).ship });
    } else {
      starScene.events.once('system-ready', onReady);
    }
    // Режим «Следования»: показываем лейбл и блокируем drag-pan
    const updateFollow = () => {
      const stars = this.scene.get('StarSystemScene') as any;
      const isFollowing = stars?.cameraMgr?.isFollowing?.() ?? false;
      if (isFollowing) {
        if (!this.followLabel) {
          this.followLabel = this.add.text(this.scale.width / 2, this.scale.height - 24, 'Режим следования', {
            color: '#ffffff', fontSize: '16px'
          }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(2000);
        }
        // блокируем drag-pan
        const inputMgr = stars?.inputMgr;
        inputMgr?.setDragEnabled?.(false);
      } else {
        this.followLabel?.destroy();
        this.followLabel = undefined;
        const inputMgr = stars?.inputMgr;
        inputMgr?.setDragEnabled?.(true);
      }
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, updateFollow);

    this.events.on(Phaser.Scenes.Events.UPDATE, () => {
      const mv = this.configRef?.gameplay?.movement;
      if (!mv) return;
      this.debugText.setText(
        `acc=${mv.acceleration} dec=${mv.deceleration} vmax=${mv.maxSpeed} turn=${mv.turnRateDegPerSec}`
      );
    });
  }
}


