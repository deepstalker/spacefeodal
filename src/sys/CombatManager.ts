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
  private targets: Array<{ obj: Phaser.GameObjects.GameObject & { x: number; y: number; active: boolean; rotation?: number }; hp: number; hpMax: number; hpBarBg: Phaser.GameObjects.Rectangle; hpBarFill: Phaser.GameObjects.Rectangle; ai?: { preferRange: number; retreatHpPct: number; type: 'ship' | 'static'; speed: number; disposition?: 'neutral' | 'enemy' | 'ally' }; weaponSlots?: string[]; shipId?: string }>=[];

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

  spawnEnemyFromConfig(enemyId: string, worldX: number, worldY: number) {
    const def = this.config.enemies.defs[enemyId];
    if (!def) return null;
    const ship = this.config.ships.defs[def.shipId] ?? this.config.ships.defs[this.config.ships.current];
    let obj: any;
    const s = ship.sprite;
    obj = this.scene.add.image(worldX, worldY, s.key).setDepth(0.4);
    obj.setOrigin(s.origin?.x ?? 0.5, s.origin?.y ?? 0.5);
    obj.setDisplaySize(s.displaySize?.width ?? 64, s.displaySize?.height ?? 128);
    obj.setRotation(Phaser.Math.DegToRad(s.noseOffsetDeg ?? 0));
    (obj as any).__noseOffsetRad = Phaser.Math.DegToRad(s.noseOffsetDeg ?? 0);
    const barW = 128;
    const above = (Math.max(obj.displayWidth, obj.displayHeight) * 0.5) + 16;
    const bg = this.scene.add.rectangle(obj.x - barW/2, obj.y - above, barW, 8, 0x111827).setOrigin(0, 0.5).setDepth(0.5);
    const fill = this.scene.add.rectangle(obj.x - barW/2, obj.y - above, barW, 8, 0x22c55e).setOrigin(0, 0.5).setDepth(0.6);
    bg.setVisible(false); fill.setVisible(false);
    const profile = this.config.aiProfiles.profiles[def.aiProfile] ?? { preferRange: 0, retreatHpPct: 0, speed: 0 } as any;
    const ai = { preferRange: profile.preferRange, retreatHpPct: profile.retreatHpPct, type: 'ship', speed: profile.speed ?? 0, disposition: profile.disposition ?? 'neutral', behavior: profile.behavior } as any;
    const entry: any = { obj, hp: ship.hull ?? 100, hpMax: ship.hull ?? 100, hpBarBg: bg, hpBarFill: fill, ai, shipId: def.shipId, behavior: profile.behavior };
    if (def.weapons && Array.isArray(def.weapons)) entry.weaponSlots = def.weapons.slice(0);
    this.targets.push(entry);
    return obj as Target;
  }

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
    // simple AI move for enemies marked as ship
    this.updateEnemiesAI(deltaMs);

    // player auto fire at selected target — use player's equipped weapons
    if (this.selectedTarget && (this.selectedTarget as any).active) {
      const saved = this.weaponSlots;
      const playerSlots = this.config.player?.weapons;
      if (playerSlots && playerSlots.length) this.weaponSlots = playerSlots;
      this.autoFire(this.ship, this.selectedTarget as any);
      this.weaponSlots = saved;
    }
    // enemies auto fire at player (use per-enemy weapons if set), only if disposition is 'enemy'
    for (const t of this.targets) {
      if (!t.ai || t.ai.disposition !== 'enemy') continue;
      const saved = this.weaponSlots;
      const slots = (t as any).weaponSlots as string[] | undefined;
      if (slots && slots.length) this.weaponSlots = slots;
      this.autoFire(t.obj as any, this.ship);
      this.weaponSlots = saved;
    }
  }

  private updateEnemiesAI(deltaMs: number) {
    const dt = deltaMs / 1000;
    const player = this.ship;
    for (const t of this.targets) {
      if (!t.ai || t.ai.type !== 'ship') continue;
      const obj: any = t.obj;
      const prefer = t.ai.preferRange;
      const retreat = t.ai.retreatHpPct;
      const noseOffsetRad = (obj.__noseOffsetRad ?? 0) as number;
      const dx = player.x - obj.x;
      const dy = player.y - obj.y;
      const dist = Math.hypot(dx, dy);
      let desired = 0; // -1 retreat, 0 hold, 1 approach
      if (t.hp / t.hpMax <= retreat) desired = -1;
      else if (dist > prefer * 1.10) desired = 1; // too far — approach
      else if (dist < prefer * 0.60) desired = -1; // way too close — back off
      else desired = 0; // hold band

      // steer towards/away, constant turn rate and speed
      const turnSpeed = 1.6; // rad/s
      let heading = (obj.rotation ?? 0) - noseOffsetRad;
      const desiredAngle = Math.atan2(dy, dx) + (desired < 0 ? Math.PI : 0);
      let diff = desiredAngle - heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turn = Math.sign(diff) * Math.min(Math.abs(diff), turnSpeed * dt);
      heading += turn;
      obj.rotation = heading + noseOffsetRad;
      const speed = (desired !== 0) ? t.ai.speed : 0;
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

  private getAimedTargetPoint(shooter: any, target: any, w: any) {
    // accuracy: 0..1; 1 = perfect leading, 0 = no prediction
    let accuracy = 1.0;
    // if shooter is an AI enemy with accuracy in config
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
    // Estimate target velocity per frame (store prev pos)
    const prev = (target as any).__prevPos || { x: target.x, y: target.y };
    const dt = Math.max(1 / 60, this.scene.game.loop.delta / 1000);
    const vx = (target.x - prev.x) / dt;
    const vy = (target.y - prev.y) / dt;
    (target as any).__prevPos = { x: target.x, y: target.y };
    const projectileSpeed = w.projectileSpeed;
    // Solve time to intercept assuming straight-line target velocity
    const sx = shooter.x;
    const sy = shooter.y;
    const tx = target.x;
    const ty = target.y;
    const rx = tx - sx;
    const ry = ty - sy;
    const a = vx * vx + vy * vy - projectileSpeed * projectileSpeed;
    const b = 2 * (rx * vx + ry * vy);
    const c = rx * rx + ry * ry;
    let t: number;
    if (Math.abs(a) < 1e-3) {
      t = c / Math.max(1, -b);
    } else {
      const disc = b * b - 4 * a * c;
      if (disc < 0) t = 0;
      else {
        const t1 = (-b - Math.sqrt(disc)) / (2 * a);
        const t2 = (-b + Math.sqrt(disc)) / (2 * a);
        t = Math.min(t1, t2);
        if (t < 0) t = Math.max(t1, t2);
        if (t < 0) t = 0;
      }
    }
    const leadX = tx + vx * t * accuracy;
    const leadY = ty + vy * t * accuracy;
    // Blend by accuracy: 0 -> current target; 1 -> full lead
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


