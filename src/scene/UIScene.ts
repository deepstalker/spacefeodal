import Phaser from 'phaser';
import { MinimapManager } from '@/sys/MinimapManager';
import type { ConfigManager } from '@/sys/ConfigManager';

export default class UIScene extends Phaser.Scene {
  private minimap!: MinimapManager;
  private debugText!: Phaser.GameObjects.Text;
  private configRef?: ConfigManager;
  private minimapHit?: Phaser.GameObjects.Zone;
  private followLabel?: Phaser.GameObjects.Text;
  // HUD elements
  private speedBar?: any;
  private speedFill?: Phaser.GameObjects.Rectangle;
  private followToggle?: any;
  private hullBar?: any;
  private hullFill?: Phaser.GameObjects.Rectangle;
  private playerHp: number | null = null;
  private shipNameText?: Phaser.GameObjects.Text;
  private shipIcon?: Phaser.GameObjects.Image;
  private weaponSlotsContainer?: Phaser.GameObjects.Container;
  private weaponPanel?: Phaser.GameObjects.Rectangle;
  private hullBarWidth: number = 614;
  private hullRect?: { x: number; y: number; w: number; h: number };
  private gameOverGroup?: Phaser.GameObjects.Container;
  private systemMenu?: any;
  constructor() {
    super('UIScene');
  }

  create() {
    const label = this.add.text(16, 16, 'SF A2', { color: '#a0b4ff' }).setScrollFactor(0).setDepth(1000);
    this.debugText = this.add.text(16, 40, '', { color: '#99ff99' }).setScrollFactor(0).setDepth(1000);

    // Миникарта: ждём готовности StarSystemScene
    const starScene = this.scene.get('StarSystemScene') as Phaser.Scene & any;
    const onReady = (payload: { config: ConfigManager; ship: Phaser.GameObjects.GameObject }) => {
      this.configRef = payload.config;
      this.minimap = new MinimapManager(this, payload.config);
      this.minimap.init(this.scale.width - 260, 20);
      this.minimap.attachShip(payload.ship);
      // интерактив: клик по миникарте переводит камеру к области клика
      const x = this.scale.width - 260;
      const y = 20;
      this.minimapHit = this.add.zone(x, y, 240, 180).setOrigin(0, 0).setScrollFactor(0).setDepth(1001);
      this.minimapHit.setInteractive({ useHandCursor: true });
      this.minimapHit.on('pointerdown', (p: Phaser.Input.Pointer) => {
        const sys = this.configRef!.system;
        const relX = (p.x - x) / 240;
        const relY = (p.y - y) / 180;
        const worldX = Phaser.Math.Clamp(relX * sys.size.width, 0, sys.size.width);
        const worldY = Phaser.Math.Clamp(relY * sys.size.height, 0, sys.size.height);
        const star = this.scene.get('StarSystemScene') as any;
        star.cameras.main.centerOn(worldX, worldY);
      });
      // при смене системы обновляем ссылку
      starScene.events.on('system-ready', (pl: any) => {
        this.configRef = pl.config;
        this.minimap = new MinimapManager(this, pl.config);
        this.minimap.init(this.scale.width - 260, 20);
        this.minimap.attachShip(pl.ship);
      });

      // HUD bottom area
      this.createHUD(payload);
      this.createWeaponBar();
      // Подписываемся на урон игрока
      const star = this.scene.get('StarSystemScene') as any;
      star.events.on('player-damaged', (hp: number) => this.onPlayerDamaged(hp));
    };
    // Если уже создана — попробуем сразу
    if ((starScene as any).config && (starScene as any).ship) {
      onReady({ config: (starScene as any).config, ship: (starScene as any).ship });
    } else {
      starScene.events.once('system-ready', onReady);
    }
    // Режим «Следования»: показываем лейбл и блокируем drag-pan
    const updateFollow = () => {
      const stars = this.scene.get('StarSystemScene') as any;
      const isFollowing = stars?.cameraMgr?.isFollowing?.() ?? false;
      if (isFollowing) {
        if (!this.followLabel) {
          this.followLabel = this.add.text(this.scale.width / 2, this.scale.height - 24, 'Режим следования', {
            color: '#ffffff', fontSize: '16px'
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
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, updateFollow);

    this.events.on(Phaser.Scenes.Events.UPDATE, () => {
      const mv = this.getMovementConfig();
      if (!mv) return;
      // Update debug
      this.debugText.setText(
        `ACC=${mv.ACCELERATION.toFixed(3)} DEC=${mv.DECELERATION.toFixed(3)} VMAX=${mv.MAX_SPEED.toFixed(2)} TURN=${mv.TURN_SPEED.toFixed(3)}`
      );
      // Update speed bar by estimating MovementManager speed if available via ship data
      this.updateHUD();
    });

    // Debug menu to switch systems
    const key = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.M);
    key?.on('down', () => this.toggleSystemMenu());
  }

  private getMovementConfig() {
    const mv = this.configRef?.gameplay?.movement;
    const playerShipId = this.configRef?.player?.shipId;
    const shipMv = playerShipId ? this.configRef?.ships?.defs[playerShipId]?.movement : undefined;
    return shipMv ?? mv;
  }

  private createHUD(payload: { config: ConfigManager; ship: Phaser.GameObjects.GameObject }) {
    const rexUI = (this as any).rexUI;
    const sw = this.scale.width;
    const sh = this.scale.height;
    const pad = 12;

    // Container at bottom
    const barW = Math.min(520, sw * 0.4);
    const barH = 20;
    const hudY = sh - pad;

    // Speed panel (progress bar)
    const speedBg = this.add.rectangle(pad, hudY, barW, barH, 0x1e293b).setOrigin(0, 1).setScrollFactor(0).setDepth(1500);
    const speedFill = this.add.rectangle(pad + 2, hudY - 2, 0, barH - 4, 0x38bdf8).setOrigin(0, 1).setScrollFactor(0).setDepth(1501);
    this.speedFill = speedFill;
    const speedValue = this.add.text(pad + barW - 6, hudY - barH / 2, '0', { color: '#e2e8f0', fontSize: '14px' }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(1502);

    // Follow toggle (rexUI label behaves like a toggle)
    const followBg = this.add.rectangle(0, 0, 130, 28, 0x0f172a).setStrokeStyle(1, 0x334155);
    const followText = this.add.text(0, 0, 'Следовать', { color: '#e2e8f0', fontSize: '14px' });
    this.followToggle = rexUI.add.label({
      x: 0, y: 0,
      background: followBg,
      text: followText,
      space: { left: 10, right: 10, top: 4, bottom: 4 }
    }).layout().setScrollFactor(0).setDepth(1500)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        const stars = this.scene.get('StarSystemScene') as any;
        if (stars?.cameraMgr?.isFollowing?.()) stars.cameraMgr.disableFollow();
        else stars?.cameraMgr?.enableFollow?.(payload.ship);
      });
    this.followToggle.setPosition(sw / 2 + 40, hudY - 40);

    // HP bar перенесён на оружейную панель (создаётся в createWeaponBar)

    // Ship name and icon (no rotation)
    const currentId = payload.config.player?.shipId ?? payload.config.ships?.current;
    const def = currentId ? payload.config.ships?.defs[currentId] : undefined;
    const shipName = def?.displayName ?? 'Ship';
    const iconKey = (def?.sprite?.key) ?? (this.textures.exists('ship_alpha') ? 'ship_alpha' : 'ship_alpha_public');
    // Переносим иконку корабля в правый нижний угол
    const icon = this.add.image(sw - pad - 24, hudY - 24, iconKey).setScrollFactor(0).setDepth(1500).setDisplaySize(48, 48);
    icon.setOrigin(1, 1);
    icon.setRotation(0);
    this.shipIcon = icon;
    // Имя корабля рядом слева от иконки
    const nameText = this.add.text(sw - pad - 24 - 8, hudY - 24 - 24, shipName, { color: '#e2e8f0', fontSize: '16px' }).setScrollFactor(0).setDepth(1500).setOrigin(1, 0.5);
    this.shipNameText = nameText;

    // store refs for dynamic values
    (this as any).__hudSpeedValue = speedValue;
  }

  private createWeaponBar() {
    if (!this.configRef) return;
    const sw = this.scale.width; const sh = this.scale.height; const pad = 12;
    const slotSize = 96; const slotBgColor = 0x2c2a2d; const outline = 0xA28F6E;
    const container = this.add.container(0, 0).setDepth(1500);
    container.setScrollFactor(0);
    // Weapon panel rectangle 800x128, 40px above bottom edge
    const panelW = 800; const panelH = 128;
    const panelX = (sw - panelW) / 2; const panelY = sh - 40 - panelH;
    this.weaponPanel = this.add.rectangle(panelX, panelY, panelW, panelH, 0x2c2a2d, 1).setOrigin(0,0).setScrollFactor(0).setDepth(1499);
    this.weaponPanel.setStrokeStyle(2, outline, 1);

    const cx = sw / 2; const cy = panelY; // place slots so their centers lie on panel top edge
    const spacing = 8;
    const totalW = 6 * slotSize + 5 * spacing;
    const startX = cx - totalW / 2;
    const playerSlots = this.configRef.player?.weapons ?? [];
    const defs = this.configRef.weapons?.defs ?? {} as any;
    const rarityMap = (this.configRef.items?.rarities ?? {}) as any;
    for (let i = 0; i < 6; i++) {
      const x = startX + i * (slotSize + spacing);
      const y = cy - slotSize / 2;
      // base slot background
      const slotBg = this.add.rectangle(x, y, slotSize, slotSize, slotBgColor, 1).setOrigin(0, 0).setDepth(1500).setScrollFactor(0);
      slotBg.setStrokeStyle(2, outline, 1);
      container.add(slotBg);
      // rarity underlay (94x94 inside with 75% alpha)
      const key = playerSlots[i];
      if (key && defs[key]) {
        const rarityKey = defs[key].rarity as string | undefined;
        const rarityColorHex = rarityKey && rarityMap[rarityKey]?.color ? Number(rarityMap[rarityKey].color.replace('#','0x')) : 0x000000;
        const under = this.add.rectangle(x + 1, y + 1, slotSize - 2, slotSize - 2, rarityColorHex, 0.75).setOrigin(0, 0).setDepth(1500).setScrollFactor(0);
        container.add(under);
        // icon fit
        const iconKey = defs[key].icon ?? key;
        if (this.textures.exists(iconKey)) {
          try { this.textures.get(iconKey).setFilter(Phaser.Textures.FilterMode.LINEAR); } catch {}
          const img = this.add.image(x + slotSize/2, y + slotSize/2, iconKey).setDepth(1501).setScrollFactor(0);
          img.setOrigin(0.5);
          container.add(img);
        }
      }
      // number badge (bottom-left)
      const badge = this.add.rectangle(x + 4, y + slotSize - 4 - 32, 32, 32, 0x2c2a2d, 1).setOrigin(0, 0).setDepth(1502).setScrollFactor(0);
      badge.setStrokeStyle(1, outline, 1);
      const num = this.add.text(x + 4 + 16, y + slotSize - 4 - 16, `${i + 1}`, { color: '#e2e8f0', fontSize: '16px' }).setOrigin(0.5).setDepth(1503).setScrollFactor(0);
      container.add(badge);
      container.add(num);
    }
    this.weaponSlotsContainer = container;

    // HP bar inside panel bottom area (614x30) with outline and custom colors
    const hpW = this.hullBarWidth; const hpH = 30;
    const hpX = panelX + (panelW - hpW) / 2;
    const hpY = panelY + panelH - 30 - hpH; // подняли на 20px выше
    const hpOutline = this.add.rectangle(hpX, hpY, hpW, hpH, 0x000000, 0).setOrigin(0,0).setScrollFactor(0).setDepth(1500);
    hpOutline.setStrokeStyle(2, outline, 1);
    const hpBg = this.add.rectangle(hpX, hpY, hpW, hpH, 0x1E3A2B, 1).setOrigin(0,0).setScrollFactor(0).setDepth(1500);
    const hpFill = this.add.rectangle(hpX + 2, hpY + 2, hpW - 4, hpH - 4, 0x1E8449, 1).setOrigin(0,0).setScrollFactor(0).setDepth(1501);
    this.hullFill = hpFill;
    const hpText = this.add.text(hpX + 8, hpY + hpH/2, '100', { color: '#e2e8f0', fontSize: '14px' }).setOrigin(0,0.5).setScrollFactor(0).setDepth(1502);
    (this as any).__hudHullValue = hpText;
    this.hullRect = { x: hpX, y: hpY, w: hpW, h: hpH };
  }

  private onPlayerDamaged(hp: number) {
    this.playerHp = hp;
    // update immediately
    this.updateHUD();
    // flash effect over HP bar
    if (this.hullRect) {
      const r = this.add.rectangle(this.hullRect.x, this.hullRect.y, this.hullRect.w, this.hullRect.h, 0xffffff, 0.35)
        .setOrigin(0,0).setScrollFactor(0).setDepth(1502);
      this.tweens.add({ targets: r, alpha: 0, duration: 180, ease: 'Sine.easeOut', onComplete: () => r.destroy() });
    }
  }

  private updateHUD() {
    if (!this.configRef) return;
    // Speed percentage — попробуем определить по смещению MovementManager. Упростим: нет прямого доступа к скорости, оценим по delta позициям последнего кадра (не идеально, но достаточно для UI)
    const star = this.scene.get('StarSystemScene') as any;
    const ship = star?.ship as Phaser.GameObjects.Image | undefined;
    if (ship && this.speedFill) {
      const mv = this.getMovementConfig();
      const max = mv?.MAX_SPEED ?? 1;
      // Храним в объекте временные данные
      const prev = (ship as any).__prevPos || { x: ship.x, y: ship.y };
      const dx = ship.x - prev.x;
      const dy = ship.y - prev.y;
      const v = Math.hypot(dx, dy);
      (ship as any).__prevPos = { x: ship.x, y: ship.y };
      const pct = Phaser.Math.Clamp(max > 0 ? v / max : 0, 0, 1);
      this.speedFill.width = (Math.min(520, this.scale.width * 0.4) - 4) * pct;
      const speedText = (this as any).__hudSpeedValue as Phaser.GameObjects.Text | undefined;
      if (speedText) speedText.setText(v.toFixed(2));
    }

    // HULL percentage (from player's ship def or placeholder)
    if (this.hullFill && this.configRef) {
      const id = this.configRef.player?.shipId ?? this.configRef.ships?.current;
      const baseHull = id ? this.configRef.ships?.defs[id]?.hull ?? 100 : 100;
      const hull = this.playerHp != null ? this.playerHp : baseHull;
      const pct = Phaser.Math.Clamp(baseHull > 0 ? hull / baseHull : 0, 0, 1);
      this.hullFill.width = (this.hullBarWidth - 4) * pct;
      const hullText = (this as any).__hudHullValue as Phaser.GameObjects.Text | undefined;
      if (hullText) hullText.setText(`${Math.round(hull)}/${baseHull}`);
    }
  }

  // Game Over overlay with rexUI button
  public showGameOver() {
    if (this.gameOverGroup) return;
    const width = this.scale.width;
    const height = this.scale.height;
    const overlay = this.add.rectangle(0, 0, width, height, 0x000000, 0.6).setOrigin(0).setScrollFactor(0).setDepth(3000);
    const title = this.add.text(0, 0, 'Корабль уничтожен', { color: '#ffffff', fontSize: '32px' }).setOrigin(0.5).setScrollFactor(0).setDepth(3001);
    const btn = (this as any).rexUI.add.label({
      x: 0, y: 0,
      background: this.add.rectangle(0, 0, 200, 44, 0x0f172a).setStrokeStyle(1, 0x334155),
      text: this.add.text(0, 0, 'Перезапуск', { color: '#e2e8f0', fontSize: '18px' }),
      space: { left: 14, right: 14, top: 8, bottom: 8 }
    }).layout().setScrollFactor(0).setDepth(3001)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        // Reload scenes
        const stars = this.scene.get('StarSystemScene');
        this.scene.stop('UIScene');
        this.scene.stop('StarSystemScene');
        this.scene.start('PreloadScene');
      });
    title.setPosition(width / 2, height / 2 - 40);
    btn.setPosition(width / 2, height / 2 + 20);
    const group = this.add.container(0, 0, [overlay, title, btn]).setDepth(3000);
    this.gameOverGroup = group;
  }

  private async toggleSystemMenu() {
    if (this.systemMenu) { this.systemMenu.destroy(); this.systemMenu = undefined; return; }
    const sw = this.scale.width; const sh = this.scale.height;
    const systems = await (async()=>{ try { return await (await fetch('/configs/systems/systems.json')).json(); } catch { return await (await fetch('/configs/systems.json')).json(); } })();
    const items = Object.entries(systems.defs).map(([id, def]: any) => ({ id, name: def.name }));
    const bg = this.add.rectangle(sw/2, sh/2, 360, 240, 0x0f172a, 0.95).setScrollFactor(0).setDepth(4000);
    bg.setStrokeStyle(1, 0x334155);
    const title = this.add.text(sw/2, sh/2 - 90, 'Смена системы (M)', { color: '#e2e8f0', fontSize: '18px' }).setOrigin(0.5).setDepth(4001).setScrollFactor(0);
    const buttons: any[] = [];
    const rex = (this as any).rexUI;
    items.forEach((it, idx) => {
      const btn = rex.add.label({ x: sw/2, y: sh/2 - 40 + idx*40, background: this.add.rectangle(0,0,280,30,0x111827).setStrokeStyle(1,0x334155), text: this.add.text(0,0,it.name,{color:'#e2e8f0',fontSize:'14px'}), space:{left:10,right:10,top:6,bottom:6} }).layout().setScrollFactor(0).setDepth(4001)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', async () => {
          // Смена системы (runtime): сохраняем выбор в localStorage
          try { localStorage.setItem('sf_selectedSystem', it.id); } catch {}
          const starScene = this.scene.get('StarSystemScene') as any;
          starScene.scene.stop('StarSystemScene');
          starScene.scene.stop('UIScene');
          starScene.scene.start('PreloadScene');
        });
      buttons.push(btn);
    });
    this.systemMenu = this.add.container(0,0,[bg,title,...buttons]).setDepth(4000);
  }
}


