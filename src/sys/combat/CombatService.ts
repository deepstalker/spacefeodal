import type { ConfigManager } from '../ConfigManager';
import type { NPCStateManager } from '../NPCStateManager';
import type { MovementManager } from '../MovementManager';
import type { PauseManager } from '../PauseManager';
import type { WeaponManager } from './weapons/WeaponManager';
import type { CombatUIManager } from './ui/CombatUIManager';
import type { TargetManager } from './targets/TargetManager';
import type { CombatAI } from './ai/CombatAI';
import type { TargetAnalyzer } from './ai/TargetAnalyzer';
import type { NPCStateContext, TargetEntry } from './CombatTypes';

/**
 * Main Combat Service - coordinates all combat subsystems
 * Acts as the primary interface for combat operations and orchestrates
 * the interaction between all combat-related components.
 */
export class CombatService {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  
  // Core dependencies
  private pauseManager?: PauseManager;
  private npcStateManager?: NPCStateManager;
  private movementManager?: MovementManager;
  
  // Combat subsystems
  private weaponManager?: WeaponManager;
  private uiManager?: CombatUIManager;
  private targetManager?: TargetManager;
  private combatAI?: CombatAI;
  private targetAnalyzer?: TargetAnalyzer;
  
  // Player ship reference
  private ship?: any;
  
  // Selection state
  private selectedTarget?: any;
  private selectionCircle?: Phaser.GameObjects.Arc;
  private radarCircle?: Phaser.GameObjects.Arc;
  private selectionPulsePhase: number = 0;
  private selectionBaseRadius: number = 30;
  
  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
    
    // Bind update method for event listener
    this.update = this.update.bind(this);
    
    // Register for scene updates
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.update);
  }
  
  // === Dependency Injection ===
  
  setShip(ship: any): void {
    this.ship = ship;
  }
  
  setPauseManager(manager: PauseManager): void {
    this.pauseManager = manager;
  }
  
  setNPCStateManager(manager: NPCStateManager): void {
    this.npcStateManager = manager;
  }
  
  setMovementManager(manager: MovementManager): void {
    this.movementManager = manager;
  }
  
  setWeaponManager(manager: WeaponManager): void {
    this.weaponManager = manager;
  }
  
  setUIManager(manager: CombatUIManager): void {
    this.uiManager = manager;
  }
  
  setTargetManager(manager: TargetManager): void {
    this.targetManager = manager;
  }
  
  setCombatAI(ai: CombatAI): void {
    this.combatAI = ai;
  }
  
  setTargetAnalyzer(analyzer: TargetAnalyzer): void {
    this.targetAnalyzer = analyzer;
  }
  
  // === Main Update Loop ===
  
  private update(_time: number, deltaMs: number): void {
    // Check pause state
    const isPaused = this.pauseManager?.isSystemPausable('combat') && this.pauseManager?.getPaused();
    
    // Update selection pulse animation
    this.updateSelectionPulse(deltaMs);
    
    // Skip main logic if paused
    if (isPaused) return;
    
    // Main combat orchestration
    if (this.ship) {
      // Clean up invalid indicators
      this.cleanupInvalidIndicators();
      
      // Process AI decisions for all NPCs
      this.processAIDecisions(deltaMs);
      
      // Update all subsystems
      this.updateSubsystems(deltaMs);
      
      // Refresh UI and indicators
      this.refreshCombatDisplay();
    }
  }
  
  /**
   * Update selection pulse animation
   */
  private updateSelectionPulse(deltaMs: number): void {
    if (this.selectedTarget && this.selectedTarget.active && this.selectionCircle) {
      this.selectionPulsePhase += deltaMs * 0.01;
      const radius = this.selectionBaseRadius + Math.sin(this.selectionPulsePhase) * 3;
      this.selectionCircle.setRadius(radius);
      this.selectionCircle.setPosition(this.selectedTarget.x, this.selectedTarget.y);
      
      // Update radar circle position
      if (this.radarCircle && this.radarCircle.visible) {
        this.radarCircle.setPosition(this.selectedTarget.x, this.selectedTarget.y);
      }
    }
  }
  
  /**
   * Clean up invalid UI indicators
   */
  private cleanupInvalidIndicators(): void {
    try {
      // Delegate to UI manager if available
      if (this.uiManager) {
        this.uiManager.cleanupInvalidIndicators();
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[CombatService] Error cleaning up indicators:', error);
      }
    }
  }
  
  /**
   * Process AI decisions for all NPCs
   */
  private processAIDecisions(deltaMs: number): void {
    if (!this.targetManager || !this.combatAI) return;
    
    const targets = this.targetManager.getAllTargets();
    
    for (const target of targets) {
      if (!target.ai || target.ai.type !== 'ship') continue;
      if ((target.obj as any).__returningHome) continue; // Skip returning home NPCs
      
      // Get NPC state context
      const context = this.npcStateManager?.getContext(target.obj);
      if (!context) continue;
      
      // Check if this NPC is in combat state
      const isInCombat = this.npcStateManager?.isInCombat(target.obj);
      
      if (isInCombat) {
        // Use CombatAI for combat decisions
        const decision = this.combatAI.makeCombatDecision(context);
        this.applyAIDecision(target, decision);
      } else {
        // Use sensor-based reactions for non-combat NPCs
        const decision = this.combatAI.processSensorReactions(context);
        if (decision) {
          this.applyAIDecision(target, decision);
        }
        
        // Check aggression cooldown
        this.combatAI.checkAggressionCooldown(context);
      }
    }
  }
  
  /**
   * Apply AI decision to target
   */
  private applyAIDecision(target: TargetEntry, decision: any): void {
    if (!decision || !this.combatAI?.isDecisionValid(decision)) return;
    
    // Apply intent based on decision
    switch (decision.action) {
      case 'attack':
        target.intent = { type: 'attack', target: decision.target };
        break;
      case 'flee':
        target.intent = { type: 'flee', target: decision.target };
        break;
      case 'retreat':
        target.intent = { type: 'retreat', target: decision.target };
        break;
      case 'patrol':
        target.intent = null; // Let movement manager handle patrol
        break;
    }
    
    // Debug logging
    if (process.env.NODE_ENV === 'development' && Math.random() < 0.01) { // 1% logs
      console.log(`[CombatService] AI Decision for ${target.shipId}:`, {
        action: decision.action,
        priority: decision.priority,
        reasoning: decision.reasoning
      });
    }
  }
  
  /**
   * Update all combat subsystems
   */
  private updateSubsystems(deltaMs: number): void {
    // Update weapons
    if (this.weaponManager) {
      this.weaponManager.update(false); // Not paused
    }
    
    // Update UI
    if (this.uiManager) {
      this.uiManager.refreshCombatIndicators();
    }
  }
  
  /**
   * Refresh combat display
   */
  private refreshCombatDisplay(): void {
    if (!this.targetManager || !this.uiManager) return;
    
    const targets = this.targetManager.getAllTargets();
    
    // Сначала скрываем все индикаторы для избежания дублирования
    for (const target of targets) {
      this.uiManager.hideIndicator(target.obj);
    }
    
    for (const target of targets) {
      // Update HP bars for all targets
      this.uiManager.updateHpBar(target);
      
      // Update selection indicator for selected target only
      if (target.obj === this.selectedTarget) {
        const name = (target.obj as any).shipName ?? (target.shipId ?? `NPC #${(target.obj as any).__uniqueId}`);
        const color = this.getRelationColor(this.getRelation('player', target.faction));
        
        // Show indicator above the ship
        this.uiManager.showIndicator(target.obj.x, target.obj.y, name, color);
      }
    }
  }
  
  // === Target Selection ===
  
  /**
   * Select a target for UI display
   */
  selectTarget(obj: any): void {
    // Очищаем индикатор предыдущей цели
    if (this.selectedTarget && this.uiManager) {
      this.uiManager.hideIndicator(this.selectedTarget);
    }
    
    this.selectedTarget = obj;
    
    if (obj && this.selectionCircle) {
      this.selectionCircle.setPosition(obj.x, obj.y);
      this.selectionCircle.setVisible(true);
    } else if (this.selectionCircle) {
      this.selectionCircle.setVisible(false);
    }
    
    // Update radar circle if available
    if (this.radarCircle) {
      if (obj) {
        const radar = this.getRadarRangeForPublic(obj);
        this.radarCircle.setRadius(radar);
        this.radarCircle.setPosition(obj.x, obj.y);
        this.radarCircle.setVisible(true);
      } else {
        this.radarCircle.setVisible(false);
      }
    }
  }
  
  /**
   * Get currently selected target
   */
  getSelectedTarget(): any {
    return this.selectedTarget;
  }
  
  // === Public API ===
  
  /**
   * Register a new target in the combat system
   */
  registerTarget(
    obj: any,
    shipId: string,
    faction: string,
    aiProfile?: string,
    combatAI?: string,
    weaponSlots?: string[]
  ): void {
    if (!this.targetManager) return;
    
    this.targetManager.registerTarget(obj, shipId, faction, aiProfile, combatAI, weaponSlots);
  }
  
  /**
   * Unregister a target from the combat system
   */
  unregisterTarget(obj: any): void {
    if (!this.targetManager) return;
    
    this.targetManager.unregisterTarget(obj);
    
    // Clear selection if this was the selected target
    if (this.selectedTarget === obj) {
      this.selectTarget(null);
    }
  }
  
  /**
   * Get all registered targets
   */
  getAllTargets(): TargetEntry[] {
    return this.targetManager?.getAllTargets() ?? [];
  }
  
  /**
   * Get all NPC records (for faction queries)
   */
  getAllNPCs(): any[] {
    return this.targetManager?.getAllTargets() ?? [];
  }
  
  /**
   * Get player ship reference
   */
  getPlayerShip(): any {
    return this.ship;
  }
  
  /**
   * Get radar range for a specific object
   */
  getRadarRangeForPublic(obj: any): number {
    if (!this.targetManager) return 800;
    
    const entry = this.targetManager.getTarget(obj);
    const shipId = entry?.shipId ?? (obj === this.ship ? (this.config.player?.shipId ?? this.config.ships.current) : undefined);
    const def = shipId ? this.config.ships.defs[shipId] : undefined;
    const overrideR = (entry as any)?.radarRange;
    
    if (typeof overrideR === 'number') return overrideR;
    
    const radius = (def as any)?.sensors?.radar_range ?? def?.combat?.sensorRadius ?? 800;
    return radius;
  }
  
  /**
   * Get faction relation
   */
  getRelationPublic(
    ofFaction: string | undefined,
    otherFaction: string | undefined,
    overrides?: Record<string, 'ally'|'neutral'|'confrontation'|'cautious'>
  ): 'ally'|'neutral'|'confrontation'|'cautious' {
    if (!ofFaction || !otherFaction) return 'neutral';
    if (overrides && overrides[otherFaction]) return overrides[otherFaction];
    
    const relation = this.config.factions?.factions?.[ofFaction]?.relations?.[otherFaction];
    return (relation ?? 'neutral') as any;
  }
  
  /**
   * Private helper for internal use
   */
  private getRelation(ofFaction: string | undefined, otherFaction: string | undefined): string {
    return this.getRelationPublic(ofFaction, otherFaction);
  }
  
  /**
   * Get color for faction relation
   */
  private getRelationColor(relation: string): number {
    switch (relation) {
      case 'ally': return 0x00ff00;
      case 'confrontation': return 0xff0000;
      case 'cautious': return 0xffff00;
      default: return 0xffffff;
    }
  }
  
  /**
   * Register damage for aggression tracking
   */
  registerDamage(obj: any, damage: number, attacker: any): void {
    if (!this.npcStateManager) return;
    
    this.npcStateManager.registerDamage(obj, damage, attacker);
  }
  
  /**
   * Apply movement from FSM to combat manager
   */
  applyMovementFromFSM(obj: any, command: string, params: any): void {
    // This method allows the FSM to apply movement decisions
    // Implementation would depend on how movement is coordinated with MovementManager
    if (process.env.NODE_ENV === 'development') {
      console.log(`[CombatService] Applying FSM movement:`, {
        objId: (obj as any).__uniqueId,
        command,
        params
      });
    }
    
    // Delegate to movement manager if available
    if (this.movementManager) {
      // This would need to be implemented based on MovementManager's API
      // For now, just log the action
    }
  }
  
  // === Graphics Initialization ===
  
  /**
   * Initialize combat graphics (selection circles, etc.)
   */
  initializeGraphics(): void {
    // Create selection circle
    this.selectionCircle = this.scene.add.circle(0, 0, this.selectionBaseRadius, 0xffffff, 0);
    this.selectionCircle.setStrokeStyle(2, 0xffffff);
    this.selectionCircle.setVisible(false);
    this.selectionCircle.setDepth(1000);
    
    // Create radar circle
    this.radarCircle = this.scene.add.circle(0, 0, 800, 0x00ff00, 0);
    this.radarCircle.setStrokeStyle(1, 0x00ff00, 0.3);
    this.radarCircle.setVisible(false);
    this.radarCircle.setDepth(999);
  }
  
  // === Cleanup ===
  
  /**
   * Destroy the combat service and clean up resources
   */
  destroy(): void {
    // Remove event listeners
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.update);
    
    // Clean up graphics
    if (this.selectionCircle) {
      this.selectionCircle.destroy();
    }
    if (this.radarCircle) {
      this.radarCircle.destroy();
    }
    
    // Clean up references
    this.selectedTarget = undefined;
    this.ship = undefined;
  }
}