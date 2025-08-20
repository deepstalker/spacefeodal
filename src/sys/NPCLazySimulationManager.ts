import type { ConfigManager, SystemConfig } from './ConfigManager';
import type { EnhancedFogOfWar } from './fog-of-war/EnhancedFogOfWar';
import { DynamicObjectType } from './fog-of-war/types';

type HomeRef = { type: 'planet' | 'station' | 'unknown'; id?: string; x: number; y: number };

type PendingNPC = {
  id: string;
  prefab: string;
  home: HomeRef;
  spawnAt: { x: number; y: number };
  created: boolean;
};

export class NPCLazySimulationManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private fog: EnhancedFogOfWar;
  private pending: PendingNPC[] = [];
  private replenishTimer?: Phaser.Time.TimerEvent;
  private pauseManager?: any;

  constructor(scene: Phaser.Scene, config: ConfigManager, fog: EnhancedFogOfWar) {
    this.scene = scene;
    this.config = config;
    this.fog = fog;
  }

  setPauseManager(pauseManager: any) {
    this.pauseManager = pauseManager;
  }

  init() {
    const sys = this.config.system as SystemConfig;
    const gp = this.config.gameplay;
    const sim = gp?.simulation ?? {} as any;
    const systemSize = Math.max(sys.size.width, sys.size.height);
    const initialRadiusPct = sim.initialSpawnRadiusPct ?? 0.25;
    const radius = systemSize * initialRadiusPct;

    // Планеты с квотами
    for (const p of sys.planets as any[]) {
      const quotas: Record<string, number> | undefined = p.spawn?.quotas;
      if (!quotas) continue;
      const px = (p as any)._x ?? (sys.star.x + p.orbit.radius);
      const py = (p as any)._y ?? sys.star.y;
      this.enqueueFromQuotas(quotas, { type: 'planet', id: p.id, x: px, y: py }, radius, `planet:${p.id}`);
    }

    // Станции с квотами
    for (const s of (sys.stations ?? []) as any[]) {
      const quotas: Record<string, number> | undefined = s.spawn?.quotas;
      if (!quotas) continue;
      const sid = s.id ?? `${s.type}_${Math.floor(s.x)}_${Math.floor(s.y)}`;
      this.enqueueFromQuotas(quotas, { type: 'station', id: sid, x: s.x, y: s.y }, radius, `station:${sid}`);
    }

    // Подписка на апдейт: проверяем ленивый спавн, когда игрок подлетает
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);

    // Плановое пополнение каждые X минут
    const checkInterval = sim.replenish?.checkIntervalMs ?? 240000; // 4 мин
    if (checkInterval > 0) {
      this.replenishTimer = this.scene.time.addEvent({ delay: checkInterval, loop: true, callback: this.scheduleReplenish, callbackScope: this });
    }
  }

  destroy() {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.update, this);
    if (this.replenishTimer) this.replenishTimer.remove(false);
    this.pending.length = 0;
  }

  private enqueueFromQuotas(quotas: Record<string, number>, home: HomeRef, radius: number, keyPrefix: string) {
    const sys = this.config.system;
    const systemSize = Math.max(sys.size.width, sys.size.height);
    for (const [prefab, count] of Object.entries(quotas)) {
      for (let i = 0; i < (count ?? 0); i++) {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * radius;
        const x = home.x + Math.cos(ang) * r;
        const y = home.y + Math.sin(ang) * r;
        const id = `${keyPrefix}:${prefab}:${i}`;
        const spawnAt = { x: this.clamp(x, 0, sys.size.width), y: this.clamp(y, 0, sys.size.height) };
        this.pending.push({ id, prefab, home, spawnAt, created: false });
        // Debug logging disabled
        // try { console.log('[NPCSim] pending created', { id, prefab, home, spawnAt }); } catch {}
      }
    }
  }

  private clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

  private update() {
    // Проверяем конфиг паузы
    if (this.pauseManager?.isSystemPausable('npcLazySimulation') && this.pauseManager?.getPaused()) {
      return;
    }
    
    if (!this.pending.length) return;
    const player = this.fog.getPlayerPosition();
    const sys = this.config.system;
    const gp = this.config.gameplay;
    const sim = gp?.simulation ?? {} as any;
    const bufPct = sim.lazySpawnRadarBufferPct ?? 0.05;
    const buffer = Math.max(sys.size.width, sys.size.height) * bufPct;
    const radar = this.fog.getRadarRange();
    const threshold = radar + buffer;

    // Ленивая инициализация: создаём только те, чьи стартовые координаты входят в радиус
    for (const p of this.pending) {
      if (p.created) continue;
      const d = Math.hypot(p.spawnAt.x - player.x, p.spawnAt.y - player.y);
      if (d <= threshold) {
        // Проверяем, можем ли мы спаунить этого NPC, не превышая квоты
        if (this.canSpawnForHomeAndPrefab(p.home, p.prefab, p.id)) {
          // Плавное появление, если точка спавна в радиусе радара игрока
          this.createNPC(p, { fadeIfInRadar: true });
        }
      }
    }
  }

  /**
   * Проверяет, можно ли спаунить NPC для конкретного дома и префаба, не превышая квоты
   */
  private canSpawnForHomeAndPrefab(home: HomeRef, prefab: string, pendingId: string): boolean {
    // Получаем текущие активные NPC
    const npcs: any[] = ((this.scene as any).npcs ?? []).filter((o: any) => o?.active);
    
    // Подсчитываем активных NPC с тем же домом и префабом
    let count = 0;
    for (const o of npcs) {
      const hr = (o as any).__homeRef as HomeRef | undefined;
      const npcPrefab = (o as any).__prefabKey ?? 'unknown';
      
      // Проверяем совпадение дома
      const homeId = hr?.id ?? `${hr?.type ?? 'unknown'}_${Math.floor(hr?.x ?? 0)}_${Math.floor(hr?.y ?? 0)}`;
      const thisHomeId = home.id ?? `${home.type}_${Math.floor(home.x)}_${Math.floor(home.y)}`;
      
      if (homeId === thisHomeId && npcPrefab === prefab) {
        count++;
      }
    }
    
    // Получаем квоту для этого дома и префаба
    const sys = this.config.system as SystemConfig;
    let quota = 0;
    
    if (home.type === 'planet' && home.id) {
      const planet = (sys.planets as any[]).find(p => p.id === home.id);
      quota = planet?.spawn?.quotas?.[prefab] ?? 0;
    } else if (home.type === 'station') {
      const station = (sys.stations ?? []).find(s => {
        const sid = (s as any).id ?? `${(s as any).type}_${Math.floor((s as any).x)}_${Math.floor((s as any).y)}`;
        return sid === home.id;
      });
      quota = (station as any)?.spawn?.quotas?.[prefab] ?? 0;
    }
    
    // Также учитываем других ожидающих NPC с тем же домом и префабом
    for (const p of this.pending) {
      if (p.created || p.id === pendingId) continue;
      
      const pHomeId = p.home.id ?? `${p.home.type}_${Math.floor(p.home.x)}_${Math.floor(p.home.y)}`;
      const thisHomeId = home.id ?? `${home.type}_${Math.floor(home.x)}_${Math.floor(home.y)}`;
      
      if (pHomeId === thisHomeId && p.prefab === prefab) {
        count++;
      }
    }
    
    // Можно спаунить, если текущее количество меньше квоты
    return count < quota;
  }

  private createNPC(p: PendingNPC, opts?: { fadeIfInRadar?: boolean }) {
    // Защита от двойного вызова (например, при ранее запланированной задаче и одновременном попадании в радиус)
    if (p.created) return;
    const cm: any = (this.scene as any).combat;
    if (!cm?.spawnNPCPrefab) return;
    const npc = cm.spawnNPCPrefab(p.prefab, p.spawnAt.x, p.spawnAt.y) as any;
    if (!npc) return;
    (npc as any).__homeRef = p.home; // сохраняем источник (порт приписки)
    
    // Убедимся, что массив npcs существует и является массивом перед добавлением
    if (!(this.scene as any).npcs) {
      (this.scene as any).npcs = [];
    }
    
    const npcsArray = (this.scene as any).npcs;
    if (Array.isArray(npcsArray)) {
      npcsArray.push(npc);
    }
    
    this.fog.registerDynamicObject(npc, DynamicObjectType.NPC);
    // Установим поведение на объект согласно aiProfile префаба
    const pref = this.config.stardwellers?.prefabs?.[p.prefab];
    const aiKey = pref?.aiProfile;
    const aiBehavior = aiKey ? this.config.aiProfiles?.profiles?.[aiKey]?.behavior : undefined;
    // Поведение по умолчанию: для торговцев 'orbital_trade', для пиратов 'patrol'
    const behavior = aiBehavior ?? (p.prefab === 'pirate' ? 'patrol' : 'orbital_trade');
    (npc as any).__behavior = behavior;
    if (behavior === 'planet_trader') {
      const sys = this.config.system;
      // целевая планета — порт приписки если указан, иначе ближайшая к точке спавна
      let targetPlanet: any = null;
      if (p.home.type === 'planet' && p.home.id) {
        targetPlanet = (sys.planets as any[]).find(pl => pl.id === p.home.id) ?? null;
      }
      if (!targetPlanet) {
        let best: any = null; let bestD = Number.POSITIVE_INFINITY;
        for (const pl of (sys.planets as any[])) {
          const px = (pl as any)._x ?? (sys.star.x + pl.orbit.radius);
          const py = (pl as any)._y ?? sys.star.y;
          const d = Math.hypot(px - p.spawnAt.x, py - p.spawnAt.y);
          if (d < bestD) { bestD = d; best = pl; }
        }
        targetPlanet = best;
      }
      (npc as any).__targetPlanet = targetPlanet;
      (npc as any).__state = 'travel';
    } else if (behavior === 'patrol') {
      (npc as any).__targetPatrol = null;
    }
    // Страховка: проставим профиль ИИ в боевой системе (поведение/retreatHpPct)
    try { if (aiKey) cm.setAIProfileFor?.(npc, aiKey); } catch {}
    p.created = true;

    // Плавное появление при спавне в радиусе радара игрока по событию цикла
    if (opts?.fadeIfInRadar && this.fog && typeof (npc as any).setAlpha === 'function') {
      try {
        const player = this.fog.getPlayerPosition();
        const radar = this.fog.getRadarRange();
        const dist = Math.hypot(p.spawnAt.x - player.x, p.spawnAt.y - player.y);
        if (dist <= radar) {
          // Начинаем с прозрачности и плавно показываем
          (npc as any).setAlpha(0);
          // Отключаем вмешательство FOW в альфу на время ручного fade, чтобы исключить мерцание
          try { this.fog.unregisterObject(npc); } catch {}
          this.scene.tweens.add({ 
            targets: npc, 
            alpha: 1, 
            duration: 2400, 
            ease: 'Sine.easeOut',
            onComplete: () => {
              // После окончания плавного появления — снова регистрируем в FOW
              try { this.fog.registerDynamicObject(npc, DynamicObjectType.NPC); } catch {}
            }
          });
          // Стартовая скорость 75% от MAX_SPEED, чтобы "выплывал" из невидимости
          try { (cm as any).npcMovement?.setInitialSpeedFraction?.(npc, 0.75); } catch {}

          // Немедленно задать цель движения, чтобы объект не стоял на месте во время проявления
          try {
            const behavior = (npc as any).__behavior as string | undefined;
            const sys = this.config.system;
            if (behavior === 'planet_trader') {
              const pl = (npc as any).__targetPlanet;
              if (pl) {
                const px = (pl as any)._x ?? (sys.star.x + pl.orbit.radius);
                const py = (pl as any)._y ?? sys.star.y;
                (cm as any).npcMovement?.setNPCTarget?.(npc, { x: px, y: py });
              }
            } else if (behavior === 'patrol') {
              const ang = Math.random() * Math.PI * 2;
              const r = 200 + Math.random() * 200;
              const tx = this.clamp(p.spawnAt.x + Math.cos(ang) * r, 0, sys.size.width);
              const ty = this.clamp(p.spawnAt.y + Math.sin(ang) * r, 0, sys.size.height);
              (cm as any).npcMovement?.setNPCTarget?.(npc, { x: tx, y: ty });
            }
          } catch {}
        }
      } catch {}
    }
    // Debug logging disabled
    // try { console.log('[NPCSim] npc created', { id: p.id, prefab: p.prefab, at: p.spawnAt, home: p.home }); } catch {}
  }

  public scheduleReplenish() {
    // Проверяем текущие активные NPC и досоздаём недостающих по квотам из конфигов
    const gp = this.config.gameplay;
    const sim = gp?.simulation ?? {} as any;
    const delayMin = sim.replenish?.spawnDelayMsRange?.min ?? 5000;
    const delayMax = sim.replenish?.spawnDelayMsRange?.max ?? 45000;

    // Карта активных по (prefab, home.id)
    const active: Record<string, number> = {};
    const npcs: any[] = ((this.scene as any).npcs ?? []).filter((o: any) => o?.active);
    for (const o of npcs) {
      const hr = (o as any).__homeRef as HomeRef | undefined;
      const prefab = (o as any).__prefabKey ?? 'unknown';
      const homeId = hr?.id ?? `${hr?.type ?? 'unknown'}_${Math.floor(hr?.x ?? 0)}_${Math.floor(hr?.y ?? 0)}`;
      const key = `${prefab}__${homeId}`;
      active[key] = (active[key] ?? 0) + 1;
    }
    // Учтём отложенные (pending) по тем же ключам
    const pendingCounts: Record<string, number> = {};
    for (const p of this.pending) {
      if (p.created) continue;
      const homeId = p.home.id ?? `${p.home.type}_${Math.floor(p.home.x)}_${Math.floor(p.home.y)}`;
      const key = `${p.prefab}__${homeId}`;
      pendingCounts[key] = (pendingCounts[key] ?? 0) + 1;
    }

    // Целевые квоты из конфигов систем (планеты/станции)
    const entries = this.listQuotaEntries();

    let totalScheduled = 0;
    for (const e of entries) {
      const key = `${e.prefab}__${e.home.id}`;
      const have = (active[key] ?? 0) + (pendingCounts[key] ?? 0);
      const deficit = Math.max(0, e.count - have);
      for (let i = 0; i < deficit; i++) {
        // создаём разово отложенную заявку
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * (Math.max(this.config.system.size.width, this.config.system.size.height) * (this.config.gameplay?.simulation?.initialSpawnRadiusPct ?? 0.25));
        const x = e.home.x + Math.cos(ang) * r;
        const y = e.home.y + Math.sin(ang) * r;
        const p: PendingNPC = { id: `${e.home.id}:${e.prefab}:repl:${Date.now()}:${i}`, prefab: e.prefab, home: e.home, spawnAt: { x: this.clamp(x, 0, this.config.system.size.width), y: this.clamp(y, 0, this.config.system.size.height) }, created: false };
        const delay = delayMin + Math.random() * (delayMax - delayMin);
        totalScheduled++;
        // Сохраняем только как pending. Фактический спавн произойдёт лениво в update(), когда игрок будет в радиусе.
        // Для сохранения «раскатанного» эффекта — добавляем в очередь с задержкой.
        this.scene.time.delayedCall(delay, () => { this.pending.push(p); });
      }
    }
    // Debug logging disabled
    // try { if (totalScheduled > 0) console.log('[NPCSim] replenish complete', { totalScheduled }); } catch {}
  }

  /**
   * Немедленное пополнение квот в начале нового цикла
   * Спавнит недостающих с минимальной задержкой, чтобы создать эффект "взлёта с началом цикла".
   */
  public replenishOnCycleStart() {
    const entries = this.listQuotaEntries();
    const npcs: any[] = ((this.scene as any).npcs ?? []).filter((o: any) => o?.active);
    const active: Record<string, number> = {};
    for (const o of npcs) {
      const hr = (o as any).__homeRef as HomeRef | undefined;
      const prefab = (o as any).__prefabKey ?? 'unknown';
      const homeId = hr?.id ?? `${hr?.type ?? 'unknown'}_${Math.floor(hr?.x ?? 0)}_${Math.floor(hr?.y ?? 0)}`;
      const key = `${prefab}__${homeId}`;
      active[key] = (active[key] ?? 0) + 1;
    }
    let scheduled = 0;
    // Учёт pending как «запланированных» к обработке
    const pendingCounts: Record<string, number> = {};
    for (const p of this.pending) {
      if (p.created) continue;
      const homeId = p.home.id ?? `${p.home.type}_${Math.floor(p.home.x)}_${Math.floor(p.home.y)}`;
      const key = `${p.prefab}__${homeId}`;
      pendingCounts[key] = (pendingCounts[key] ?? 0) + 1;
    }

    for (const e of entries) {
      const key = `${e.prefab}__${e.home.id}`;
      const have = (active[key] ?? 0) + (pendingCounts[key] ?? 0);
      const deficit = Math.max(0, e.count - have);
      for (let i = 0; i < deficit; i++) {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * (Math.max(this.config.system.size.width, this.config.system.size.height) * (this.config.gameplay?.simulation?.initialSpawnRadiusPct ?? 0.25));
        const x = e.home.x + Math.cos(ang) * r;
        const y = e.home.y + Math.sin(ang) * r;
        const p: PendingNPC = { id: `${e.home.id}:${e.prefab}:cycle:${Date.now()}:${i}` , prefab: e.prefab, home: e.home, spawnAt: { x: this.clamp(x, 0, this.config.system.size.width), y: this.clamp(y, 0, this.config.system.size.height) }, created: false };
        const delay = Math.random() * 1000; // до 1 секунды для живости
        scheduled++;
        // Только добавляем в pending с небольшой задержкой для визуальной натуральности старта цикла.
        this.scene.time.delayedCall(delay, () => { this.pending.push(p); });
      }
    }
    // Debug logging disabled
    // try { if (scheduled > 0) console.log('[NPCSim] cycle replenish scheduled', { scheduled }); } catch {}
  }

  private canSpawnForHomeAndPrefab(home: HomeRef, prefab: string, excludePendingId?: string): boolean {
    const entries = this.listQuotaEntries();
    const target = entries.find(e => e.home.id === (home.id ?? `${home.type}_${Math.floor(home.x)}_${Math.floor(home.y)}`) && e.prefab === prefab);
    if (!target) return true; // нет квоты — не ограничиваем
    const key = `${prefab}__${home.id ?? `${home.type}_${Math.floor(home.x)}_${Math.floor(home.y)}`}`;
    let have = 0;
    const npcs: any[] = ((this.scene as any).npcs ?? []).filter((o: any) => o?.active);
    for (const o of npcs) {
      const hr = (o as any).__homeRef as HomeRef | undefined;
      const pf = (o as any).__prefabKey ?? 'unknown';
      const hid = hr?.id ?? `${hr?.type ?? 'unknown'}_${Math.floor(hr?.x ?? 0)}_${Math.floor(hr?.y ?? 0)}`;
      const k = `${pf}__${hid}`;
      if (k === key) have++;
    }
    for (const p of this.pending) {
      if (p.created) continue;
      if (excludePendingId && p.id === excludePendingId) continue; // не учитываем текущую заявку
      const hid = p.home.id ?? `${p.home.type}_${Math.floor(p.home.x)}_${Math.floor(p.home.y)}`;
      const k = `${p.prefab}__${hid}`;
      if (k === key) have++;
    }
    return have < target.count;
  }

  private listQuotaEntries(): Array<{ prefab: string; count: number; home: HomeRef }> {
    const sys = this.config.system as SystemConfig;
    const result: Array<{ prefab: string; count: number; home: HomeRef }> = [];
    for (const p of sys.planets as any[]) {
      const quotas: Record<string, number> | undefined = p.spawn?.quotas;
      if (!quotas) continue;
      const px = (p as any)._x ?? (sys.star.x + p.orbit.radius);
      const py = (p as any)._y ?? sys.star.y;
      for (const [prefab, count] of Object.entries(quotas)) {
        result.push({ prefab, count: count ?? 0, home: { type: 'planet', id: p.id, x: px, y: py } });
      }
    }
    for (const s of (sys.stations ?? []) as any[]) {
      const quotas: Record<string, number> | undefined = s.spawn?.quotas;
      if (!quotas) continue;
      const sid = s.id ?? `${s.type}_${Math.floor(s.x)}_${Math.floor(s.y)}`;
      for (const [prefab, count] of Object.entries(quotas)) {
        result.push({ prefab, count: count ?? 0, home: { type: 'station', id: sid, x: s.x, y: s.y } });
      }
    }
    return result;
  }

  /** Отладочный снимок очереди ожидающих */
  public getPendingSnapshot(): ReadonlyArray<PendingNPC> {
    return this.pending.slice();
  }
}

export default NPCLazySimulationManager;


