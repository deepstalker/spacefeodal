export type SettingsConfig = {
  resolution: { width: number; height: number };
  scaleMode: 'RESIZE';
  ui: {
    theme: string;
    fontFamily: string;
    baseFontSize: number;
    spacing: Record<string, number>;
  };
  camera: { minZoom: number; maxZoom: number; edgePanMargin: number; edgePanSpeed: number };
};

export type GameplayConfig = {
  movement: {
    MAX_SPEED: number;              // 1.0
    ACCELERATION: number;           // 0.025
    DECELERATION: number;           // 0.08
    TURN_SPEED: number;             // 0.02 (radians per frame-equivalent)
    SLOWING_RADIUS: number;         // 150
    TURN_PENALTY_MULTIPLIER: number;// 1.3
    TURN_DECELERATION_FACTOR: number;// 0.2
  };
  fov: {
    radiusUnits: number;
    cellSize: number;
    fogColor: string;
    fogAlpha: number;
  };
};

export type SystemConfig = {
  size: { width: number; height: number };
  star: { x: number; y: number };
  planets: Array<{ id: string; name: string; orbit: { radius: number; angularSpeedDegPerSec: number }; color?: string }>;
  poi: Array<{ id: string; name: string; x: number; y: number; discovered: boolean }>;
  dynamicObjects: Array<{ id: string; type: string; x: number; y: number; vx: number; vy: number }>;
};

export type AssetsConfig = {
  plugins: { rexUI: boolean; spine: boolean };
  procedural: Record<string, unknown>;
  sprites?: {
    ship?: {
      key: string;
      displaySize?: { width: number; height: number };
      origin?: { x: number; y: number };
      noseOffsetDeg?: number;
    };
  };
};

export type KeybindsConfig = { toggleFollow: string; zoomIn: string; zoomOut: string };
export type ModulesConfig = { navigation: boolean; combat: boolean; llm: boolean };
export type PersistenceConfig = { saveKey: string };

export class ConfigManager {
  private scene: Phaser.Scene;
  settings!: SettingsConfig;
  gameplay!: GameplayConfig;
  system!: SystemConfig;
  assets!: AssetsConfig;
  keybinds!: KeybindsConfig;
  modules!: ModulesConfig;
  persistence!: PersistenceConfig;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  async loadAll() {
    const base = '/configs';
    const [settings, gameplay, system, assets, keybinds, modules, persistence] = await Promise.all([
      fetch(`${base}/settings.json`).then(r => r.json()),
      fetch(`${base}/gameplay.json`).then(r => r.json()),
      fetch(`${base}/system.json`).then(r => r.json()),
      fetch(`${base}/assets.json`).then(r => r.json()),
      fetch(`${base}/keybinds.json`).then(r => r.json()),
      fetch(`${base}/modules.json`).then(r => r.json()),
      fetch(`${base}/persistence.json`).then(r => r.json())
    ]);
    this.settings = settings;
    this.gameplay = gameplay;
    this.system = system;
    this.assets = assets;
    this.keybinds = keybinds;
    this.modules = modules;
    this.persistence = persistence;
  }
}


