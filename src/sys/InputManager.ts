import type { ConfigManager } from './ConfigManager';

export class InputManager {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  // Источники ввода
  private keyboardEnabled = true;
  private edgePanEnabled = false;
  private isDragging = false;
  private lastX = 0;
  private lastY = 0;
  private dragDistance = 0;
  private dragEnabled = true;
  private leftClickHandlers: Array<(x: number, y: number) => void> = [];
  private rightClickHandlers: Array<(x: number, y: number) => void> = [];
  private registeredKeys: Phaser.Input.Keyboard.Key[] = [];

  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
    this.initMouse();
    this.initWheel();
    this.initKeyboard();
    // Edge pan отключён по умолчанию
    if (this.edgePanEnabled) this.initEdgePan();
    this.initDragPan();
  }

  onRightClick(handler: (x: number, y: number) => void) {
    this.rightClickHandlers.push(handler);
  }

  onLeftClick(handler: (x: number, y: number) => void) {
    this.leftClickHandlers.push(handler);
  }

  setDragEnabled(enabled: boolean) {
    this.dragEnabled = enabled;
    if (!enabled) {
      this.isDragging = false;
      this.dragDistance = 0;
    }
  }

  /** Подписка на действие высокого уровня (единый шина событий) */
  onAction(action: string, handler: (payload?: any) => void) {
    this.scene.events.on('input:action', (a: string, payload?: any) => {
      if (a === action) handler(payload);
    });
  }

  /** Внешний вызов для эмуляции действия из других источников (UI, геймпад) */
  emitAction(action: string, payload?: any) {
    this.scene.events.emit('input:action', action, payload);
  }

  setKeyboardEnabled(enabled: boolean) {
    this.keyboardEnabled = enabled;
  }

  private resolveKeyCode(binding: string | undefined): number | null {
    if (!binding) return null;
    const kc: any = (Phaser.Input.Keyboard as any).KeyCodes ?? (Phaser as any).Input.Keyboard.KeyCodes;
    const name = binding.toUpperCase();
    if (kc && kc[name] != null) return kc[name];
    if (binding === '+') return kc?.PLUS ?? kc?.NUMPAD_ADD ?? kc?.EQUALS ?? null;
    if (binding === '-') return kc?.MINUS ?? kc?.NUMPAD_SUBTRACT ?? kc?.DASH ?? kc?.SUBTRACT ?? null;
    if (binding === ' ') return kc?.SPACE ?? kc?.SPACEBAR ?? null;
    // Один символ A-Z/0-9
    if (/^[A-Z0-9]$/.test(name) && kc && kc[name] != null) return kc[name];
    return null;
  }

  private bindKey(action: string, keyCode: number) {
    const key = this.scene.input.keyboard?.addKey(keyCode);
    if (!key) return;
    // Блокируем дефолтное поведение браузера для этой клавиши (например, ПРОБЕЛ = прокрутка)
    try { this.scene.input.keyboard?.addCapture(keyCode); } catch {}
    this.registeredKeys.push(key);
    key.on('down', () => {
      if (!this.keyboardEnabled) return;
      this.emitAction(action);
    });
  }

  private initKeyboard() {
    const kb = this.config.keybinds ?? ({} as any);
    const toBind: Array<[string, string | undefined]> = [
      ['toggleFollow', kb.toggleFollow],
      ['zoomIn', kb.zoomIn],
      ['zoomOut', kb.zoomOut],
      ['pause', (kb as any).pause],
      ['systemMenu', (kb as any).systemMenu]
    ];
    for (const [action, keyStr] of toBind) {
      const code = this.resolveKeyCode(keyStr);
      if (code != null) this.bindKey(action, code);
    }
  }

  private initMouse() {
    this.scene.input.mouse?.disableContextMenu();
    const isRight = (p: any) => (p?.event?.button === 2) || (p?.buttons === 2) || p?.rightButtonDown?.() || p?.rightButtonReleased?.();
    const isLeft = (p: any) => (p?.event?.button === 0) || p?.leftButtonDown?.() || p?.leftButtonReleased?.();

    // Also catch on pointerdown for right-click in some browsers
    this.scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (isRight(p)) {
        this.rightClickHandlers.forEach(h => h(p.worldX, p.worldY));
      }
    });

    this.scene.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      // Left click as tap (not a drag)
      if (isLeft(p)) {
        if (this.isDragging && this.dragDistance < 6) {
          this.leftClickHandlers.forEach(h => h(p.worldX, p.worldY));
        } else if (!this.isDragging) {
          this.leftClickHandlers.forEach(h => h(p.worldX, p.worldY));
        }
        this.isDragging = false;
        this.dragDistance = 0;
      }
      if (isRight(p)) this.rightClickHandlers.forEach(h => h(p.worldX, p.worldY));
    });
  }

  private initWheel() {
    this.scene.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjs: any, _dx: number, dy: number) => {
      const cam = this.scene.cameras.main;
      const minZoom = this.config.settings.camera.minZoom;
      const maxZoom = this.config.settings.camera.maxZoom;
      const step = dy > 0 ? -0.1 : 0.1;
      const oldZoom = cam.zoom;
      const newZoom = Phaser.Math.Clamp(oldZoom + step, minZoom, maxZoom);
      if (newZoom === oldZoom) return;
      // Масштабирование вокруг центра экрана: фиксируем мировую точку под центром
      const cx = this.scene.scale.width * 0.5;
      const cy = this.scene.scale.height * 0.5;
      const before = (cam as any).getWorldPoint ? (cam as any).getWorldPoint(cx, cy) : new Phaser.Math.Vector2(cam.scrollX + cx / oldZoom, cam.scrollY + cy / oldZoom);
      cam.setZoom(newZoom);
      cam.centerOn(before.x, before.y);
    });
  }

  private initEdgePan() {
    const margin = this.config.settings.camera.edgePanMargin;
    const speed = this.config.settings.camera.edgePanSpeed;
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, (_t: number, dtMs: number) => {
      if (!this.edgePanEnabled) return;
      const cam = this.scene.cameras.main;
      const input = this.scene.input.activePointer;
      const w = this.scene.scale.width;
      const h = this.scene.scale.height;
      const dt = dtMs / 1000;
      let dx = 0, dy = 0;
      if (input.x < margin) dx = -1;
      else if (input.x > w - margin) dx = 1;
      if (input.y < margin) dy = -1;
      else if (input.y > h - margin) dy = 1;
      if (dx !== 0 || dy !== 0) {
        cam.scrollX += dx * speed * dt;
        cam.scrollY += dy * speed * dt;
      }
    });
  }

  private initDragPan() {
    this.scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown() && this.dragEnabled) {
        this.isDragging = true;
        this.lastX = p.x;
        this.lastY = p.y;
        this.dragDistance = 0;
      }
    });
    this.scene.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonReleased()) {
        this.isDragging = false;
        this.dragDistance = 0;
      }
    });
    this.scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.isDragging || !this.dragEnabled) return;
      const cam = this.scene.cameras.main;
      const dx = (p.x - this.lastX) / cam.zoom;
      const dy = (p.y - this.lastY) / cam.zoom;
      cam.scrollX -= dx;
      cam.scrollY -= dy;
      this.lastX = p.x;
      this.lastY = p.y;
      this.dragDistance += Math.hypot(dx, dy);
    });
  }
}


