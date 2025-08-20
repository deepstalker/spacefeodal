import Phaser from 'phaser';
import { MinimapManager } from '@/sys/MinimapManager';
import type { ConfigManager } from '@/sys/ConfigManager';
import type { PauseManager } from '@/sys/PauseManager';
import type { TimeManager } from '@/sys/TimeManager';

export class HUDManager {
  private scene: Phaser.Scene;
  private configRef?: ConfigManager;
  private pauseManager?: PauseManager;
  private timeManager?: TimeManager;
  private combatManager?: any; // Ссылка на CombatManager
  
  // HUD elements
  private speedText?: Phaser.GameObjects.Text;
  private followToggle?: any;
  private hullFill?: Phaser.GameObjects.Rectangle;
  private playerHp: number | null = null;
  private shipNameText?: Phaser.GameObjects.Text;
  private shipIcon?: Phaser.GameObjects.Image;
  private systemTitleText?: Phaser.GameObjects.Text;
  private systemSectorText?: Phaser.GameObjects.Text;
  private weaponSlotsContainer?: Phaser.GameObjects.Container;
  private weaponPanel?: Phaser.GameObjects.Rectangle;
  private hullBarWidth: number = 1228;
  private hullRect?: { x: number; y: number; w: number; h: number };
  private uiTextResolution: number = 2;
  private gameOverGroup?: Phaser.GameObjects.Container;
  private followLabel?: Phaser.GameObjects.Text;
  private minimap?: MinimapManager;
  private minimapHit?: Phaser.GameObjects.Zone;
  private isMinimapDragging: boolean = false;
  private minimapBounds?: { x: number; y: number; w: number; h: number };
  
  // Pause and Time UI elements
  private pauseIndicator?: Phaser.GameObjects.Text;
  private pauseBlinkTween?: Phaser.Tweens.Tween;
  private cycleCounterText?: Phaser.GameObjects.Text;
  private cycleProgressBar?: Phaser.GameObjects.Rectangle;
  private cycleProgressBarBg?: Phaser.GameObjects.Rectangle;
  // Combat UI state
  private slotRecords: Array<{
    slotIndex: number;
    slotKey: string;
    baseX: number; baseY: number;
    size: number;
    bg: Phaser.GameObjects.Rectangle;
    outline: Phaser.GameObjects.Rectangle;
    under?: Phaser.GameObjects.Rectangle;
    icon?: Phaser.GameObjects.Image;
    badge?: Phaser.GameObjects.Rectangle;
    badgeText?: Phaser.GameObjects.Text;
  }> = [];
  private selectedSlots: Set<number> = new Set();
  private cursorIcons: Map<number, Phaser.GameObjects.Container> = new Map();
  private cursorOrder: number[] = [];
  private assignedIconsBySlot: Map<string, { target: any; container: Phaser.GameObjects.Container; updater: () => void }>= new Map();
  private cooldownBarsBySlot: Map<string, { bg: Phaser.GameObjects.Rectangle; outline: Phaser.GameObjects.Rectangle; fill: Phaser.GameObjects.Rectangle; width: number; height: number }>= new Map();
  private outOfRangeTexts: Map<string, Phaser.GameObjects.Text> = new Map();
  private assignedBlinkTweens: Map<string, Phaser.Tweens.Tween[]> = new Map();
  private beamDurationActive: Set<string> = new Set();
  // Speed display state
  private lastSpeedU: number = 0;
  private pausedSpeedU: number | null = null;
  private isPaused: boolean = false;
  private lastChargeProgressBySlot: Map<string, number> = new Map();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  init(config: ConfigManager, ship: Phaser.GameObjects.GameObject, pauseManager?: PauseManager, timeManager?: TimeManager) {
    this.configRef = config;
    this.pauseManager = pauseManager;
    this.timeManager = timeManager;
    
    // сброс локального UI-состояния
    this.selectedSlots.clear();
    this.cursorOrder = [];
    this.assignedIconsBySlot.clear();

    this.createHUD(ship);
    this.createWeaponBar();
    this.createMinimap(ship);
    this.createSystemTitle();
    this.createPauseUI();
    this.createTimeUI();
    


    const starScene = this.scene.scene.get('StarSystemScene') as any;
    this.combatManager = starScene.combat; // Сохраняем ссылку на CombatManager
    
    starScene.events.on('player-damaged', (hp: number) => this.onPlayerDamaged(hp));
    starScene.events.on('player-weapon-fired', (slotKey: string) => this.flashAssignedIcon(slotKey));
    starScene.events.on('player-weapon-target-cleared', (_target: any, slots: string[]) => slots.forEach(s => this.removeAssignedIcon(s)));
    // Beam HUD: показывать duration как 100% и затем refresh обрабатывается в updateWeaponChargeBars
    starScene.events.on('beam-start', (slotKey: string, durationMs: number) => this.showBeamDuration(slotKey, durationMs));
    // Снять флаг duration при старте refresh
    starScene.events.on('beam-refresh', (slotKey: string) => { this.beamDurationActive.delete(slotKey); });
    // Out of range — отдельный текст
    starScene.events.on('weapon-out-of-range', (slotKey: string, show: boolean) => this.toggleOutOfRange(slotKey, show));

    // Подписываемся на событие снятия паузы для принудительного обновления прогресс-баров
    this.scene.events.on('game-resumed', () => {
      // Немедленно обновляем прогресс-бары после снятия паузы
      this.updateWeaponChargeBars();
      // Возврат отображения скорости к фактической
      this.pausedSpeedU = null;
    });
    this.scene.events.on('game-paused', () => { this.isPaused = true; });
    this.scene.events.on('game-resumed', () => { 
      this.isPaused = false;
      // Без очистки и скрытия: оставляем бары в актуальном состоянии, чтобы избежать скачков
    });

    this.scene.events.on(Phaser.Scenes.Events.UPDATE, () => this.updateHUD());
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, () => this.updateFollowMode());
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, () => this.realignCursorIcons());
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, () => this.syncSlotsVisual());
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, () => this.updateTimeUI());
    
    // Прогресс-бары оружия обновляются ВСЕГДА, даже во время паузы
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, () => this.updateWeaponChargeBars());

    // Клавиши
    const kb = this.scene.input.keyboard;
    const numberKeys = [
      Phaser.Input.Keyboard.KeyCodes.ONE,
      Phaser.Input.Keyboard.KeyCodes.TWO,
      Phaser.Input.Keyboard.KeyCodes.THREE,
      Phaser.Input.Keyboard.KeyCodes.FOUR,
      Phaser.Input.Keyboard.KeyCodes.FIVE,
      Phaser.Input.Keyboard.KeyCodes.SIX,
      Phaser.Input.Keyboard.KeyCodes.SEVEN,
      Phaser.Input.Keyboard.KeyCodes.EIGHT,
      Phaser.Input.Keyboard.KeyCodes.NINE
    ];
    numberKeys.forEach((code, idx) => {
      const key = kb?.addKey(code);
      key?.on('down', () => this.toggleSelectSlotByIndex(idx));
    });
    // Отладочный спавн отключён — спавн NPC централизован через симулятор
    const backtick = kb?.addKey((Phaser.Input.Keyboard.KeyCodes as any).BACKTICK ?? 192);
    backtick?.on('down', () => {
      const allSelected = this.selectedSlots.size === this.slotRecords.length && this.slotRecords.length > 0;
      if (allSelected) this.clearAllSelections();
      else this.selectAllWeapons();
    });

    // Действие атаки по выбранной цели: назначаем все выбранные слоты на текущую цель
    try {
      const stars = this.scene.scene.get('StarSystemScene') as any;
      const inputMgr = stars?.inputMgr;
      inputMgr?.onAction('attackSelected', () => {
        const target = stars?.combat?.getSelectedTarget?.();
        if (!target || this.selectedSlots.size === 0) return;
        const playerSlots: string[] = (this.configRef!.player?.weapons ?? []).filter((w: string)=>!!w);
        const bySlotIndex = Array.from(this.selectedSlots.values()).sort((a,b)=>a-b);
        bySlotIndex.forEach((idx) => {
          const slotKey = playerSlots[idx];
          if (!slotKey) return;
          const currentTarget = stars.combat.getPlayerWeaponTargets().get(slotKey);
          if (currentTarget && currentTarget !== target) {
            this.removeAssignedIcon(slotKey);
          }
          stars.combat.setPlayerWeaponTarget(slotKey, target);
          stars.combat.forceSelectTarget(target);
          this.createAssignedIcon(slotKey, target);
          this.removeCursorIcon(idx);
          const rec = this.slotRecords[idx];
          if (rec) this.deselectSlot(rec as any);
        });
        this.selectedSlots.clear();
      });
    } catch {}

    // Клики
    this.scene.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonReleased()) this.handleLeftClickForWeapons(p);
      if (p.rightButtonReleased()) this.handleRightClickForWeapons();
    });
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

    // Speed numeric readout: число и отдельный суффикс U/S меньшим шрифтом
    const speedValue = this.scene.add.text(pad + 16, hudY - 52, '0', {
      color: '#F5F0E9',
      fontSize: '32px',
      fontFamily: 'Request',
      padding: { top: 8, bottom: 4, left: 2, right: 2 }
    }).setOrigin(0, 0.8).setScrollFactor(0).setDepth(1502);
    const speedSuffix = this.scene.add.text((pad + 16) + 4, hudY - 52, 'U/S', {
      color: '#F5F0E9',
      fontSize: '20px',
      fontFamily: 'Request',
      padding: { top: 10, bottom: 4, left: 0, right: 0 }
    }).setOrigin(0, 0.8).setScrollFactor(0).setDepth(1502);
    
    try { (speedValue as any).setResolution?.(this.uiTextResolution); } catch {}
    this.speedText = speedValue;
    // Связываем суффикс с числом: позиция зависит от ширины числа
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, () => {
      if (speedValue && speedValue.active && speedSuffix && speedSuffix.active) {
        speedSuffix.x = speedValue.x + speedValue.width + 6;
        speedSuffix.y = speedValue.y;
      }
    });
    
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
    (this.scene as any).__hudSpeedSuffix = speedSuffix;
    
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
        // Дублируем клик на кнопку в действие высокого уровня
        const stars = this.scene.scene.get('StarSystemScene') as any;
        stars?.inputMgr?.emitAction?.('toggleFollow');
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

  private createSystemTitle() {
    if (!this.configRef) return;
    const sys = this.configRef.system;
    const padBelowMap = 20;
    const titleFontPx = 48;
    const sectorGapPx = 20;
    const map = this.minimapBounds;
    const baseX = map ? (map.x + map.w / 2) : (this.scene.scale.width / 2);
    const baseY = map ? (map.y + map.h + padBelowMap) : 40;
    const title = this.scene.add.text(baseX, baseY, sys.name ?? '', {
      color: '#ffffff',
      fontSize: `${titleFontPx}px`,
      fontFamily: 'HooskaiChamferedSquare'
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1501);
    const sectorText = sys.sector ? `Сектор ${sys.sector}` : '';
    const sector = this.scene.add.text(baseX, baseY + titleFontPx + sectorGapPx, sectorText, {
      color: '#ffffff',
      fontSize: '24px',
      fontFamily: 'roboto'
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1501);
    try { (title as any).setResolution?.(this.uiTextResolution); (sector as any).setResolution?.(this.uiTextResolution); } catch {}
    this.systemTitleText = title;
    this.systemSectorText = sector;
    // Обновлять позицию при ресайзе
    this.scene.scale.on('resize', (gameSize: any) => {
      const mapNow = this.minimapBounds;
      const nx = mapNow ? (mapNow.x + mapNow.w / 2) : (gameSize.width / 2);
      const ny = mapNow ? (mapNow.y + mapNow.h + padBelowMap) : 40;
      this.systemTitleText?.setPosition(nx, ny);
      this.systemSectorText?.setPosition(nx, ny + titleFontPx + sectorGapPx);
    });
  }

  // Отладочный спавн отключён

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
    const playerSlots = (this.configRef.player?.weapons ?? []).filter(w => w && w.trim() !== '');
    const equippedWeapons = playerSlots;
    const actualSlotsCount = Math.max(1, equippedWeapons.length); // минимум 1 слот для отображения
    
    // Фиксированные размеры панели и HP бара
    const fixedPanelW = 900; // фиксированная ширина панели
    const fixedPanelH = 200; // фиксированная высота панели
    const fixedHpBarW = 600; // фиксированная ширина HP бара
    const fixedHpBarH = 60;  // фиксированная высота HP бара
    
    const panelOffset = 20;
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
    
    // Отображаем только экипированные слоты и делаем их интерактивными
    this.slotRecords = [];
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
          img.setOrigin(0.5, 0);
          
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

          const rec = { slotIndex: i, slotKey: weaponKey, baseX: x, baseY: y, size: slotSize, bg: slotBg, outline: this.scene.add.rectangle(x, y, slotSize, slotSize, 0x000000, 0).setOrigin(0,0).setDepth(1503).setScrollFactor(0), under, icon: img };
          rec.outline.setStrokeStyle(0, 0x00ff00, 1);
          this.slotRecords.push(rec as any);
          // badge number already below — keep it
          (rec as any).badge = undefined; (rec as any).badgeText = undefined;
          // interactivity: toggle select
          const hitZone = this.scene.add.zone(x, y, slotSize, slotSize).setOrigin(0,0).setScrollFactor(0).setDepth(1504).setInteractive({ useHandCursor: true });
          hitZone.on('pointerdown', () => this.toggleSelectSlotByIndex(i));
          container.add(hitZone);
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
        padding: { top: Math.max(2, fontSize * 0.15), bottom: 4, left: 2, right: 2 }
      }).setOrigin(0.5, 0.5).setDepth(1503).setScrollFactor(0);
      
      // Явно устанавливаем шрифт для цифр на значках
      num.setFontFamily('Request');
      try { (num as any).setResolution?.(this.uiTextResolution); } catch {}
      container.add(badge);
      container.add(num);
      const rec = this.slotRecords.find(r => r.slotIndex === i);
      if (rec) { rec.badge = badge; rec.badgeText = num; }
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
    const hpText = this.scene.add.text(hpX + hpTextPadding, hpY + fixedHpBarH/2 - 10, '100', { 
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

    // После сборки баров — принудительно синхронизируем
    this.syncSlotsVisual();
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
    
    // Speed actual units per second (умножить на 100)
    const star = this.scene.scene.get('StarSystemScene') as any;
    const ship = star?.ship as Phaser.GameObjects.Image | undefined;
    if (ship && this.speedText) {
      const mv = this.getMovementConfig();
      const max = mv?.MAX_SPEED ?? 1;
      let displayU: number;
      if (this.pauseManager?.getPaused()) {
        // Во время паузы показываем зафиксированную скорость
        if (this.pausedSpeedU == null) {
          // Если по какой-то причине не зафиксирована — используем последнюю вычисленную
          displayU = this.lastSpeedU;
        } else {
          displayU = this.pausedSpeedU;
        }
      } else {
        const prev = (ship as any).__prevPos || { x: ship.x, y: ship.y };
        const dx = ship.x - prev.x;
        const dy = ship.y - prev.y;
        const dt = Math.max(1 / 60, this.scene.game.loop.delta / 1000);
        const v = Math.hypot(dx, dy) / dt; // px per second
        (ship as any).__prevPos = { x: ship.x, y: ship.y };
        const u = Math.round(((max > 0 ? (v / max) : 0) * max) * 10);
        this.lastSpeedU = u;
        displayU = u;
      }
      const txt = (this.scene as any).__hudSpeedValue as Phaser.GameObjects.Text | undefined;
      if (txt) txt.setText(`${displayU}`);
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

  private isClickInWeaponSlot(screenX: number, screenY: number): boolean {
    // Проверяем попадание клика в область любого слота оружия (в экранных координатах)
    for (const rec of this.slotRecords) {
      // Получаем экранные координаты слота (слоты используют setScrollFactor(0))
      const slotScreenX = rec.baseX;
      const slotScreenY = rec.bg?.y ?? rec.baseY; // используем актуальную Y позицию
      const slotSize = rec.size;
      
      if (screenX >= slotScreenX && screenX <= slotScreenX + slotSize &&
          screenY >= slotScreenY && screenY <= slotScreenY + slotSize) {
        return true;
      }
    }
    return false;
  }

  private toggleSelectSlotByIndex(idx: number) {
    const rec = this.slotRecords[idx];
    if (!rec) return;
    if (this.selectedSlots.has(idx)) this.deselectSlot(rec);
    else this.selectSlot(rec);
  }

  private selectSlot(rec: { slotIndex: number; slotKey: string; baseX: number; baseY: number; size: number; bg: any; outline: any; under?: any; icon?: any; }) {
    this.selectedSlots.add(rec.slotIndex);
    if (!this.cursorOrder.includes(rec.slotIndex)) this.cursorOrder.push(rec.slotIndex);

    // зелёный аутлайн только на время выбора
    rec.outline.setStrokeStyle(2, 0x00ff66, 1);
    // поднимем слот, если он ещё не поднят
    const targetY = rec.baseY - 20;
    const mainToMove = [rec.bg, rec.outline, rec.under, rec.icon].filter(Boolean);
    if (Math.abs((rec.bg as any).y - targetY) > 1) {
      this.scene.tweens.add({ targets: mainToMove, y: targetY, duration: 90, ease: 'Sine.easeOut' });
      // Для бейджа анимируем к правильной позиции относительно нового положения слота
      const badge = (rec as any).badge;
      const badgeText = (rec as any).badgeText;
      if (badge && badgeText) {
        const slotSize = rec.size;
        const badgeSize = Math.max(32, slotSize * 0.35);
        const badgePadding = Math.max(4, slotSize * 0.05);
        this.scene.tweens.add({ targets: badge, y: targetY + slotSize - badgePadding - badgeSize, duration: 90, ease: 'Sine.easeOut' });
        this.scene.tweens.add({ targets: badgeText, y: targetY + slotSize - badgePadding - badgeSize/2, duration: 90, ease: 'Sine.easeOut' });
      }
    }
    // иконка на курсоре
    this.addCursorIcon(rec);
    this.realignCursorIcons();

    // Сообщаем сцене о выборе слота оружия (для чисто визуальных эффектов)
    try {
      const star = this.scene.scene.get('StarSystemScene') as any;
      star?.events?.emit('weapon-slot-selected', rec.slotKey, true);
    } catch {}
  }

  private deselectSlot(rec: { slotIndex: number; slotKey: string; baseX: number; baseY: number; size: number; bg: any; outline: any; under?: any; icon?: any; }) {
    this.selectedSlots.delete(rec.slotIndex);
    this.cursorOrder = this.cursorOrder.filter(i => i !== rec.slotIndex);

    const isAssigned = Array.from(this.assignedIconsBySlot.keys()).includes(rec.slotKey);
    if (!isAssigned) {
      rec.outline.setStrokeStyle(0, 0x00ff66, 1);
      const mainToMove = [rec.bg, rec.outline, rec.under, rec.icon].filter(Boolean);
      // вернём ровно к baseY
      this.scene.tweens.add({ targets: mainToMove, y: rec.baseY, duration: 90, ease: 'Sine.easeOut' });
      // Для бейджа анимируем к правильной позиции относительно базового положения слота
      const badge = (rec as any).badge;
      const badgeText = (rec as any).badgeText;
      if (badge && badgeText) {
        const slotSize = rec.size;
        const badgeSize = Math.max(32, slotSize * 0.35);
        const badgePadding = Math.max(4, slotSize * 0.05);
        this.scene.tweens.add({ targets: badge, y: rec.baseY + slotSize - badgePadding - badgeSize, duration: 90, ease: 'Sine.easeOut' });
        this.scene.tweens.add({ targets: badgeText, y: rec.baseY + slotSize - badgePadding - badgeSize/2, duration: 90, ease: 'Sine.easeOut' });
      }
    } else {
      // активный слот остаётся поднятым и красным
      rec.outline.setStrokeStyle(2, 0xA93226, 1);
      const mainToMove = [rec.bg, rec.outline, rec.under, rec.icon].filter(Boolean);
      mainToMove.forEach((g: any) => { if (g) g.y = rec.baseY - 20; });
      // Для бейджа устанавливаем позицию относительно поднятого положения слота
      const badge = (rec as any).badge;
      const badgeText = (rec as any).badgeText;
      if (badge && badgeText) {
        const slotSize = rec.size;
        const badgeSize = Math.max(32, slotSize * 0.35);
        const badgePadding = Math.max(4, slotSize * 0.05);
        badge.y = rec.baseY - 20 + slotSize - badgePadding - badgeSize;
        badgeText.y = rec.baseY - 20 + slotSize - badgePadding - badgeSize/2;
      }
    }
    this.removeCursorIcon(rec.slotIndex);
    this.realignCursorIcons();

    // Сообщаем сцене о снятии выбора слота оружия (для чисто визуальных эффектов)
    try {
      const star = this.scene.scene.get('StarSystemScene') as any;
      star?.events?.emit('weapon-slot-selected', rec.slotKey, false);
    } catch {}
  }

  private addCursorIcon(rec: { slotIndex: number; slotKey: string; size: number; }) {
    if (this.cursorIcons.has(rec.slotIndex)) return;
    const size = 48;
    const defs = this.configRef!.weapons.defs as any;
    const items = this.configRef!.items?.rarities as any;
    const rarityKey = defs[rec.slotKey]?.rarity as string | undefined;
    const rarityColorHex = rarityKey && items?.[rarityKey]?.color ? Number(items[rarityKey].color.replace('#','0x')) : 0x000000;
    const iconKey = defs[rec.slotKey]?.icon ?? rec.slotKey;
    const bg = this.scene.add.rectangle(0, 0, size, size, 0x2c2a2d, 1).setOrigin(0.5).setScrollFactor(0).setDepth(4002);
    bg.setStrokeStyle(2, 0x00ff66, 1);
    const under = this.scene.add.rectangle(0, 0, size - 6, size - 6, rarityColorHex, 0.8).setOrigin(0.5).setScrollFactor(0).setDepth(4002);
    const img = this.scene.add.image(0, 0, iconKey).setOrigin(0.5).setScrollFactor(0).setDepth(4003);
    try { const tx = this.scene.textures.get(iconKey); const scale = Math.min((size - 12) / tx.source[0].width, (size - 12) / tx.source[0].height); img.setScale(scale); } catch {}
    const cont = this.scene.add.container(0, 0, [under, bg, img]).setDepth(4002).setAlpha(0.95);
    this.cursorIcons.set(rec.slotIndex, cont);

    // без пер-иконных апдейтов; глобально двигаем в realignCursorIcons()
  }

  private removeCursorIcon(slotIndex: number) {
    const c = this.cursorIcons.get(slotIndex);
    if (!c) return;
    this.cursorIcons.delete(slotIndex);
    c.destroy();

  }

  private selectAllWeapons() {
    for (const rec of this.slotRecords) {
      if (!this.selectedSlots.has(rec.slotIndex)) this.selectSlot(rec);
    }
  }

  private clearAllSelections() {
    for (const idx of Array.from(this.selectedSlots.values())) {
      const rec = this.slotRecords[idx];
      if (rec) this.deselectSlot(rec);
      this.removeCursorIcon(idx);
    }
    this.selectedSlots.clear();
    this.cursorOrder = [];

    // Дополнительно информируем сцену, что все выборы сняты (для страховки)
    try {
      const star = this.scene.scene.get('StarSystemScene') as any;
      const slots = (this.configRef!.player?.weapons ?? []).filter((k: string)=>!!k);
      for (const slotKey of slots) star?.events?.emit('weapon-slot-selected', slotKey, false);
    } catch {}
  }

  private handleLeftClickForWeapons(p: Phaser.Input.Pointer) {
    if (this.selectedSlots.size === 0) return;
    
    // Проверяем, попал ли клик в область слота оружия - если да, не обрабатываем
    if (this.isClickInWeaponSlot(p.x, p.y)) {
      return; // Клик по слоту - пусть обрабатывает toggleSelectSlotByIndex
    }
    
    // Проверим попадание по цели в StarSystemScene
    const star: any = this.scene.scene.get('StarSystemScene');
    const cam = star.cameras?.main as Phaser.Cameras.Scene2D.Camera | undefined;
    let wx = p.worldX, wy = p.worldY;
    if (cam) {
      const out = new Phaser.Math.Vector2();
      try {
        (cam as any).getWorldPoint?.(p.x, p.y, out);
        if (!Number.isNaN(out.x) && !Number.isNaN(out.y)) { wx = out.x; wy = out.y; }
      } catch {
        wx = cam.scrollX + p.x / cam.zoom;
        wy = cam.scrollY + p.y / cam.zoom;
      }
    }
    const hit = star.combat?.findTargetAt?.(wx, wy);

    if (hit) {
      // Назначаем выбранные слоты на цель
      const playerSlots: string[] = (this.configRef!.player?.weapons ?? []).filter((w: string)=>!!w);
      const bySlotIndex = Array.from(this.selectedSlots.values()).sort((a,b)=>a-b);
      bySlotIndex.forEach((idx) => {
        const slotKey = playerSlots[idx];
        if (!slotKey) return;
        const targetObj = (hit as any).obj ?? hit;
        
        // Если у этого оружия уже была назначенная цель, удаляем иконку с предыдущей цели
        const currentTarget = star.combat.getPlayerWeaponTargets().get(slotKey);
        if (currentTarget && currentTarget !== targetObj) {
          this.removeAssignedIcon(slotKey);
        }
        
        star.combat.setPlayerWeaponTarget(slotKey, targetObj);
        // сделать эту цель текущей выделенной
        star.combat.forceSelectTarget(targetObj);
        this.createAssignedIcon(slotKey, targetObj);
        // убрать курсор-иконку и снять выделение
        this.removeCursorIcon(idx);
        const rec = this.slotRecords[idx];
        if (rec) this.deselectSlot(rec as any);
      });
      // оставим выбор слотов снятым, но НЕ сбрасываем сразу cursorOrder — он очищается в deselectSlot
      this.selectedSlots.clear();
    } else {
      // Клик мимо цели — сбросить только выбранные слоты/цели; информационную цель не трогаем здесь
      const playerSlots: string[] = (this.configRef!.player?.weapons ?? []).filter((w: string)=>!!w);
      const bySlotIndex = Array.from(this.selectedSlots.values());
      bySlotIndex.forEach((idx) => {
        const slotKey = playerSlots[idx];
        if (!slotKey) return;
        // сброс цели
        star.combat.setPlayerWeaponTarget(slotKey, null);
        this.removeAssignedIcon(slotKey);
        this.removeCursorIcon(idx);
        const rec = this.slotRecords[idx];
        if (rec) this.deselectSlot(rec as any);
      });
      this.selectedSlots.clear();
      this.cursorOrder = [];
    }
  }

  private handleRightClickForWeapons() {
    // Сброс выбора оружия при ПКМ (если включено в настройках)
    const enabled = this.configRef?.settings?.ui?.combat?.rightClickCancelSelectedWeapons ?? true;
    if (!enabled) return;
    if (this.selectedSlots.size === 0) return;
    for (const idx of Array.from(this.selectedSlots.values())) {
      this.removeCursorIcon(idx);
      const rec = this.slotRecords[idx];
      if (rec) this.deselectSlot(rec as any);
    }
    this.selectedSlots.clear();
  }

  private createAssignedIcon(slotKey: string, target: any) {
    const existing = this.assignedIconsBySlot.get(slotKey);
    if (existing) { 
      // Если оружие переназначается на новую цель, сначала удаляем старую иконку
      this.removeAssignedIcon(slotKey);
    }
    const size = 48;
    const defs: any = this.configRef!.weapons.defs;
    const items: any = this.configRef!.items?.rarities;
    const rarityKey = defs[slotKey]?.rarity as string | undefined;
    const rarityColorHex = rarityKey && items?.[rarityKey]?.color ? Number(items[rarityKey].color.replace('#','0x')) : 0x000000;
    const iconKey = defs[slotKey]?.icon ?? slotKey;
    const star: any = this.scene.scene.get('StarSystemScene');
    // Добавляем в StarSystemScene, а не в UIScene, и на глубину между HP-баром (0.6) и именем (0.7)
    const bg = star.add.rectangle(0, 0, size, size, 0x2c2a2d, 1).setOrigin(0.5).setDepth(0.65);
    bg.setStrokeStyle(2, 0xA93226, 1);
    const under = star.add.rectangle(0, 0, size - 6, size - 6, rarityColorHex, 0.8).setOrigin(0.5).setDepth(0.65);
    const img = star.add.image(0, 0, iconKey).setOrigin(0.5).setDepth(0.66);
    try { const tx = this.scene.textures.get(iconKey); const scale = Math.min((size - 12)/tx.source[0].width, (size - 12)/tx.source[0].height); img.setScale(scale); } catch {}
    const outlineFlash = star.add.rectangle(0, 0, size, size, 0x000000, 0).setOrigin(0.5).setDepth(0.67).setStrokeStyle(2, 0xA93226, 1).setAlpha(0);
    const cont = star.add.container(0, 0, [under, bg, img, outlineFlash]).setDepth(0.66);

    const updater = () => {
      const hp = star.combat?.getHpBarInfoFor?.(target);
      if (!hp) return;
      // позиция над именем: над HP баром на высоту иконки + небольшой отступ
      const sx = hp.x;
      const sy = hp.y; // world coords
      const slotsAssigned = Array.from(this.assignedIconsBySlot.entries()).filter(([,v]) => v.target === target).map(([k]) => k);
      const idx = slotsAssigned.indexOf(slotKey);
      const spacing = size + 8;
      const totalW = slotsAssigned.length * spacing - 8;
      const startX = sx + (hp.width - totalW) / 2 + size/2;
      const cx = startX + idx * spacing;
      const cy = sy - (size + 16);
      cont.x = cx;
      cont.y = cy;
    };
    star.events.on(Phaser.Scenes.Events.UPDATE, updater);
    this.assignedIconsBySlot.set(slotKey, { target, container: cont, updater });

    // сделать слот активным (поднять и красный контур)
    const slotIndex = (this.configRef!.player?.weapons ?? []).findIndex(k => k === slotKey);
    const recSlot = slotIndex >= 0 ? this.slotRecords[slotIndex] : undefined;
    if (recSlot) {
      recSlot.outline.setStrokeStyle(2, 0xA93226, 1);
      const targetY = recSlot.baseY - 20;
      const mainToMove = [recSlot.bg, recSlot.outline, recSlot.under, recSlot.icon].filter(Boolean);
      mainToMove.forEach((g: any) => { if (g) g.y = targetY; });
      // Для бейджа устанавливаем позицию относительно поднятого положения слота
      const badge = (recSlot as any).badge;
      const badgeText = (recSlot as any).badgeText;
      if (badge && badgeText) {
        const slotSize = recSlot.size;
        const badgeSize = Math.max(32, slotSize * 0.35);
        const badgePadding = Math.max(4, slotSize * 0.05);
        badge.y = targetY + slotSize - badgePadding - badgeSize;
        badgeText.y = targetY + slotSize - badgePadding - badgeSize/2;
      }
    }

    (cont as any).__flash = outlineFlash;
  }

  private removeAssignedIcon(slotKey: string) {
    const rec = this.assignedIconsBySlot.get(slotKey);
    if (!rec) return;
    this.assignedIconsBySlot.delete(slotKey);
    const star: any = this.scene.scene.get('StarSystemScene');
    star.events.off(Phaser.Scenes.Events.UPDATE, rec.updater);
    rec.container.destroy();
    // удалить HUD прогресс-бар для этого слота, если есть
    const bar = this.cooldownBarsBySlot.get(slotKey);
    if (bar) {
      try { bar.bg.destroy(); } catch {}
      try { bar.fill.destroy(); } catch {}
      try { bar.outline.destroy(); } catch {}
      this.cooldownBarsBySlot.delete(slotKey);
    }
    // вернуть слот в норму/оставить поднятым если всё ещё выбран; всегда убрать красную обводку
    const slotIndex = (this.configRef!.player?.weapons ?? []).findIndex(k => k === slotKey);
    const recSlot = slotIndex >= 0 ? this.slotRecords[slotIndex] : undefined;
    if (recSlot) {
      const selected = this.selectedSlots.has(recSlot.slotIndex);
      const targetY = recSlot.baseY + (selected ? -20 : 0);
      const mainNodes = [recSlot.bg, recSlot.outline, recSlot.under, recSlot.icon].filter(Boolean);
      mainNodes.forEach((n: any) => { if (n) n.y = targetY; });
      // Для бейджа устанавливаем позицию относительно нового положения слота
      const badge = (recSlot as any).badge;
      const badgeText = (recSlot as any).badgeText;
      if (badge && badgeText) {
        const slotSize = recSlot.size;
        const badgeSize = Math.max(32, slotSize * 0.35);
        const badgePadding = Math.max(4, slotSize * 0.05);
        badge.y = targetY + slotSize - badgePadding - badgeSize;
        badgeText.y = targetY + slotSize - badgePadding - badgeSize/2;
      }
      // обводка: если выбран, зелёная; иначе убрать
      if (selected) recSlot.outline.setStrokeStyle(2, 0x00ff66, 1);
      else recSlot.outline.setStrokeStyle(0, 0x00ff66, 1);
    }
  }

  private flashAssignedIcon(slotKey: string) {
    const rec = this.assignedIconsBySlot.get(slotKey);
    const cont: any = rec?.container;
    const flash: Phaser.GameObjects.Rectangle | undefined = cont?.list?.find((c: any) => (c as any).strokeColor === 0xA93226);
    if (!flash) return;
    (flash as any).setAlpha(1);
    this.scene.tweens.add({ targets: flash, alpha: 0, duration: 120 });
    // Показать прогресс-бар перезарядки в HUD (без анимации твина)
    this.showCooldownBarInHUD(slotKey);
    // мигать КРАСНЫМ контуром слота, и оставить красным
    const slotIndex = (this.configRef!.player?.weapons ?? []).findIndex(k => k === slotKey);
    const recSlot = slotIndex >= 0 ? this.slotRecords[slotIndex] : undefined;
    if (recSlot) {
      recSlot.outline.setStrokeStyle(2, 0xA93226, 1);
      const tw = this.scene.tweens.add({ targets: recSlot.outline, alpha: 0.2, duration: 80, yoyo: true, onComplete: () => { recSlot.outline.setAlpha(1); recSlot.outline.setStrokeStyle(2, 0xA93226, 1); } });
      const arr = this.assignedBlinkTweens.get(slotKey) ?? [];
      arr.push(tw);
      this.assignedBlinkTweens.set(slotKey, arr);
    }
  }

  private showCooldownBarInHUD(slotKey: string) {
    // Определяем позицию слота в HUD
    const slotIndex = (this.configRef!.player?.weapons ?? []).findIndex(k => k === slotKey);
    if (slotIndex < 0) return;
    const recSlot = this.slotRecords[slotIndex];
    if (!recSlot) return;
    
    // Убедимся, что бар существует и видим
    const bar = this.ensureHudBar(slotKey, recSlot);
    bar.bg.setVisible(true);
    bar.outline.setVisible(true);
    bar.fill.setVisible(true);
    // Ширина будет обновлена в updateWeaponChargeBars в следующем кадре
  }

  private updateWeaponChargeBars() {
    // Если игра на паузе, не обновляем прогресс-бары
    // Визуальные бары должны обновляться всегда (даже на паузе), поэтому не выходим
    
    if (!this.combatManager || !this.configRef?.player?.weapons) return;
    
    const playerWeapons = this.configRef.player.weapons;
    
    for (let i = 0; i < playerWeapons.length; i++) {
      const slotKey = playerWeapons[i];
      if (!slotKey) continue;
      
      const recSlot = this.slotRecords[i];
      if (!recSlot) continue;
      
      // Если активен луч (duration) — держим 100% без скачков
      if (this.beamDurationActive.has(slotKey)) {
        const bar = this.ensureHudBar(slotKey, recSlot);
        bar.bg.setVisible(true); bar.outline.setVisible(true); bar.fill.setVisible(true);
        bar.fill.width = (bar.width - 4);
        // Не продолжаем — прогрессом управляет duration/refresh
        continue;
      }
      
      const isCharging = this.combatManager.isWeaponCharging(slotKey);
      
      if (isCharging) {
        // Определяем тип оружия для правильного прогресса
        const w = this.configRef.weapons.defs[slotKey];
        const isBeam = (w?.type ?? 'single') === 'beam';
        
        const progress = isBeam 
          ? this.combatManager.getBeamRefreshProgress(slotKey)
          : this.combatManager.getWeaponChargeProgress(slotKey);
        
        // Показываем прогресс-бар
        const bar = this.ensureHudBar(slotKey, recSlot);
        bar.bg.setVisible(true);
        bar.outline.setVisible(true);
        bar.fill.setVisible(true);
        
        // Обновляем ширину напрямую на основе прогресса таймера с клампом монотонности
        const prev = this.lastChargeProgressBySlot.get(slotKey);
        const next = Phaser.Math.Clamp(progress, 0, 1);
        const stable = (this.pauseManager?.getPaused?.() ? Math.max(prev ?? 0, next) : next);
        bar.fill.width = stable * (bar.width - 4);
        this.lastChargeProgressBySlot.set(slotKey, stable);
        
        // Скрываем out-of-range во время зарядки
        this.toggleOutOfRange(slotKey, false);
      } else {
        // На паузе скрываем бары, чтобы избежать зависания
        // Не на паузе: скрываем прогресс-бар, если оружие не заряжается
        const bar = this.cooldownBarsBySlot.get(slotKey);
        if (bar) {
          // Во время паузы не скрываем и не обнуляем — закрепляем текущую ширину
          if (!this.pauseManager?.getPaused?.()) {
            bar.bg.setVisible(false);
            bar.outline.setVisible(false);
            bar.fill.setVisible(false);
            // Удаляем из кэша прогресса при скрытии бара
            this.lastChargeProgressBySlot.delete(slotKey);
          }
        }
      }
    }
  }


  private toggleOutOfRange(slotKey: string, show: boolean) {
    const idx = (this.configRef!.player?.weapons ?? []).findIndex(k => k === slotKey);
    if (idx < 0) return; const recSlot = this.slotRecords[idx]; if (!recSlot) return;
    let txt = this.outOfRangeTexts.get(slotKey);
    if (!txt) {
      txt = this.scene.add.text(0, 0, 'OUT OF RANGE', { color: '#D5008F', fontSize: '16px', fontFamily: 'roboto' }).setDepth(1504).setScrollFactor(0);
      this.outOfRangeTexts.set(slotKey, txt);
    }
    const x = recSlot.baseX; const y = (recSlot as any).bg.y + recSlot.size + 6 + 10; // по центру полосы
    txt.setPosition(x, y).setVisible(show);
    // Если просят показать, но у слота нет назначенной цели — скрываем (нет смысла показывать)
    if (show) {
      const slotAssigned = Array.from(this.assignedIconsBySlot.keys()).includes(slotKey);
      if (!slotAssigned) txt.setVisible(false);
    }
  }

  private showBeamDuration(slotKey: string, durationMs: number) {
    const idx = (this.configRef!.player?.weapons ?? []).findIndex(k => k === slotKey);
    if (idx < 0) return; const recSlot = this.slotRecords[idx]; if (!recSlot) return;
    const bar = this.ensureHudBar(slotKey, recSlot);
    bar.bg.setVisible(true); bar.outline.setVisible(true); bar.fill.setVisible(true);
    // 100% заполнение на время длительности луча (без таймеров, дергаем флаг)
    bar.fill.width = Math.max(0, bar.width - 4);
    try { (this.scene.tweens as any).killTweensOf(bar.fill); } catch {}
    this.beamDurationActive.add(slotKey);
  }

  /**
   * Скрыть все прогресс-бары перезарядки оружия
   */
  private hideAllCooldownBars() {
    for (const [slotKey, bar] of this.cooldownBarsBySlot.entries()) {
      // Скрываем все элементы бара
      bar.bg.setVisible(false);
      bar.outline.setVisible(false);
      bar.fill.setVisible(false);
      
      // Удаляем из кэша прогресса
      this.lastChargeProgressBySlot.delete(slotKey);
    }
  }



  private ensureHudBar(slotKey: string, recSlot: any) {
    let bar = this.cooldownBarsBySlot.get(slotKey);
    if (!bar) {
      const barWidth = recSlot.size; const barHeight = 20;
      const outlineColor = 0xA28F6E; const fillColor = 0xBC5A36; const bgColor = 0x2c2a2d;
      const bg = this.scene.add.rectangle(0, 0, barWidth, barHeight, bgColor, 1).setDepth(1502).setOrigin(0, 0).setScrollFactor(0);
      const outline = this.scene.add.rectangle(0, 0, barWidth, barHeight, 0x000000, 0).setDepth(1503).setOrigin(0, 0).setScrollFactor(0).setStrokeStyle(2, outlineColor, 1);
      const fill = this.scene.add.rectangle(0, 0, 0, barHeight - 4, fillColor, 1).setDepth(1503).setOrigin(0, 0).setScrollFactor(0);
      
      bar = { bg, outline, fill, width: barWidth, height: barHeight };
      this.cooldownBarsBySlot.set(slotKey, bar);
    }
    const x = recSlot.baseX; const y = (recSlot as any).bg.y + recSlot.size + 6;
    bar.bg.setPosition(x, y); bar.outline.setPosition(x, y); bar.fill.setPosition(x + 2, y + 2);
    return bar;
  }

  private realignCursorIcons() {
    const size = 48;
    const spacing = size + 4;
    const order = this.cursorOrder.filter(idx => this.cursorIcons.has(idx));
    const totalW = order.length * spacing - 4;
    const p = this.scene.input.activePointer;
    const startX = p.x - totalW / 2 + size / 2;
    order.forEach((idx, i) => {
      const c = this.cursorIcons.get(idx)!;
      c.x = startX + i * spacing;
      c.y = p.y - size - 8;
    });
  }

  private createMinimap(ship: Phaser.GameObjects.GameObject) {
    if (!this.configRef) return;
    
    // Увеличенные размеры миникарты
    const minimapW = 512; // увеличиваем с 480 до 640
    const minimapH = 384; // увеличиваем с 360 до 480
    const minimapX = this.scene.scale.width - minimapW - 40; // отступ от правого края
    const minimapY = 80; // отступ от верхнего края
    this.minimapBounds = { x: minimapX, y: minimapY, w: minimapW, h: minimapH };
    
    // Инициализируем миникарту с новыми размерами
    this.minimap = new MinimapManager(this.scene, this.configRef);
    this.minimap.init(minimapX, minimapY, minimapW, minimapH);
    this.minimap.attachShip(ship);
    
    // Интегрируем fog of war с миникартой
    const starScene = this.scene.scene.get('StarSystemScene') as any;
    if (starScene?.fogOfWar) {
      this.minimap.setFogOfWar(starScene.fogOfWar);
    }
    
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
      // клик по мини-карте отключает follow
      if (star?.cameraMgr?.isFollowing?.()) star.cameraMgr.disableFollow();
      star.cameras.main.centerOn(worldX, worldY);
      // начинаем перетаскивание при удержании ЛКМ
      if (p.leftButtonDown()) this.isMinimapDragging = true;
    });
    // Глобальный move: тянем камеру даже если курсор вышел за зону мини-карты, пока ЛКМ зажата
    this.scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.isMinimapDragging || !p.leftButtonDown()) return;
      const sys = this.configRef!.system;
      const relX = (p.x - minimapX) / minimapW;
      const relY = (p.y - minimapY) / minimapH;
      const worldX = Phaser.Math.Clamp(relX * sys.size.width, 0, sys.size.width);
      const worldY = Phaser.Math.Clamp(relY * sys.size.height, 0, sys.size.height);
      const star = this.scene.scene.get('StarSystemScene') as any;
      star.cameras.main.centerOn(worldX, worldY);
    });
    this.scene.input.on('pointerup', () => { this.isMinimapDragging = false; });
    // При ресайзе — обновим запомненные границы миникарты (и заголовки подтянутся своим ресайзом)
    this.scene.scale.on('resize', (gameSize: any) => {
      const nx = gameSize.width - minimapW - 40;
      const ny = 40;
      this.minimapBounds = { x: nx, y: ny, w: minimapW, h: minimapH };
    });
  }

  private getMovementConfig() {
    const mv = this.configRef?.gameplay?.movement;
    const playerShipId = this.configRef?.player?.shipId;
    const shipMv = playerShipId ? this.configRef?.ships?.defs[playerShipId]?.movement : undefined;
    return shipMv ?? mv;
  }

  // Game Over overlay with rexUI button
  private createPauseUI() {
    // Индикатор паузы в центре экрана
    const sw = this.scene.scale.width;
    const sh = this.scene.scale.height;
    
    this.pauseIndicator = this.scene.add.text(sw / 2, sh / 2 - 100, 'ПАУЗА', {
      color: '#ffffff',
      fontSize: '72px',
      fontFamily: 'HooskaiChamferedSquare',
      stroke: '#000000',
      strokeThickness: 8
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(5000).setVisible(false);
    
    try { 
      (this.pauseIndicator as any).setResolution?.(this.uiTextResolution); 
    } catch {}
    
    // Подписываемся на события паузы
    this.scene.events.on('game-paused', () => this.showPauseIndicator());
    this.scene.events.on('game-resumed', () => this.hidePauseIndicator());
    // Зафиксировать скорость при входе в паузу (для отображения)
    this.scene.events.on('game-paused', () => {
      const currentText = (this.scene as any).__hudSpeedValue as Phaser.GameObjects.Text | undefined;
      if (currentText) {
        const val = parseInt(currentText.text || '0', 10);
        if (!Number.isNaN(val)) this.pausedSpeedU = val;
      }
    });
    
    // Обновляем позицию при ресайзе
    this.scene.scale.on('resize', (gameSize: any) => {
      if (this.pauseIndicator) {
        this.pauseIndicator.setPosition(gameSize.width / 2, gameSize.height / 2 - 100);
      }
    });
  }

  private createTimeUI() {
    if (!this.minimapBounds) {
      // Создаем с дефолтными позициями, если миникарта еще не готова
      const sw = this.scene.scale.width;
      const sh = this.scene.scale.height;
      const mapX = sw - 512 - 40; // дефолтная позиция миникарты
      const mapY = 40;
      const mapW = 512;
      this.minimapBounds = { x: mapX, y: mapY, w: mapW, h: 384 };
    }
    
    const mapX = this.minimapBounds.x;
    const mapY = this.minimapBounds.y;
    const mapW = this.minimapBounds.w;
    
    // Счетчик циклов рядом с миникартой (гарантированно в пределах экрана)
    const cycleX = mapX + mapW / 2;
    const cycleY = Math.max(24, mapY - 26);
    
    this.cycleCounterText = this.scene.add.text(cycleX, cycleY, 'Цикл: 0010', {
      color: '#ffffff',
      fontSize: '28px',
      fontFamily: 'HooskaiChamferedSquare',
      align: 'center',
      lineSpacing: 8
    }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(1501);
    
    try { 
      (this.cycleCounterText as any).setResolution?.(this.uiTextResolution); 
    } catch {}
    
    // Прогресс-бар под счетчиком циклов
    const barY = cycleY + 12;
    const barW = mapW - 40; // Чуть уже миникарты
    const barH = 4;
    const barX = mapX + 20; // Центрируем
    
    this.cycleProgressBarBg = this.scene.add.rectangle(barX, barY, barW, barH, 0x2c2a2d, 1)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(1500);
    this.cycleProgressBarBg.setStrokeStyle(1, 0xA28F6E, 1);
    
    this.cycleProgressBar = this.scene.add.rectangle(barX + 1, barY, 0, barH - 2, 0x22c55e, 1)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(1501);
    
    // Обновляем позицию при ресайзе
    this.scene.scale.on('resize', (gameSize: any) => {
      if (this.cycleCounterText && this.minimapBounds) {
        const newMapX = gameSize.width - this.minimapBounds.w - 40;
        const newCycleX = newMapX + this.minimapBounds.w / 2;
        this.cycleCounterText.setPosition(newCycleX, cycleY);
        
        if (this.cycleProgressBarBg) {
          this.cycleProgressBarBg.setPosition(newMapX + 20, barY);
        }
        if (this.cycleProgressBar) {
          this.cycleProgressBar.setPosition(newMapX + 21, barY);
        }
      }
    });
  }

  private showPauseIndicator() {
    if (!this.pauseIndicator) return;
    
    this.pauseIndicator.setVisible(true);
    
    // Создаем мигающий эффект
    if (this.pauseBlinkTween) {
      this.pauseBlinkTween.destroy();
    }
    
    this.pauseBlinkTween = this.scene.tweens.add({
      targets: this.pauseIndicator,
      alpha: 0.3,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
    
    // Помечаем как UI tween, чтобы он НЕ останавливался при паузе
    (this.pauseBlinkTween as any).__isUITween = true;
  }

  private hidePauseIndicator() {
    if (!this.pauseIndicator) return;
    
    this.pauseIndicator.setVisible(false);
    
    if (this.pauseBlinkTween) {
      this.pauseBlinkTween.destroy();
      this.pauseBlinkTween = undefined;
    }
    
    // Восстанавливаем альфу
    this.pauseIndicator.setAlpha(1);
  }

  private updateTimeUI() {
    if (!this.timeManager || !this.cycleCounterText || !this.cycleProgressBar) return;
    
    // Обновляем текст счетчика циклов
    const cycleFormatted = this.timeManager.getCurrentCycleFormatted();
    this.cycleCounterText.setText(`Цикл: ${cycleFormatted}`);
    
    // Обновляем прогресс-бар
    const progress = this.timeManager.getCycleProgress();
    const maxWidth = (this.minimapBounds?.w ?? 512) - 42; // -42 для отступов и рамки
    this.cycleProgressBar.width = Math.max(0, progress * maxWidth);
  }

  // Публичный метод для полного обновления HUD при смене системы
  public updateForNewSystem(config: ConfigManager, ship: Phaser.GameObjects.GameObject) {
    this.configRef = config;
    
    // Уничтожаем старые элементы
    this.destroyElements();
    
    // Создаем заново все элементы с правильными шрифтами
    this.createHUD(ship);
    this.createWeaponBar();
    this.createMinimap(ship);
    
    // Переинтегрируем fog of war с миникартой
    const starScene = this.scene.scene.get('StarSystemScene') as any;
    if (starScene?.fogOfWar && this.minimap) {
      this.minimap.setFogOfWar(starScene.fogOfWar);
    }
  }

  private destroyElements() {
    // уничтожить HUD элементы
    this.speedText?.destroy(); this.followToggle?.destroy(); this.shipNameText?.destroy(); this.shipIcon?.destroy();
    this.weaponSlotsContainer?.destroy(); this.weaponPanel?.destroy(); this.hullFill?.destroy(); this.followLabel?.destroy(); this.gameOverGroup?.destroy(); this.minimapHit?.destroy();
    
    // уничтожить элементы паузы и времени
    this.pauseIndicator?.destroy(); this.cycleCounterText?.destroy(); this.cycleProgressBar?.destroy(); this.cycleProgressBarBg?.destroy();
    if (this.pauseBlinkTween) { this.pauseBlinkTween.destroy(); this.pauseBlinkTween = undefined; }

    // очистить ссылки
    this.speedText = undefined; this.followToggle = undefined; this.shipNameText = undefined; this.shipIcon = undefined; this.weaponSlotsContainer = undefined; this.weaponPanel = undefined; this.hullFill = undefined; this.followLabel = undefined; this.gameOverGroup = undefined; this.minimapHit = undefined;
    this.pauseIndicator = undefined; this.cycleCounterText = undefined; this.cycleProgressBar = undefined; this.cycleProgressBarBg = undefined;

    // уничтожить текстовые ref
    const hpText = (this.scene as any).__hudHullValue as Phaser.GameObjects.Text | undefined; hpText?.destroy(); (this.scene as any).__hudHullValue = undefined;
    const speedValue = (this.scene as any).__hudSpeedValue as Phaser.GameObjects.Text | undefined; speedValue?.destroy(); (this.scene as any).__hudSpeedValue = undefined;

    // сбросить состояние
    this.playerHp = null; this.hullRect = undefined;

    // удалить назначенные иконки и события
    const star: any = this.scene.scene.get('StarSystemScene');
    for (const { updater, container } of Array.from(this.assignedIconsBySlot.values())) {
      try { star.events.off(Phaser.Scenes.Events.UPDATE, updater); } catch {}
      try { container.destroy(); } catch {}
    }
    this.assignedIconsBySlot.clear();
    // очистить выборы
    this.selectedSlots.clear();
    this.cursorOrder = [];
    
    // очистить кэш прогресса перезарядки
    this.lastChargeProgressBySlot.clear();
    
    // уничтожить все прогресс-бары перезарядки
    for (const [slotKey, bar] of this.cooldownBarsBySlot.entries()) {
      try { bar.bg.destroy(); } catch {}
      try { bar.fill.destroy(); } catch {}
      try { bar.outline.destroy(); } catch {}
    }
    this.cooldownBarsBySlot.clear();
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

  private syncSlotsVisual() {
    // жёстко выставляем Y и обводку согласно состоянию (selected/assigned)
    for (const rec of this.slotRecords) {
      const assigned = Array.from(this.assignedIconsBySlot.keys()).includes(rec.slotKey);
      const selected = this.selectedSlots.has(rec.slotIndex);
      const lifted = assigned || selected;
      const targetY = rec.baseY + (lifted ? -20 : 0);
      
      // Для основных элементов слота просто меняем Y
      const mainNodes = [rec.bg, rec.outline, rec.under, rec.icon].filter(Boolean);
      for (const n of mainNodes) { if ((n as any).y !== targetY) (n as any).y = targetY; }
      
      // Для бейджа пересчитываем позицию относительно нового положения слота
      const badge = (rec as any).badge;
      const badgeText = (rec as any).badgeText;
      if (badge && badgeText) {
        const slotSize = rec.size;
        const badgeSize = Math.max(32, slotSize * 0.35);
        const badgePadding = Math.max(4, slotSize * 0.05);
        
        // Позиция бейджа всегда в нижнем левом углу слота
        badge.y = targetY + slotSize - badgePadding - badgeSize;
        badgeText.y = targetY + slotSize - badgePadding - badgeSize/2;
      }
      
      // обводка: assigned -> red, selected (без assigned) -> green, иначе без обводки
      if (assigned) rec.outline.setStrokeStyle(2, 0xA93226, 1);
      else if (selected) rec.outline.setStrokeStyle(2, 0x00ff66, 1);
      else rec.outline.setStrokeStyle(0, 0x00ff66, 1);
    }
  }
  

}
