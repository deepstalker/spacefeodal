import type { ConfigManager } from '../../ConfigManager';
import type { TargetAnalysis, ThreatAssessment, NPCStateContext, TargetStabilization, AggressionState } from '../CombatTypes';

/**
 * Анализатор целей для NPC - извлеченная логика анализа и выбора целей
 * Отвечает за оценку приоритетности целей и стабильный выбор с предотвращением дребезжания
 */
export class TargetAnalyzer {
  private scene: Phaser.Scene;
  private config: ConfigManager;
  
  // Настройки системы (перенесены из NPCStateManager)
  private readonly TARGET_SWITCH_THRESHOLD = 1.4;   // требуется 40% преимущество
  private readonly TARGET_STABILITY_TIME = 1500;    // 1.5 сек стабильности
  private readonly DAMAGE_MEMORY_TIME = 30000;      // 30 сек помним урон
  
  constructor(scene: Phaser.Scene, config: ConfigManager) {
    this.scene = scene;
    this.config = config;
  }
  
  /**
   * Создает новый контекст стабилизации целей
   */
  createStabilizationContext(): TargetStabilization {
    return {
      currentTarget: null,
      targetScore: 0,
      targetSwitchTime: 0,
      requiredAdvantage: this.TARGET_SWITCH_THRESHOLD - 1, // 0.4 (40%)
      stabilityPeriod: this.TARGET_STABILITY_TIME
    };
  }
  
  /**
   * Оценка цели (улучшенная система)
   * ПЕРЕНЕСЕНО ИЗ NPCStateManager.evaluateTarget()
   */
  evaluateTarget(context: NPCStateContext, target: any): number {
    if (!target || !target.active) return -1;
    
    const obj = context.obj;
    const aggression = context.aggression;
    
    let score = 0;
    
    // Урон от цели (важнейший фактор)
    const damageData = aggression.sources.get(target);
    if (damageData) {
      let damageScore = damageData.damage * 2.0; // x2 множитель за урон
      
      // Игрок оценивается наравне с другими целями
      // (убраны специальные бонусы)
      
      score += damageScore;
      
      // Бонус за недавний урон
      const timeSinceDamage = this.scene.time.now - damageData.lastTime;
      if (timeSinceDamage < 5000) {
        score += (5000 - timeSinceDamage) * 0.001; // до +5 очков за свежий урон
      }
    }
    
    // Расчет расстояния до цели
    const distance = Phaser.Math.Distance.Between(obj.x, obj.y, target.x, target.y);
    
    // Расстояние до цели (штраф)
    score -= distance * 0.002; // -2 очка за 1000 единиц расстояния
    
    // Бонус за близость к текущей цели (предотвращает дребезжание)
    if (target === context.targetStabilization.currentTarget) {
      score += 2.0; // бонус за стабильность
    }
    
    return score;
  }
  
  /**
   * Стабильный выбор цели
   * ПЕРЕНЕСЕНО ИЗ NPCStateManager.selectStableTarget()
   */
  selectStableTarget(context: NPCStateContext, candidates: any[]): any | null {
    if (candidates.length === 0) return null;
    
    const stabilization = context.targetStabilization;
    const now = this.scene.time.now;
    const objId = (context.obj as any).__uniqueId || 'unknown';
    
    // Оцениваем всех кандидатов
    let bestTarget: any = null;
    let bestScore = -1;
    
    // Получаем корабль игрока из CombatManager
    const playerShip = (this.scene as any).combatManager?.ship;
    const playerCandidate = candidates.find(candidate => candidate === playerShip);
    
    const candidateScores: any[] = [];
    for (const candidate of candidates) {
      const score = this.evaluateTarget(context, candidate);
      const isPlayerCandidate = candidate === playerCandidate;
      const candidateId = isPlayerCandidate ? 'PLAYER' : `#${(candidate as any).__uniqueId || 'UNK'}`;
      candidateScores.push({ id: candidateId, score: score.toFixed(2), isPlayer: isPlayerCandidate });
      
      // ОТЛАДКА: детально логируем игрока
      if (process.env.NODE_ENV === 'development' && isPlayerCandidate) {
        console.log(`[PlayerCandidate] Found PLAYER in candidates for ${objId}`, {
          playerScore: score.toFixed(2),
          playerTexture: (candidate as any)?.texture?.key,
          playerActive: candidate?.active,
          aggressionLevel: (context.aggression.level * 100).toFixed(0) + '%',
          damageFromPlayer: context.aggression.sources.get(candidate) || 'none'
        });
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestTarget = candidate;
      }
    }
    
    const bestTargetId = !bestTarget ? 'null' : 
                         bestTarget === playerCandidate ? 'PLAYER' : 
                         `#${(bestTarget as any).__uniqueId || 'UNK'}`;
    const currentTargetId = !stabilization.currentTarget ? 'none' :
                           stabilization.currentTarget === playerCandidate ? 'PLAYER' : 
                           `#${(stabilization.currentTarget as any).__uniqueId || 'UNK'}`;
    
    // Проверяем, нужно ли менять цель
    if (bestTarget !== stabilization.currentTarget) {
      const timeSinceSwitch = now - stabilization.targetSwitchTime;
      
      // ИСПРАВЛЕНО: правильная формула для требуемого превосходства
      const currentScore = stabilization.currentTarget ? stabilization.targetScore : 0;
      const requiredScore = currentScore * (1 + stabilization.requiredAdvantage);
      
      const canSwitchByTime = timeSinceSwitch > stabilization.stabilityPeriod;
      const canSwitchByScore = bestScore > requiredScore;
      const hasCurrentTarget = !!stabilization.currentTarget;
      
      // Debug logging disabled
      // if (process.env.NODE_ENV === 'development') {
      //   console.log(`[StableTarget] ${objId} considering switch: ${currentTargetId} → ${bestTargetId}`, {
      //     candidateScores,
      //     currentScore: currentScore.toFixed(2),
      //     bestScore: bestScore.toFixed(2),
      //     requiredScore: requiredScore.toFixed(2),
      //     timeSinceSwitch: timeSinceSwitch + 'ms',
      //     stabilityPeriod: stabilization.stabilityPeriod + 'ms',
      //     canSwitchByTime,
      //     canSwitchByScore,
      //     hasCurrentTarget,
      //     requiredAdvantage: (stabilization.requiredAdvantage * 100).toFixed(0) + '%'
      //   });
      // }
      
      // Меняем цель если:
      // 1. У нас нет текущей цели ИЛИ
      // 2. (Прошел период стабильности И новая цель значительно лучше)
      if (!hasCurrentTarget || (canSwitchByTime && canSwitchByScore)) {
        
        stabilization.currentTarget = bestTarget;
        stabilization.targetScore = bestScore;
        stabilization.targetSwitchTime = now;
        
        // Debug logging disabled
        // if (process.env.NODE_ENV === 'development') {
        //   console.log(`[StableTarget] ${objId} SWITCHED to ${bestTargetId}`, {
        //     reason: !hasCurrentTarget ? 'no_current_target' : 'better_target',
        //     newScore: bestTarget ? bestScore.toFixed(2) : 'null'
        //   });
        // }
        
        return bestTarget;
      } else {
        // Остаемся с текущей целью
        // Debug logging disabled
        // if (process.env.NODE_ENV === 'development') {
        //   console.log(`[StableTarget] ${objId} KEEPING ${currentTargetId}`, {
        //     reason: !canSwitchByTime ? 'stabilization_period' : 'insufficient_score_advantage'
        //   });
        // }
        
        return stabilization.currentTarget;
      }
    } else {
      // Цель не изменилась - обновляем счет
      stabilization.targetScore = bestScore;
      
      // Debug logging disabled
      // if (process.env.NODE_ENV === 'development') {
      //   console.log(`[StableTarget] ${objId} UNCHANGED ${bestTargetId}`, {
      //     score: bestTarget ? bestScore.toFixed(2) : 'null',
      //     candidateCount: candidates.length
      //   });
      // }
      
      return bestTarget;
    }
  }
  
  /**
   * Создание анализа множественных целей с подробной информацией
   */
  analyzeTargets(context: NPCStateContext, candidates: any[]): TargetAnalysis[] {
    return candidates
      .filter(candidate => candidate && candidate.active)
      .map(candidate => {
        const score = this.evaluateTarget(context, candidate);
        const distance = Phaser.Math.Distance.Between(
          context.obj.x, context.obj.y, 
          candidate.x, candidate.y
        );
        
        // Оценка угрозы на основе данных об уроне
        const damageData = context.aggression.sources.get(candidate);
        const threat = damageData ? damageData.damage / Math.max(1, this.scene.time.now - damageData.lastTime) : 0;
        
        // Приоритет = оценка + бонусы
        let priority = score;
        if (candidate === context.targetStabilization.currentTarget) {
          priority += 10; // бонус за текущую цель
        }
        
        return {
          target: candidate,
          score,
          distance,
          threat,
          priority
        };
      })
      .sort((a, b) => b.priority - a.priority);
  }
  
  /**
   * Оценка угроз от множественных источников
   */
  assessThreats(context: NPCStateContext): ThreatAssessment[] {
    const threats: ThreatAssessment[] = [];
    
    for (const [source, damageData] of context.aggression.sources.entries()) {
      if (!source || !source.active) continue;
      
      const distance = Phaser.Math.Distance.Between(
        context.obj.x, context.obj.y,
        source.x, source.y
      );
      
      // Вычисляем угрозу на основе урона и времени
      const timeSinceDamage = this.scene.time.now - damageData.lastTime;
      const recencyFactor = Math.max(0, (this.DAMAGE_MEMORY_TIME - timeSinceDamage) / this.DAMAGE_MEMORY_TIME);
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
   * Фильтрация кандидатов по отношениям фракций
   */
  filterHostileCandidates(
    context: NPCStateContext, 
    allCandidates: any[], 
    combatInterface: any
  ): any[] {
    if (!combatInterface) return [];
    
    const myFaction = context.faction;
    const myOverrides = this.getObjectOverrides(context.obj, combatInterface);
    
    return allCandidates.filter(candidate => {
      if (!candidate || !candidate.active) return false;
      
      // Получаем фракцию кандидата
      const candidateFaction = this.getCandidateFaction(candidate, combatInterface);
      const candidateOverrides = this.getCandidateOverrides(candidate, combatInterface);
      
      // Проверяем взаимную вражду
      const relAB = combatInterface.getRelationPublic?.(myFaction, candidateFaction, myOverrides);
      const relBA = combatInterface.getRelationPublic?.(candidateFaction, myFaction, candidateOverrides);
      
      return relAB === 'confrontation' || relBA === 'confrontation';
    });
  }
  
  /**
   * Проверка находится ли кандидат в радиусе радара
   */
  isInRadarRange(context: NPCStateContext, candidate: any, combatInterface: any): boolean {
    if (!candidate || !candidate.active) return false;
    
    const radar = combatInterface?.getRadarRangeForPublic?.(context.obj) ?? 800;
    const distance = Phaser.Math.Distance.Between(
      context.obj.x, context.obj.y,
      candidate.x, candidate.y
    );
    
    return distance <= radar;
  }
  
  /**
   * Получение конфигурации стабилизации цели для контекста
   */
  getTargetStabilizationConfig(): { 
    switchThreshold: number; 
    stabilityTime: number; 
    memoryTime: number 
  } {
    return {
      switchThreshold: this.TARGET_SWITCH_THRESHOLD,
      stabilityTime: this.TARGET_STABILITY_TIME,
      memoryTime: this.DAMAGE_MEMORY_TIME
    };
  }
  
  /**
   * Применение нового выбора цели к контексту
   */
  applyTargetSelection(context: NPCStateContext, selectedTarget: any): void {
    const stabilization = context.targetStabilization;
    const now = this.scene.time.now;
    
    if (selectedTarget !== stabilization.currentTarget) {
      stabilization.currentTarget = selectedTarget;
      stabilization.targetSwitchTime = now;
      
      if (selectedTarget) {
        stabilization.targetScore = this.evaluateTarget(context, selectedTarget);
      } else {
        stabilization.targetScore = 0;
      }
    } else if (selectedTarget) {
      // Обновляем оценку текущей цели
      stabilization.targetScore = this.evaluateTarget(context, selectedTarget);
    }
  }
  
  // === Утилитарные методы ===
  
  private getObjectOverrides(obj: any, combatInterface: any): any {
    const allNPCs = combatInterface?.getAllNPCs?.() ?? [];
    const selfRec = allNPCs.find((r: any) => r.obj === obj);
    return selfRec?.overrides?.factions;
  }
  
  private getCandidateFaction(candidate: any, combatInterface: any): string | undefined {
    // Проверяем, является ли кандидат игроком
    const playerShip = combatInterface?.getPlayerShip?.();
    if (candidate === playerShip) {
      return 'player';
    }
    
    // Ищем фракцию среди NPC
    const allNPCs = combatInterface?.getAllNPCs?.() ?? [];
    const candidateRec = allNPCs.find((r: any) => r.obj === candidate);
    return candidateRec?.faction;
  }
  
  private getCandidateOverrides(candidate: any, combatInterface: any): any {
    const allNPCs = combatInterface?.getAllNPCs?.() ?? [];
    const candidateRec = allNPCs.find((r: any) => r.obj === candidate);
    return candidateRec?.overrides?.factions;
  }
}