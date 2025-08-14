import type { ConfigManager } from './ConfigManager';

export type PlayerState = { x: number; y: number; headingDeg: number; zoom: number };

export class SaveManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private buffer: { player?: PlayerState } = {};

  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
  }

  private get key(): string { return this.config.persistence.saveKey; }

  getLastPlayerState(): PlayerState | undefined {
    try {
      const json = localStorage.getItem(this.key);
      if (!json) return undefined;
      const parsed = JSON.parse(json);
      return parsed.player as PlayerState;
    } catch {
      return undefined;
    }
  }

  setLastPlayerState(state: PlayerState) {
    this.buffer.player = state;
  }

  flush() {
    try {
      const json = JSON.stringify(this.buffer);
      localStorage.setItem(this.key, json);
    } catch {
      // noop
    }
  }
}


