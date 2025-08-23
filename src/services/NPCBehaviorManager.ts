import type { ConfigManager } from '@/sys/ConfigManager';

/**
 * Поведение NPC (патруль/торговля) с делегированием в CombatManager для движения.
 */
export class NPCBehaviorManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private npcs: any[];
  private combat: any;
  private escortTargets: Map<any, { target: any; lastSeen: number }> = new Map();

  constructor(scene: Phaser.Scene, config: ConfigManager, npcsRef: any[], combat: any) {
    this.scene = scene;
    this.config = config;
    this.npcs = npcsRef;
    this.combat = combat;
  }

  updateTraders(deltaMs: number) {
    const dt = deltaMs / 1000;
    const sys = this.config?.system as any;
    if (!sys || !Array.isArray(sys.planets)) return;
    for (const o of this.npcs) {
      const behavior = (o as any).__behavior;
      if (behavior !== 'planet_trader' && behavior !== 'orbital_trade') continue;
      const cmAny: any = this.combat;
      const cmEntry = cmAny?.targets?.find((t: any) => t.obj === o);
      if (cmEntry && cmEntry.intent) continue;

      let target = (o as any).__targetPlanet;
      if (!target) { (o as any).__targetPlanet = this.pickRandomPlanet(); target = (o as any).__targetPlanet; }
      const confPlanet = (sys.planets as any[]).find((p: any) => p.id === target.id) as any;
      if (!confPlanet) { (o as any).__targetPlanet = this.pickRandomPlanet(); continue; }

      const planetPos = this.getPlanetWorldPosById(target.id) ?? { x: confPlanet?._x, y: confPlanet?._y };
      const state = (o as any).__state ?? 'travel';
      if (state === 'travel') {
        const planetRec = this.findPlanetRec(target.id);
        const canMove = cmAny.npcStateManager?.addMovementCommand(
          o, 'move_to', { x: planetPos.x, y: planetPos.y, targetObject: planetRec?.obj }, undefined, 'TRADE', 'scene_trader'
        );
        if (canMove !== false) cmAny.npcMovement.setNPCTarget(o, { x: planetPos.x, y: planetPos.y, targetObject: planetRec?.obj });
        const dist = Math.hypot(planetPos.x - o.x, planetPos.y - o.y);
        const dockRange = (target as any).dockRange ?? this.config.gameplay.dock_range ?? 220;
        if (dist < dockRange) {
          (o as any).__state = 'docking';
          try { cmAny.clearAssignmentsForTarget?.(o); } catch {}
          const dur = 1200;
          const bsx = (o as any).__baseScaleX ?? o.scaleX ?? 1;
          const bsy = (o as any).__baseScaleY ?? o.scaleY ?? 1;
          this.scene.tweens.add({
            targets: o, x: planetPos.x, y: planetPos.y, scaleX: bsx * 0.2, scaleY: bsy * 0.2, alpha: 0, duration: dur, ease: 'Sine.easeInOut',
            onComplete: () => { (o as any).__state = 'docked'; try { (this.combat as any).despawnNPC?.(o, 'docked'); } catch {} }
          });
        }
      }
    }
  }

  updatePatrol(deltaMs: number) {
    const dt = deltaMs / 1000;
    const sys = this.config?.system as any;
    if (!sys || !Array.isArray(sys.planets)) return;
    for (const o of this.npcs) {
      if ((o as any).__behavior !== 'patrol' && (o as any).__behavior !== 'pirate_raider') continue;
      const cm: any = this.combat;
      const entry = cm?.targets?.find((t: any) => t.obj === o);
      if (entry && entry.intent) {
        const intent = entry.intent;
        if (intent?.type === 'attack') {
          const tgt = intent.target;
          if (!tgt?.active || (tgt as any).__state === 'docked') (o as any).__targetPatrol = null;
        }
        continue;
      }

      // ESCORT: только для фракции orbital_patrol — если рядом есть союзный торговец, орбита вокруг него
      const myEntry = cm.targets?.find((t: any) => t.obj === o);
      const myFaction = myEntry?.faction;
      const isEscortCapable = myFaction === 'orbital_patrol';
      if (isEscortCapable) {
        const radar = cm.getRadarRangeForPublic?.(o) ?? 800;
        const allies = (cm.getAllNPCs?.() ?? [])
          .filter((r: any) => r && r.obj !== o && r.obj?.active)
          .filter((r: any) => cm.getRelationPublic?.(myFaction, r.faction, myEntry?.overrides?.factions) === 'ally');

        let escortTarget: any = null;
        for (const allyRec of allies) {
          const rec = cm.targets?.find((tt: any) => tt.obj === allyRec.obj);
          const allyBehavior = rec?.ai?.behavior;
          const allyState = (allyRec.obj as any)?.__state;
          if (allyBehavior === 'planet_trader' && allyState !== 'docked' && allyState !== 'docking') {
            const d = Phaser.Math.Distance.Between(o.x, o.y, allyRec.obj.x, allyRec.obj.y);
            if (d <= radar) { escortTarget = allyRec.obj; break; }
          }
        }
        if (escortTarget) {
          const dist = 400;
          cm.npcMovement.setNPCMode(o, 'orbit', dist);
          cm.npcMovement.setNPCTarget(o, { x: escortTarget.x, y: escortTarget.y, targetObject: escortTarget });
          // сбросить обычную цель патруля, чтобы после исчезновения эскорта вернуться к патрулю
          (o as any).__targetPatrol = null;
          continue;
        }
      }
      let target = (o as any).__targetPatrol;
      if (!target || (target._isPlanet && !this.getPlanetWorldPosById(target.id))) {
        const pickStar = Math.random() < 0.2;
        if (pickStar) {
          const ang = Math.random() * Math.PI * 2;
          const r = 300 + Math.random() * 400;
          (o as any).__targetPatrol = { _isPoint: true, x: sys.star.x + Math.cos(ang) * r, y: sys.star.y + Math.sin(ang) * r };
        } else {
          const planet = this.pickRandomPlanet();
          (o as any).__targetPatrol = { _isPlanet: true, id: planet.id };
        }
        target = (o as any).__targetPatrol;
      }
      let tx = sys.star.x, ty = sys.star.y;
      if ((target as any)._isPoint) { tx = (target as any).x; ty = (target as any).y; }
      else if ((target as any)._isPlanet) {
        const pos = this.getPlanetWorldPosById((target as any).id);
        if (pos) { tx = pos.x; ty = pos.y; }
      }
      const canMove = cm.npcStateManager?.addMovementCommand(o, 'move_to', { x: tx, y: ty }, undefined, 'PATROL', 'scene_patrol');
      if (canMove !== false) {
        cm.npcMovement.setNPCMode(o, 'move_to');
        cm.npcMovement.setNPCTarget(o, { x: tx, y: ty });
      }
      const dist = Math.hypot(tx - o.x, ty - o.y);
      if (dist < 160) (o as any).__targetPatrol = null;
    }
  }

  private getPlanetWorldPosById(id: string): { x: number; y: number } | null {
    const sys: any = this.config?.system;
    const rec = (this.scene as any).planets?.find?.((p: any) => (p as any).data?.id === id);
    if (rec && rec.obj) return { x: rec.obj.x, y: rec.obj.y };
    const confPlanet = (sys?.planets as any[])?.find((p: any) => p.id === id);
    if (confPlanet) {
      const x = confPlanet._x ?? (sys.star.x + confPlanet.orbit.radius);
      const y = confPlanet._y ?? sys.star.y;
      return { x, y };
    }
    return null;
  }

  private pickRandomPlanet() {
    const system = this.config.system;
    const idx = Math.floor(Math.random() * system.planets.length);
    return system.planets[idx];
  }
  private findPlanetRec(id: string) {
    return (this.scene as any).planets?.find?.((p: any) => (p as any).data?.id === id);
  }
  
  /**
   * Корректно уничтожить менеджер и освободить ресурсы
   */
  public destroy(): void {
    // Очистить все данные
    this.npcs = [];
    this.combat = undefined;
    this.escortTargets.clear();
  }
}


