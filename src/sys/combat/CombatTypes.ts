// Re-export from existing combat services for compatibility
export { Target } from './weapons/services/TargetService';

// === Core Combat Types ===

/** Типы отношений между фракциями */
export type RelationType = 'ally' | 'neutral' | 'confrontation' | 'cautious';

/** Типы боевых намерений для NPC */
export interface CombatIntent {
  type: 'attack' | 'flee' | 'retreat';
  target: any;
}

/** Лог урона для отслеживания истории боя */
export interface DamageLog {
  firstAttacker?: any;
  totalDamageBySource?: Map<any, number>;
  lastDamageTimeBySource?: Map<any, number>;
}

/** Конфигурация ИИ для NPC */
export interface AIConfig {
  preferRange: number;
  retreatHpPct: number;
  type: 'ship' | 'static';
  speed: number;
  disposition?: 'neutral' | 'enemy' | 'ally';
  behavior?: string;
}

/** Переопределения отношений фракций */
export interface FactionOverrides {
  factions?: Record<string, RelationType>;
}

/** Полная запись цели, используемая CombatManager */
export interface TargetEntry {
  obj: Phaser.GameObjects.GameObject & { x: number; y: number; active: boolean; rotation?: number };
  hp: number;
  hpMax: number;
  hpBarBg: Phaser.GameObjects.Rectangle;
  hpBarFill: Phaser.GameObjects.Rectangle;
  nameLabel?: Phaser.GameObjects.Text;
  ai?: AIConfig;
  weaponSlots?: string[];
  shipId?: string;
  faction?: string;
  combatAI?: string;
  aiProfileKey?: string;
  intent?: CombatIntent | null;
  overrides?: FactionOverrides;
  damageLog?: DamageLog;
}

/** Облегченная запись цели для публичных API */
export interface PublicTargetEntry {
  obj: any;
  faction?: string;
  overrides?: FactionOverrides;
  intent?: CombatIntent;
  combatAI?: string;
  weaponSlots?: string[];
  shipId?: string;
}

// === Visual Component Types ===

/** Конфигурация визуальных боевых колец */
export interface CombatRingConfig {
  color: number;
  alpha: number;
  strokeWidth: number;
  strokeColor: number;
  strokeAlpha: number;
}

/** Конфигурация кругов дальности оружия */
export interface WeaponRangeConfig {
  color: string;
  fillAlpha: number;
  strokeColor: string;
  strokeAlpha: number;
  strokeWidth: number;
}

// === Event Types ===

/** События, связанные с боем */
export interface CombatEvents {
  'weapon-slot-selected': { slotKey: string; show: boolean };
  'player-weapon-fired': { slotKey: string; target: any };
  'player-weapon-target-cleared': { target: any; slots: string[] };
  'weapon-out-of-range': { slotKey: string; inRange: boolean };
  'beam-start': { slotKey: string; durationMs: number };
  'beam-refresh': { slotKey: string; refreshMs: number };
  'game-paused': {};
  'game-resumed': { pausedTimeMs: number };
}

// === Interface Definitions ===

/** Интерфейс для операций управления целями */
export interface ITargetManager {
  addTarget(entry: TargetEntry): void;
  removeTarget(obj: any): void;
  getTarget(obj: any): TargetEntry | null;
  getAllTargets(): TargetEntry[];
  getTargetsInRange(center: { x: number; y: number }, range: number): TargetEntry[];
  assignTarget(obj: any, weapon: string): void;
  clearAssignments(obj: any): void;
}

/** Интерфейс для операций боевого UI */
export interface ICombatUIManager {
  updateHpBar(target: TargetEntry): void;
  showCombatRing(target: any, config?: Partial<CombatRingConfig>): void;
  hideCombatRing(target: any): void;
  showWeaponRange(slotKey: string, range: number): void;
  hideWeaponRange(slotKey: string): void;
  refreshCombatIndicators(): void;
  setIndicatorManager(indicators: any): void;
}

/** Интерфейс для координации боя */
export interface ICombatService {
  registerTarget(obj: any, config: Partial<TargetEntry>): void;
  unregisterTarget(obj: any): void;
  updateCombat(deltaMs: number): void;
  handleCombatEvent(event: keyof CombatEvents, data: any): void;
  attachShip(ship: any): void;
  setFogOfWar(fog: any): void;
  setPauseManager(pauseManager: any): void;
}

// === Utility Types ===

/** Точка в 2D пространстве */
export interface Point {
  x: number;
  y: number;
}

/** Зависимости конфигурации callback */
export interface CombatDependencies {
  scene: Phaser.Scene;
  config: any; // ConfigManager
  pauseManager?: any;
  fogOfWar?: any;
  indicatorManager?: any;
}

// === NPC State Management Types ===

/** Типы намерений NPC для совместимости */
export interface NPCIntent {
  type: 'attack' | 'flee' | 'retreat';
  target: any;
}

/** Состояние агрессии NPC */
export interface AggressionState {
  level: number;              // 0-1, текущий уровень агрессии
  lastDamageTime: number;     // время последнего урона
  lastCombatTime: number;     // время последнего боя
  cooldownRate: number;       // скорость остывания агрессии/сек
  sources: Map<any, {         // источники агрессии
    damage: number;
    lastTime: number;
  }>;
}

/** Стабилизация выбора целей */
export interface TargetStabilization {
  currentTarget: any | null;
  targetScore: number;
  targetSwitchTime: number;   // время последней смены цели
  requiredAdvantage: number;  // требуемое преимущество для смены
  stabilityPeriod: number;    // период стабильности после смены
}

/** Команда движения с приоритетом */
export interface MovementCommand {
  mode: string;
  target: { x: number; y: number; targetObject?: any };
  distance?: number;
  priority: number;           // приоритет команды
  source: string;            // откуда пришла команда
  timestamp: number;
}

/** Контекст состояния NPC */
export interface NPCStateContext {
  obj: any;                  // игровой объект
  state: number;             // текущее состояние (NPCState)
  previousState: number;     // предыдущее состояние
  stateEnterTime: number;
  
  // Агрессия и боевое поведение
  aggression: AggressionState;
  targetStabilization: TargetStabilization;
  
  // Движение
  movementQueue: MovementCommand[];
  currentMovement: MovementCommand | null;
  
  // Конфигурация
  aiProfile?: string;
  combatAI?: string;
  faction?: string;
  
  // Сохраняем существующие поля для совместимости
  legacy: {
    __behavior?: string;
    __state?: string;
    intent?: any;
    __targetPatrol?: any;
    __targetPlanet?: any;
    __homeRef?: any;
    forceIntentUntil?: number;
  };
}

/** Результат анализа целей */
export interface TargetAnalysis {
  target: any;
  score: number;
  distance: number;
  threat: number;
  priority: number;
}

/** Решение ИИ боя */
export interface CombatDecision {
  action: 'attack' | 'flee' | 'retreat' | 'patrol';
  target?: any;
  priority: number;
  reasoning: string;
}

/** Оценка угрозы */
export interface ThreatAssessment {
  source: any;
  threat: number;
  distance: number;
  damage: number;
  lastDamageTime: number;
}

// === Configuration Types ===

/** Конфигурация UI зависимостей */
export interface UIDependencies {
  getTargets: () => TargetEntry[];
  getSelectedTarget: () => any;
  getPlayerShip: () => any;
  getEffectiveRadius: (obj: any) => number;
  getRelation: (ofFaction: string | undefined, otherFaction: string | undefined, overrides?: any) => string;
  getRelationColor: (relation: string) => string;
  resolveDisplayName: (target: any) => string | null;
  isTargetCombatAssigned: (target: any) => boolean;
  getWeaponManager: () => any;
  getNpcStateManager: () => any;
}