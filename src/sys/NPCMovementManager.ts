import type { ConfigManager } from './ConfigManager';
import { MovementManager, type MovementCommand, type MovementMode } from './MovementManager';

export interface NPCMovementState {
  obj: any;
  movementManager: MovementManager;
  currentTarget?: { x: number; y: number };
  mode: MovementMode;
  distance?: number;
}

export class NPCMovementManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private npcStates: Map<any, NPCMovementState> = new Map();

  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
  }

  // Регистрируем NPC для управления движением
  registerNPC(npc: any, shipId: string, combatAIProfile?: string) {
    // Создаем отдельный MovementManager для каждого NPC
    const movementManager = new MovementManager(this.scene, this.config, shipId);
    
    // Получаем настройки движения из профиля ИИ
    const profile = combatAIProfile ? this.config.combatAI?.profiles?.[combatAIProfile] : null;
    const mode: MovementMode = (profile?.movementMode as MovementMode) || 'move_to';
    const distance = profile?.movementDistance || 300;

    const state: NPCMovementState = {
      obj: npc,
      movementManager,
      mode,
      distance
    };

    this.npcStates.set(npc, state);
    return state;
  }

  // Убираем NPC из управления
  unregisterNPC(npc: any) {
    this.npcStates.delete(npc);
  }

  // Устанавливаем цель для NPC с учетом его режима движения
  setNPCTarget(npc: any, target: { x: number; y: number; targetObject?: any }) {
    const state = this.npcStates.get(npc);
    if (!state) return;

    state.currentTarget = target;
    const targetVector = new Phaser.Math.Vector2(target.x, target.y);

    const command: MovementCommand = {
      mode: state.mode,
      target: targetVector,
      distance: state.distance,
      targetObject: target.targetObject // Передаем динамический объект цели
    };

    state.movementManager.setMovementCommand(command, npc);
  }

  // Получаем текущую цель NPC
  getNPCTarget(npc: any): { x: number; y: number } | null {
    const state = this.npcStates.get(npc);
    return state?.currentTarget || null;
  }

  // Получаем режим движения NPC
  getNPCMode(npc: any): MovementMode | null {
    const state = this.npcStates.get(npc);
    return state?.mode || null;
  }

  // Изменяем режим движения NPC
  setNPCMode(npc: any, mode: MovementMode, distance?: number) {
    const state = this.npcStates.get(npc);
    if (!state) return;

    state.mode = mode;
    if (distance !== undefined) {
      state.distance = distance;
    }

    // Если есть текущая цель, обновляем команду движения
    if (state.currentTarget) {
      this.setNPCTarget(npc, state.currentTarget);
    }
  }

  // Проверяем, достиг ли NPC своей цели (для режима move_to)
  hasNPCReachedTarget(npc: any): boolean {
    const state = this.npcStates.get(npc);
    if (!state || !state.currentTarget) return true;

    const command = state.movementManager.getCurrentCommand();
    return !command; // MovementManager очищает команду по достижении цели в режиме move_to
  }

  // Получаем всех зарегистрированных NPC
  getAllNPCs(): any[] {
    return Array.from(this.npcStates.keys());
  }

  // Очищаем все состояния
  clear() {
    this.npcStates.clear();
  }
}
