import Phaser from 'phaser';
import { ConfigManager } from '@/sys/ConfigManager';
import { SaveManager } from '@/sys/SaveManager';
import { CameraManager } from '@/sys/CameraManager';
import { InputManager } from '@/sys/InputManager';
import { PathfindingManager } from '@/sys/PathfindingManager';
import { MovementManager } from '@/sys/MovementManager';
import { CombatManager } from '@/sys/CombatManager';
import { FogOfWar } from '@/sys/FogOfWar';

export default class StarSystemScene extends Phaser.Scene {
  private config!: ConfigManager;
  private save!: SaveManager;
  private cameraMgr!: CameraManager;
  private inputMgr!: InputManager;
  private pathfinding!: PathfindingManager;
  private movement!: MovementManager;
  private combat!: CombatManager;
  private npcs: any[] = [];

  private ship!: Phaser.GameObjects.Image;
  private playerHp!: number;
  private playerHpMax!: number;
  private routeGraphics!: Phaser.GameObjects.Graphics;
  private clickMarker?: Phaser.GameObjects.Arc;
  private planets: { obj: Phaser.GameObjects.Image; data: any }[] = [];
  private encounterMarkers: Array<{ id: string; name: string; x: number; y: number; typeId?: string; activationRange?: number; marker: Phaser.GameObjects.GameObject; label: Phaser.GameObjects.Text }>=[];
  private starfield?: Phaser.GameObjects.Graphics;
  private bgTile?: Phaser.GameObjects.TileSprite;
  private readonly bgParallax: number = 0.2;
  private aimLine?: Phaser.GameObjects.Graphics;
  private readonly orbitalSpeedScale: number = 0.1; // reduce planet speeds by ~90%
  // private fog!: FogOfWar; // FOW disabled for now

  constructor() {
    super('StarSystemScene');
  }

  async create() {
    this.config = new ConfigManager(this);
    await this.config.loadAll();

    // Определяем текущую систему: статичная или процедурная
    const systemsIndex = (this.cache.json.get('systems_index') as any) ?? await fetch('/configs/systems.json').then(r=>r.json());
    const systemProfiles = (this.cache.json.get('system_profiles') as any) ?? await fetch('/configs/system_profiles.json').then(r=>r.json());
    const stored = (()=>{ try { return localStorage.getItem('sf_selectedSystem'); } catch { return null; } })();
    const currentId = stored || systemsIndex.current;
    const sysDef = systemsIndex.defs[currentId];
    if (sysDef?.type === 'procedural') {
      const { generateSystem } = await import('@/sys/SystemGenerator');
      const profile = systemProfiles.profiles[sysDef.profile ?? 'default'];
      this.config.system = generateSystem(profile);
    } else if (sysDef?.type === 'static' && sysDef.configPath) {
      // Загрузим указанный статики конфиг
      this.config.system = await fetch(sysDef.configPath).then(r => r.json());
    }

    this.save = new SaveManager(this, this.config);
    this.cameraMgr = new CameraManager(this, this.config, this.save);
    this.inputMgr = new InputManager(this, this.config);
    this.pathfinding = new PathfindingManager(this, this.config);
    this.movement = new MovementManager(this, this.config);
    this.combat = new CombatManager(this, this.config);

    const system = this.config.system;
    const maxSize = 25000;
    const w = Math.min(system.size.width, maxSize);
    const h = Math.min(system.size.height, maxSize);
    this.cameras.main.setBounds(0, 0, w, h);

    // Use BackgroundTiler with new texture
    const { BackgroundTiler } = await import('@/sys/BackgroundTiler');
    // Back stars layer (farther): lower parallax
    try { this.textures.get('bg_stars1').setFilter(Phaser.Textures.FilterMode.LINEAR); } catch {}
    const stars = new BackgroundTiler(this, 'bg_stars1', -30, 0.6, 1.0, Phaser.BlendModes.SCREEN);
    stars.init(system.size.width, system.size.height);
    // Nebula layer on top of stars: stronger parallax
    const bgKey = this.textures.exists('bg_nebula_blue') ? 'bg_nebula_blue' : 'bg_nebula1';
    try { this.textures.get(bgKey).setFilter(Phaser.Textures.FilterMode.LINEAR); } catch {}
    const nebula = new BackgroundTiler(this, bgKey, -25, 0.8, 0.8, Phaser.BlendModes.SCREEN);
    nebula.init(system.size.width, system.size.height);
    this.events.on(Phaser.Scenes.Events.UPDATE, () => { stars.update(); nebula.update(); });
    // Optional extra starfield
    this.starfield = this.add.graphics().setDepth(-15);
    this.drawStarfield();

    // Parallax update and resize handling
    this.events.on(Phaser.Scenes.Events.UPDATE, this.updateBackground, this);
    this.scale.on('resize', (gameSize: any) => {
      if (this.bgTile) {
        this.bgTile.width = gameSize.width;
        this.bgTile.height = gameSize.height;
      }
    });

    // Star placeholder
    this.add.circle(system.star.x, system.star.y, 80, 0xffcc00).setDepth(0);
    // Draw encounters (POI). Интерпретируем координаты как относительные к центру звезды
    for (const e of system.poi as any[]) {
      const ex = system.star.x + (e.x ?? 0);
      const ey = system.star.y + (e.y ?? 0);
      const q = this.add.circle(ex, ey, 24, 0x999999, 0.4).setDepth(0.5);
      const t = this.add.text(ex, ey, '?', { color: '#ffffff', fontSize: '24px', fontStyle: 'bold' }).setOrigin(0.5).setDepth(0.6);
      const typesArr = (this.config.systemProfiles as any)?.profiles?.default?.encounters?.types as Array<any> | undefined;
      const type = typesArr?.find((k: any)=>k.name === e.name);
      const activationRange = (type && typeof type.activation_range === 'number') ? type.activation_range : 400;
      this.encounterMarkers.push({ id: e.id, name: e.name, x: ex, y: ey, typeId: type?.id, activationRange, marker: q, label: t });
    }

    // Planets as sprites (will rotate)
    for (let i = 0; i < system.planets.length; i++) {
      const p = system.planets[i];
      const key = `planet_${(i % 10).toString().padStart(2,'0')}`;
      const c = this.add.image(
        system.star.x + p.orbit.radius,
        system.star.y,
        key
      ).setDepth(0);
      c.setDisplaySize(512, 512).setOrigin(0.5);
      this.planets.push({ obj: c, data: { ...p, angleDeg: 0 } });
    }
    // Fog of War disabled for now

    // Spawn NPCs from system config
    const dwellers = (system as any).npcs as Array<any> | undefined;
    if (Array.isArray(dwellers)) {
      for (const d of dwellers) {
        if (d.x != null && d.y != null) {
          // explicit coordinates
          const npc = (this.combat as any).spawnNPCPrefab(d.prefab, d.x, d.y) as any;
          if (npc) {
            const pref = this.config.stardwellers?.prefabs?.[d.prefab];
            (npc as any).__behavior = this.config.aiProfiles.profiles?.[pref?.aiProfile]?.behavior ?? 'planet_trader';
            (npc as any).__targetPlanet = this.pickNearestPlanet(npc.x, npc.y) ?? this.pickRandomPlanet();
            (npc as any).__state = 'travel';
            (npc as any).setAlpha?.(1);
            this.npcs.push(npc);
            const sx = (npc as any).scaleX ?? 1;
            const sy = (npc as any).scaleY ?? 1;
            this.tweens.add({ targets: npc, scaleX: { from: sx * 0.6, to: sx }, scaleY: { from: sy * 0.6, to: sy }, duration: 250, ease: 'Sine.easeOut' });
          }
        } else if (d.planetId) {
          const planet = system.planets.find(p => p.id === d.planetId);
          if (!planet) continue;
          const px = (planet as any)._x ?? (system.star.x + planet.orbit.radius);
          const py = (planet as any)._y ?? system.star.y;
          const dockRange = this.config.gameplay.dock_range ?? 220;
          const offset = dockRange + 300;
          const ang = Math.random() * Math.PI * 2;
          const npc = (this.combat as any).spawnNPCPrefab(d.prefab, px + Math.cos(ang)*offset, py + Math.sin(ang)*offset) as any;
          if (npc) {
            const pref = this.config.stardwellers?.prefabs?.[d.prefab];
            (npc as any).__behavior = this.config.aiProfiles.profiles?.[pref?.aiProfile]?.behavior ?? 'planet_trader';
            (npc as any).__targetPlanet = planet;
            (npc as any).__state = 'travel';
            (npc as any).setAlpha?.(1);
            this.npcs.push(npc);
            const sx2 = (npc as any).scaleX ?? 1;
            const sy2 = (npc as any).scaleY ?? 1;
            this.tweens.add({ targets: npc, scaleX: { from: sx2 * 0.6, to: sx2 }, scaleY: { from: sy2 * 0.6, to: sy2 }, duration: 250, ease: 'Sine.easeOut' });
          }
        }
      }
    }

    // Ensure at least one trader near the star in every system
    const nearX = system.star.x + 300;
    const nearY = system.star.y - 180;
    const near = (this.combat as any).spawnNPCPrefab('trader', nearX, nearY) as any;
    if (near) {
      const pref = this.config.stardwellers?.prefabs?.['trader'];
      (near as any).__behavior = this.config.aiProfiles.profiles?.[pref?.aiProfile]?.behavior ?? 'planet_trader';
      (near as any).__targetPlanet = this.pickRandomPlanet();
      (near as any).__state = 'travel';
      (near as any).setAlpha?.(1);
      this.npcs.push(near);
      const nsx = (near as any).scaleX ?? 1;
      const nsy = (near as any).scaleY ?? 1;
      this.tweens.add({ targets: near, scaleX: { from: nsx * 0.6, to: nsx }, scaleY: { from: nsy * 0.6, to: nsy }, duration: 250, ease: 'Sine.easeOut' });
    }

    // Ship sprite (256x128)
    const fallbackStart = { x: system.star.x + 300, y: system.star.y, headingDeg: 0, zoom: 1 };
    const cfgStart = this.config.player?.start ?? {} as any;
    const start = this.save.getLastPlayerState() ?? {
      x: cfgStart.x ?? fallbackStart.x,
      y: cfgStart.y ?? fallbackStart.y,
      headingDeg: cfgStart.headingDeg ?? fallbackStart.headingDeg,
      zoom: cfgStart.zoom ?? fallbackStart.zoom
    };
    const selectedId = this.config.player?.shipId ?? this.config.ships.current;
    const selected = this.config.ships.defs[selectedId];
    const s = selected?.sprite;
    const fallbackKey = this.textures.exists('ship_alpha') ? 'ship_alpha' : 'ship_alpha_public';
    const keyToUse = (s?.key && this.textures.exists(s.key)) ? s.key : fallbackKey;
    this.ship = this.add.image(start.x, start.y, keyToUse) as any;
    const ox = s?.origin?.x ?? 0.5;
    const oy = s?.origin?.y ?? 0.5;
    this.ship.setOrigin(ox, oy);
    const dw = s?.displaySize?.width ?? 64;
    const dh = s?.displaySize?.height ?? 128;
    this.ship.setDisplaySize(dw, dh);
    this.ship.setDepth(1);
    const noseOffsetRad = Phaser.Math.DegToRad(s?.noseOffsetDeg ?? 0);
    this.ship.setRotation(Phaser.Math.DegToRad(start.headingDeg) + noseOffsetRad);

    this.cameraMgr.enableFollow(this.ship);
    this.combat.attachShip(this.ship);
    this.cameraMgr.setZoom((this.config.player?.start?.zoom ?? start.zoom) ?? 1);

    // Player HP
    this.playerHpMax = (selected as any)?.hull ?? 100;
    this.playerHp = this.playerHpMax;

    this.routeGraphics = this.add.graphics({ lineStyle: { width: 2, color: 0x4dd2ff, alpha: 0.85 } }).setDepth(0.5);
    this.aimLine = this.add.graphics({}).setDepth(0.6);

    // Optional: if we had a tilemap and collision indices, here we would build a navmesh
    // Example (commented until tilemap exists):
    // const navMesh = (this as any).navMeshPlugin.buildFromTileLayer(tilemap, layer, { collisionIndices: [1], debug: { navMesh: false } });
    // this.pathfinding.setNavMesh(navMesh);

    // Врагов не спауним напрямую — они будут привязаны к энкаунтерам (POI)

    // Сообщаем другим сценам, что система готова (конфиги загружены, корабль создан)
    this.events.emit('system-ready', { config: this.config, ship: this.ship });

    const onSelect = async (worldX: number, worldY: number) => {
      // Показать маркер клика
      if (!this.clickMarker) {
        // Маркер цели под кораблём
        this.clickMarker = this.add.circle(worldX, worldY, 10, 0x00ff88).setDepth(0.55).setAlpha(0.7);
      } else {
        this.clickMarker.setPosition(worldX, worldY).setVisible(true);
      }
      // Строим сценарный план тем же алгоритмом, что и исполнитель, чтобы не было расхождений
      this.movement.followPath(this.ship as any, { points: [ new Phaser.Math.Vector2(worldX, worldY) ] } as any);
      this.drawAimLine();
    };
    this.inputMgr.onRightClick(onSelect);
    this.combat.bindInput(this.inputMgr);
    // Только правая кнопка ставит цель

    // Toggle follow camera (F)
    const followKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    followKey?.on('down', () => {
      if (this.cameraMgr.isFollowing()) this.cameraMgr.disableFollow();
      else this.cameraMgr.enableFollow(this.ship);
    });

    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      const cam = this.cameras ? this.cameras.main : undefined;
      this.save.setLastPlayerState({
        x: this.ship?.x ?? 0,
        y: this.ship?.y ?? 0,
        headingDeg: Phaser.Math.RadToDeg(this.ship?.rotation ?? 0),
        zoom: cam?.zoom ?? 1
      });
      this.save.flush();
    });

    this.events.on(Phaser.Scenes.Events.UPDATE, this.updateSystem, this);
    this.events.on(Phaser.Scenes.Events.UPDATE, () => this.drawAimLine());
    this.events.on(Phaser.Scenes.Events.UPDATE, () => this.updateEncounters());
    this.events.on(Phaser.Scenes.Events.UPDATE, (_t:number, dt: number) => this.updateNPCs(dt));
  }

  public applyDamageToPlayer(amount: number) {
    this.playerHp = Math.max(0, this.playerHp - amount);
    this.events.emit('player-damaged', this.playerHp);
    if (this.playerHp <= 0) {
      this.gameOver();
    }
  }

  private gameOver() {
    const ui = this.scene.get('UIScene') as any;
    if (ui?.showGameOver) {
      ui.showGameOver();
    }
  }

  private drawPath(points: Phaser.Math.Vector2[]) {
    this.routeGraphics.clear();
    if (points.length === 0) return;
    this.routeGraphics.beginPath();
    this.routeGraphics.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      this.routeGraphics.lineTo(points[i].x, points[i].y);
    }
    this.routeGraphics.strokePath();
    // рисуем стрелку направления в конце
    const n = points.length;
    if (n >= 2) {
      const a = points[n - 2];
      const b = points[n - 1];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const ah = 14;
      const left = new Phaser.Math.Vector2(b.x - Math.cos(ang) * ah + Math.cos(ang + Math.PI / 2) * (ah * 0.5), b.y - Math.sin(ang) * ah + Math.sin(ang + Math.PI / 2) * (ah * 0.5));
      const right = new Phaser.Math.Vector2(b.x - Math.cos(ang) * ah + Math.cos(ang - Math.PI / 2) * (ah * 0.5), b.y - Math.sin(ang) * ah + Math.sin(ang - Math.PI / 2) * (ah * 0.5));
      this.routeGraphics.fillStyle(0x4dd2ff, 0.9);
      this.routeGraphics.fillTriangle(b.x, b.y, left.x, left.y, right.x, right.y);
    }
  }

  private updateSystem(_time: number, delta: number) {
    // Update planets along circular orbits (безопасные проверки при переключении сцен/систем)
    const sys = this.config?.system as any;
    if (!sys || !sys.star || !sys.planets) return;
    const dt = delta / 1000;
    for (const pl of this.planets) {
      pl.data.angleDeg = (pl.data.angleDeg + pl.data.orbit.angularSpeedDegPerSec * dt * this.orbitalSpeedScale) % 360;
      const rad = Phaser.Math.DegToRad(pl.data.angleDeg);
      const px = sys.star.x + Math.cos(rad) * pl.data.orbit.radius;
      const py = sys.star.y + Math.sin(rad) * pl.data.orbit.radius;
      pl.obj.x = px;
      pl.obj.y = py;
      // проксируем текущие координаты планет обратно в конфиг (для миникарты)
      const confPlanet = (sys.planets as Array<any>).find((q: any) => q.id === pl.data.id) as any;
      if (confPlanet) { confPlanet._x = px; confPlanet._y = py; }
    }
  }

  private drawAimLine() {
    if (!this.aimLine) return;
    this.aimLine.clear();
    const target = this.movement.getTarget();
    if (!target) return;
    this.aimLine.lineStyle(2, 0xffffff, 0.2);
    this.aimLine.beginPath();
    this.aimLine.moveTo(this.ship.x, this.ship.y);
    this.aimLine.lineTo(target.x, target.y);
    this.aimLine.strokePath();
    // target circle
    this.aimLine.lineStyle(2, 0xffffff, 1);
    this.aimLine.strokeCircle(target.x, target.y, 8);
    this.aimLine.fillStyle(0xff6464, 1);
    this.aimLine.fillCircle(target.x, target.y, 8);
    this.aimLine.lineStyle(2, 0xffffff, 1);
    this.aimLine.strokeCircle(target.x, target.y, 8);
  }

  private updateEncounters() {
    const ship = this.ship;
    if (!ship) return;
    for (const e of this.encounterMarkers) {
      const d = Math.hypot(e.x - ship.x, e.y - ship.y);
      if (d <= (e.activationRange ?? 400)) {
        // Activate encounter: show banner and remove marker
        this.showEncounterBanner(e.name);
        e.marker.destroy();
        e.label.destroy();
        // spawn by type
        if (e.typeId === 'lost_treasure') {
          this.add.rectangle(e.x, e.y, 48, 48, 0xffe066).setDepth(0.4);
        } else if (e.typeId === 'pirates') {
          // spawn 3 hostile ships
          const ids = ['hostile_ship','hostile_ship','hostile_ship'];
          const offs = [[0,0],[40,20],[-40,-20]];
          ids.forEach((id, idx)=> this.combat.spawnEnemyFromConfig(id, e.x + offs[idx][0], e.y + offs[idx][1]));
        }
        // remove from list
        this.encounterMarkers = this.encounterMarkers.filter(m => m !== e);
        break;
      }
    }
  }

  private showEncounterBanner(name: string) {
    const w = this.scale.width;
    const h = this.scale.height;
    const banner = this.add.text(w/2, h/2, `Вы нашли: ${name}`, { color: '#ffffff', fontSize: '28px', fontStyle: 'bold' }).setOrigin(0.5).setScrollFactor(0).setDepth(5000);
    this.tweens.add({ targets: banner, alpha: 0, duration: 2200, ease: 'Sine.easeIn', onComplete: () => banner.destroy() });
  }

  private updateNPCs(deltaMs: number) {
    const dt = deltaMs / 1000;
    const sys = this.config?.system as any;
    if (!sys || !Array.isArray(sys.planets) || !this.ship) return;
    for (const o of this.npcs) {
      if ((o as any).__behavior !== 'planet_trader') continue;
      const noseOffsetRad = (o as any).__noseOffsetRad ?? 0;
      let target = (o as any).__targetPlanet;
      if (!target) { (o as any).__targetPlanet = this.pickRandomPlanet(); target = (o as any).__targetPlanet; }
      const confPlanet = (sys.planets as any[]).find(p => p.id === target.id) as any;
      const tx = (confPlanet?._x ?? (sys.star.x + target.orbit.radius));
      const ty = (confPlanet?._y ?? sys.star.y);
      const dx = tx - o.x;
      const dy = ty - o.y;
      const dist = Math.hypot(dx, dy);
      const dockRange = this.config.gameplay.dock_range ?? 220;

      const state = (o as any).__state ?? 'travel';
      if (state === 'travel') {
        // Travel towards planet center
        const desiredHeading = Math.atan2(dy, dx);
        let heading = (o.rotation ?? 0) - noseOffsetRad;
        let diff = desiredHeading - heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const turn = Math.sign(diff) * Math.min(Math.abs(diff), 1.3 * dt);
        heading += turn;
        o.rotation = heading + noseOffsetRad;
        const speed = 120;
        o.x += Math.cos(heading) * speed * dt;
        o.y += Math.sin(heading) * speed * dt;
        if (dist < dockRange) {
          // Start docking
          (o as any).__state = 'docking';
          const dur = 3000 + Math.random() * 1000;
          const bsx = (o as any).__baseScaleX ?? o.scaleX ?? 1;
          const bsy = (o as any).__baseScaleY ?? o.scaleY ?? 1;
          this.tweens.add({ targets: o, x: tx, y: ty, scaleX: bsx * 0.2, scaleY: bsy * 0.2, alpha: 0, duration: dur, ease: 'Sine.easeInOut', onComplete: () => {
            (o as any).__state = 'docked';
            // undock after random dwell
            this.time.delayedCall(10000 + Math.random() * 50000, () => {
              if (!o.active) return;
              // pick new planet
              const planets = (sys.planets as Array<any>).filter((p: any) => p.id !== target.id);
              (o as any).__targetPlanet = planets[Math.floor(Math.random() * planets.length)];
              (o as any).__state = 'undocking';
              const ang = Math.random() * Math.PI * 2;
              this.tweens.add({ targets: o, x: tx + Math.cos(ang) * 200, y: ty + Math.sin(ang) * 200, scaleX: bsx, scaleY: bsy, alpha: 1, duration: dur, ease: 'Sine.easeInOut', onComplete: () => {
                (o as any).__state = 'travel';
              }});
            });
          }});
        }
      } else if (state === 'docking' || state === 'docked' || state === 'undocking') {
        // tween-controlled; no manual movement
        continue;
      }
    }
  }

  private spawnPlanetTrader(x: number, y: number) {
    // synthetic enemy-def like object
    const def = { shipId: 'trader', weapons: [], aiProfile: 'planet_trader' } as any;
    // Temporarily inject into enemies table to reuse spawn
    const id = `npc_trader_${Math.floor(Math.random()*1e6)}`;
    (this.config.enemies.defs as any)[id] = def;
    const npc = (this.combat as any).spawnEnemyFromConfig(id, x, y) as any;
    delete (this.config.enemies.defs as any)[id];
    if (npc) {
      (npc as any).__behavior = 'planet_trader';
      (npc as any).__targetPlanet = this.pickNearestPlanet(x, y) ?? this.pickRandomPlanet();
      (npc as any).__orbitUntil = 0;
      (npc as any).__state = 'travel';
      this.npcs.push(npc);
    }
  }

  private pickRandomPlanet() {
    const system = this.config.system;
    const idx = Math.floor(Math.random() * system.planets.length);
    return system.planets[idx];
  }

  private pickNearestPlanet(x: number, y: number) {
    const sys = this.config.system;
    let best: any = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const p of sys.planets as any[]) {
      const px = p._x ?? (sys.star.x + p.orbit.radius);
      const py = p._y ?? sys.star.y;
      const d = Math.hypot(px - x, py - y);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best ?? null;
  }

  // navmesh удалён — работаем только с кинематическим планированием

  private drawStarfield() {
    const g = this.starfield!;
    g.clear();
    const sys = this.config.system;
    const count = 600;
    g.fillStyle(0xffffff, 0.3);
    for (let i = 0; i < count; i++) {
      const x = Math.random() * sys.size.width;
      const y = Math.random() * sys.size.height;
      const r = Math.random() * 1.5 + 0.2;
      g.fillCircle(x, y, r);
    }
  }

  private updateBackground() {
    if (!this.bgTile) return;
    const cam = this.cameras.main;
    this.bgTile.tilePositionX = -cam.scrollX * this.bgParallax;
    this.bgTile.tilePositionY = -cam.scrollY * this.bgParallax;
  }
}


