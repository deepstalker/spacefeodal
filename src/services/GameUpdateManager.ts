import type { ConfigManager } from '@/sys/ConfigManager';
import type { PauseManager } from '@/sys/PauseManager';

/**
 * Единая точка обновлений, чтобы снять с Scene множественные подписки UPDATE.
 */
export class GameUpdateManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private pause: PauseManager;

  private updateFns: Array<() => void> = [];
  private pausedAwareFns: Array<{ key: string; fn: (dt: number) => void }> = [];

  constructor(scene: Phaser.Scene, config: ConfigManager, pause: PauseManager) {
    this.scene = scene;
    this.config = config;
    this.pause = pause;
  }

  register(fn: () => void) {
    this.updateFns.push(fn);
  }

  registerPausedAware(key: string, fn: (dt: number) => void) {
    this.pausedAwareFns.push({ key, fn });
  }

  init() {
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, (_time: number, delta: number) => {
      for (const fn of this.updateFns) fn();
      // Пауза учитывается по ключам систем
      for (const { key, fn } of this.pausedAwareFns) {
        if (!this.pause.isSystemPausable(key) || !this.pause.getPaused()) fn(delta);
      }
    });
  }
  
  /**
   * Корректно уничтожить менеджер и отписаться от событий
   */
  public destroy(): void {
    try {
      this.scene.events.off(Phaser.Scenes.Events.UPDATE);
    } catch (e) {
      console.warn('[GameUpdateManager] Error removing UPDATE listener:', e);
    }
    
    this.updateFns = [];
    this.pausedAwareFns = [];
  }
}