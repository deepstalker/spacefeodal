export type RelationKind = 'ally' | 'neutral' | 'confrontation' | 'cautious';

interface ObjectOverride {
  targetFaction: string; // обычно 'player'
  relation: RelationKind;
  reason?: string; // 'aim', 'script', etc
  expireOnOutOfRadar?: boolean;
  createdAtCycle: number;
  expiresAtCycle?: number; // если задано — снятие по циклам
}

interface FactionOverride {
  againstFaction: string; // обычно 'player'
  relation: RelationKind;
  createdAtCycle: number;
  remainingCycles?: number; // если задано — автоистечение по циклам
}

/**
 * Централизованный менеджер временных переопределений отношений.
 * Поддерживает два уровня:
 * - точечные переопределения для конкретных объектов (NPC против фракции/игрока)
 * - массовые переопределения для всей фракции (против другой фракции) с истечением по циклам
 */
export class RelationOverrideManager {
  private scene: Phaser.Scene;
  private getTargets: () => Array<{ obj: any; faction?: string; overrides?: { factions?: Record<string, RelationKind> } }>;
  private getPlayer: () => any;
  private getRadarRangeFor: (obj: any) => number;
  private getNpcContext?: (obj: any) => any; // для проверок боевого состояния/агрессии
  private timeManager?: { getCurrentCycle(): number };
  private clearAssignmentsForTarget?: (obj: any) => void;

  private objectOverrides: Map<any, Map<string, ObjectOverride>> = new Map();
  private factionOverrides: Map<string, Map<string, FactionOverride>> = new Map();

  constructor(
    scene: Phaser.Scene,
    deps: {
      getTargets: () => Array<{ obj: any; faction?: string; overrides?: { factions?: Record<string, RelationKind> } }>;
      getPlayer: () => any;
      getRadarRangeFor: (obj: any) => number;
      getNpcContext?: (obj: any) => any;
      clearAssignmentsForTarget?: (obj: any) => void;
    }
  ) {
    this.scene = scene;
    this.getTargets = deps.getTargets;
    this.getPlayer = deps.getPlayer;
    this.getRadarRangeFor = deps.getRadarRangeFor;
    this.getNpcContext = deps.getNpcContext;
    this.clearAssignmentsForTarget = deps.clearAssignmentsForTarget;

    // Тик обновления (минимальная нагрузка)
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
  }

  setTimeManager(tm: { getCurrentCycle(): number }) {
    this.timeManager = tm;
  }

  // === ПУБЛИЧНЫЕ API ===

  /**
   * Включить временную враждебность конкретного объекта к игроку.
   * По умолчанию снимается, когда игрок выходит за пределы радара этого объекта,
   * либо по истечении cycles (если задан expiresInCycles/expiresAtCycle).
   */
  public markObjectHostileToPlayer(
    obj: any,
    opts?: { reason?: string; expireOnOutOfRadar?: boolean; expiresInCycles?: number; expiresAtCycle?: number }
  ) {
    const nowCycle = this.getCurrentCycle();
    const overridesForObj = this.ensureObjectMap(obj);
    const existing = overridesForObj.get('player');
    const expiresAtCycle = opts?.expiresAtCycle ?? (opts?.expiresInCycles ? nowCycle + Math.max(0, opts.expiresInCycles) : undefined);
    const record: ObjectOverride = {
      targetFaction: 'player',
      relation: 'confrontation',
      reason: opts?.reason ?? 'aim',
      expireOnOutOfRadar: opts?.expireOnOutOfRadar ?? true,
      createdAtCycle: nowCycle,
      expiresAtCycle
    };
    overridesForObj.set('player', record);
    // Синхронизируем в CombatManager.targets.overrides для обратной совместимости
    this.applyObjectOverrideToEntry(obj, 'player', 'confrontation');
  }

  /** Снять точечную враждебность объекта к игроку (если не заблокировано боем). */
  public unmarkObjectHostilityToPlayer(obj: any) {
    const map = this.objectOverrides.get(obj);
    if (map) map.delete('player');
    // Очистим overrides у записи цели
    this.clearObjectOverrideFromEntry(obj, 'player');
  }

  /** Массовая установка переопределения отношений фракции против игрока на N циклов. */
  public setFactionAgainstPlayer(
    sourceFaction: string,
    relation: RelationKind,
    opts: { durationCycles?: number }
  ) {
    const nowCycle = this.getCurrentCycle();
    const map = this.ensureFactionMap(sourceFaction);
    map.set('player', {
      againstFaction: 'player',
      relation,
      createdAtCycle: nowCycle,
      remainingCycles: opts.durationCycles && opts.durationCycles > 0 ? Math.floor(opts.durationCycles) : undefined
    });
    // Применяем к существующим целям соответствующей фракции
    this.applyFactionOverrideToEntries(sourceFaction, 'player', relation);
    // Если наступил мир/нейтрал — сбрасываем назначение оружия игрока с целей этой фракции
    if (relation !== 'confrontation') {
      for (const t of this.getTargets()) {
        if (t && t.faction === sourceFaction) {
          try { this.clearAssignmentsForTarget?.(t.obj); } catch {}
        }
      }
    }
  }

  /** Снять массовое переопределение для фракции против игрока. */
  public clearFactionAgainstPlayer(sourceFaction: string) {
    const map = this.factionOverrides.get(sourceFaction);
    if (map) map.delete('player');
    // Очистить с существующих объектов
    this.clearFactionOverrideFromEntries(sourceFaction, 'player');
  }

  // === ВНУТРЕННИЕ ===

  private ensureObjectMap(obj: any): Map<string, ObjectOverride> {
    let m = this.objectOverrides.get(obj);
    if (!m) { m = new Map(); this.objectOverrides.set(obj, m); }
    return m;
  }
  private ensureFactionMap(sourceFaction: string): Map<string, FactionOverride> {
    let m = this.factionOverrides.get(sourceFaction);
    if (!m) { m = new Map(); this.factionOverrides.set(sourceFaction, m); }
    return m;
  }

  private getCurrentCycle(): number {
    try { return this.timeManager?.getCurrentCycle?.() ?? 0; } catch { return 0; }
  }

  private applyObjectOverrideToEntry(obj: any, targetFaction: string, relation: RelationKind) {
    const entry = this.getTargets().find(t => t.obj === obj);
    if (!entry) return;
    (entry as any).overrides = (entry as any).overrides ?? {};
    (entry as any).overrides.factions = (entry as any).overrides.factions ?? {};
    (entry as any).overrides.factions[targetFaction] = relation;
  }
  private clearObjectOverrideFromEntry(obj: any, targetFaction: string) {
    const entry = this.getTargets().find(t => t.obj === obj);
    if (!entry) return;
    // Если существует массовый override для фракции объекта — восстановим его значение.
    const fo = this.factionOverrides.get(entry.faction ?? '');
    const tgt = fo?.get(targetFaction);
    (entry as any).overrides = (entry as any).overrides ?? {};
    (entry as any).overrides.factions = (entry as any).overrides.factions ?? {};
    if (tgt) {
      (entry as any).overrides.factions[targetFaction] = tgt.relation;
    } else {
      const f = (entry as any).overrides?.factions;
      if (f && f[targetFaction]) delete f[targetFaction];
    }
  }

  private applyFactionOverrideToEntries(sourceFaction: string, targetFaction: string, relation: RelationKind) {
    for (const t of this.getTargets()) {
      if (!t || t.faction !== sourceFaction) continue;
      (t as any).overrides = (t as any).overrides ?? {};
      (t as any).overrides.factions = (t as any).overrides.factions ?? {};
      (t as any).overrides.factions[targetFaction] = relation;
    }
  }
  private clearFactionOverrideFromEntries(sourceFaction: string, targetFaction: string) {
    for (const t of this.getTargets()) {
      if (!t || t.faction !== sourceFaction) continue;
      const f = (t as any).overrides?.factions;
      if (f && f[targetFaction]) delete f[targetFaction];
    }
  }

  private isPlayerOutOfRadarFor(obj: any): boolean {
    const player = this.getPlayer();
    if (!player || !player.active || !obj || !obj.active) return true;
    const radar = this.getRadarRangeFor(obj);
    const d = Phaser.Math.Distance.Between(obj.x, obj.y, player.x, player.y);
    return d > radar;
  }

  private isInActiveCombatAgainstPlayer(obj: any): boolean {
    try {
      const ctx = this.getNpcContext?.(obj);
      if (!ctx) return false;
      // Если текущая стабилизированная цель — игрок, не снимаем принудительно
      const tgt = ctx.targetStabilization?.currentTarget;
      return !!tgt && tgt === this.getPlayer();
    } catch {
      return false;
    }
  }

  private update() {
    // Снятие точечных overrides при выходе из радара/истечении циклов
    const toClear: Array<{ obj: any; faction: string }> = [];
    for (const [obj, map] of this.objectOverrides.entries()) {
      for (const [targetFaction, rec] of map.entries()) {
        // истечение по циклам
        const nowCycle = this.getCurrentCycle();
        if (typeof rec.expiresAtCycle === 'number' && nowCycle >= rec.expiresAtCycle) {
          toClear.push({ obj, faction: targetFaction });
          continue;
        }
        // истечение по выходу из радара
        if (rec.expireOnOutOfRadar) {
          const out = this.isPlayerOutOfRadarFor(obj);
          if (out) {
            // Не снимаем, если NPC сейчас активно в бою против игрока
            if (!this.isInActiveCombatAgainstPlayer(obj)) {
              toClear.push({ obj, faction: targetFaction });
            }
          }
        }
      }
    }
    for (const c of toClear) {
      const map = this.objectOverrides.get(c.obj);
      if (map) map.delete(c.faction);
      this.clearObjectOverrideFromEntry(c.obj, c.faction);
    }

    // Снижение оставшихся циклов у factionOverrides по событиям времени обрабатываем в слушателях снаружи,
    // но на случай отсутствия — ничего тут не делаем. Снятие произойдет на событии цикла.
  }

  /** Вызывать на старте каждого цикла, чтобы уменьшить счётчики и снять истёкшие правила. */
  public onCycleStart() {
    const toDelete: Array<{ source: string; against: string }> = [];
    for (const [source, map] of this.factionOverrides.entries()) {
      for (const [against, rec] of map.entries()) {
        if (typeof rec.remainingCycles === 'number') {
          rec.remainingCycles = Math.max(0, rec.remainingCycles - 1);
          if (rec.remainingCycles === 0) toDelete.push({ source, against });
        }
      }
    }
    for (const it of toDelete) {
      const map = this.factionOverrides.get(it.source);
      if (map) map.delete(it.against);
      this.clearFactionOverrideFromEntries(it.source, it.against);
    }
  }

  /** Очистка ресурсов */
  public destroy() {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.update, this);
    this.objectOverrides.clear();
    this.factionOverrides.clear();
  }
}


