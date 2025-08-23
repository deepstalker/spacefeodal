import type { ConfigManager } from '@/sys/ConfigManager';
import type { MovementManager } from '@/sys/MovementManager';

type FindNPCFn = (worldX: number, worldY: number) => any;

/**
 * Инкапсулирует обработку ПКМ/радиального меню и команды перемещения игрока.
 */
export class InputHandler {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  private movement: MovementManager;
  private ship: any;
  private findNPCAt: FindNPCFn;

  private rightMouseHoldStart = 0;
  private isRightMouseDown = false;
  private rightMouseStartPos = { x: 0, y: 0 };
  private rightClickTargetNPC: any | null = null;
  private lastPointerWorld?: { x: number; y: number };
  private clickMarker?: Phaser.GameObjects.Arc;

  constructor(scene: Phaser.Scene, config: ConfigManager, movement: MovementManager, ship: any, findNPCAt: FindNPCFn) {
    this.scene = scene;
    this.config = config;
    this.movement = movement;
    this.ship = ship;
    this.findNPCAt = findNPCAt;
  }

  init() {
    this.setupMouseControls();
  }

  private getUIScene(): any { return this.scene.scene.get('UIScene'); }

  private setupMouseControls() {
    this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) {
        this.isRightMouseDown = true;
        this.rightMouseHoldStart = this.scene.time.now;
        this.rightMouseStartPos = { x: pointer.worldX, y: pointer.worldY };
        this.rightClickTargetNPC = this.findNPCAt(pointer.worldX, pointer.worldY);
      }
    });

    this.scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonReleased()) {
        if (this.isRightMouseDown) {
          this.isRightMouseDown = false;
          const holdTime = this.scene.time.now - this.rightMouseHoldStart;
          if (this.getUIScene().isRadialMenuVisible()) {
            const selectedItem = this.getUIScene().getRadialMenuSelection();
            this.getUIScene().hideRadialMenu();
            if (selectedItem) this.executeMovementCommand(selectedItem, pointer.worldX, pointer.worldY, this.rightClickTargetNPC);
          } else if (holdTime < 200) {
            this.executeSimpleMoveTo(pointer.worldX, pointer.worldY);
          }
        } else {
          this.executeSimpleMoveTo(pointer.worldX, pointer.worldY);
        }
        this.rightClickTargetNPC = null;
      }
    });

    this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isRightMouseDown && pointer.rightButtonDown()) {
        const holdTime = this.scene.time.now - this.rightMouseHoldStart;
        if (holdTime > 200 && this.rightClickTargetNPC && !this.getUIScene().isRadialMenuVisible()) {
          this.getUIScene().showRadialMenu(pointer.x, pointer.y);
        }
        if (this.getUIScene().isRadialMenuVisible()) {
          this.getUIScene().updateRadialMenuSelection(pointer.y);
          this.lastPointerWorld = { x: pointer.worldX, y: pointer.worldY };
        }
      }
    });
  }

  private executeSimpleMoveTo(worldX: number, worldY: number) {
    const targetNPC = this.findNPCAt(worldX, worldY);
    if (targetNPC) {
      this.movement.pursueTarget(targetNPC, this.ship);
      if (this.clickMarker) this.clickMarker.setVisible(false);
    } else {
      if (!this.clickMarker) {
        this.clickMarker = this.scene.add.circle(worldX, worldY, 10, 0x00ff88).setDepth(0.55).setAlpha(0.7);
      } else {
        this.clickMarker.setPosition(worldX, worldY).setVisible(true);
        this.clickMarker.setFillStyle(0x00ff88);
        this.clickMarker.setRadius(10);
      }
      this.movement.moveTo(new Phaser.Math.Vector2(worldX, worldY), this.ship);
    }
  }

  private executeMovementCommand(item: any, worldX: number, worldY: number, capturedTarget: any | null) {
    const targetNPC = capturedTarget || this.findNPCAt(worldX, worldY);
    if (targetNPC) {
      if (this.clickMarker) this.clickMarker.setVisible(false);
    } else {
      if (!this.clickMarker) {
        this.clickMarker = this.scene.add.circle(worldX, worldY, 10, 0x00ff88).setDepth(0.55).setAlpha(0.7);
      } else {
        this.clickMarker.setPosition(worldX, worldY).setVisible(true);
        this.clickMarker.setFillStyle(0x00ff88);
        this.clickMarker.setRadius(10);
      }
    }
    const target = new Phaser.Math.Vector2(worldX, worldY);
    switch (item.mode) {
      case 'follow':
        if (targetNPC) this.movement.followObject(targetNPC, item.distance, this.ship);
        else this.movement.followTarget(target, item.distance, this.ship);
        break;
      case 'orbit':
        if (targetNPC) this.movement.orbitObject(targetNPC, item.distance, this.ship);
        else this.movement.orbitTarget(target, item.distance, this.ship);
        break;
      default:
        this.movement.moveTo(target, this.ship);
        break;
    }
    this.lastPointerWorld = undefined;
  }
  
  /**
   * Корректно уничтожить обработчик и освободить ресурсы
   */
  public destroy(): void {
    // Отписаться от всех событий мыши
    try {
      this.scene.input.off('pointerdown');
    } catch (e) {
      console.warn('[InputHandler] Error removing pointerdown listener:', e);
    }
    
    try {
      this.scene.input.off('pointerup');
    } catch (e) {
      console.warn('[InputHandler] Error removing pointerup listener:', e);
    }
    
    try {
      this.scene.input.off('pointermove');
    } catch (e) {
      console.warn('[InputHandler] Error removing pointermove listener:', e);
    }
    
    // Уничтожить маркер клика
    try {
      this.clickMarker?.destroy();
    } catch (e) {
      console.warn('[InputHandler] Error destroying clickMarker:', e);
    }
    
    // Очистить ссылки
    this.ship = undefined;
    this.movement = undefined as any;
    this.findNPCAt = undefined as any;
    this.clickMarker = undefined;
    this.rightClickTargetNPC = null;
    this.lastPointerWorld = undefined;
  }
}
