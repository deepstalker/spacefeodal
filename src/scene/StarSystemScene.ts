import Phaser from 'phaser';
import { ConfigManager } from '@/sys/ConfigManager';
import { SaveManager } from '@/sys/SaveManager';
import { CameraManager } from '@/sys/CameraManager';
import { InputManager } from '@/sys/InputManager';
import { PathfindingManager } from '@/sys/PathfindingManager';
import { MovementManager } from '@/sys/MovementManager';
import { CombatManager } from '@/sys/CombatManager';
import { EnhancedFogOfWar } from '@/sys/fog-of-war/EnhancedFogOfWar';
import { PauseManager } from '@/sys/PauseManager';
import { TimeManager } from '@/sys/TimeManager';
// Тип не импортируем, чтобы не тянуть модуль на этап линтинга; используем any
import { MovementPriority } from '@/sys/NPCStateManager';
import { StarfieldRenderer } from '@/services/StarfieldRenderer';
import { SystemInitializer } from '@/services/SystemInitializer';
import { EncounterManager } from '@/services/EncounterManager';
import { PlanetOrbitManager } from '@/services/PlanetOrbitManager';
import { InputHandler } from '@/services/InputHandler';
import { NPCBehaviorManager } from '@/services/NPCBehaviorManager';
import { PathRenderService } from '@/services/PathRenderService';
import { GameUpdateManager } from '@/services/GameUpdateManager';
import { SystemLoaderService } from '@/services/SystemLoaderService';
import { IndicatorManager } from '@/sys/IndicatorManager';

export default class StarSystemScene extends Phaser.Scene {
  private config!: ConfigManager;
  private save!: SaveManager;
  private cameraMgr!: CameraManager;
  private inputMgr!: InputManager;
  private pathfinding!: PathfindingManager;
  private movement!: MovementManager;
  private combat!: CombatManager;
  private fogOfWar!: EnhancedFogOfWar;
  private pauseManager!: PauseManager;
  private timeManager!: TimeManager;
  private npcs: any[] = [];
  private starfieldRenderer!: StarfieldRenderer;
  private systemInitializer!: SystemInitializer;
  private encounterManager!: EncounterManager;
  private planetOrbitMgr!: PlanetOrbitManager;
  private inputHandler!: InputHandler;
  private npcBehaviorMgr!: NPCBehaviorManager;
  private pathRender!: PathRenderService;
  private updateMgr!: GameUpdateManager;
  private indicators!: IndicatorManager;
  
  // Состояние для удержания правой кнопки мыши
  private rightMouseHoldStart = 0;
  private isRightMouseDown = false;
  private rightMouseStartPos = { x: 0, y: 0 };
  private rightClickTargetNPC: any | null = null; // Захваченная цель при клике
  private lastPointerWorld?: { x: number; y: number };

  private ship!: Phaser.GameObjects.Image;
  private playerHp!: number;
  private playerHpMax!: number;
  private routeGraphics!: Phaser.GameObjects.Graphics;
  private clickMarker?: Phaser.GameObjects.Arc;
  private planets: { obj: Phaser.GameObjects.Image; data: any; label?: Phaser.GameObjects.Text }[] = [];
  private encounterMarkers: Array<{ id: string; name: string; x: number; y: number; typeId?: string; activationRange?: number; marker: Phaser.GameObjects.GameObject; label: Phaser.GameObjects.Text }>=[];
  private starfield?: Phaser.GameObjects.Graphics;
  private bgTile?: Phaser.GameObjects.TileSprite;
  private readonly bgParallax: number = 0.2;
  private aimLine?: Phaser.GameObjects.Graphics;
  private readonly orbitalSpeedScale: number = 0.1; // reduce planet speeds by ~90%
  // Менеджер симуляции NPC (ленивый спавн по квотам из конфигов)
  private npcSim?: any;


  constructor() {
    super('StarSystemScene');
  }

  async create() {
    this.config = new ConfigManager(this);
    await this.config.loadAll();
    const systemLoader = new SystemLoaderService(this, this.config);
    await systemLoader.loadCurrentSystem();

    this.save = new SaveManager(this, this.config);
    this.cameraMgr = new CameraManager(this, this.config, this.save);
    this.inputMgr = new InputManager(this, this.config);
    this.pathfinding = new PathfindingManager(this, this.config);
    this.movement = new MovementManager(this, this.config);
    this.combat = new CombatManager(this, this.config);
    this.fogOfWar = new EnhancedFogOfWar(this, this.config);
    this.indicators = new IndicatorManager(this, this.config);
    // Сообщаем менеджеру боя о менеджере индикаторов
    try { this.combat.setIndicatorManager(this.indicators); } catch {}
    
    // Инициализируем системы паузы и времени
    this.pauseManager = new PauseManager(this);
    this.timeManager = new TimeManager(this);
    this.timeManager.init();
    
    // Передаем PauseManager во все системы
    this.combat.setPauseManager(this.pauseManager);
    (this.combat as any).npcStateManager?.setPauseManager(this.pauseManager);
    this.movement.setPauseManager(this.pauseManager);
    // Передаем TimeManager в менеджер отношений
    try { (this.combat as any).relationOverrides?.setTimeManager?.(this.timeManager); } catch {}
    
    // Связываем паузу с тайм-менеджером
    this.events.on('game-paused', () => {
      this.timeManager.pause();
    });
    this.events.on('game-resumed', () => {
      this.timeManager.resume();
    });

    // Пополнение квот на старте каждого цикла и оповещение менеджеров
    try {
      const onCycleStart = (_e: any) => {
        try { this.npcSim?.replenishOnCycleStart?.(); } catch {}
        try { (this.combat as any)?.relationOverrides?.onCycleStart?.(); } catch {}
      };
      this.events.on('time-cycle_start', onCycleStart);
    } catch {}

    const system = this.config.system;
    const maxSize = 25000;
    const w = Math.min(system.size.width, maxSize);
    const h = Math.min(system.size.height, maxSize);
    this.cameras.main.setBounds(0, 0, w, h);

    // Фон и дополнительный starfield-слой
    this.starfieldRenderer = new StarfieldRenderer(this, this.config);
    await this.starfieldRenderer.init();

    // Initialize fog of war system
    this.fogOfWar.init();
    // Звезда, планеты и POI
    this.systemInitializer = new SystemInitializer(this, this.config, this.fogOfWar);
    this.systemInitializer.initStarAndStatics();
    this.systemInitializer.initPOI();
    this.systemInitializer.initPlanets();
    this.planets = this.systemInitializer.planets as any;
    this.encounterMarkers = this.systemInitializer.encounterMarkers as any;
    // Подключаем постоянные плашки для планет
    for (const p of this.planets) {
      try { this.indicators.attachPlanet(p.obj, p.data?.name ?? p.data?.id ?? 'Planet'); } catch {}
      try { p.label?.setVisible(false); } catch {}
    }
    // Stations manager
    const { SpaceStationManager } = await import('@/sys/SpaceStationManager');
    const stationMgr = new SpaceStationManager(this as any, this.config);
    stationMgr.init();
    // Fog of War disabled for now

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
    this.combat.setFogOfWar(this.fogOfWar);
    this.cameraMgr.setZoom((this.config.player?.start?.zoom ?? start.zoom) ?? 1);
    // Сделаем стартовое «выплывание» побыстрее для игрока
    try { this.movement.setInitialSpeedFraction(0.35); } catch {}
    
    // Set initial player position for fog of war
    this.fogOfWar.setPlayerPosition(this.ship.x, this.ship.y);

    // Энкаунтеры
    this.encounterManager = new EncounterManager(this, this.config);
    this.encounterManager.setPlayerShip(this.ship as any);
    this.encounterManager.attach(this.encounterMarkers as any);

    // Инициализация симуляции NPC (ленивый спавн по квотам) — после установки позиции игрока в FOW
    try {
      const { NPCLazySimulationManager } = await import('../sys/NPCLazySimulationManager');
      this.npcSim = new NPCLazySimulationManager(this as any, this.config, this.fogOfWar);
      this.npcSim.setPauseManager(this.pauseManager);
      this.npcSim.init();
    } catch {}
    
    // NPC спавн теперь полностью управляется NPCLazySimulationManager по квотам

    // Player HP
    this.playerHpMax = (selected as any)?.hull ?? 100;
    this.playerHp = this.playerHpMax;

    this.pathRender = new PathRenderService(this, this.movement, this.ship as any);
    this.pathRender.init();

    // Optional: if we had a tilemap and collision indices, here we would build a navmesh
    // Example (commented until tilemap exists):
    // const navMesh = (this as any).navMeshPlugin.buildFromTileLayer(tilemap, layer, { collisionIndices: [1], debug: { navMesh: false } });
    // this.pathfinding.setNavMesh(navMesh);

    // Врагов не спауним напрямую — они будут привязаны к энкаунтерам (POI)

    // Сообщаем другим сценам, что система готова (конфиги загружены, корабль создан)
    this.events.emit('system-ready', { 
      config: this.config, 
      ship: this.ship, 
      pauseManager: this.pauseManager, 
      timeManager: this.timeManager 
    });

    // Обработка ввода/ПКМ вынесена в сервис
    this.inputHandler = new InputHandler(this, this.config, this.movement, this.ship as any, this.findNPCAt.bind(this));
    this.inputHandler.init();
    this.combat.bindInput(this.inputMgr);

    // Действия высокого уровня через InputManager
    this.inputMgr.onAction('toggleFollow', () => {
      if (this.cameraMgr.isFollowing()) this.cameraMgr.disableFollow();
      else this.cameraMgr.enableFollow(this.ship);
    });
    this.inputMgr.onAction('pause', () => {
      this.pauseManager.togglePause();
    });
    this.inputMgr.onAction('zoomIn', () => {
      this.cameraMgr.zoomDelta(0.1);
    });
    this.inputMgr.onAction('zoomOut', () => {
      this.cameraMgr.zoomDelta(-0.1);
    });
    // Space: осмысленная атака дружественной цели — пометить временным врагом и открыть огонь
    this.inputMgr.onAction('attackSelected', () => {
      const cm: any = this.combat as any;
      const t = cm.getSelectedTarget?.();
      if (!t || t === this.ship) return;
      // централизованная пометка врагом
      cm.markTargetHostileToPlayer?.(t);
      // Назначение целей слотов делает HUD от этого же действия; здесь только страховка выделения
      cm.forceSelectTarget?.(t);
    });
    
    // Отладочная команда для проверки конфига паузы (Ctrl+Shift+D)
    const debugKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    debugKey?.on('down', (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey) {
        this.pauseManager.debugLogConfig();
      }
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

    // Регистрируем обновления через GameUpdateManager
    this.planetOrbitMgr = new PlanetOrbitManager(this, this.config, this.planets as any, this.orbitalSpeedScale);
    this.npcBehaviorMgr = new NPCBehaviorManager(this, this.config, this.npcs, this.combat as any);
    this.updateMgr = new GameUpdateManager(this, this.config, this.pauseManager);
    this.updateMgr.registerPausedAware('planetOrbits', (dt) => this.planetOrbitMgr.update(dt));
    this.updateMgr.registerPausedAware('indicatorsPlanets', () => this.indicators.updateAllPlanetBadges(this.planets as any));
    this.updateMgr.registerPausedAware('combat', () => this.pathRender.updateAimLine());
    this.updateMgr.registerPausedAware('encounters', () => this.encounterManager.update());
    this.updateMgr.registerPausedAware('npcStateManager', (dt) => this.npcBehaviorMgr.updateTraders(dt));
    this.updateMgr.registerPausedAware('npcMovementManager', (dt) => this.npcBehaviorMgr.updatePatrol(dt));
    this.updateMgr.registerPausedAware('fogOfWar', (dt) => {
      if (this.ship && this.fogOfWar) {
        this.fogOfWar.setPlayerPosition(this.ship.x, this.ship.y);
        try { this.fogOfWar.update(dt); } catch {}
      }
    });
    this.updateMgr.init();

    // Test pirate spawns removed — use encounters or stations to introduce pirates
  }

  public applyDamageToPlayer(amount: number) {
    this.playerHp = Math.max(0, this.playerHp - amount);
    this.events.emit('player-damaged', this.playerHp);
    // Плавающий урон над игроком
    try {
      const ui = this.scene.get('UIScene') as any;
      const sceneAny: any = this;
      const t = this.add.text(this.ship.x, this.ship.y - 70, `-${amount}`, { color: '#f87171', fontSize: '24px' }).setOrigin(0.5).setDepth(2.0);
      this.tweens.add({ targets: t, y: this.ship.y - 100, alpha: 0, duration: 700, ease: 'Sine.easeOut', onComplete: () => t.destroy() });
    } catch {}
    if (this.playerHp <= 0) {
      this.gameOver();
    }
  }

  public getPauseManager(): PauseManager {
    return this.pauseManager;
  }

  public getTimeManager(): TimeManager {
    return this.timeManager;
  }

  private gameOver() {
    const ui = this.scene.get('UIScene') as any;
    if (ui?.showGameOver) {
      ui.showGameOver();
    }
  }

  private drawPath(_points: Phaser.Math.Vector2[]) {}

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
      
      // Обновляем позицию метки
      if (pl.label) {
        pl.label.setPosition(px, py - 180);
      }
      
      // проксируем текущие координаты планет обратно в конфиг (для миникарты)
      const confPlanet = (sys.planets as Array<any>).find((q: any) => q.id === pl.data.id) as any;
      if (confPlanet) { confPlanet._x = px; confPlanet._y = py; }
    }
  }

  private drawAimLine() {}

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
          // NPC спавн управляется симулятором; здесь только визуальные/POI эффекты
        }
        // remove from list
        this.encounterMarkers = this.encounterMarkers.filter(m => m !== e);
        break;
      }
    }
  }

  private getPlanetWorldPosById(id: string): { x: number; y: number } | null {
    const rec = this.planets.find(p => (p as any).data?.id === id);
    if (rec && rec.obj) return { x: rec.obj.x, y: rec.obj.y };
    // fallback to config proxy values
    const sys: any = this.config?.system;
    const confPlanet = (sys?.planets as any[])?.find((p: any) => p.id === id);
    if (confPlanet) {
      const x = confPlanet._x ?? (sys.star.x + confPlanet.orbit.radius);
      const y = confPlanet._y ?? sys.star.y;
      return { x, y };
    }
    return null;
  }

  private updatePatrolNPCs(deltaMs: number) {
    const dt = deltaMs / 1000;
    const sys = this.config?.system as any;
    if (!sys || !Array.isArray(sys.planets)) return;
    for (const o of this.npcs) {
      if ((o as any).__behavior !== 'patrol') continue;
      // Skip patrol steering if combat intent exists (CombatManager handles it)
      const cm: any = (this as any).combat;
      const entry = cm?.targets?.find((t: any) => t.obj === o);
      if (entry && entry.intent) {
        // Если цель недействительна (докнулась/умерла), сбросить патрульную точку для выбора новой
        const intent = entry.intent;
        if (intent?.type === 'attack') {
          const tgt = intent.target;
          if (!tgt?.active || (tgt as any).__state === 'docked') {
            (o as any).__targetPatrol = null;
          }
        }
        continue;
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
      if ((target as any)._isPoint) { 
        tx = (target as any).x; 
        ty = (target as any).y; 
      } else if ((target as any)._isPlanet) {
        const pos = this.getPlanetWorldPosById((target as any).id);
        if (pos) {
          tx = pos.x;
          ty = pos.y;
        }
      }
      
      // Проверяем, не заблокировано ли движение более приоритетной задачей
      const canMove = cm.npcStateManager?.addMovementCommand(
        o, 'move_to', 
        { x: tx, y: ty }, 
        undefined, 
        MovementPriority.PATROL, 
        'scene_patrol'
      );
      
      // Применяем команду только если она была принята системой приоритетов
      if (canMove !== false) {
        cm.npcMovement.setNPCMode(o, 'move_to');
        cm.npcMovement.setNPCTarget(o, { x: tx, y: ty });
      }

      const dist = Math.hypot(tx - o.x, ty - o.y);
      if (dist < 160) {
        (o as any).__targetPatrol = null;
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
      // orbital_trade: простой цикл по случайным планетам
      const behavior = (o as any).__behavior;
      if (behavior !== 'planet_trader' && behavior !== 'orbital_trade') continue;
      // If trader has combat intent (e.g., flee), let CombatManager drive movement to avoid double-speed
      const cmAny: any = (this as any).combat;
      const cmEntry = cmAny?.targets?.find((t: any) => t.obj === o);
      if (cmEntry && cmEntry.intent) continue;

      let target = (o as any).__targetPlanet;
      if (!target) { 
        (o as any).__targetPlanet = this.pickRandomPlanet(); 
        target = (o as any).__targetPlanet; 
      }
      const confPlanet = (sys.planets as any[]).find(p => p.id === target.id) as any;
      
      if (!confPlanet) {
        (o as any).__targetPlanet = this.pickRandomPlanet();
        continue;
      }
      
      const planetPos = this.getPlanetWorldPosById(target.id) ?? { x: confPlanet?._x, y: confPlanet?._y };
      
      const state = (o as any).__state ?? 'travel';
      if (state === 'travel') {
        const planetRec = this.planets.find(p => (p as any).data?.id === target.id);
        
        // Проверяем приоритеты для торговой команды
        const canMove = cmAny.npcStateManager?.addMovementCommand(
          o, 'move_to', 
          { x: planetPos.x, y: planetPos.y, targetObject: planetRec?.obj }, 
          undefined, 
          MovementPriority.TRADE, 
          'scene_trader'
        );
        
        // Применяем команду только если она была принята
        if (canMove !== false) {
          cmAny.npcMovement.setNPCTarget(o, { x: planetPos.x, y: planetPos.y, targetObject: planetRec?.obj });
        }
        
        const dist = Math.hypot(planetPos.x - o.x, planetPos.y - o.y);
        const dockRange = (target as any).dockRange ?? this.config.gameplay.dock_range ?? 220;
        
        if (dist < dockRange) {
          (o as any).__state = 'docking';
          // Сбрасываем любые боевые назначения на этот объект
          try { (cmAny as any).clearAssignmentsForTarget?.(o); } catch {}

          // Анимация «посадки» и немедленный деспаун по завершении
          const dur = 1200;
          const bsx = (o as any).__baseScaleX ?? o.scaleX ?? 1;
          const bsy = (o as any).__baseScaleY ?? o.scaleY ?? 1;
          this.tweens.add({
            targets: o,
            x: planetPos.x,
            y: planetPos.y,
            scaleX: bsx * 0.2,
            scaleY: bsy * 0.2,
            alpha: 0,
            duration: dur,
            ease: 'Sine.easeInOut',
            onComplete: () => {
              (o as any).__state = 'docked';
              // Удаляем NPC из системы (торговец «приземлился» и исчез)
              try { (this.combat as any).despawnNPC?.(o, 'docked'); } catch {}
            }
          });
        }
      } else if (state === 'docking' || state === 'docked' || state === 'undocking') {
        continue;
      }
    }
  }

  // Централизованное создание NPC — см. NPCLazySimulationManager

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

  private drawStarfield() {}

  private updateBackground() {
    if (!this.bgTile) return;
    const cam = this.cameras.main;
    this.bgTile.tilePositionX = -cam.scrollX * this.bgParallax;
    this.bgTile.tilePositionY = -cam.scrollY * this.bgParallax;
  }

  private getUIScene(): any {
    return this.scene.get('UIScene');
  }

  private findNPCAt(worldX: number, worldY: number): any {
    for (const npc of this.npcs) {
      if (!npc.active) continue;
      const st = (npc as any).__state;
      if (st === 'docking' || st === 'docked' || st === 'undocking') continue;
      if (typeof (npc as any).alpha === 'number' && (npc as any).alpha <= 0.05) continue;

      // Используем displayWidth/Height, так как они учитывают scale объекта.
      const radius = Math.max(npc.displayWidth, npc.displayHeight) * 0.5 + 15; // +15 пикселей для удобства.
      
      const distance = Math.hypot(npc.x - worldX, npc.y - worldY);
      if (distance <= radius) {
        return npc;
      }
    }
    
    return null;
  }

  private setupMouseControls() {}

  private executeSimpleMoveTo(_worldX: number, _worldY: number) {}

  private executeMovementCommand(_item: any, _worldX: number, _worldY: number, _capturedTarget: any | null) {}
}


