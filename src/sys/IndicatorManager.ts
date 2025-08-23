import type { ConfigManager } from './ConfigManager';

type NPCBadge = {
	container: Phaser.GameObjects.Container;
	background: Phaser.GameObjects.Graphics;
	nameText: Phaser.GameObjects.Text;
	statusText: Phaser.GameObjects.Text;
	width: number;
	height: number;
	owner?: any;
};

type PlanetBadge = {
	container: Phaser.GameObjects.Container;
	background: Phaser.GameObjects.Graphics;
	nameText: Phaser.GameObjects.Text;
	width: number;
	height: number;
};

export class IndicatorManager {
	private scene: Phaser.Scene;
	private config: ConfigManager;
	private npcBadges: Map<any, NPCBadge> = new Map();
	private planetBadges: Map<any, PlanetBadge> = new Map();

	// UI theme colors (как везде в интерфейсе)
	private readonly bgColor = 0x0f172a;
	private readonly strokeColor = 0x334155;
	private readonly bgAlpha = 0.5;   // 50%
	private readonly strokeAlpha = 0.75; // 75%
	private readonly strokeWidth = 2;

	// Базовое увеличение всех плашек на 50%
	private readonly baseScaleMultiplier = 1.0;
	private readonly uiScaleMin = 1.0; // минимальный экранный масштаб
	private readonly uiScaleMax = 2.0;  // максимальный экранный масштаб

	// Геометрия/шрифты
	private readonly badgeWidth = 256;
	private readonly badgeMinHeight = 64;
	private readonly nameFontSize = 22;
	private readonly statusFontSize = 18;
	private readonly padX = 4;
	private readonly padY = 4;

	// Смещения
	private readonly planetOffsetPx = 30;
	private readonly npcOffsetAboveHp = -180;

	constructor(scene: Phaser.Scene, config: ConfigManager) {
		this.scene = scene;
		this.config = config;
	}

	private getInverseZoomScaleRaw(): number {
		const cam = this.scene.cameras?.main;
		const z = cam?.zoom ?? 1;
		const deviceScale = (this.scene as any).scale?.displayScale?.x ?? 1; // компенсируем масштаб канваса
		const invZoom = z > 0 ? (1 / z) : 1;
		return invZoom * this.baseScaleMultiplier / deviceScale;
	}

	public getUIScale(): number {
		const s = this.getInverseZoomScaleRaw();
		return Phaser.Math.Clamp(s, this.uiScaleMin, this.uiScaleMax);
	}

	private getWorldScale(): number {
		return this.baseScaleMultiplier;
	}

	private ensureNpcBadge(obj: any): NPCBadge {
		let badge = this.npcBadges.get(obj);
		if (badge) return badge;
		const w = this.badgeWidth;
		const padX = this.padX;
		const padY = this.padY;
		const name = this.scene.add.text(0, +20, '', {
			color: '#ffffff',
			fontSize: `${this.nameFontSize}px`,
			fontFamily: 'HooskaiChamferedSquare',
			align: 'center',
			wordWrap: { width: w - 2 * padX, useAdvancedWrap: false }
		}).setOrigin(0.5, 0.5).setDepth(0.8);
		const status = this.scene.add.text(0, 0, '', {
			color: '#cbd5e1',
			fontSize: `${this.statusFontSize}px`,
			fontFamily: 'HooskaiChamferedSquare',
			align: 'center',
			wordWrap: { width: w - 2 * padX, useAdvancedWrap: false }
		}).setOrigin(0.5, 0.5).setDepth(0.8);
		const bg = this.scene.add.graphics().setDepth(0.79);
		const container = this.scene.add.container(0, 0, [bg, name, status]).setDepth(2.0);
		container.setVisible(false);
		badge = { container, background: bg, nameText: name, statusText: status, width: w, height: 32, owner: obj };
		this.npcBadges.set(obj, badge);
		return badge;
	}

	// Выставить ширину плашки конкретного NPC (синхронизируем с шириной HP-бара)
	setBadgeWidth(obj: any, width: number) {
		const b = this.npcBadges.get(obj);
		if (!b) return;
		
		// Проверяем, изменилась ли ширина
		if (Math.abs(b.width - width) < 1) return; // Нет изменений - не перерисовываем

		b.width = width;
		b.nameText.setWordWrapWidth(width - 2 * this.padX, false);
		b.statusText.setWordWrapWidth(width - 2 * this.padX, false);

		// Re-draw background with new width
		const totalH = (b.background as any).height || this.badgeMinHeight; // Assume height doesn't change here
		b.background.clear();
		b.background.fillStyle(this.bgColor, this.bgAlpha);
		b.background.fillRoundedRect(-width / 2, -totalH / 2, width, totalH, 4);
		b.background.lineStyle(this.strokeWidth, this.strokeColor, this.strokeAlpha);
		b.background.strokeRoundedRect(-width / 2, -totalH / 2, width, totalH, 4);
	}

	showOrUpdateNPCBadge(obj: any, opts: { name: string; status: string; color?: string; x: number; y: number }) {
		const b = this.ensureNpcBadge(obj);
		const s = this.getUIScale();
		
		// Проверяем, нужно ли обновлять содержимое
		let needsContentUpdate = false;
		let needsLayoutUpdate = false;
		
		// Update texts only if changed to avoid reflow flicker
		if (b.nameText.text !== opts.name) {
			b.nameText.setText(opts.name);
			needsContentUpdate = true;
		}
		if (opts.color && (b.nameText.style.color !== opts.color)) {
			b.nameText.setColor(opts.color);
		}
		if (b.statusText.text !== opts.status) {
			b.statusText.setText(opts.status);
			needsContentUpdate = true;
		}
		
		// Dynamic layout: prevent overlap - только если содержимое изменилось
		if (needsContentUpdate) {
			const padX = this.padX, padY = this.padY;
			const nameH = b.nameText.height;
			const statusH = b.statusText.height;
			const gap = 6;
			const totalH = Math.max(this.badgeMinHeight, padY + nameH + gap + statusH + padY);
			
			// Проверяем, изменился ли размер
			const currentHeight = (b.background as any).height || 0;
			if (Math.abs(currentHeight - totalH) > 1) {
				needsLayoutUpdate = true;
			}
			
			// Перерисовываем фон только если размер изменился
			if (needsLayoutUpdate) {
				const w = b.width;
				b.background.clear();
				b.background.fillStyle(this.bgColor, this.bgAlpha);
				b.background.fillRoundedRect(-w / 2, -totalH / 2, w, totalH, 4);
				b.background.lineStyle(this.strokeWidth, this.strokeColor, this.strokeAlpha);
				b.background.strokeRoundedRect(-w / 2, -totalH / 2, w, totalH, 4);
				(b.background as any).height = totalH; // Store for setBadgeWidth
			}
			
			// Обновляем позиции текста только если layout изменился
			if (needsLayoutUpdate) {
				const nameY = -totalH / 2 + padY + nameH / 2;
				b.nameText.setY(nameY);
				b.statusText.setY(nameY + nameH / 2 + gap + statusH / 2);
			}
		}
		
		// Всегда обновляем позицию и масштаб контейнера
		b.container.setPosition(opts.x, opts.y - this.npcOffsetAboveHp);
		b.container.setScale(s);
		b.container.setVisible(true);
	}

	updateNPCBadgeTransform(obj: any, x: number, y: number) {
		const b = this.npcBadges.get(obj);
		if (!b || !b.container.visible) return;
		const s = this.getUIScale();
		b.container.setPosition(x, y - this.npcOffsetAboveHp);
		b.container.setScale(s);
	}

	hideNPCBadge(obj: any) {
		const b = this.npcBadges.get(obj);
		if (!b) return;
		b.container.setVisible(false);
	}

	destroyNPCBadge(obj: any) {
		const b = this.npcBadges.get(obj);
		if (!b) return;
		try { b.container.destroy(); } catch {}
		this.npcBadges.delete(obj);
	}

	// Вызывается боевым менеджером при удалении цели: подчистить все, что невалидно
	cleanupInvalidNPCBadges() {
		for (const [obj, b] of this.npcBadges.entries()) {
			if (!obj || !obj.active) {
				try { b.container.destroy(); } catch {}
				this.npcBadges.delete(obj);
			}
		}
	}

	attachPlanet(planetObj: Phaser.GameObjects.Image, name: string) {
		if (this.planetBadges.has(planetObj)) return;
		const w = this.badgeWidth;
		const h = 32;
		const bg = this.scene.add.graphics().setDepth(0.79);
		bg.fillStyle(this.bgColor, this.bgAlpha);
		bg.fillRoundedRect(-w / 2, -h / 2, w, h, 4);
		bg.lineStyle(this.strokeWidth, this.strokeColor, this.strokeAlpha);
		bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 4);

		const txt = this.scene.add.text(0, 0, name, {
			color: '#ffffff',
			fontSize: `${this.nameFontSize}px`,
			fontFamily: 'HooskaiChamferedSquare',
			align: 'center',
			wordWrap: { width: w - 2 * this.padX, useAdvancedWrap: true }
		}).setOrigin(0.5).setDepth(0.8);
		const container = this.scene.add.container(0, 0, [bg, txt]).setDepth(2.0);
		container.setVisible(true);
		this.planetBadges.set(planetObj, { container, background: bg, nameText: txt, width: w, height: h });
		// Initial position
		this.updatePlanetBadgePosition(planetObj);
	}

	updatePlanetBadgePosition(planetObj: Phaser.GameObjects.Image) {
		const b = this.planetBadges.get(planetObj);
		if (!b) return;
		const radius = Math.max(planetObj.displayWidth, planetObj.displayHeight) * 0.5;
		const s = this.getUIScale();
		b.container.setPosition(planetObj.x, planetObj.y - radius - this.planetOffsetPx);
		b.container.setScale(s);
	}

	updateAllPlanetBadges(planets: Array<{ obj: Phaser.GameObjects.Image }>) {
		for (const p of planets) this.updatePlanetBadgePosition(p.obj);
	}
	
	/**
	 * Корректно уничтожить все индикаторы и освободить ресурсы
	 */
	public destroy(): void {
		// Уничтожить все NPC бейджи
		for (const badge of this.npcBadges.values()) {
			try {
				badge.container.destroy();
			} catch (e) {
				console.warn('[IndicatorManager] Error destroying NPC badge:', e);
			}
		}
		this.npcBadges.clear();
		
		// Уничтожить все планетарные бейджи
		for (const badge of this.planetBadges.values()) {
			try {
				badge.container.destroy();
			} catch (e) {
				console.warn('[IndicatorManager] Error destroying planet badge:', e);
			}
		}
		this.planetBadges.clear();
	}
}


