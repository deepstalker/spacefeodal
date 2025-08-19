export type SettingsConfig = {
  resolution: { width: number; height: number };
  scaleMode: 'RESIZE';
  ui: {
    theme: string;
    fontFamily: string;
    baseFontSize: number;
    spacing: Record<string, number>;
    weaponSlots?: {
      size: number;
      iconPadding: number;
      highQualityRendering: boolean;
    };
    combat?: {
      rightClickCancelSelectedWeapons?: boolean;
      weaponRanges?: {
        color?: string;        // e.g. '#4ade80'
        fillAlpha?: number;    // 0..1
        strokeColor?: string;  // e.g. '#4ade80'
        strokeAlpha?: number;  // 0..1
        strokeWidth?: number;  // px
      };
    };
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
    TARGET_UPDATE_INTERVAL_MS?: number; // 100 (частота обновления динамических целей)
    ACCELERATION_PENALTY_AT_MAX?: number; // 0..1 (например 0.9) — доля снижения ускорения при 100% скорости
  };
  simulation?: {
    enabled?: boolean;
    initialSpawnRadiusPct?: number; // 0.25 по умолчанию
    lazySpawnRadarBufferPct?: number; // 0.05 по умолчанию (5% размера системы)
    replenish?: {
      checkIntervalMs?: number; // 240000 (4 минуты)
      spawnDelayMsRange?: { min: number; max: number }; // { min: 5000, max: 45000 }
    };
  };
  fogOfWar?: {
    enabled: boolean;
    dimming: {
      enabled: boolean;
      alpha: number;
      color: string;
    };
    fadeZone: {
      innerRadius: number;
      outerRadius: number;
    };
    staticObjects: {
      alwaysVisible: boolean;
      types: string[];
    };
    dynamicObjects: {
      hideOutsideRadar: boolean;
      types: string[];
    };
    performance: {
      updateInterval: number;
      maxObjectsPerFrame: number;
    };
  };
  dock_range?: number;
};

export type SystemConfig = {
  name?: string;
  sector?: string;
  size: { width: number; height: number };
  star: { x: number; y: number };
  planets: Array<{ id: string; name: string; orbit: { radius: number; angularSpeedDegPerSec: number }; color?: string; dockRange?: number; spawn?: { quotas?: Record<string, number> } }>;
  poi: Array<{ id: string; name: string; x: number; y: number; discovered: boolean }>;
  dynamicObjects: Array<{ id: string; type: string; x: number; y: number; vx: number; vy: number }>;
  stations?: Array<{ id?: string; type: 'pirate_base' | string; x: number; y: number; wave?: { initialDelayMs?: number; intervalMs?: number; count?: number; lifespanMs?: number }; spawn?: { quotas?: Record<string, number> } }>;
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

export type KeybindsConfig = {
  toggleFollow: string;
  zoomIn: string;
  zoomOut: string;
  // Дополнительно (необязательно):
  pause?: string;
  systemMenu?: string;
};
export type ModulesConfig = { navigation: boolean; combat: boolean; llm: boolean };
export type PersistenceConfig = { saveKey: string };
export type ItemsConfig = { rarities: Record<string, { name: string; color: string }> };

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
    sensors?: { radar_range?: number };
    movement: GameplayConfig['movement'];
  }>;
};

export type WeaponsConfig = {
  defs: Record<string, {
    icon?: string;
    rarity?: string;
    type?: 'single' | 'burst' | 'beam';
    accuracy?: number; // базовая точность оружия (0..1), модифицируется точностью корабля
    projectile?: any;
    hitEffect?: any;
    projectileSpeed?: number;
    fireRatePerSec?: number; // для single/burst — серия считается одной атакой
    damage: number;
    range: number;
    muzzleOffset: { x: number; y: number };
    // burst-специфика
    burst?: { count?: number; delayMs?: number };
    // beam-специфика
    beam?: {
      tickMs?: number;
      damagePerTick?: number;
      durationMs?: number;
      refreshMs?: number;
      color?: string;
      innerWidth?: number;
      outerWidth?: number;
      innerAlpha?: number;
      outerAlpha?: number;
    };
  }>;
};

// Enemies config removed — all NPC are defined in stardwellers

export type StardwellersConfig = {
  prefabs: Record<string, { shipId: string; aiProfile: string; combatAI?: string; faction?: string; weapons: string[] }>;
};

export type AIProfilesConfig = {
  profiles: Record<string, { behavior: string; sensors?: { react?: { onFaction?: Record<'ally'|'neutral'|'confrontation', 'ignore'|'attack'|'flee'|'seekEscort'> } }; combat?: { retreatHpPct?: number } }>;
};

export type FactionsConfig = {
  factions: Record<string, { relations: Record<string, 'ally'|'neutral'|'confrontation'> }>;
};

export type CombatAIProfilesConfig = {
  profiles: Record<string, { 
    retreatHpPct?: number;
    movementMode?: 'orbit' | 'pursue' | 'move_to';
    movementDistance?: number;
    outdistance_attack?: 'target' | 'flee' | 'ignore';
    targetPriority?: Array<'top_dps' | 'first_attacker' | 'nearest'>;
  }>;
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
  items!: ItemsConfig;
  keybinds!: KeybindsConfig;
  modules!: ModulesConfig;
  persistence!: PersistenceConfig;
  ships!: ShipConfig;
  weapons!: WeaponsConfig;
  aiProfiles!: AIProfilesConfig;
  player!: PlayerConfig;
  stardwellers!: StardwellersConfig;
  systemsIndex!: SystemsIndexConfig;
  systemProfiles!: SystemProfilesConfig;
  factions!: FactionsConfig;
  combatAI!: CombatAIProfilesConfig;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  async loadAll() {
    const tryFetch = async (paths: string[]) => {
      for (const p of paths) {
        try {
          const r = await fetch(p);
          if (r.ok) return await r.json();
        } catch {}
      }
      // last resort: return empty object to avoid hard crash
      return {} as any;
    };
    const [settings, gameplay, system, assets, items, keybinds, modules, persistence, ships, weapons, player, aiProfiles, systemsIndex, systemProfiles, stardwellers, factions, combatAI] = await Promise.all([
      tryFetch(['/configs/general/settings.json', '/configs/settings.json']),
      tryFetch(['/configs/general/gameplay.json', '/configs/gameplay.json']),
      tryFetch(['/configs/systems/system.json', '/configs/system.json']),
      tryFetch(['/configs/general/assets.json', '/configs/assets.json']),
      tryFetch(['/configs/general/items.json', '/configs/items.json']),
      tryFetch(['/configs/general/keybinds.json', '/configs/keybinds.json']),
      tryFetch(['/configs/general/modules.json', '/configs/modules.json']),
      tryFetch(['/configs/general/persistence.json', '/configs/persistence.json']),
      tryFetch(['/configs/ships/ships.json', '/configs/ships.json']),
      tryFetch(['/configs/ships/weapons.json', '/configs/weapons.json']),
      tryFetch(['/configs/general/player.json', '/configs/player.json']),
      tryFetch(['/configs/npc/ai_profiles.json', '/configs/ai_profiles.json']),
      tryFetch(['/configs/systems/systems.json', '/configs/systems.json']),
      tryFetch(['/configs/systems/system_profiles.json', '/configs/system_profiles.json']),
      tryFetch(['/configs/npc/stardwellers.json', '/configs/stardwellers.json']),
      tryFetch(['/configs/npc/factions.json', '/configs/factions.json']),
      tryFetch(['/configs/npc/combat_ai_profiles.json', '/configs/combat_ai_profiles.json'])
    ]);
    this.settings = settings;
    this.gameplay = gameplay;
    this.system = system;
    this.assets = assets;
    this.items = items;
    this.keybinds = keybinds;
    this.modules = modules;
    this.persistence = persistence;
    this.ships = ships;
    this.weapons = weapons;
    this.player = player;
    this.aiProfiles = aiProfiles;
    this.stardwellers = stardwellers;
    this.systemsIndex = systemsIndex;
    this.systemProfiles = systemProfiles;
    this.factions = factions;
    this.combatAI = combatAI;
  }
}


