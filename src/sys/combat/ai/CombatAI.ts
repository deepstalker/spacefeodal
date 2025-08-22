import type { ConfigManager } from '../../ConfigManager';
import type { 
  NPCStateContext, 
  CombatDecision, 
  TargetAnalysis, 
  ThreatAssessment 
} from '../CombatTypes';

/**
 * Central Combat AI system for making tactical decisions
 * Extracts decision-making logic from CombatManager and NPCStateManager
 */
export class CombatAI {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  
  // Dependencies (injected externally)
  private targetAnalyzer?: any; // TargetAnalyzer
  private combatManager?: any; // CombatManager for faction relations
  
  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
  }
  
  // === Dependency Injection ===
  
  setTargetAnalyzer(analyzer: any): void {
    this.targetAnalyzer = analyzer;
  }
  
  setCombatManager(manager: any): void {
    this.combatManager = manager;
  }
  
  // === Core Decision Making ===
  
  /**
   * Main combat decision function
   * Extracted from CombatManager.updateEnemiesAI() and NPCStateMachine.handleCombatSeeking()
   */
  makeCombatDecision(context: NPCStateContext): CombatDecision {
    const obj = context.obj;
    const faction = context.faction;
    
    // Get AI profiles
    const aiProfile = this.getAIProfile(context);
    const combatProfile = this.getCombatProfile(context);
    
    // Assess current threats and targets
    const threats = this.assessThreats(context);
    const candidates = this.findHostileCandidates(context);
    
    // Check retreat conditions first
    const retreatDecision = this.evaluateRetreat(context, combatProfile, threats);
    if (retreatDecision) {
      return retreatDecision;
    }
    
    // Check flee conditions for non-combat units
    const fleeDecision = this.evaluateFlee(context, combatProfile, threats);
    if (fleeDecision) {
      return fleeDecision;
    }
    
    // Evaluate attack opportunities
    const attackDecision = this.evaluateAttack(context, aiProfile, candidates);
    if (attackDecision) {
      return attackDecision;
    }
    
    // Default to patrol/idle behavior
    return this.makeDefaultDecision(context, aiProfile);
  }
  
  /**
   * Evaluate retreat conditions
   * Extracted from CombatManager retreat logic
   */
  private evaluateRetreat(
    context: NPCStateContext, 
    combatProfile: any, 
    threats: ThreatAssessment[]
  ): CombatDecision | null {
    const obj = context.obj;
    const hpPct = this.getHealthPercentage(context);
    const retreatThreshold = combatProfile?.retreatHpPct ?? 0;
    
    // Check HP-based retreat
    if (hpPct <= retreatThreshold && retreatThreshold > 0) {
      const primaryThreat = threats[0];
      
      return {
        action: 'retreat',
        target: primaryThreat?.source,
        priority: 90,
        reasoning: `HP ${(hpPct * 100).toFixed(0)}% <= retreat threshold ${(retreatThreshold * 100).toFixed(0)}%`
      };
    }
    
    // Check overwhelming threat retreat (multiple attackers)
    if (threats.length >= 3 && context.aggression.level > 0.7) {
      const totalThreat = threats.reduce((sum, t) => sum + t.threat, 0);
      const avgThreat = totalThreat / threats.length;
      
      if (avgThreat > 50) { // High average threat
        return {
          action: 'retreat',
          target: threats[0]?.source,
          priority: 85,
          reasoning: `Overwhelming threats: ${threats.length} attackers with avg threat ${avgThreat.toFixed(0)}`
        };
      }
    }
    
    return null;
  }
  
  /**
   * Evaluate flee conditions for non-combat units
   * Extracted from NPCStateMachine flee logic
   */
  private evaluateFlee(
    context: NPCStateContext,
    combatProfile: any,
    threats: ThreatAssessment[]
  ): CombatDecision | null {
    const isNonCombat = !!combatProfile?.nonCombat;
    
    // Non-combat units always flee from any threat
    if (isNonCombat && threats.length > 0) {
      return {
        action: 'flee',
        target: threats[0].source,
        priority: 95,
        reasoning: 'Non-combat unit fleeing from threat'
      };
    }
    
    // Trader/civilian behavior - flee from confrontation
    const aiProfile = this.getAIProfile(context);
    const behavior = aiProfile?.behavior;
    
    if ((behavior === 'planet_trader' || behavior === 'orbital_trade') && threats.length > 0) {
      // Check faction relations for flee decision
      const primaryThreat = threats[0];
      const relation = this.getFactionRelation(context.faction, this.getThreatFaction(primaryThreat.source));
      
      if (relation === 'confrontation') {
        return {
          action: 'flee',
          target: primaryThreat.source,
          priority: 80,
          reasoning: `Trader fleeing from confrontational ${this.getThreatFaction(primaryThreat.source)}`
        };
      }
    }
    
    return null;
  }
  
  /**
   * Evaluate attack opportunities
   * Extracted from NPCStateMachine.handleCombatSeeking()
   */
  private evaluateAttack(
    context: NPCStateContext,
    aiProfile: any,
    candidates: any[]
  ): CombatDecision | null {
    if (candidates.length === 0) return null;
    
    const behavior = aiProfile?.behavior;
    const reactions = aiProfile?.sensors?.react?.onFaction;
    
    // Use TargetAnalyzer to select best target
    let bestTarget: any = null;
    if (this.targetAnalyzer) {
      bestTarget = this.targetAnalyzer.selectStableTarget(context, candidates);
    } else {
      // Fallback: simple closest target selection
      bestTarget = this.selectClosestTarget(context, candidates);
    }
    
    if (!bestTarget) return null;
    
    // Check if we should attack based on behavior and faction relations
    const targetFaction = this.getThreatFaction(bestTarget);
    const relation = this.getFactionRelation(context.faction, targetFaction);
    const reaction = reactions?.[relation] ?? 'ignore';
    
    // Aggressive behavior or explicit attack reaction
    if (behavior === 'aggressive' || reaction === 'attack') {
      const targetAnalysis = this.analyzeTarget(context, bestTarget);
      
      return {
        action: 'attack',
        target: bestTarget,
        priority: 70 + targetAnalysis.threat, // Higher priority for more threatening targets
        reasoning: `${behavior === 'aggressive' ? 'Aggressive' : 'Faction'} attack on ${targetFaction} (threat: ${targetAnalysis.threat.toFixed(0)})`
      };
    }
    
    // Defensive attack - only if we're being attacked
    const damageFromTarget = context.aggression.sources.get(bestTarget);
    if (damageFromTarget && damageFromTarget.damage > 0) {
      const timeSinceDamage = this.scene.time.now - damageFromTarget.lastTime;
      
      if (timeSinceDamage < 10000) { // Within last 10 seconds
        return {
          action: 'attack',
          target: bestTarget,
          priority: 60 + damageFromTarget.damage * 0.1,
          reasoning: `Defensive retaliation against attacker (${damageFromTarget.damage} damage ${(timeSinceDamage/1000).toFixed(1)}s ago)`
        };
      }
    }
    
    return null;
  }
  
  /**
   * Make default decision when no combat action is needed
   */
  private makeDefaultDecision(context: NPCStateContext, aiProfile: any): CombatDecision {
    const behavior = aiProfile?.behavior;
    
    if (behavior === 'patrol') {
      return {
        action: 'patrol',
        priority: 10,
        reasoning: 'Default patrol behavior'
      };
    }
    
    return {
      action: 'patrol',
      priority: 5,
      reasoning: 'Default idle behavior'
    };
  }
  
  // === Threat Assessment ===
  
  /**
   * Assess all threats to this NPC
   * Delegates to TargetAnalyzer if available
   */
  private assessThreats(context: NPCStateContext): ThreatAssessment[] {
    if (this.targetAnalyzer) {
      return this.targetAnalyzer.assessThreats(context);
    }
    
    // Fallback implementation
    const threats: ThreatAssessment[] = [];
    
    for (const [source, damageData] of context.aggression.sources.entries()) {
      if (!source || !source.active) continue;
      
      const distance = Phaser.Math.Distance.Between(
        context.obj.x, context.obj.y,
        source.x, source.y
      );
      
      const timeSinceDamage = this.scene.time.now - damageData.lastTime;
      const recencyFactor = Math.max(0, (30000 - timeSinceDamage) / 30000);
      const threat = (damageData.damage * recencyFactor) / Math.max(1, distance * 0.001);
      
      threats.push({
        source,
        threat,
        distance,
        damage: damageData.damage,
        lastDamageTime: damageData.lastTime
      });
    }
    
    return threats.sort((a, b) => b.threat - a.threat);
  }
  
  /**
   * Find hostile candidates within radar range
   * Extracted from NPCStateMachine candidate filtering
   */
  private findHostileCandidates(context: NPCStateContext): any[] {
    const combat = this.combatManager || (this.scene as any).combat;
    const obj = context.obj;
    const faction = context.faction;
    const radar = combat?.getRadarRangeForPublic?.(obj) ?? 800;
    const all = combat?.getAllNPCs?.() ?? [];
    
    // Get faction overrides
    const selfRec = all.find((r: any) => r.obj === obj);
    const overrides = selfRec?.overrides?.factions;
    
    // Filter hostile NPCs
    const candidates = all
      .filter((r: any) => r && r.obj !== obj && r.obj?.active)
      .filter((r: any) => {
        const distance = Phaser.Math.Distance.Between(obj.x, obj.y, r.obj.x, r.obj.y);
        if (distance > radar) return false;
        
        // Check mutual hostility with overrides
        const relAB = combat.getRelationPublic(faction, r.faction, overrides);
        const relBA = combat.getRelationPublic(r.faction, faction, r.overrides?.factions);
        return relAB === 'confrontation' || relBA === 'confrontation';
      })
      .map((r: any) => r.obj);
    
    // Add player as potential target if hostile and in range
    const player = combat?.getPlayerShip?.();
    if (player && player.active) {
      const distance = Phaser.Math.Distance.Between(obj.x, obj.y, player.x, player.y);
      if (distance <= radar) {
        const relation = combat.getRelationPublic(faction, 'player', overrides);
        const aiProfile = this.getAIProfile(context);
        const reactions = aiProfile?.sensors?.react?.onFaction;
        const reaction = reactions?.[relation] ?? 'ignore';
        const wantsAttackPlayer = (aiProfile?.behavior === 'aggressive') || (reaction === 'attack');
        
        if (wantsAttackPlayer && !candidates.includes(player)) {
          candidates.push(player);
        }
      }
    }
    
    return candidates;
  }
  
  /**
   * Analyze specific target for detailed assessment
   */
  private analyzeTarget(context: NPCStateContext, target: any): TargetAnalysis {
    if (this.targetAnalyzer) {
      const score = this.targetAnalyzer.evaluateTarget(context, target);
      const distance = Phaser.Math.Distance.Between(
        context.obj.x, context.obj.y,
        target.x, target.y
      );
      
      const damageData = context.aggression.sources.get(target);
      const threat = damageData ? damageData.damage / Math.max(1, this.scene.time.now - damageData.lastTime) : 0;
      
      return {
        target,
        score,
        distance,
        threat,
        priority: score
      };
    }
    
    // Fallback implementation
    const distance = Phaser.Math.Distance.Between(
      context.obj.x, context.obj.y,
      target.x, target.y
    );
    
    return {
      target,
      score: 100 - distance * 0.1,
      distance,
      threat: 0,
      priority: 50
    };
  }
  
  // === Utility Methods ===
  
  /**
   * Get AI profile for the NPC
   */
  private getAIProfile(context: NPCStateContext): any {
    const profileKey = context.aiProfile;
    return profileKey ? this.config.aiProfiles?.profiles?.[profileKey] : undefined;
  }
  
  /**
   * Get combat profile for the NPC
   */
  private getCombatProfile(context: NPCStateContext): any {
    const profileKey = context.combatAI;
    return profileKey ? this.config.combatAI?.profiles?.[profileKey] : undefined;
  }
  
  /**
   * Get health percentage of the NPC
   */
  private getHealthPercentage(context: NPCStateContext): number {
    // This would need integration with target system to get actual HP
    // For now, return default value
    return 1.0;
  }
  
  /**
   * Get faction relation between two factions
   */
  private getFactionRelation(factionA?: string, factionB?: string): string {
    if (!this.combatManager) return 'neutral';
    return this.combatManager.getRelationPublic?.(factionA, factionB) ?? 'neutral';
  }
  
  /**
   * Get faction of a threat source
   */
  private getThreatFaction(source: any): string {
    const combat = this.combatManager || (this.scene as any).combat;
    
    // Check if it's the player
    const player = combat?.getPlayerShip?.();
    if (source === player) return 'player';
    
    // Find faction among NPCs
    const all = combat?.getAllNPCs?.() ?? [];
    const sourceRec = all.find((r: any) => r.obj === source);
    return sourceRec?.faction ?? 'unknown';
  }
  
  /**
   * Simple closest target selection (fallback)
   */
  private selectClosestTarget(context: NPCStateContext, candidates: any[]): any | null {
    if (candidates.length === 0) return null;
    
    let closest: any = null;
    let minDistance = Infinity;
    
    for (const candidate of candidates) {
      const distance = Phaser.Math.Distance.Between(
        context.obj.x, context.obj.y,
        candidate.x, candidate.y
      );
      
      if (distance < minDistance) {
        minDistance = distance;
        closest = candidate;
      }
    }
    
    return closest;
  }
  
  // === Decision Validation ===
  
  /**
   * Validate if a combat decision is still valid
   */
  isDecisionValid(decision: CombatDecision): boolean {
    if (!decision.target) return true; // No target decisions are always valid
    
    // Check if target is still active
    if (!decision.target.active) return false;
    
    // Check if target is in docking state (can't be attacked)
    const state = decision.target.__state;
    if (state === 'docking' || state === 'docked' || state === 'undocking') {
      return false;
    }
    
    return true;
  }
  
  /**
   * Get decision priority adjustment based on context
   */
  getDecisionPriorityAdjustment(context: NPCStateContext, decision: CombatDecision): number {
    let adjustment = 0;
    
    // Boost priority if we're already committed to this target
    if (decision.target === context.targetStabilization.currentTarget) {
      adjustment += 10;
    }
    
    // Reduce priority if we're heavily damaged
    const hpPct = this.getHealthPercentage(context);
    if (hpPct < 0.3) {
      adjustment -= 15;
    }
    
    // Boost priority based on aggression level
    adjustment += context.aggression.level * 20;
    
    return adjustment;
  }
}