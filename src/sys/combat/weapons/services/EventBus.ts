export const EVENTS = {
  WeaponOutOfRange: 'combat.weapon.out_of_range',
  PlayerWeaponFired: 'combat.player.weapon_fired',
  PlayerWeaponTargetCleared: 'combat.player.weapon_target_cleared',
  BeamStart: 'combat.beam.start',
  BeamRefresh: 'combat.beam.refresh',
} as const;

export type WeaponOutOfRangePayload = { slotKey: string; inRange: boolean };
export type PlayerWeaponFiredPayload = { slotKey: string; target: any };
export type PlayerWeaponTargetClearedPayload = { target: any | null; slots: string[] };
export type BeamStartPayload = { slotKey: string; durationMs: number };
export type BeamRefreshPayload = { slotKey: string; refreshMs: number };

export type CombatEventPayloadMap = {
  [EVENTS.WeaponOutOfRange]: WeaponOutOfRangePayload;
  [EVENTS.PlayerWeaponFired]: PlayerWeaponFiredPayload;
  [EVENTS.PlayerWeaponTargetCleared]: PlayerWeaponTargetClearedPayload;
  [EVENTS.BeamStart]: BeamStartPayload;
  [EVENTS.BeamRefresh]: BeamRefreshPayload;
};

export class EventBus {
  private scene: Phaser.Scene;
  constructor(scene: Phaser.Scene) { this.scene = scene; }

  emit<K extends keyof CombatEventPayloadMap>(name: K, payload: CombatEventPayloadMap[K]) {
    try { this.scene.events.emit(name, payload); } catch {}
  }

  on<K extends keyof CombatEventPayloadMap>(name: K, handler: (payload: CombatEventPayloadMap[K]) => void) {
    try { this.scene.events.on(name, handler as any); } catch {}
  }

  off<K extends keyof CombatEventPayloadMap>(name: K, handler: (payload: CombatEventPayloadMap[K]) => void) {
    try { this.scene.events.off(name, handler as any); } catch {}
  }
}
