import type { ConfigManager } from '../../../ConfigManager';
import type { CombatManager } from '../../../CombatManager';

export class RangeUiService {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private combatManager: CombatManager;
  private circles: Map<string, Phaser.GameObjects.Arc> = new Map();

  constructor(scene: Phaser.Scene, config: ConfigManager, combatManager: CombatManager) {
    this.scene = scene;
    this.config = config;
    this.combatManager = combatManager;
  }

  public toggle(slotKey: string, show: boolean) {
    const def = this.config.weapons?.defs?.[slotKey];
    if (!def || typeof def.range !== 'number') {
      const old = this.circles.get(slotKey);
      if (old) { try { old.setVisible(false); } catch {} }
      return;
    }
    let circle = this.circles.get(slotKey);
    if (show) {
      if (!circle) {
        const wr = this.config.settings?.ui?.combat?.weaponRanges ?? {} as any;
        const fillColorNum = Number((wr.color ?? '#4ade80').replace('#','0x'));
        const fillAlpha = typeof wr.fillAlpha === 'number' ? Phaser.Math.Clamp(wr.fillAlpha, 0, 1) : 0.08;
        const strokeColorNum = Number((wr.strokeColor ?? wr.color ?? '#4ade80').replace('#','0x'));
        const strokeAlpha = typeof wr.strokeAlpha === 'number' ? Phaser.Math.Clamp(wr.strokeAlpha, 0, 1) : 0.8;
        const strokeWidth = typeof wr.strokeWidth === 'number' ? Math.max(0, Math.floor(wr.strokeWidth)) : 1;
        const ship = this.combatManager.getPlayerShip();
        circle = this.scene.add.circle(ship?.x ?? 0, ship?.y ?? 0, def.range, fillColorNum, fillAlpha).setDepth(0.35);
        circle.setStrokeStyle(strokeWidth, strokeColorNum, strokeAlpha);
        this.circles.set(slotKey, circle);
      }
      const wr2 = this.config.settings?.ui?.combat?.weaponRanges ?? {} as any;
      const fillColorNum2 = Number((wr2.color ?? '#4ade80').replace('#','0x'));
      const fillAlpha2 = typeof wr2.fillAlpha === 'number' ? Phaser.Math.Clamp(wr2.fillAlpha, 0, 1) : 0.08;
      const strokeColorNum2 = Number((wr2.strokeColor ?? wr2.color ?? '#4ade80').replace('#','0x'));
      const strokeAlpha2 = typeof wr2.strokeAlpha === 'number' ? Phaser.Math.Clamp(wr2.strokeAlpha, 0, 1) : 0.8;
      const strokeWidth2 = typeof wr2.strokeWidth === 'number' ? Math.max(0, Math.floor(wr2.strokeWidth)) : 1;
      circle.setFillStyle(fillColorNum2, fillAlpha2);
      circle.setStrokeStyle(strokeWidth2, strokeColorNum2, strokeAlpha2);
      circle.setRadius(def.range);
      const ship = this.combatManager.getPlayerShip();
      circle.setPosition(ship?.x ?? 0, ship?.y ?? 0);
      circle.setVisible(true);
    } else {
      if (circle) { circle.setVisible(false); }
    }
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
