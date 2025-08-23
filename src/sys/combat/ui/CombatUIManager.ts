import type { ConfigManager } from '../../ConfigManager';
import type { TargetEntry, CombatRingConfig, WeaponRangeConfig, UIDependencies } from '../CombatTypes';
import type { IndicatorManager } from '../../IndicatorManager';

/**
 * Менеджер визуальных элементов боевой системы
 * Отвечает за отображение HP баров, боевых колец, кругов дальности оружия
 */
export class CombatUIManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private deps: UIDependencies;
  private indicatorMgr?: IndicatorManager;
  
  // Визуальные элементы
  private combatRings: Map<any, Phaser.GameObjects.Arc> = new Map();
  private playerWeaponRangeCircles: Map<string, Phaser.GameObjects.Arc> = new Map();
  
  constructor(scene: Phaser.Scene, config: ConfigManager, dependencies: UIDependencies) {
    this.scene = scene;
    this.config = config;
    this.deps = dependencies;
  }
  
  setIndicatorManager(indicators: IndicatorManager): void {
    this.indicatorMgr = indicators;
  }
  
  /**
   * Обновить HP бар для цели
   * ПЕРЕНЕСЕНО ИЗ CombatManager.updateHpBar()
   */
  updateHpBar(target: TargetEntry): void {
    const pct = Math.max(0, Math.min(1, target.hp / Math.max(1, target.hpMax)));
    const baseW = ((target.hpBarBg as any).__baseWidth as number) || target.hpBarBg.width || 192;
    const extra = 64;
    const maxByShip = Math.max(32, target.obj.displayWidth + extra);
    const barW = Math.min(baseW, maxByShip);
    
    target.hpBarBg.width = barW;
    target.hpBarFill.width = barW * pct;
    
    const above = this.deps.getEffectiveRadius(target.obj) + 16;
    const by = target.obj.y - above;
    const barX = target.obj.x;
    const barY = by;
    
    target.hpBarBg.setPosition(barX - barW * 0.5, barY);
    target.hpBarFill.setPosition(barX - barW * 0.5, barY);
    
    // Логика видимости
    const isSelected = this.deps.getSelectedTarget() === target.obj;
    const isAssignedForCombat = this.deps.isTargetCombatAssigned(target.obj);
    const shouldBeVisible = isSelected || isAssignedForCombat;
    
    target.hpBarBg.setVisible(shouldBeVisible);
    target.hpBarFill.setVisible(shouldBeVisible);
    
    // Обновление индикаторов
    if (shouldBeVisible && this.indicatorMgr) {
      const name = this.deps.resolveDisplayName(target) || 'Unknown';
      const color = this.deps.getRelationColor(this.deps.getRelation('player', target.faction));
      
      // Получаем статус из NPCStateManager
      const ctx = this.deps.getNpcStateManager().getContext(target.obj);
      let status = '';
      if (ctx && (ctx.state === 'COMBAT_ATTACKING' || ctx.state === 'COMBAT_SEEKING' || ctx.state === 'COMBAT_FLEEING')) {
        if (ctx.state === 'COMBAT_FLEEING') {
          status = 'Flee';
        } else {
          const tgt = ctx.targetStabilization.currentTarget;
          const tgtName = tgt === this.deps.getPlayerShip() ? 'PLAYER' : `#${(tgt as any)?.__uniqueId ?? '?}'}`;
          status = tgt ? `Attack ${tgtName}` : 'Attack';
        }
      } else {
        if ((target.obj as any).__targetPatrol) {
          status = 'Patrol';
        } else if ((target.obj as any).__targetPlanet) {
          const planet: any = (target.obj as any).__targetPlanet;
          const pname = planet?.data?.name ?? planet?.data?.id ?? 'Planet';
          status = `Moving to "${pname}"`;
        } else {
          status = 'Patrol';
        }
      }
      
      this.indicatorMgr.showOrUpdateNPCBadge(target.obj, {
        name,
        status,
        color,
        x: target.obj.x,
        y: target.obj.y
      });
    } else if (this.indicatorMgr) {
      this.indicatorMgr.hideNPCBadge(target.obj);
    }
  }
  
  /**
   * Показать боевое кольцо вокруг цели
   */
  showCombatRing(target: any, config?: Partial<CombatRingConfig>): void {
    if (this.combatRings.has(target)) return;
    
    const baseRadius = this.deps.getEffectiveRadius(target) + 5;
    const cfg = {
      color: 0xA93226,
      alpha: 0.12,
      strokeWidth: 2,
      strokeColor: 0xA93226,
      strokeAlpha: 1,
      ...config
    };
    
    const ring = this.scene.add.circle(target.x, target.y, baseRadius, cfg.color, cfg.alpha)
      .setDepth(0.44);
    ring.setStrokeStyle(cfg.strokeWidth, cfg.strokeColor, cfg.strokeAlpha);
    
    this.combatRings.set(target, ring);
  }
  
  /**
   * Скрыть боевое кольцо
   */
  hideCombatRing(target: any): void {
    const ring = this.combatRings.get(target);
    if (ring) {
      ring.destroy();
      this.combatRings.delete(target);
    }
  }
  
  /**
   * Показать круг дальности оружия игрока
   */
  showWeaponRange(slotKey: string, range: number): void {
    if (this.playerWeaponRangeCircles.has(slotKey)) return;
    
    const wr = this.config.settings?.ui?.combat?.weaponRanges ?? {} as any;
    const fillColorNum = Number((wr.color ?? '#4ade80').replace('#', '0x'));
    const fillAlpha = typeof wr.fillAlpha === 'number' ? Math.max(0, Math.min(1, wr.fillAlpha)) : 0.08;
    const strokeColorNum = Number((wr.strokeColor ?? wr.color ?? '#4ade80').replace('#', '0x'));
    const strokeAlpha = typeof wr.strokeAlpha === 'number' ? Math.max(0, Math.min(1, wr.strokeAlpha)) : 0.8;
    const strokeWidth = typeof wr.strokeWidth === 'number' ? Math.max(0, Math.floor(wr.strokeWidth)) : 1;
    
    const ship = this.deps.getPlayerShip();
    const circle = this.scene.add.circle(ship?.x ?? 0, ship?.y ?? 0, range, fillColorNum, fillAlpha)
      .setDepth(0.35);
    circle.setStrokeStyle(strokeWidth, strokeColorNum, strokeAlpha);
    
    this.playerWeaponRangeCircles.set(slotKey, circle);
  }
  
  /**
   * Скрыть круг дальности оружия
   */
  hideWeaponRange(slotKey: string): void {
    const circle = this.playerWeaponRangeCircles.get(slotKey);
    if (circle) {
      circle.setVisible(false);
    }
  }
  
  /**
   * Обновить все боевые индикаторы
   * ПЕРЕНЕСЕНО ИЗ CombatManager.refreshCombatRings() и refreshCombatUIAssigned()
   */
  refreshCombatIndicators(): void {
    const assigned = new Set<any>();
    
    // Получаем назначенные цели от WeaponManager
    for (const t of this.deps.getWeaponManager().getPlayerWeaponTargets().values()) {
      if (t && (t as any).active) assigned.add(t);
    }
    
    // Добавляем NPC, которые целятся в игрока
    for (const t of this.deps.getTargets()) {
      if (t.intent?.target === this.deps.getPlayerShip() && 
          (t.intent.type === 'attack' || t.intent.type === 'flee')) {
        assigned.add(t.obj);
      }
    }
    
    // Удаляем кольца для неназначенных целей
    for (const [target, ring] of this.combatRings.entries()) {
      if (!assigned.has(target)) {
        ring.destroy();
        this.combatRings.delete(target);
      }
    }
    
    // Создаем кольца для новых назначенных целей
    for (const target of assigned.values()) {
      if (!this.combatRings.has(target)) {
        this.showCombatRing(target);
      }
    }
    
    // Обновляем позиции существующих колец
    for (const [target, ring] of this.combatRings.entries()) {
      if (!target || !target.active) {
        ring.destroy();
        this.combatRings.delete(target);
        continue;
      }
      
      const baseRadius = this.deps.getEffectiveRadius(target) + 5;
      ring.setRadius(baseRadius);
      ring.setPosition(target.x, target.y);
    }
  }
  
  /**
   * Переключить отображение круга дальности оружия игрока
   * ПЕРЕНЕСЕНО ИЗ CombatManager.togglePlayerWeaponRangeCircle()
   */
  togglePlayerWeaponRangeCircle(slotKey: string, show: boolean): void {
    const def = this.config.weapons?.defs?.[slotKey];
    if (!def || typeof def.range !== 'number') {
      // если нет данных — просто скрываем существующий круг
      const old = this.playerWeaponRangeCircles.get(slotKey);
      if (old) { 
        try { old.setVisible(false); } catch {} 
      }
      return;
    }
    
    let circle = this.playerWeaponRangeCircles.get(slotKey);
    if (show) {
      if (!circle) {
        this.showWeaponRange(slotKey, def.range);
        circle = this.playerWeaponRangeCircles.get(slotKey);
      }
      if (circle) {
        // на случай, если параметры были изменены в рантайме — обновим стиль
        const wr2 = this.config.settings?.ui?.combat?.weaponRanges ?? {} as any;
        const fillColorNum2 = Number((wr2.color ?? '#4ade80').replace('#','0x'));
        const fillAlpha2 = typeof wr2.fillAlpha === 'number' ? Math.max(0, Math.min(1, wr2.fillAlpha)) : 0.08;
        const strokeColorNum2 = Number((wr2.strokeColor ?? wr2.color ?? '#4ade80').replace('#','0x'));
        const strokeAlpha2 = typeof wr2.strokeAlpha === 'number' ? Math.max(0, Math.min(1, wr2.strokeAlpha)) : 0.8;
        const strokeWidth2 = typeof wr2.strokeWidth === 'number' ? Math.max(0, Math.floor(wr2.strokeWidth)) : 1;
        circle.setFillStyle(fillColorNum2, fillAlpha2);
        circle.setStrokeStyle(strokeWidth2, strokeColorNum2, strokeAlpha2);
        circle.setRadius(def.range);
        circle.setPosition(this.deps.getPlayerShip()?.x ?? 0, this.deps.getPlayerShip()?.y ?? 0);
        circle.setVisible(true);
      }
    } else {
      if (circle) {
        circle.setVisible(false);
      }
    }
  }
  
  /**
   * Обновить позицию кругов дальности оружия
   */
  updateWeaponRangePositions(): void {
    const ship = this.deps.getPlayerShip();
    if (!ship) return;
    
    for (const circle of this.playerWeaponRangeCircles.values()) {
      circle.setPosition(ship.x, ship.y);
    }
  }

  /**
   * Очистить недействительные индикаторы
   * ДОБАВЛЕНО ДЛЯ СОВМЕСТИМОСТИ С CombatService
   */
  cleanupInvalidIndicators(): void {
    if (this.indicatorMgr) {
      this.indicatorMgr.cleanupInvalidNPCBadges();
    }
  }

  /**
   * Показать индикатор над объектом
   * ДОБАВЛЕНО ДЛЯ СОВМЕСТИМОСТИ С CombatService
   */
  showIndicator(x: number, y: number, name: string, color?: number): void {
    // Находим объект по координатам и показываем индикатор
    // В текущей реализации используется showOrUpdateNPCBadge через updateHpBar
    // Этот метод добавлен для совместимости с существующим API
    if (this.indicatorMgr) {
      // Получаем список всех целей для поиска реального объекта
      const targets = this.deps.getTargets();
      const targetObj = targets.find(t => 
        Math.abs(t.obj.x - x) < 50 && Math.abs(t.obj.y - y) < 50
      );
      
      if (targetObj) {
        // Используем реальный объект вместо создания временного
        const colorStr = color ? `#${color.toString(16).padStart(6, '0')}` : '#ffffff';
        
        this.indicatorMgr.showOrUpdateNPCBadge(targetObj.obj, {
          name,
          status: '',
          color: colorStr,
          x: targetObj.obj.x,
          y: targetObj.obj.y
        });
      }
    }
  }
  
  /**
   * Скрыть индикатор для объекта
   * ДОБАВЛЕНО ДЛЯ УСТРАНЕНИЯ ДУБЛИРОВАНИЯ ИНДИКАТОРОВ
   */
  hideIndicator(obj: any): void {
    if (this.indicatorMgr) {
      this.indicatorMgr.hideNPCBadge(obj);
    }
  }
  
  /**
   * Очистка при уничтожении
   */
  destroy(): void {
    // Очистка боевых колец
    for (const ring of this.combatRings.values()) {
      try { ring.destroy(); } catch {}
    }
    this.combatRings.clear();
    
    // Очистка кругов дальности оружия
    for (const circle of this.playerWeaponRangeCircles.values()) {
      try { circle.destroy(); } catch {}
    }
    this.playerWeaponRangeCircles.clear();
  }
}