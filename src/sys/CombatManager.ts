import type { ConfigManager } from './ConfigManager';

type Target = Phaser.GameObjects.GameObject & { x: number; y: number; active: boolean };

export class CombatManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private ship!: Phaser.GameObjects.Image;
  private selectedTarget: Target | null = null;
  private selectionCircle?: Phaser.GameObjects.Arc;
  private selectionBaseRadius = 70;
  private selectionPulsePhase = 0;
  private lastFireTimesByShooter: WeakMap<any, Record<string, number>> = new WeakMap();
  private weaponSlots: string[] = ['laser', 'cannon', 'missile'];
  private targets: Array<{
    obj: Phaser.GameObjects.GameObject & { x: number; y: number; active: boolean; rotation?: number };
    hp: number; hpMax: number;
    hpBarBg: Phaser.GameObjects.Rectangle; hpBarFill: Phaser.GameObjects.Rectangle;
    ai?: { preferRange: number; retreatHpPct: number; type: 'ship' | 'static'; speed: number; disposition?: 'neutral' | 'enemy' | 'ally'; behavior?: string };
    weaponSlots?: string[];
    shipId?: string;
    faction?: string;
    combatAI?: string;
    aiProfileKey?: string;
    intent?: { type: 'attack' | 'flee'; target: any } | null;
    overrides?: { factions?: Record<string, 'ally'|'neutral'|'confrontation'> };
  }>=[];

  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
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
    const profile = this.config.aiProfiles.profiles[aiProfileName] ?? { behavior: 'static', startDisposition: 'neutral' } as any;
    const ai = { preferRange: 0, retreatHpPct: profile.combat?.retreatHpPct ?? 0, type: 'ship', disposition: profile.startDisposition ?? 'neutral', behavior: profile.behavior } as any;
    const entry: any = { obj, hp: ship.hull ?? 100, hpMax: ship.hull ?? 100, hpBarBg: bg, hpBarFill: fill, ai, shipId: prefab?.shipId ?? shipDefId, faction: prefab?.faction, combatAI: prefab?.combatAI, aiProfileKey: aiProfileName, intent: null };
    if (prefab?.weapons && Array.isArray(prefab.weapons)) entry.weaponSlots = prefab.weapons.slice(0);
    this.targets.push(entry);
    return obj as Target;
  }

  // enemies-by-config removed — use spawnNPCPrefab with stardwellers prefabs

  bindInput(inputMgr: any) {
    inputMgr.onLeftClick((wx: number, wy: number) => {
      const hit = this.targets.find(t => {
        const rad = this.getEffectiveRadius(t.obj as any);
        return Phaser.Math.Distance.Between(t.obj.x, t.obj.y, wx, wy) <= rad;
      });
      if (hit) this.selectTarget(hit.obj as any);
      else this.clearSelection();
    });
  }

  private selectTarget(target: Target) {
    this.selectedTarget = target;
    const base = this.getEffectiveRadius(target as any) + 5;
    this.selectionBaseRadius = base;
    if (!this.selectionCircle) {
      this.selectionCircle = this.scene.add.circle(target.x, target.y, base, 0xff0000, 0.15).setDepth(0.45);
      this.selectionCircle.setStrokeStyle(2, 0xff4d4d, 1);
    } else {
      this.selectionCircle.setPosition(target.x, target.y).setVisible(true);
      this.selectionCircle.setRadius(base);
    }
    // toggle HP bars visibility
    for (const t of this.targets) {
      const vis = t.obj === target;
      t.hpBarBg.setVisible(vis);
      t.hpBarFill.setVisible(vis);
      this.updateHpBar(t);
    }
  }

  private clearSelection() {
    this.selectedTarget = null;
    this.selectionCircle?.setVisible(false);
    // hide all HP bars
    for (const t of this.targets) { t.hpBarBg.setVisible(false); t.hpBarFill.setVisible(false); }
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

    // player auto fire at selected target — use player's equipped weapons
    if (this.selectedTarget && (this.selectedTarget as any).active) {
      const saved = this.weaponSlots;
      const playerSlots = this.config.player?.weapons;
      if (playerSlots && playerSlots.length) this.weaponSlots = playerSlots;
      this.autoFire(this.ship, this.selectedTarget as any);
      this.weaponSlots = saved;
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
  }

  private updateEnemiesAI(deltaMs: number) {
    const dt = deltaMs / 1000;
    for (const t of this.targets) {
      if (!t.ai || t.ai.type !== 'ship') continue;
      // If no combat intent and behavior isn't aggressive — let regular logic handle
      if ((!t.intent || t.intent.type === undefined) && t.ai.behavior && t.ai.behavior !== 'aggressive') continue;
      const obj: any = t.obj;
      const retreat = ((): number => {
        if (t.combatAI) {
          const cp = this.config.combatAI?.profiles?.[t.combatAI];
          if (cp && typeof cp.retreatHpPct === 'number') return cp.retreatHpPct;
        }
        return t.ai.retreatHpPct ?? 0;
      })();
      const noseOffsetRad = (obj.__noseOffsetRad ?? 0) as number;
      const targetObj = (t.intent && t.intent.type === 'attack') ? t.intent.target : this.ship;
      const fleeObj = (t.intent && t.intent.type === 'flee') ? t.intent.target : null;
      const dx = (fleeObj ? (obj.x - fleeObj.x) : (targetObj.x - obj.x));
      const dy = (fleeObj ? (obj.y - fleeObj.y) : (targetObj.y - obj.y));
      const dist = Math.hypot(dx, dy);
      let desired = 0; // -1 retreat, 0 hold, 1 approach
      if (t.hp / t.hpMax <= retreat) desired = -1;
      else desired = 1; // approach by default

      // steer towards/away, constant turn rate and speed
      const turnSpeed = 1.6; // rad/s
      let heading = (obj.rotation ?? 0) - noseOffsetRad;
      const desiredAngle = Math.atan2(dy, dx) + (desired < 0 ? 0 : 0); // dx,dy already flipped for flee
      let diff = desiredAngle - heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turn = Math.sign(diff) * Math.min(Math.abs(diff), turnSpeed * dt);
      heading += turn;
      obj.rotation = heading + noseOffsetRad;
      const baseSpeed = (typeof t.ai.speed === 'number' ? t.ai.speed : 140);
      const speed = (desired !== 0) ? baseSpeed : 0;
      obj.x += Math.cos(heading) * speed * dt;
      obj.y += Math.sin(heading) * speed * dt;
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

    const lifetimeMs = (w.range / speed) * 1000 + 50;
    const onUpdate = (_t: number, dt: number) => {
      (proj as any).x += vx * (dt/1000);
      (proj as any).y += vy * (dt/1000);
      // collision simple distance check
      if (!target.active) return;
      const hitDist = this.getEffectiveRadius(target as any);
      const d = Phaser.Math.Distance.Between((proj as any).x, (proj as any).y, target.x, target.y);
      if (d <= hitDist) {
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
        target.destroy();
        t.hpBarBg.destroy();
        t.hpBarFill.destroy();
        if (this.selectedTarget === target) this.clearSelection();
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
        const d = Phaser.Math.Distance.Between(t.obj.x, t.obj.y, o.obj.x, o.obj.y);
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
      for (const s of sensed) {
        const rel = this.getRelation(myFaction, s.faction, t.overrides?.factions);
        const act = reactions?.[rel] ?? 'ignore';
        if (act === 'attack') { decided = { type: 'attack', target: s.obj }; break; }
        if (act === 'flee') { decided = { type: 'flee', target: s.obj }; break; }
      }
      t.intent = decided;

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
}


