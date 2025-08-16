import type { ConfigManager } from './ConfigManager';
import { NPCMovementManager } from './NPCMovementManager';

type Target = Phaser.GameObjects.GameObject & { x: number; y: number; active: boolean };

export class CombatManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private npcMovement: NPCMovementManager;
  private ship!: Phaser.GameObjects.Image;
  private selectedTarget: Target | null = null;
  private selectionCircle?: Phaser.GameObjects.Arc;
  private selectionBaseRadius = 70;
  private selectionPulsePhase = 0;
  private lastFireTimesByShooter: WeakMap<any, Record<string, number>> = new WeakMap();
  private weaponSlots: string[] = ['laser', 'cannon', 'missile'];
  // Назначения целей для оружия игрока: slotKey -> target
  private playerWeaponTargets: Map<string, Target> = new Map();
  private targets: Array<{
    obj: Phaser.GameObjects.GameObject & { x: number; y: number; active: boolean; rotation?: number };
    hp: number; hpMax: number;
    hpBarBg: Phaser.GameObjects.Rectangle; hpBarFill: Phaser.GameObjects.Rectangle;
    nameLabel?: Phaser.GameObjects.Text;
    ai?: { preferRange: number; retreatHpPct: number; type: 'ship' | 'static'; speed: number; disposition?: 'neutral' | 'enemy' | 'ally'; behavior?: string };
    weaponSlots?: string[];
    shipId?: string;
    faction?: string;
    combatAI?: string;
    aiProfileKey?: string;
    intent?: { type: 'attack' | 'flee'; target: any } | null;
    overrides?: { factions?: Record<string, 'ally'|'neutral'|'confrontation'> };
  }>=[];
  private combatRings: Map<any, Phaser.GameObjects.Arc> = new Map();

  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
    this.npcMovement = new NPCMovementManager(scene, config);
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
  }

  public clearIntentFor(obj: any) {
    const entry = this.targets.find(t => t.obj === obj);
    if (entry) (entry as any).intent = null;
  }
  public setAIProfileFor(obj: any, profileKey: string) {
    const entry = this.targets.find(t => t.obj === obj);
    if (!entry) return;
    const profile = this.config.aiProfiles.profiles[profileKey];
    if (!profile) return;
    entry.aiProfileKey = profileKey;
    entry.ai = entry.ai || ({ type: 'ship', preferRange: 0, speed: 0 } as any);
    (entry.ai as any).behavior = profile.behavior;
    (entry.ai as any).retreatHpPct = profile.combat?.retreatHpPct ?? 0;
  }

  attachShip(ship: Phaser.GameObjects.Image) {
    this.ship = ship;
  }

  getTargetObjects(): Phaser.GameObjects.GameObject[] {
    return this.targets.map(t => t.obj as Phaser.GameObjects.GameObject);
  }

  getSelectedTarget(): Target | null { return this.selectedTarget; }

  spawnNPCPrefab(prefabKey: string, x: number, y: number) {
    const prefab = this.config.stardwellers?.prefabs?.[prefabKey];
    const shipDefId = prefab?.shipId ?? prefabKey; // allow direct ship id fallback
    const ship = this.config.ships.defs[shipDefId] ?? this.config.ships.defs[this.config.ships.current];
    if (!ship) { return null; }
    let obj: any;
    const s = ship.sprite;
    const texKey = (s.key && this.scene.textures.exists(s.key)) ? s.key : (this.scene.textures.exists('ship_alpha') ? 'ship_alpha' : 'ship_alpha_public');
    obj = this.scene.add.image(x, y, texKey).setDepth(0.8);
    obj.setOrigin(s.origin?.x ?? 0.5, s.origin?.y ?? 0.5);
    obj.setDisplaySize(s.displaySize?.width ?? 64, s.displaySize?.height ?? 128);
    // Начальная ориентация — по носу из конфига
    obj.setRotation(Phaser.Math.DegToRad(s.noseOffsetDeg ?? 0));
    // Запомним базовый масштаб после применения displaySize
    (obj as any).__baseScaleX = obj.scaleX;
    (obj as any).__baseScaleY = obj.scaleY;
    obj.setAlpha(1);
    obj.setVisible(true);
    (obj as any).__noseOffsetRad = Phaser.Math.DegToRad(s.noseOffsetDeg ?? 0);
    const barW = 128;
    const above = (Math.max(obj.displayWidth, obj.displayHeight) * 0.5) + 16;
    const bg = this.scene.add.rectangle(obj.x - barW/2, obj.y - above, barW, 8, 0x111827).setOrigin(0, 0.5).setDepth(0.5);
    const fill = this.scene.add.rectangle(obj.x - barW/2, obj.y - above, barW, 8, 0x22c55e).setOrigin(0, 0.5).setDepth(0.6);
    bg.setVisible(false); fill.setVisible(false);
    const aiProfileName = prefab?.aiProfile ?? 'planet_trader';
    const profile = this.config.aiProfiles.profiles[aiProfileName] ?? { behavior: 'static' } as any;
    const ai = { preferRange: 0, retreatHpPct: profile.combat?.retreatHpPct ?? 0, type: 'ship', behavior: profile.behavior } as any;
    const entry: any = { obj, hp: ship.hull ?? 100, hpMax: ship.hull ?? 100, hpBarBg: bg, hpBarFill: fill, ai, shipId: prefab?.shipId ?? shipDefId, faction: prefab?.faction, combatAI: prefab?.combatAI, aiProfileKey: aiProfileName, intent: null };
    if (prefab?.weapons && Array.isArray(prefab.weapons)) entry.weaponSlots = prefab.weapons.slice(0);
    this.targets.push(entry);
    
    // Регистрируем NPC в системе движения
    this.npcMovement.registerNPC(obj, prefab?.combatAI);
    
    return obj as Target;
  }

  // enemies-by-config removed — use spawnNPCPrefab with stardwellers prefabs

  bindInput(inputMgr: any) {
    inputMgr.onLeftClick((wx: number, wy: number) => {
      try { console.debug('[Combat] onLeftClick', { wx, wy }); } catch {}
      const hit = this.findTargetAt(wx, wy);
      if (hit) {
        try { console.debug('[Combat] hit target', { x: hit.obj.x, y: hit.obj.y, shipId: (hit as any).shipId }); } catch {}
        this.selectTarget(hit.obj as any);
      } else {
        // Пустой клик: сбрасываем выбор, только если нет ни одного оружия, нацеленного на текущую выбранную цель
        if (!this.selectedTarget || !this.isTargetCombatSelected(this.selectedTarget)) {
          try { console.debug('[Combat] no target, clearSelection'); } catch {}
          this.clearSelection();
        } else {
          try { console.debug('[Combat] no target, keep selected info target (combat-selected)'); } catch {}
        }
      }
    });
  }

  public findTargetAt(wx: number, wy: number) {
    // Фильтруем цели в состоянии docking/docked/undocking - их нельзя выбирать для боя
    const availableTargets = this.targets.filter(t => {
      const state = (t.obj as any).__state;
      const isDockingState = state === 'docking' || state === 'docked' || state === 'undocking';
      if (isDockingState) {
        try { console.debug('[Combat] findTargetAt: filtering out target in state', state, { x: (t.obj as any).x, y: (t.obj as any).y }); } catch {}
      }
      return !isDockingState;
    });
    
    // Сначала проверим попадание по кругу вокруг объекта
    let hit = availableTargets.find(t => {
      const rad = this.getEffectiveRadius(t.obj as any) + 12;
      return Phaser.Math.Distance.Between(t.obj.x, t.obj.y, wx, wy) <= rad;
    });
    if (hit) return hit;
    // Также считаем попаданием клики по области HP-бара
    hit = availableTargets.find(t => {
      const bg = t.hpBarBg;
      if (!bg || !bg.visible) return false;
      const x1 = bg.x, y1 = bg.y - bg.height * 0.5;
      const x2 = bg.x + bg.width, y2 = bg.y + bg.height * 0.5;
      return wx >= x1 && wx <= x2 && wy >= y1 && wy <= y2;
    }) as any;
    if (hit) return hit;
    // Последняя попытка: клик рядом с объектом в прямоугольнике дисплея
    hit = availableTargets.find(t => {
      const obj: any = t.obj;
      const w = obj.displayWidth ?? obj.width ?? 128;
      const h = obj.displayHeight ?? obj.height ?? 128;
      const x1 = obj.x - w * 0.5, y1 = obj.y - h * 0.5;
      const x2 = obj.x + w * 0.5, y2 = obj.y + h * 0.5;
      return wx >= x1 && wx <= x2 && wy >= y1 && wy <= y2;
    }) as any;
    return hit ?? null;
  }

  public forceSelectTarget(target: Target) {
    this.selectTarget(target);
  }

  public setPlayerWeaponTarget(slotKey: string, target: Target | null) {
    const oldTarget = this.playerWeaponTargets.get(slotKey);
    
    if (target) {
      this.playerWeaponTargets.set(slotKey, target);
      try { console.debug('[Combat] setPlayerWeaponTarget', slotKey, { tx: (target as any).x, ty: (target as any).y, hadOldTarget: !!oldTarget }); } catch {}
    } else {
      this.playerWeaponTargets.delete(slotKey);
      try { console.debug('[Combat] clearPlayerWeaponTarget', slotKey); } catch {}
    }
    
    this.refreshSelectionCircleColor();
    this.refreshCombatRings();
    this.refreshCombatUIAssigned();
  }

  public clearPlayerWeaponTargets() {
    if (this.playerWeaponTargets.size > 0) {
      try { console.debug('[Combat] clearPlayerWeaponTargets: clearing', this.playerWeaponTargets.size, 'assignments'); } catch {}
      // Уведомляем UI о сбросе всех назначений
      const clearedSlots = Array.from(this.playerWeaponTargets.keys());
      this.playerWeaponTargets.clear();
      if (clearedSlots.length > 0) {
        try { this.scene.events.emit('player-weapon-target-cleared', null, clearedSlots); } catch {}
      }
    }
    this.refreshSelectionCircleColor();
    this.refreshCombatRings();
    this.refreshCombatUIAssigned();
  }

  public getPlayerWeaponTargets(): ReadonlyMap<string, Target> {
    return this.playerWeaponTargets;
  }

  public getHpBarInfoFor(target: Target): { x: number; y: number; width: number; height: number } | null {
    const t = this.targets.find(tt => tt.obj === target);
    if (!t) return null;
    return { x: t.hpBarBg.x, y: t.hpBarBg.y, width: t.hpBarBg.width, height: t.hpBarBg.height };
  }

  private selectTarget(target: Target) {
    this.selectedTarget = target;
    const base = this.getEffectiveRadius(target as any) + 5;
    this.selectionBaseRadius = base;
    if (!this.selectionCircle) {
      // начально — нейтральный цвет; позже может смениться на красный, если есть цель для оружия
      this.selectionCircle = this.scene.add.circle(target.x, target.y, base, 0x9e9382, 0.15).setDepth(0.45);
      this.selectionCircle.setStrokeStyle(2, 0x9e9382, 1);
    } else {
      this.selectionCircle.setPosition(target.x, target.y).setVisible(true);
      this.selectionCircle.setRadius(base);
      this.selectionCircle.setFillStyle(0x9e9382, 0.15);
      this.selectionCircle.setStrokeStyle(2, 0x9e9382, 1);
    }
    // toggle HP bars visibility
    for (const t of this.targets) {
      const vis = t.obj === target;
      t.hpBarBg.setVisible(vis);
      t.hpBarFill.setVisible(vis);
      this.updateHpBar(t);
      // Имя цели над HP баром
      if (vis) {
        if (!t.nameLabel) {
          const name = this.resolveDisplayName(t) || 'Unknown';
          t.nameLabel = this.scene.add.text(0, 0, name, { color: '#ffffff', fontSize: '16px', fontFamily: 'HooskaiChamferedSquare' }).setOrigin(0.5, 1).setDepth(0.7);
        }
        // Цвет имени по отношению к игроку: neutral -> 0x9E9382, enemy -> 0xA93226
        const rel = this.getRelation('player', t.faction, t.overrides?.factions);
        const color = (rel === 'confrontation') ? '#A93226' : '#9E9382';
        t.nameLabel.setText(this.resolveDisplayName(t) || 'Unknown');
        t.nameLabel.setColor(color);
        t.nameLabel.setVisible(true);
        this.updateHpBar(t); // позиция имени обновится внутри
      } else {
        t.nameLabel?.setVisible(false);
      }
    }
    this.refreshSelectionCircleColor();
  }

  private clearSelection() {
    this.selectedTarget = null;
    this.selectionCircle?.setVisible(false);
    // hide all HP bars
    for (const t of this.targets) { t.hpBarBg.setVisible(false); t.hpBarFill.setVisible(false); t.nameLabel?.setVisible(false); }
  }

  private update(_time: number, deltaMs: number) {
    // pulse selection
    if (this.selectedTarget && this.selectionCircle) {
      this.selectionPulsePhase += deltaMs * 0.01;
      const r = this.selectionBaseRadius + Math.sin(this.selectionPulsePhase) * 3;
      this.selectionCircle.setRadius(r);
      this.selectionCircle.setPosition((this.selectedTarget as any).x, (this.selectedTarget as any).y);
    }

    // auto logic
    if (!this.ship) return;
    // sensors + intent resolution
    this.updateSensors(deltaMs);
    // AI steering
    this.updateEnemiesAI(deltaMs);

    // Player fire only по назначенным целям для каждого слота оружия
    const playerSlots = this.config.player?.weapons ?? [];
    if (playerSlots.length) {
      const now = this.scene.time.now;
      const times = this.getShooterTimes(this.ship);
      for (let i = 0; i < playerSlots.length; i++) {
        const slotKey = playerSlots[i];
        const target = this.playerWeaponTargets.get(slotKey);
        if (!target || !target.active) continue;
        const w = this.config.weapons.defs[slotKey];
        if (!w) continue;
        const dx = (target as any).x - this.ship.x;
        const dy = (target as any).y - this.ship.y;
        const dist = Math.hypot(dx, dy);
        if (dist > w.range) continue;
        const cooldownMs = 1000 / Math.max(0.001, w.fireRatePerSec);
        const last = times[slotKey] ?? 0;
        if (now - last >= cooldownMs) {
          times[slotKey] = now;
          const muzzleOffset = this.resolveMuzzleOffset(this.ship, i, w.muzzleOffset);
          const w2 = { ...w, muzzleOffset };
          this.fireWeapon(slotKey, w2, target as any, this.ship);
          try { console.debug('[Combat] fire', slotKey, { range: w.range, dist }); } catch {}
        }
      }
    }
    // enemies auto fire by intent
    for (const t of this.targets) {
      if (!t.ai || !t.intent || t.intent.type !== 'attack') continue;
      const targetObj = t.intent.target;
      if (!targetObj || !targetObj.active) continue;
      const saved = this.weaponSlots;
      const slots = (t as any).weaponSlots as string[] | undefined;
      if (slots && slots.length) this.weaponSlots = slots;
      this.autoFire(t.obj as any, targetObj);
      this.weaponSlots = saved;
    }
    // update red rings for combat-selected targets
    for (const [tgt, ring] of this.combatRings.entries()) {
      if (!tgt || !tgt.active) { ring.destroy(); this.combatRings.delete(tgt); continue; }
      const base = this.getEffectiveRadius(tgt as any) + 5;
      ring.setRadius(base);
      ring.setPosition((tgt as any).x, (tgt as any).y);
    }
    // ensure HP bars for all combat targets remain visible
    this.refreshCombatUIAssigned();
  }

  private refreshSelectionCircleColor() {
    const t = this.selectedTarget;
    if (!t || !this.selectionCircle) return;
    // если хоть одно оружие нацелено на выбранную цель — выделение красным
    const anyOnThis = Array.from(this.playerWeaponTargets.values()).some(v => v === t);
    if (anyOnThis) {
      this.selectionCircle.setFillStyle(0xA93226, 0.15);
      this.selectionCircle.setStrokeStyle(2, 0xA93226, 1);
    } else {
      this.selectionCircle.setFillStyle(0x9e9382, 0.15);
      this.selectionCircle.setStrokeStyle(2, 0x9e9382, 1);
    }
  }

  private isTargetCombatSelected(target: Target | null): boolean {
    if (!target) return false;
    for (const t of this.playerWeaponTargets.values()) { if (t === target) return true; }
    return false;
  }

  private updateEnemiesAI(deltaMs: number) {
    for (const t of this.targets) {
      if (!t.ai || t.ai.type !== 'ship') continue;
      // If object is returning home (e.g., wave despawn), skip combat steering
      if ((t.obj as any).__returningHome) continue;
      // If no combat intent and behavior isn't aggressive — let regular logic handle
      if ((!t.intent || t.intent.type === undefined) && t.ai.behavior && t.ai.behavior !== 'aggressive') { 
        this.updateHpBar(t as any); 
        continue; 
      }
      
      const obj: any = t.obj;
      const retreat = ((): number => {
        if (t.combatAI) {
          const cp = this.config.combatAI?.profiles?.[t.combatAI];
          if (cp && typeof cp.retreatHpPct === 'number') return cp.retreatHpPct;
        }
        return t.ai.retreatHpPct ?? 0;
      })();
      
      const targetObj = (t.intent && t.intent.type === 'attack') ? t.intent.target : this.ship;
      const fleeObj = (t.intent && t.intent.type === 'flee') ? t.intent.target : null;
      
      let target: { x: number; y: number };
      if (fleeObj) {
        // Flee: отлетаем от источника угрозы
        const dx = obj.x - fleeObj.x;
        const dy = obj.y - fleeObj.y;
        const dist = Math.hypot(dx, dy);
        const fleeDistance = 1000; // дистанция бегства
        target = {
          x: fleeObj.x + (dx / dist) * fleeDistance,
          y: fleeObj.y + (dy / dist) * fleeDistance
        };
        this.npcMovement.setNPCTarget(obj, target);
      } else if (targetObj) {
        // Attack: используем режим движения из профиля ИИ
        const shouldRetreat = t.hp / t.hpMax <= retreat;
        if (shouldRetreat) {
          // Отступаем
          const dx = obj.x - targetObj.x;
          const dy = obj.y - targetObj.y;
          const dist = Math.hypot(dx, dy);
          const retreatDistance = 800;
          target = {
            x: targetObj.x + (dx / dist) * retreatDistance,
            y: targetObj.y + (dy / dist) * retreatDistance
          };
          this.npcMovement.setNPCTarget(obj, target);
        } else {
          // Атакуем с использованием режима из профиля ИИ
          target = { x: targetObj.x, y: targetObj.y };
          this.npcMovement.setNPCTarget(obj, target);
        }
      }
      
      // Ограничиваем движение границами системы
      const sz = this.config.system?.size;
      if (sz) {
        const mx = Math.max(0, sz.width * 0.2);
        const my = Math.max(0, sz.height * 0.2);
        const maxX = Math.max(mx, sz.width - mx);
        const maxY = Math.max(my, sz.height - my);
        obj.x = Phaser.Math.Clamp(obj.x, mx, maxX);
        obj.y = Phaser.Math.Clamp(obj.y, my, maxY);
      }
      
      // update HP bar follow
      this.updateHpBar(t as any);
    }
  }

  private fireWeapon(_slot: string, w: any, target: any, shooter: any) {
    const muzzle = this.getMuzzleWorldPositionFor(shooter, w.muzzleOffset);
    const aim = this.getAimedTargetPoint(shooter, target, w);
    const angle = Math.atan2(aim.y - muzzle.y, aim.x - muzzle.x);
    // projectile visual
    let proj: Phaser.GameObjects.GameObject & { x: number; y: number };
    if (w.projectile.shape === 'rect') {
      proj = this.scene.add.rectangle(muzzle.x, muzzle.y, w.projectile.width, w.projectile.height, Number((w.projectile.color as string).replace('#','0x'))).setDepth(0.8) as any;
      (proj as any).setRotation?.(angle);
    } else {
      const r = w.projectile.radius ?? 4;
      proj = this.scene.add.circle(muzzle.x, muzzle.y, r, Number((w.projectile.color as string).replace('#','0x'))).setDepth(0.8) as any;
    }
    (proj as any).__combat = { damage: w.damage, target };
    // under shooter
    (proj as any).setDepth?.(((shooter as any).depth ?? 1) - 0.1);

    const speed = w.projectileSpeed;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;

    const lifetimeMs = Math.min(1500, (w.range / Math.max(1, speed)) * 1000 + 50);
    const onUpdate = (_t: number, dt: number) => {
      (proj as any).x += vx * (dt/1000);
      (proj as any).y += vy * (dt/1000);
      // collision simple distance check
      if (!target.active) return;
      const hitDist = this.getEffectiveRadius(target as any);
      const d = Phaser.Math.Distance.Between((proj as any).x, (proj as any).y, target.x, target.y);
      if (d <= hitDist) {
        try { console.debug('[Combat] hit target, applyDamage', w.damage); } catch {}
        this.applyDamage(target, w.damage, shooter);
        this.spawnHitEffect((proj as any).x, (proj as any).y, w);
        this.scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
        (proj as any).destroy?.();
      }
    };
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
    this.scene.time.delayedCall(lifetimeMs, () => {
      this.scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
      (proj as any).destroy?.();
    });
    // Сигнализируем UI о выстреле игрока для мигания иконки
    if (shooter === this.ship) {
      try { this.scene.events.emit('player-weapon-fired', _slot, target); } catch {}
    }
  }

  private getMuzzleWorldPositionFor(shooter: any, offset: { x: number; y: number }) {
    // offset is relative to shooter local space where +Y is down in Phaser, shooter rotated
    const rot = shooter.rotation;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const lx = offset.x;
    const ly = offset.y;
    const wx = shooter.x + lx * cos - ly * sin;
    const wy = shooter.y + lx * sin + ly * cos;
    return { x: wx, y: wy };
  }

  private resolveMuzzleOffset(shooter: any, slotIndex: number, defaultOffset: { x: number; y: number }) {
    // Player
    if (shooter === this.ship) {
      const shipId = this.config.player?.shipId ?? this.config.ships.current;
      const def = this.config.ships.defs[shipId];
      const off = def?.combat?.slots?.[slotIndex]?.offset;
      if (off) return off;
    }
    // Enemy -> try enemy ship slots, fallback to player's layout
    const entry = this.targets.find(t => t.obj === shooter);
    const eShipId = entry?.shipId;
    if (eShipId) {
      const offE = this.config.ships.defs[eShipId]?.combat?.slots?.[slotIndex]?.offset;
      if (offE) return offE;
    }
    const offP = this.config.ships.defs[this.config.player?.shipId ?? this.config.ships.current]?.combat?.slots?.[slotIndex]?.offset;
    return offP ?? defaultOffset;
  }

  private autoFire(shooter: any, target: any) {
    if (!target || !target.active || !shooter || !shooter.active) return;
    const dx = target.x - shooter.x;
    const dy = target.y - shooter.y;
    const dist = Math.hypot(dx, dy);
    const times = this.getShooterTimes(shooter);
    const slotsArr = this.weaponSlots;
    for (let i = 0; i < slotsArr.length; i++) {
      const slotKey = slotsArr[i];
      const w = this.config.weapons.defs[slotKey];
      if (!w) continue;
      if (dist > w.range) continue;
      const now = this.scene.time.now;
      const cooldownMs = 1000 / Math.max(0.001, w.fireRatePerSec);
      const last = times[slotKey] ?? 0;
      if (now - last >= cooldownMs) {
        times[slotKey] = now;
        const muzzleOffset = this.resolveMuzzleOffset(shooter, i, w.muzzleOffset);
        const w2 = { ...w, muzzleOffset };
        this.fireWeapon(slotKey, w2, target, shooter);
      }
    }
  }

  private getShooterTimes(shooter: any): Record<string, number> {
    let times = this.lastFireTimesByShooter.get(shooter);
    if (!times) { times = {}; this.lastFireTimesByShooter.set(shooter, times); }
    return times;
  }

  private applyDamage(target: any, damage: number, attacker?: any) {
    const t = this.targets.find(tt => tt.obj === target);
    if (t) {
      t.hp -= damage;
      if (t.hp < 0) t.hp = 0;
      this.updateHpBar(t);
      this.floatDamageText(target.x, target.y - 70, damage);
      // Если атаковал игрок и цель — NPC, задаём временную конфронтацию к игроку
      if (attacker && attacker === this.ship) {
        (t as any).overrides = (t as any).overrides ?? {};
        (t as any).overrides.factions = (t as any).overrides.factions ?? {};
        (t as any).overrides.factions['player'] = 'confrontation';
      }
      if (t.hp <= 0) {
        // Полное удаление NPC: объект, HP элементы, имя, боевые кольца, назначения
        try { (t.obj as any).destroy?.(); } catch {}
        try { t.hpBarBg.destroy(); } catch {}
        try { t.hpBarFill.destroy(); } catch {}
        try { t.nameLabel?.destroy(); } catch {}
        // удалить боевое кольцо если было
        const ring = this.combatRings.get(target);
        if (ring) { try { ring.destroy(); } catch {} this.combatRings.delete(target); }
        // снять информационную цель при необходимости
        if (this.selectedTarget === target) this.clearSelection();
        // очистить назначения слотов на этот таргет и уведомить UI
        const removedSlots: string[] = [];
        for (const [slot, tgt] of this.playerWeaponTargets.entries()) {
          if (tgt === target) { this.playerWeaponTargets.delete(slot); removedSlots.push(slot); }
        }
        if (removedSlots.length) {
          try { this.scene.events.emit('player-weapon-target-cleared', target, removedSlots); } catch {}
        }
        // убираем из системы движения NPC
        this.npcMovement.unregisterNPC(target);
        // вычистить из массива целей
        this.targets = this.targets.filter(rec => rec.obj !== target);
        return;
      }
      return;
    }
    // if target is player
    if ((target as any) === (this.ship as any)) {
      const star = this.scene as any;
      if (star?.applyDamageToPlayer) {
        star.applyDamageToPlayer(damage);
      }
    }
  }

  private updateHpBar(t: { obj: any; hp: number; hpMax: number; hpBarBg: Phaser.GameObjects.Rectangle; hpBarFill: Phaser.GameObjects.Rectangle }) {
    const pct = Phaser.Math.Clamp(t.hp / Math.max(1, t.hpMax), 0, 1);
    const barW = 128;
    t.hpBarFill.width = barW * pct;
    const above = (this.getEffectiveRadius(t.obj as any) + 16);
    t.hpBarBg.setPosition(t.obj.x - barW/2, t.obj.y - above);
    t.hpBarFill.setPosition(t.obj.x - barW/2, t.obj.y - above);
    if (t.nameLabel) {
      t.nameLabel.setPosition(t.obj.x, t.hpBarBg.y - 4);
    }
  }

  private getEffectiveRadius(obj: any): number {
    if (typeof obj.displayWidth === 'number' && typeof obj.displayHeight === 'number') {
      return Math.max(obj.displayWidth, obj.displayHeight) * 0.5;
    }
    if (typeof obj.radius === 'number') return obj.radius;
    const w = (typeof obj.width === 'number' ? obj.width : 128);
    const h = (typeof obj.height === 'number' ? obj.height : 128);
    return Math.max(w, h) * 0.5;
  }

  private getRadarRangeFor(obj: any): number {
    const entry = this.targets.find(t => t.obj === obj);
    const shipId = entry?.shipId ?? (obj === this.ship ? (this.config.player?.shipId ?? this.config.ships.current) : undefined);
    const def = shipId ? this.config.ships.defs[shipId] : undefined;
    const overrideR = (entry as any)?.radarRange;
    if (typeof overrideR === 'number') return overrideR;
    const r = (def as any)?.sensors?.radar_range ?? def?.combat?.sensorRadius ?? 800;
    return r;
  }

  private getRelation(ofFaction: string | undefined, otherFaction: string | undefined, overrides?: Record<string, 'ally'|'neutral'|'confrontation'>): 'ally'|'neutral'|'confrontation' {
    if (!ofFaction || !otherFaction) return 'neutral';
    if (overrides && overrides[otherFaction]) return overrides[otherFaction];
    const rel = this.config.factions?.factions?.[ofFaction]?.relations?.[otherFaction];
    return rel ?? 'neutral';
  }

  private updateSensors(deltaMs: number) {
    for (const t of this.targets) {
      t.intent = null;
      const myFaction = t.faction;
      const radar = this.getRadarRangeFor(t.obj);
      const sensed: any[] = [];
      for (const o of this.targets) {
        if (o === t) continue;
        const objAny: any = o.obj;
        // пропускаем цели в состоянии докинга/дока
        const st = objAny?.__state;
        const invisible = (typeof objAny?.alpha === 'number' && objAny.alpha <= 0.05) || objAny?.visible === false;
        if (!objAny?.active) continue;
        if (st === 'docked' || st === 'docking') {
          // авто-сброс назначений игрока на цели, которые начинают док
          this.clearAssignmentsForTarget(objAny);
          continue;
        }
        if (invisible) continue;
        const d = Phaser.Math.Distance.Between(t.obj.x, t.obj.y, objAny.x, objAny.y);
        if (d <= radar) sensed.push(o);
      }
      const playerObj = this.ship as any;
      const dp = Phaser.Math.Distance.Between(t.obj.x, t.obj.y, playerObj.x, playerObj.y);
      const seesPlayer = dp <= radar;
      if (seesPlayer) sensed.push({ obj: playerObj, faction: 'player' });

      const profileKey = t.aiProfileKey;
      const profile = profileKey ? this.config.aiProfiles.profiles[profileKey] : undefined;
      const reactions = profile?.sensors?.react?.onFaction;
      let decided: { type: 'attack'|'flee'; target: any } | null = null;
      // prefer non-pirate targets first to avoid mutual pirate-pirate selection
      const sorted = sensed.sort((a,b) => (a.faction === 'pirate' ? 1 : 0) - (b.faction === 'pirate' ? 1 : 0));
      for (const s of sorted) {
        const rel = this.getRelation(myFaction, s.faction, t.overrides?.factions);
        const act = reactions?.[rel] ?? 'ignore';
        // пропускаем докованных целей
        if ((s.obj as any)?.__state === 'docked' || (s.obj as any)?.__state === 'docking') continue;
        if (act === 'attack') { decided = { type: 'attack', target: s.obj }; break; }
        if (act === 'flee') { decided = { type: 'flee', target: s.obj }; break; }
      }
      // If current intent target is invalid (docked/docking/inactive) — clear it
      const curIntent: any = (t as any).intent;
      const curTarget: any = curIntent?.target;
      if (curTarget && (!curTarget.active || curTarget.__state === 'docked' || curTarget.__state === 'docking')) {
        (t as any).intent = null;
      } else {
        (t as any).intent = decided;
      }
      // debug: pirates intents — только при изменении
      if (t.faction === 'pirate') {
        const lastType = (t as any).__lastIntentType;
        const lastObj = (t as any).__lastIntentObj;
        const changed = (!!decided?.type !== !!lastType) || (decided?.type !== lastType) || (decided?.target !== lastObj);
        if (decided && changed) {
          try { console.debug('[AI] Pirate intent', decided.type, 'to', decided.target?.x, decided.target?.y); } catch {}
        }
        (t as any).__lastIntentType = decided?.type;
        (t as any).__lastIntentObj = decided?.target ?? null;
      }

      if (!seesPlayer) {
        (t as any).overrides = (t as any).overrides ?? {};
        (t as any).overrides.factions = (t as any).overrides.factions ?? {};
        if ((t as any).overrides.factions['player'] === 'confrontation') {
          delete (t as any).overrides.factions['player'];
        }
      }
    }
  }

  private getAimedTargetPoint(shooter: any, target: any, w: any) {
    let accuracy = 1.0;
    const entry = this.targets.find(t => t.obj === shooter);
    if (shooter === this.ship) {
      const playerShipId = this.config.player?.shipId ?? this.config.ships.current;
      const shipDef = this.config.ships.defs[playerShipId];
      const a = shipDef?.combat?.accuracy;
      if (typeof a === 'number') accuracy = Phaser.Math.Clamp(a, 0, 1);
    } else if (entry) {
      const eShipId = entry.shipId ?? this.config.ships.current;
      const shipDef = this.config.ships.defs[eShipId];
      const a = shipDef?.combat?.accuracy;
      if (typeof a === 'number') accuracy = Phaser.Math.Clamp(a, 0, 1);
    }
    const prev = (target as any).__prevPos || { x: target.x, y: target.y };
    const dt = Math.max(1 / 60, this.scene.game.loop.delta / 1000);
    const vx = (target.x - prev.x) / dt;
    const vy = (target.y - prev.y) / dt;
    (target as any).__prevPos = { x: target.x, y: target.y };
    const projectileSpeed = w.projectileSpeed;
    const sx = shooter.x;
    const sy = shooter.y;
    const tx = target.x;
    const ty = target.y;
    const rx = tx - sx;
    const ry = ty - sy;
    const a2 = vx * vx + vy * vy - projectileSpeed * projectileSpeed;
    const b = 2 * (rx * vx + ry * vy);
    const c = rx * rx + ry * ry;
    let tHit: number;
    if (Math.abs(a2) < 1e-3) {
      tHit = c / Math.max(1, -b);
    } else {
      const disc = b * b - 4 * a2 * c;
      if (disc < 0) tHit = 0; else {
        const t1 = (-b - Math.sqrt(disc)) / (2 * a2);
        const t2 = (-b + Math.sqrt(disc)) / (2 * a2);
        tHit = Math.min(t1, t2);
        if (tHit < 0) tHit = Math.max(t1, t2);
        if (tHit < 0) tHit = 0;
      }
    }
    const leadX = tx + vx * tHit * accuracy;
    const leadY = ty + vy * tHit * accuracy;
    const aimX = Phaser.Math.Linear(tx, leadX, accuracy);
    const aimY = Phaser.Math.Linear(ty, leadY, accuracy);
    return { x: aimX, y: aimY };
  }

  private spawnHitEffect(x: number, y: number, w: any) {
    const colorNum = Number((w.hitEffect.color as string).replace('#', '0x'));
    const r = w.hitEffect.radius ?? 16;
    const g = this.scene.add.circle(x, y, r, colorNum, 0.6).setDepth(0.9);
    this.scene.tweens.add({ targets: g, alpha: 0, scale: 1.4, duration: w.hitEffect.durationMs ?? 200, onComplete: () => g.destroy() });
  }

  private floatDamageText(x: number, y: number, dmg: number) {
    const t = this.scene.add.text(x, y, `-${dmg}`, { color: '#f87171', fontSize: '16px' }).setOrigin(0.5).setDepth(1.2);
    this.scene.tweens.add({ targets: t, y: y - 24, alpha: 0, duration: 600, onComplete: () => t.destroy() });
  }

  private resolveDisplayName(t: { shipId?: string; obj: any }): string | null {
    const sid = t.shipId;
    if (sid && this.config.ships?.defs?.[sid]?.displayName) return this.config.ships.defs[sid].displayName;
    return null;
  }

  private refreshCombatRings() {
    const assigned = new Set<any>();
    for (const t of this.playerWeaponTargets.values()) if (t && (t as any).active) assigned.add(t);
    for (const [t, ring] of this.combatRings.entries()) {
      if (!assigned.has(t)) { ring.destroy(); this.combatRings.delete(t); }
    }
    for (const t of assigned.values()) {
      if (!this.combatRings.has(t)) {
        const base = this.getEffectiveRadius(t as any) + 5;
        const r = this.scene.add.circle((t as any).x, (t as any).y, base, 0xA93226, 0.12).setDepth(0.44);
        r.setStrokeStyle(2, 0xA93226, 1);
        this.combatRings.set(t, r);
      }
    }
  }
  private refreshCombatUIAssigned() {
    const assigned = new Set<any>();
    for (const t of this.playerWeaponTargets.values()) if (t && (t as any).active) assigned.add(t);
    for (const rec of this.targets) {
      const isAssigned = assigned.has(rec.obj);
      if (isAssigned) {
        rec.hpBarBg.setVisible(true);
        rec.hpBarFill.setVisible(true);
        if (!rec.nameLabel) {
          const name = this.resolveDisplayName(rec) || 'Unknown';
          rec.nameLabel = this.scene.add.text(0, 0, name, { color: '#ffffff', fontSize: '16px', fontFamily: 'HooskaiChamferedSquare' }).setOrigin(0.5, 1).setDepth(0.7);
        }
        // Боевой статус — можно оставить нейтральный цвет имени или выделить красным, оставлю нейтральный для читаемости
        rec.nameLabel.setVisible(true);
        this.updateHpBar(rec as any);
      } else {
        // не скрываем тут — clearSelection управляет инфоцелью; скрытие для невыбранных/небоевых оставляем как было
        // ничего
      }
    }
  }
  private clearAssignmentsForTarget(objAny: any) {
    const clearedSlots: string[] = [];
    for (const [slot, tgt] of Array.from(this.playerWeaponTargets.entries())) {
      if (tgt === objAny) { this.playerWeaponTargets.delete(slot); clearedSlots.push(slot); }
    }
    if (clearedSlots.length) {
      try { this.scene.events.emit('player-weapon-target-cleared', objAny, clearedSlots); } catch {}
      this.refreshCombatRings();
      this.refreshCombatUIAssigned();
    }
  }

  public forceCleanupInactiveTargets() {
    // вспомогательно: вызывается при необходимости, удаляет все неактивные объекты
    const removed: any[] = [];
    for (const rec of this.targets) {
      if (!rec.obj || !(rec.obj as any).active) {
        try { (rec.obj as any).destroy?.(); } catch {}
        try { rec.hpBarBg.destroy(); } catch {}
        try { rec.hpBarFill.destroy(); } catch {}
        try { rec.nameLabel?.destroy(); } catch {}
        removed.push(rec.obj);
      }
    }
    if (removed.length) {
      this.targets = this.targets.filter(rec => !removed.includes(rec.obj));
      removed.forEach(t => { const ring = this.combatRings.get(t); if (ring) { try { ring.destroy(); } catch {} this.combatRings.delete(t); } });
    }
  }
}


