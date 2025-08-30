import type { ConfigManager } from '../../../ConfigManager';
import type { CombatManager } from '../../../CombatManager';

export class RangeUiService {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private combatManager: CombatManager;
  private circles: Map<string, Phaser.GameObjects.Arc> = new Map();
  // Причины видимости для каждого слота: радиус виден, если selected || hover
  private visibleReasons: Map<string, { selected?: boolean; hover?: boolean }> = new Map();

  constructor(scene: Phaser.Scene, config: ConfigManager, combatManager: CombatManager) {
    this.scene = scene;
    this.config = config;
    this.combatManager = combatManager;
  }

  // Обратная совместимость: toggle трактуем как переключение причины "selected"
  public toggle(slotKey: string, show: boolean) {
    this.setSelected(slotKey, show);
  }

  // Установка причины selected
  public setSelected(slotKey: string, show: boolean) {
    const state = this.visibleReasons.get(slotKey) ?? {};
    state.selected = !!show;
    this.visibleReasons.set(slotKey, state);
    if (show) this.ensureCircle(slotKey);
    this.updateVisibility(slotKey);
  }

  // Установка причины hover
  public setHover(slotKey: string, show: boolean) {
    const state = this.visibleReasons.get(slotKey) ?? {};
    state.hover = !!show;
    this.visibleReasons.set(slotKey, state);
    if (show) this.ensureCircle(slotKey);
    this.updateVisibility(slotKey);
  }

  // Создать или обновить круг с актуальными стилями и позицией
  private ensureCircle(slotKey: string) {
    const def = this.config.weapons?.defs?.[slotKey];
    if (!def || typeof def.range !== 'number') return;
    let circle = this.circles.get(slotKey);
    const wr = this.config.settings?.ui?.combat?.weaponRanges ?? ({} as any);
    const fillColorNum = Number((wr.color ?? '#4ade80').replace('#','0x'));
    const fillAlpha = typeof wr.fillAlpha === 'number' ? Phaser.Math.Clamp(wr.fillAlpha, 0, 1) : 0.08;
    const strokeColorNum = Number((wr.strokeColor ?? wr.color ?? '#4ade80').replace('#','0x'));
    const strokeAlpha = typeof wr.strokeAlpha === 'number' ? Phaser.Math.Clamp(wr.strokeAlpha, 0, 1) : 0.8;
    const strokeWidth = typeof wr.strokeWidth === 'number' ? Math.max(0, Math.floor(wr.strokeWidth)) : 1;
    const ship = this.combatManager.getPlayerShip();
    if (!circle) {
      circle = this.scene.add.circle(ship?.x ?? 0, ship?.y ?? 0, def.range, fillColorNum, fillAlpha).setDepth(0.35);
      circle.setStrokeStyle(strokeWidth, strokeColorNum, strokeAlpha);
      this.circles.set(slotKey, circle);
    } else {
      circle.setFillStyle(fillColorNum, fillAlpha);
      circle.setStrokeStyle(strokeWidth, strokeColorNum, strokeAlpha);
    }
    circle.setRadius(def.range);
    circle.setPosition(ship?.x ?? 0, ship?.y ?? 0);
  }

  // Пересчитать видимость по причинам
  private updateVisibility(slotKey: string) {
    const circle = this.circles.get(slotKey);
    if (!circle) return;
    const st = this.visibleReasons.get(slotKey) ?? {};
    const visible = !!(st.selected || st.hover);
    circle.setVisible(visible);
  }

  public updateAll() {
    const ship = this.combatManager.getPlayerShip();
    if (ship && this.circles.size > 0) {
      for (const [slotKey, circle] of this.circles.entries()) {
        if (!circle || !circle.active) continue;
        circle.setPosition(ship.x, ship.y);
        const w = this.config.weapons?.defs?.[slotKey];
        if (w && typeof w.range === 'number') {
          circle.setRadius(w.range);
        }
      }
    }
  }

  public destroy() {
    for (const c of this.circles.values()) { try { c.destroy(); } catch {} }
    this.circles.clear();
  }
}
