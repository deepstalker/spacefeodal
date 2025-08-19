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

    if (sysDef?.type === 'procedural') {
      const { generateSystem } = await import('@/sys/SystemGenerator');
      const profile = (systemProfiles as any).profiles[sysDef.profile ?? 'default'];
      this.config.system = generateSystem(profile);
    } else if (sysDef?.type === 'static' && sysDef.configPath) {
      this.config.system = await fetch(sysDef.configPath).then(r => r.json());
    }
  }
}


