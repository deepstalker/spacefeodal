import Phaser from 'phaser';
import { MinimapManager } from '@/sys/MinimapManager';
import type { ConfigManager } from '@/sys/ConfigManager';

export class HUDManager {
  private scene: Phaser.Scene;
  private configRef?: ConfigManager;
  
  // HUD elements
  private speedText?: Phaser.GameObjects.Text;
  private followToggle?: any;
  private hullFill?: Phaser.GameObjects.Rectangle;
  private playerHp: number | null = null;
  private shipNameText?: Phaser.GameObjects.Text;
  private shipIcon?: Phaser.GameObjects.Image;
  private weaponSlotsContainer?: Phaser.GameObjects.Container;
  private weaponPanel?: Phaser.GameObjects.Rectangle;
  private hullBarWidth: number = 1228;
  private hullRect?: { x: number; y: number; w: number; h: number };
  private uiTextResolution: number = 2;
  private gameOverGroup?: Phaser.GameObjects.Container;
  private followLabel?: Phaser.GameObjects.Text;
  private minimap?: MinimapManager;
  private minimapHit?: Phaser.GameObjects.Zone;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  init(config: ConfigManager, ship: Phaser.GameObjects.GameObject) {
    this.configRef = config;
    this.createHUD(ship);
    this.createWeaponBar();
    this.createMinimap(ship);
    
    // Подписываемся на события
    const starScene = this.scene.scene.get('StarSystemScene') as any;
    starScene.events.on('player-damaged', (hp: number) => this.onPlayerDamaged(hp));
    
    // Обновление HUD каждый кадр
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, () => this.updateHUD());
    
    // Обновление режима следования
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, () => this.updateFollowMode());
  }

  private createHUD(ship: Phaser.GameObjects.GameObject) {
    const rexUI = (this.scene as any).rexUI;
    const sw = this.scene.scale.width;
    const sh = this.scene.scale.height;
    const pad = 24;
    const hudY = sh - pad;
    
    // Проверяем доступность шрифта Request
    console.log('Creating HUD - fonts should be loaded by PreloadScene');
    
    // Простая проверка загрузки шрифта
    const fontCheck = () => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (context) {
        context.font = '16px Request';
        const requestWidth = context.measureText('test').width;
        context.font = '16px Arial';
        const arialWidth = context.measureText('test').width;
        const isLoaded = requestWidth !== arialWidth;
        console.log('Request font status in HUD:', isLoaded, 'fonts available');
        return isLoaded;
      }
      return false;
    };
    
    const isRequestLoaded = fontCheck();

    // Speed numeric readout
    const speedValue = this.scene.add.text(pad + 16, hudY - 52, '0 U/S', { 
      color: '#F5F0E9', 
      fontSize: '32px', 
      fontFamily: 'Request',
      padding: { top: 8, bottom: 4, left: 2, right: 2 }
    }).setOrigin(0, 0.8).setScrollFactor(0).setDepth(1502);
    
    try { (speedValue as any).setResolution?.(this.uiTextResolution); } catch {}
    this.speedText = speedValue;
    
    // Если шрифт не загружен при старте, принудительно устанавливаем через задержку
    if (!isRequestLoaded) {
      console.warn('Request font not loaded in HUD creation - applying with delay');
      this.scene.time.delayedCall(100, () => {
        if (speedValue && speedValue.active) {
          speedValue.setFontFamily('Request');
          console.log('Applied Request font to speed text with delay');
        }
      });
    }
    
    // Сохраняем ссылку для обновлений
    (this.scene as any).__hudSpeedValue = speedValue;
    
    // underline under speed text (120x4)
    const underline = this.scene.add.rectangle(pad + 36 + 76, hudY - 34, 200, 4, 0xA28F6E).setOrigin(0.5, 1).setScrollFactor(0).setDepth(1502);

    // Follow toggle (rexUI label behaves like a toggle)
    const followBg = this.scene.add.rectangle(0, 0, 260, 56, 0x0f172a).setStrokeStyle(2, 0x334155);
    const followText = this.scene.add.text(0, 0, 'Следовать', { color: '#F5F0E9', fontSize: '28px' });
    try { (followText as any).setResolution?.(this.uiTextResolution); } catch {}
    this.followToggle = rexUI.add.label({
      x: 0, y: 0,
      background: followBg,
      text: followText,
      space: { left: 20, right: 20, top: 8, bottom: 8 }
    }).layout().setScrollFactor(0).setDepth(1500)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        const stars = this.scene.scene.get('StarSystemScene') as any;
        if (stars?.cameraMgr?.isFollowing?.()) stars.cameraMgr.disableFollow();
        else stars?.cameraMgr?.enableFollow?.(ship);
      });
    // Move follow toggle to right-bottom corner
    this.followToggle.setPosition(sw - pad - 150, hudY - 160);

    // Ship name and icon (no rotation)
    const currentId = this.configRef!.player?.shipId ?? this.configRef!.ships?.current;
    const def = currentId ? this.configRef!.ships?.defs[currentId] : undefined;
    const shipName = def?.displayName ?? 'Ship';
    const iconKey = (def?.sprite?.key) ?? (this.scene.textures.exists('ship_alpha') ? 'ship_alpha' : 'ship_alpha_public');
    
    // Переносим иконку корабля в правый нижний угол
    const icon = this.scene.add.image(sw - pad - 48, hudY - 48, iconKey).setScrollFactor(0).setDepth(1500).setDisplaySize(96, 96);
    icon.setOrigin(1, 1);
    icon.setRotation(0);
    this.shipIcon = icon;
    
    // Имя корабля рядом слева от иконки
    const nameText = this.scene.add.text(sw - pad - 48 - 16, hudY - 48 - 48, shipName, { color: '#F5F0E9', fontSize: '32px', fontFamily: 'HooskaiChamferedSquare' }).setScrollFactor(0).setDepth(1500).setOrigin(1, 0.5);
    try { (nameText as any).setResolution?.(this.uiTextResolution); } catch {}
    this.shipNameText = nameText;

    // store refs for dynamic values
    (this.scene as any).__hudSpeedValue = speedValue;
  }

  private createWeaponBar() {
    if (!this.configRef) return;
    const sw = this.scene.scale.width; 
    const sh = this.scene.scale.height; 
    
    // Используем настройки из конфигурации с fallback значениями
    const slotSize = this.configRef.settings?.ui?.weaponSlots?.size ?? 112;
    const slotBgColor = 0x2c2a2d; 
    const outline = 0xA28F6E;
    const container = this.scene.add.container(0, 0).setDepth(1500);
    container.setScrollFactor(0);
    
    // Получаем только экипированное оружие (фильтруем undefined/null)
    const playerSlots = this.configRef.player?.weapons ?? [];
    const equippedWeapons = playerSlots.filter(weapon => weapon && weapon.trim() !== '');
    const actualSlotsCount = Math.max(1, equippedWeapons.length); // минимум 1 слот для отображения
    
    // Фиксированные размеры панели и HP бара
    const fixedPanelW = 800; // фиксированная ширина панели
    const fixedPanelH = 200; // фиксированная высота панели
    const fixedHpBarW = 600; // фиксированная ширина HP бара
    const fixedHpBarH = 60;  // фиксированная высота HP бара
    
    const panelOffset = 40;
    const panelX = (sw - fixedPanelW) / 2; 
    const panelY = sh - panelOffset - fixedPanelH;
    
    // Создаем фиксированную панель
    this.weaponPanel = this.scene.add.rectangle(panelX, panelY, fixedPanelW, fixedPanelH, 0x2c2a2d, 1).setOrigin(0,0).setScrollFactor(0).setDepth(1499);
    this.weaponPanel.setStrokeStyle(2, outline, 1);

    // Вычисляем позиции слотов - центрируем по количеству экипированного оружия
    const spacing = Math.max(8, slotSize * 0.125);
    const totalSlotsWidth = actualSlotsCount * slotSize + (actualSlotsCount - 1) * spacing;
    const startX = (sw - totalSlotsWidth) / 2; // центрируем слоты на экране
    const slotsY = panelY - slotSize/2; // отступ от верха панели
    
    const defs = this.configRef.weapons?.defs ?? {} as any;
    const rarityMap = (this.configRef.items?.rarities ?? {}) as any;
    
    // Отображаем только экипированные слоты
    for (let i = 0; i < actualSlotsCount; i++) {
      const x = startX + i * (slotSize + spacing);
      const y = slotsY;
      
      // base slot background
      const slotBg = this.scene.add.rectangle(x, y, slotSize, slotSize, slotBgColor, 1).setOrigin(0, 0).setDepth(1500).setScrollFactor(0);
      slotBg.setStrokeStyle(2, outline, 1);
      container.add(slotBg);
      
      // rarity underlay and weapon icon
      const weaponKey = equippedWeapons[i];
      if (weaponKey && defs[weaponKey]) {
        const rarityKey = (defs[weaponKey] as any).rarity as string | undefined;
        const rarityColorHex = rarityKey && rarityMap[rarityKey]?.color ? Number(rarityMap[rarityKey].color.replace('#','0x')) : 0x000000;
        const under = this.scene.add.rectangle(x + 1, y + 1, slotSize - 2, slotSize - 2, rarityColorHex, 0.75).setOrigin(0, 0).setDepth(1500).setScrollFactor(0);
        container.add(under);
        
        // icon fit - оптимизированный рендеринг для высокого качества
        const iconKey = (defs[weaponKey] as any).icon ?? weaponKey;
        if (this.scene.textures.exists(iconKey)) {
          try { this.scene.textures.get(iconKey).setFilter(Phaser.Textures.FilterMode.LINEAR); } catch {}
          const img = this.scene.add.image(x + slotSize/2, y + slotSize/2, iconKey).setDepth(1501).setScrollFactor(0);
          img.setOrigin(0.5);
          
          // Правильное масштабирование с сохранением пропорций
          const iconPadding = this.configRef.settings?.ui?.weaponSlots?.iconPadding ?? 8;
          const targetSize = slotSize - iconPadding * 2;
          
          // Получаем оригинальные размеры текстуры
          const texture = this.scene.textures.get(iconKey);
          const originalWidth = texture.source[0].width;
          const originalHeight = texture.source[0].height;
          
          // Вычисляем коэффициент масштабирования с сохранением пропорций
          const scale = Math.min(targetSize / originalWidth, targetSize / originalHeight);
          img.setScale(scale);
          
          container.add(img);
        }
      }
      
      // number badge (bottom-left) - динамический размер привязанный к слоту
      const badgeSize = Math.max(32, slotSize * 0.35);    // 30% от размера слота (было 0.28)
      const badgePadding = Math.max(4, slotSize * 0.05); // 4% от размера слота (было 0.03)
      const badge = this.scene.add.rectangle(x + badgePadding, y + slotSize - badgePadding - badgeSize, badgeSize, badgeSize, 0x2c2a2d, 1).setOrigin(0, 0).setDepth(1502).setScrollFactor(0);
      badge.setStrokeStyle(2, outline, 1);
      const fontSize = Math.max(18, badgeSize * 0.5);   // 55% от размера значка (было 0.5)
      const num = this.scene.add.text(x + badgePadding + badgeSize/2, y + slotSize - badgePadding - badgeSize/2, `${i + 1}`, { 
        color: '#F5F0E9', 
        fontSize: `${fontSize}px`, 
        fontFamily: 'Request',
        padding: { top: Math.max(2, fontSize * 0.15), bottom: 2, left: 2, right: 2 }
      }).setOrigin(0.5, 0.45).setDepth(1503).setScrollFactor(0);
      
      // Явно устанавливаем шрифт для цифр на значках
      num.setFontFamily('Request');
      try { (num as any).setResolution?.(this.uiTextResolution); } catch {}
      container.add(badge);
      container.add(num);
    }
    this.weaponSlotsContainer = container;

    // HP bar - фиксированные размеры и позиция
    const hpX = (sw - fixedHpBarW) / 2; // центрируем HP бар
    const hpY = panelY + fixedPanelH - 100; // фиксированная позиция от низа панели
    
    const hpOutline = this.scene.add.rectangle(hpX, hpY, fixedHpBarW, fixedHpBarH, 0x000000, 0).setOrigin(0,0).setScrollFactor(0).setDepth(1500);
    hpOutline.setStrokeStyle(2, outline, 1);
    const hpBg = this.scene.add.rectangle(hpX, hpY, fixedHpBarW, fixedHpBarH, 0x1E3A2B, 1).setOrigin(0,0).setScrollFactor(0).setDepth(1500);
    const hpFill = this.scene.add.rectangle(hpX + 2, hpY + 2, fixedHpBarW - 4, fixedHpBarH - 4, 0x1E8449, 1).setOrigin(0,0).setScrollFactor(0).setDepth(1501);
    this.hullFill = hpFill;
    
    const hpTextSize = 24; // фиксированный размер шрифта
    const hpTextPadding = 16; // фиксированный отступ
    const hpText = this.scene.add.text(hpX + hpTextPadding, hpY + fixedHpBarH/2, '100', { 
      color: '#F5F0E9', 
      fontSize: `${hpTextSize}px`, 
      fontFamily: 'Request',
      padding: { top: 6, bottom: 2, left: 2, right: 2 }
    }).setOrigin(0, 0.4).setScrollFactor(0).setDepth(1502);
    
    try { (hpText as any).setResolution?.(this.uiTextResolution); } catch {}
    (this.scene as any).__hudHullValue = hpText;
    
    // Проверяем шрифт и применяем с задержкой если нужно
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    let fontLoaded = false;
    if (context) {
      context.font = '16px Request';
      const requestWidth = context.measureText('test').width;
      context.font = '16px Arial';
      const arialWidth = context.measureText('test').width;
      fontLoaded = requestWidth !== arialWidth;
    }
    
    if (!fontLoaded) {
      console.warn('Request font not loaded for HP text - applying with delay');
      this.scene.time.delayedCall(100, () => {
        if (hpText && hpText.active) {
          hpText.setFontFamily('Request');
          console.log('Applied Request font to HP text with delay');
        }
      });
    }
    this.hullRect = { x: hpX, y: hpY, w: fixedHpBarW, h: fixedHpBarH };
  }

  private onPlayerDamaged(hp: number) {
    this.playerHp = hp;
    this.updateHUD();
    
    // flash effect over HP bar
    if (this.hullRect && this.hullFill) {
      const fx = this.scene.add.rectangle(this.hullFill.x, this.hullFill.y, this.hullFill.width, this.hullFill.height, 0xffffff, 0.35)
        .setOrigin(0,0).setScrollFactor(0).setDepth(1502);
      this.scene.tweens.add({ targets: fx, alpha: 0, duration: 180, ease: 'Sine.easeOut', onComplete: () => fx.destroy() });
    }
  }

  private updateHUD() {
    if (!this.configRef) return;
    
    // Speed percentage
    const star = this.scene.scene.get('StarSystemScene') as any;
    const ship = star?.ship as Phaser.GameObjects.Image | undefined;
    if (ship && this.speedText) {
      const mv = this.getMovementConfig();
      const max = mv?.MAX_SPEED ?? 1;
      const prev = (ship as any).__prevPos || { x: ship.x, y: ship.y };
      const dx = ship.x - prev.x;
      const dy = ship.y - prev.y;
      const v = Math.hypot(dx, dy);
      (ship as any).__prevPos = { x: ship.x, y: ship.y };
      const u = Math.round((max > 0 ? (v / max) : 0) * 100);
      const txt = (this.scene as any).__hudSpeedValue as Phaser.GameObjects.Text | undefined;
      if (txt) txt.setText(`${u} U/S`);
    }

    // HULL percentage
    if (this.hullFill && this.configRef) {
      const id = this.configRef.player?.shipId ?? this.configRef.ships?.current;
      const baseHull = id ? this.configRef.ships?.defs[id]?.hull ?? 100 : 100;
      const hull = this.playerHp != null ? this.playerHp : baseHull;
      const pct = Phaser.Math.Clamp(baseHull > 0 ? hull / baseHull : 0, 0, 1);
      const actualHpBarWidth = this.hullRect?.w ?? this.hullBarWidth;
      this.hullFill.width = (actualHpBarWidth - 4) * pct;
      const hullText = (this.scene as any).__hudHullValue as Phaser.GameObjects.Text | undefined;
      if (hullText) hullText.setText(`${Math.round(hull)}/${baseHull}`);
    }
  }

  private updateFollowMode() {
    const stars = this.scene.scene.get('StarSystemScene') as any;
    const isFollowing = stars?.cameraMgr?.isFollowing?.() ?? false;
    if (isFollowing) {
      if (!this.followLabel) {
        // Размещаем справа, над кнопкой "Следовать"
        const sw = this.scene.scale.width;
        const sh = this.scene.scale.height;
        const pad = 24;
        // Позиция над кнопкой "Следовать" (которая находится в sw - pad - 150, hudY - 160)
        this.followLabel = this.scene.add.text(sw - pad - 75, sh - pad - 220, 'Режим следования', {
          color: '#ffffff', fontSize: '24px'
        }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(2000);
      }
      // блокируем drag-pan
      const inputMgr = stars?.inputMgr;
      inputMgr?.setDragEnabled?.(false);
    } else {
      this.followLabel?.destroy();
      this.followLabel = undefined;
      const inputMgr = stars?.inputMgr;
      inputMgr?.setDragEnabled?.(true);
    }
  }

  private createMinimap(ship: Phaser.GameObjects.GameObject) {
    if (!this.configRef) return;
    
    // Увеличенные размеры миникарты
    const minimapW = 512; // увеличиваем с 480 до 640
    const minimapH = 384; // увеличиваем с 360 до 480
    const minimapX = this.scene.scale.width - minimapW - 40; // отступ от правого края
    const minimapY = 40; // отступ от верхнего края
    
    // Инициализируем миникарту с новыми размерами
    this.minimap = new MinimapManager(this.scene, this.configRef);
    this.minimap.init(minimapX, minimapY, minimapW, minimapH);
    this.minimap.attachShip(ship);
    
    // Настраиваем интерактивность
    this.minimapHit = this.scene.add.zone(minimapX, minimapY, minimapW, minimapH).setOrigin(0, 0).setScrollFactor(0).setDepth(1001);
    this.minimapHit.setInteractive({ useHandCursor: true });
    this.minimapHit.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const sys = this.configRef!.system;
      const relX = (p.x - minimapX) / minimapW;
      const relY = (p.y - minimapY) / minimapH;
      const worldX = Phaser.Math.Clamp(relX * sys.size.width, 0, sys.size.width);
      const worldY = Phaser.Math.Clamp(relY * sys.size.height, 0, sys.size.height);
      const star = this.scene.scene.get('StarSystemScene') as any;
      star.cameras.main.centerOn(worldX, worldY);
    });
  }

  private getMovementConfig() {
    const mv = this.configRef?.gameplay?.movement;
    const playerShipId = this.configRef?.player?.shipId;
    const shipMv = playerShipId ? this.configRef?.ships?.defs[playerShipId]?.movement : undefined;
    return shipMv ?? mv;
  }

  // Game Over overlay with rexUI button
  // Публичный метод для полного обновления HUD при смене системы
  public updateForNewSystem(config: ConfigManager, ship: Phaser.GameObjects.GameObject) {
    this.configRef = config;
    
    // Уничтожаем старые элементы
    this.destroyElements();
    
    // Создаем заново все элементы с правильными шрифтами
    this.createHUD(ship);
    this.createWeaponBar();
    this.createMinimap(ship);
  }

  private destroyElements() {
    // Уничтожаем все HUD элементы для пересоздания
    this.speedText?.destroy();
    this.followToggle?.destroy();
    this.shipNameText?.destroy();
    this.shipIcon?.destroy();
    this.weaponSlotsContainer?.destroy();
    this.weaponPanel?.destroy();
    this.hullFill?.destroy();
    this.followLabel?.destroy();
    this.gameOverGroup?.destroy();
    this.minimapHit?.destroy();
    
    // Очищаем ссылки
    this.speedText = undefined;
    this.followToggle = undefined;
    this.shipNameText = undefined;
    this.shipIcon = undefined;
    this.weaponSlotsContainer = undefined;
    this.weaponPanel = undefined;
    this.hullFill = undefined;
    this.followLabel = undefined;
    this.gameOverGroup = undefined;
    this.minimapHit = undefined;
    
    // Очищаем дополнительные элементы с глобальными ссылками
    const hpText = (this.scene as any).__hudHullValue as Phaser.GameObjects.Text | undefined;
    hpText?.destroy();
    (this.scene as any).__hudHullValue = undefined;
    
    const speedValue = (this.scene as any).__hudSpeedValue as Phaser.GameObjects.Text | undefined;
    speedValue?.destroy();
    (this.scene as any).__hudSpeedValue = undefined;
    
    // Сбрасываем состояние HP игрока
    this.playerHp = null;
    this.hullRect = undefined;
  }

  public showGameOver() {
    if (this.gameOverGroup) return;
    const width = this.scene.scale.width;
    const height = this.scene.scale.height;
    const overlay = this.scene.add.rectangle(0, 0, width, height, 0x000000, 0.6).setOrigin(0).setScrollFactor(0).setDepth(3000);
    const title = this.scene.add.text(0, 0, 'Корабль уничтожен', { color: '#ffffff', fontSize: '64px' }).setOrigin(0.5).setScrollFactor(0).setDepth(3001);
    const btn = (this.scene as any).rexUI.add.label({
      x: 0, y: 0,
      background: this.scene.add.rectangle(0, 0, 400, 88, 0x0f172a).setStrokeStyle(2, 0x334155),
      text: this.scene.add.text(0, 0, 'Перезапуск', { color: '#e2e8f0', fontSize: '36px' }),
      space: { left: 28, right: 28, top: 16, bottom: 16 }
    }).layout().setScrollFactor(0).setDepth(3001)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        const stars = this.scene.scene.get('StarSystemScene');
        this.scene.scene.stop('UIScene');
        this.scene.scene.stop('StarSystemScene');
        this.scene.scene.start('PreloadScene');
      });
    title.setPosition(width / 2, height / 2 - 80);
    btn.setPosition(width / 2, height / 2 + 40);
    const group = this.scene.add.container(0, 0, [overlay, title, btn]).setDepth(3000);
    this.gameOverGroup = group;
  }
}
