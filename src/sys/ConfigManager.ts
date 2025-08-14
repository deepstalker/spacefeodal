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

export type SystemsIndexConfig = {
  current: string;
  defs: Record<string, { name: string; type: 'static' | 'procedural'; configPath?: string; profile?: string; seed?: number }>;
};

export type SystemProfilesConfig = {
  profiles: Record<string, {
    starRadius: { min: number; max: number };
    orbits: { min: number; max: number };
    orbitGap: { min: number; max: number };
    planetSize: { min: number; max: number };
    satellitesPerPlanet: { min: number; max: number };
    planetTypes: Array<{ name: string; color: string }>;
    encounters: {
      count: { min: number; max: number };
      radius: { min: number; max: number };
      minSpacing: number;
      types: Array<{ id: string; name: string; activation_range?: number; groupSize?: { min: number; max: number } }>;
    };
    systemSize: { width: number; height: number };
  }>;
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

export type ShipConfig = {
  current: string;
  defs: Record<string, {
    displayName: string;
    hull: number;
    sprite: {
      key: string;
      displaySize?: { width: number; height: number };
      origin?: { x: number; y: number };
      noseOffsetDeg?: number;
    };
    combat?: { weaponSlots: number; accuracy?: number; sensorRadius?: number; slots?: Array<{ offset: { x: number; y: number } }> };
    movement: GameplayConfig['movement'];
  }>;
};

export type WeaponsConfig = {
  defs: Record<string, {
    projectile: any;
    hitEffect: any;
    projectileSpeed: number;
    fireRatePerSec: number;
    damage: number;
    range: number;
    muzzleOffset: { x: number; y: number };
  }>;
};

export type EnemiesConfig = {
  defs: Record<string, {
    displayName: string;
    shipId: string;
    weapons: string[];
    aiProfile: string;
  }>;
};

export type AIProfilesConfig = {
  profiles: Record<string, { preferRange: number; retreatHpPct: number; speed?: number; disposition?: 'neutral' | 'enemy' | 'ally'; behavior?: string }>;
};

export type PlayerConfig = {
  shipId: string;
  weapons: string[];
  start: { x: number | null; y: number | null; headingDeg: number; zoom: number };
};

export class ConfigManager {
  private scene: Phaser.Scene;
  settings!: SettingsConfig;
  gameplay!: GameplayConfig;
  system!: SystemConfig;
  assets!: AssetsConfig;
  keybinds!: KeybindsConfig;
  modules!: ModulesConfig;
  persistence!: PersistenceConfig;
  ships!: ShipConfig;
  weapons!: WeaponsConfig;
  enemies!: EnemiesConfig;
  aiProfiles!: AIProfilesConfig;
  player!: PlayerConfig;
  systemsIndex!: SystemsIndexConfig;
  systemProfiles!: SystemProfilesConfig;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  async loadAll() {
    const base = '/configs';
    const [settings, gameplay, system, assets, keybinds, modules, persistence, ships, weapons, enemies, player, aiProfiles, systemsIndex, systemProfiles] = await Promise.all([
      fetch(`${base}/settings.json`).then(r => r.json()),
      fetch(`${base}/gameplay.json`).then(r => r.json()),
      fetch(`${base}/system.json`).then(r => r.json()),
      fetch(`${base}/assets.json`).then(r => r.json()),
      fetch(`${base}/keybinds.json`).then(r => r.json()),
      fetch(`${base}/modules.json`).then(r => r.json()),
      fetch(`${base}/persistence.json`).then(r => r.json()),
      fetch(`${base}/ships.json`).then(r => r.json()),
      fetch(`${base}/weapons.json`).then(r => r.json()),
      fetch(`${base}/enemies.json`).then(r => r.json()),
      fetch(`${base}/player.json`).then(r => r.json()),
      fetch(`${base}/ai_profiles.json`).then(r => r.json()),
      fetch(`${base}/systems.json`).then(r => r.json()),
      fetch(`${base}/system_profiles.json`).then(r => r.json())
    ]);
    this.settings = settings;
    this.gameplay = gameplay;
    this.system = system;
    this.assets = assets;
    this.keybinds = keybinds;
    this.modules = modules;
    this.persistence = persistence;
    this.ships = ships;
    this.weapons = weapons;
    this.enemies = enemies;
    this.player = player;
    this.aiProfiles = aiProfiles;
    this.systemsIndex = systemsIndex;
    this.systemProfiles = systemProfiles;
  }
}


