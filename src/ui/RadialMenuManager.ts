import Phaser from 'phaser';
import type { MovementMode } from '@/sys/MovementManager';

export interface RadialMenuItem {
  id: string;
  label: string;
  mode: MovementMode;
  distance?: number;
}

export class RadialMenuManager {
  private scene: Phaser.Scene;
  private container?: Phaser.GameObjects.Container;
  private items: RadialMenuItem[] = [
    { id: 'follow_300', label: 'Следование 300', mode: 'follow', distance: 300 },
    { id: 'follow_6000', label: 'Следование 6000', mode: 'follow', distance: 6000 },
    { id: 'orbit_500', label: 'Орбита 500', mode: 'orbit', distance: 500 },
    { id: 'orbit_800', label: 'Орбита 800', mode: 'orbit', distance: 800 }
  ];
  
  private selectedIndex = 0;
  private isVisible = false;
  private backgroundRect?: Phaser.GameObjects.Rectangle;
  private itemTexts: Phaser.GameObjects.Text[] = [];
  private selectionIndicator?: Phaser.GameObjects.Rectangle;
  
  // Настройки UI
  private readonly menuWidth = 200;
  private readonly menuHeight = 160;
  private readonly itemHeight = 32;
  private readonly padding = 12;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  show(x: number, y: number) {
    if (this.isVisible) return;
    
    this.isVisible = true;
    this.selectedIndex = 0;
    
    // Создаем контейнер в UI слое
    this.container = this.scene.add.container(x, y).setDepth(10000);
    
    // Фон меню - стандартный цвет и обводка
    this.backgroundRect = this.scene.add.rectangle(0, 0, this.menuWidth, this.menuHeight, 0x1f2937)
      .setStrokeStyle(2, 0x4b5563, 1)
      .setAlpha(0.95);
    this.container.add(this.backgroundRect);
    
    // Индикатор выбора
    this.selectionIndicator = this.scene.add.rectangle(
      0, 
      -this.menuHeight/2 + this.padding + this.itemHeight/2, 
      this.menuWidth - this.padding * 2, 
      this.itemHeight - 4, 
      0x3b82f6, 
      0.3
    ).setStrokeStyle(1, 0x3b82f6, 0.8);
    this.container.add(this.selectionIndicator);
    
    // Создаем текстовые элементы
    this.itemTexts = [];
    this.items.forEach((item, index) => {
      const text = this.scene.add.text(
        -this.menuWidth/2 + this.padding,
        -this.menuHeight/2 + this.padding + index * this.itemHeight + this.itemHeight/2,
        item.label,
        {
          fontSize: '16px',
          fontFamily: 'HooskaiChamferedSquare',
          color: '#ffffff'
        }
      ).setOrigin(0, 0.5);
      
      this.itemTexts.push(text);
      this.container.add(text);
    });
    
    this.updateSelection();
  }

  hide() {
    if (!this.isVisible) return;
    
    this.isVisible = false;
    this.container?.destroy();
    this.container = undefined;
    this.backgroundRect = undefined;
    this.itemTexts = [];
    this.selectionIndicator = undefined;
  }

  // Навигация по меню (вызывается при движении мыши)
  updateSelection(mouseY?: number) {
    if (!this.isVisible || !this.container) return;
    
    if (mouseY !== undefined) {
      // Вычисляем индекс на основе позиции мыши относительно меню
      const containerY = this.container.y;
      const relativeY = mouseY - containerY;
      const menuTopY = -this.menuHeight/2 + this.padding;
      const itemRelativeY = relativeY - menuTopY;
      
      let newIndex = Math.floor(itemRelativeY / this.itemHeight);
      newIndex = Phaser.Math.Clamp(newIndex, 0, this.items.length - 1);
      
      if (newIndex !== this.selectedIndex) {
        this.selectedIndex = newIndex;
        this.updateVisualSelection();
      }
    } else {
      this.updateVisualSelection();
    }
  }

  private updateVisualSelection() {
    if (!this.selectionIndicator) return;
    
    // Обновляем позицию индикатора
    const targetY = -this.menuHeight/2 + this.padding + this.selectedIndex * this.itemHeight + this.itemHeight/2;
    this.selectionIndicator.setY(targetY);
    
    // Обновляем цвета текста
    this.itemTexts.forEach((text, index) => {
      if (index === this.selectedIndex) {
        text.setColor('#ffffff');
      } else {
        text.setColor('#9ca3af');
      }
    });
  }

  // Получить выбранный элемент
  getSelectedItem(): RadialMenuItem | null {
    if (!this.isVisible || this.selectedIndex < 0 || this.selectedIndex >= this.items.length) {
      return null;
    }
    return this.items[this.selectedIndex];
  }

  isMenuVisible(): boolean {
    return this.isVisible;
  }

  // Навигация стрелками (опционально)
  moveSelectionUp() {
    if (!this.isVisible) return;
    this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    this.updateVisualSelection();
  }

  moveSelectionDown() {
    if (!this.isVisible) return;
    this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
    this.updateVisualSelection();
  }
}
