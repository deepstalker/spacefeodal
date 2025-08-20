import type { ConfigManager } from '@/sys/ConfigManager';

/**
 * Загружает активную звёздную систему: статическую (по пути конфига) или процедурную (через профиль).
 */
export class SystemLoaderService {
  private scene: Phaser.Scene;
  private config: ConfigManager;

  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
  }

  async loadCurrentSystem() {
    // Используем уже загруженные индексы, либо подстраховываемся ручной загрузкой
    const systemsIndex = this.config.systemsIndex ?? await (async()=>{
      try { return await (await fetch('/configs/systems/systems.json')).json(); } catch {}
      return await (await fetch('/configs/systems.json')).json();
    })();
    const systemProfiles = this.config.systemProfiles ?? await (async()=>{
      try { return await (await fetch('/configs/systems/system_profiles.json')).json(); } catch {}
      return await (await fetch('/configs/system_profiles.json')).json();
    })();

    const stored = (()=>{ try { return localStorage.getItem('sf_selectedSystem'); } catch { return null; } })();
    const currentId = stored || (systemsIndex as any).current;
    const sysDef = (systemsIndex as any).defs[currentId];

    try {
      if (sysDef?.type === 'procedural') {
        const { generateSystem } = await import('@/sys/SystemGenerator');
        const profile = (systemProfiles as any).profiles[sysDef.profile ?? 'default'];
        this.config.system = generateSystem(profile);
      } else if (sysDef?.type === 'static' && sysDef.configPath) {
        const resp = await fetch(sysDef.configPath);
        if (!resp.ok) throw new Error(`Failed to load system: ${sysDef.configPath}`);
        this.config.system = await resp.json();
      }
    } catch (e) {
      // Fallback: минимальная валидная система, чтобы не упасть
      const w = 20000, h = 20000;
      this.config.system = {
        name: 'fallback',
        size: { width: w, height: h },
        star: { x: Math.floor(w/2), y: Math.floor(h/2) },
        planets: [],
        poi: [],
        dynamicObjects: []
      } as any;
      console.error('[SystemLoaderService] Using fallback system due to error:', e);
    }
  }
}


