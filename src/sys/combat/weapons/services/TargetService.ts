export type Target = Phaser.GameObjects.GameObject & { x: number; y: number; active: boolean };
import { EventBus, EVENTS } from './EventBus';

/**
 * Сервис управления целями игрока для слотов оружия.
 * Отвечает за хранение, очистку и эмит событий, без вмешательства в кулдауны.
 */
export class TargetService {
  private scene: Phaser.Scene;
  private combatManager: any;
  private targets: Map<string, Target> = new Map();

  constructor(scene: Phaser.Scene, combatManager: any) {
    this.scene = scene;
    this.combatManager = combatManager;
  }

  /** Текущие назначения целей по слотам */
  public getTargets(): ReadonlyMap<string, Target> {
    return this.targets;
  }

  /** Установить/сбросить цель слота. Без кулдаун-логики. */
  public setTarget(slotKey: string, target: Target | null) {
    if (target) {
      try { (this.combatManager as any).markTargetHostileToPlayer?.(target as any); } catch {}
      this.targets.set(slotKey, target);
    } else {
      if (this.targets.has(slotKey)) {
        this.targets.delete(slotKey);
      }
      try { this.scene.events.emit('weapon-out-of-range', slotKey, false); } catch {}
      try { new EventBus(this.scene).emit(EVENTS.WeaponOutOfRange, { slotKey, inRange: false }); } catch {}
    }
  }

  /** Очистить цель конкретного слота игрока с эмитами событий */
  public clearSlot(slotKey: string, target?: Target) {
    if (this.targets.has(slotKey)) {
      this.targets.delete(slotKey);
    }
    try { this.scene.events.emit('weapon-out-of-range', slotKey, false); } catch {}
    try { new EventBus(this.scene).emit(EVENTS.WeaponOutOfRange, { slotKey, inRange: false }); } catch {}
    if (target) {
      try { this.scene.events.emit('player-weapon-target-cleared', target, [slotKey]); } catch {}
      try { new EventBus(this.scene).emit(EVENTS.PlayerWeaponTargetCleared, { target, slots: [slotKey] }); } catch {}
    }
  }

  /** Очистить все цели игрока и заэмитить события для UI */
  public clearAll() {
    if (this.targets.size > 0) {
      const clearedSlots = Array.from(this.targets.keys());
      this.targets.clear();
      if (clearedSlots.length > 0) {
        for (const slotKey of clearedSlots) {
          try { this.scene.events.emit('weapon-out-of-range', slotKey, false); } catch {}
          try { new EventBus(this.scene).emit(EVENTS.WeaponOutOfRange, { slotKey, inRange: false }); } catch {}
        }
      }
    }
  }

  /** Удалить назначения конкретного target и сообщить об этом */
  public clearAssignmentsForTarget(target: any) {
    const clearedSlots: string[] = [];
    for (const [slot, tgt] of this.targets.entries()) {
      if (tgt === target) {
        this.targets.delete(slot);
        clearedSlots.push(slot);
      }
    }
    if (clearedSlots.length > 0) {
      try { this.scene.events.emit('player-weapon-target-cleared', target, clearedSlots); } catch {}
      try { new EventBus(this.scene).emit(EVENTS.PlayerWeaponTargetCleared, { target, slots: clearedSlots }); } catch {}
    }
  }
}
