// ═══════════════════════════════════════════════════════════
// MUNINN — Relationship Progression System
// How trust is built: not by time alone, but by depth
// Inspired by James's stream of consciousness:
// relationship is a continuous flow, not discrete steps
//
// Philosophical progression:
//   Curious     → Locke's tabula rasa (blank slate, pure receptivity)
//   Learning    → James' stream of experience (patterns in the flow)
//   Understanding → Brentano's intentionality (thought directed at its object)
//   Proactive   → Leibniz' apperception (self-aware perception)
// ═══════════════════════════════════════════════════════════

import { RelationshipPhase } from '../core/types.js';
import type { Soul, Fact } from '../core/types.js';
import type { MemoryEngine } from '../memory/memory-engine.js';
import type { SoulManager } from './soul-manager.js';

/** Criteria for phase transitions */
interface PhaseTransitionCriteria {
  minInteractions: number;
  minFacts: number;
  minDaysActive: number;
  description: string;
}

/** The progression map — what it takes to advance
 *  Each phase embodies a specific philosophical stance toward knowledge */
const PHASE_TRANSITIONS: Record<RelationshipPhase, PhaseTransitionCriteria> = {
  [RelationshipPhase.CURIOUS]: {
    minInteractions: 0,
    minFacts: 0,
    minDaysActive: 0,
    description: 'Locke\'s tabula rasa — a blank slate, pure receptivity, everything is new',
  },
  [RelationshipPhase.LEARNING]: {
    minInteractions: 15,
    minFacts: 10,
    minDaysActive: 1,
    description: 'James\' stream of consciousness — patterns begin to emerge from the flow of experience',
  },
  [RelationshipPhase.UNDERSTANDING]: {
    minInteractions: 75,
    minFacts: 50,
    minDaysActive: 14,
    description: 'Brentano\'s intentionality — every thought is now directed at something specific about this person',
  },
  [RelationshipPhase.PROACTIVE]: {
    minInteractions: 200,
    minFacts: 100,
    minDaysActive: 30,
    description: 'Leibniz\' apperception — not just perceiving, but perceiving that you perceive. True partnership.',
  },
};

/** Phase order for progression */
const PHASE_ORDER: RelationshipPhase[] = [
  RelationshipPhase.CURIOUS,
  RelationshipPhase.LEARNING,
  RelationshipPhase.UNDERSTANDING,
  RelationshipPhase.PROACTIVE,
];

/**
 * The Relationship Manager — evaluates and manages phase transitions.
 *
 * Unlike most AI systems where the relationship is static,
 * Muninn's relationship with the user evolves organically.
 * This isn't a gamification system — it's a genuine attempt
 * to model how trust builds between minds.
 */
export class RelationshipManager {
  private memory: MemoryEngine;
  private soul: SoulManager;

  constructor(memory: MemoryEngine, soul: SoulManager) {
    this.memory = memory;
    this.soul = soul;
  }

  /** Evaluate whether a phase transition should occur */
  async evaluateProgression(): Promise<{
    shouldProgress: boolean;
    currentPhase: RelationshipPhase;
    nextPhase?: RelationshipPhase;
    reason?: string;
    progress: Record<string, { current: number; required: number; met: boolean }>;
  }> {
    const soul = await this.soul.getSoul();
    const currentPhase = soul.relationshipPhase;
    const currentIndex = PHASE_ORDER.indexOf(currentPhase);

    // Already at max phase
    if (currentIndex >= PHASE_ORDER.length - 1) {
      return {
        shouldProgress: false,
        currentPhase,
        progress: await this.getProgressMetrics(PHASE_TRANSITIONS[RelationshipPhase.PROACTIVE]),
      };
    }

    const nextPhase = PHASE_ORDER[currentIndex + 1];
    const criteria = PHASE_TRANSITIONS[nextPhase];
    const progress = await this.getProgressMetrics(criteria);

    const allMet = Object.values(progress).every(p => p.met);

    return {
      shouldProgress: allMet,
      currentPhase,
      nextPhase: allMet ? nextPhase : undefined,
      reason: allMet
        ? `Ready for ${nextPhase}: ${criteria.description}`
        : undefined,
      progress,
    };
  }

  /** Execute a phase transition */
  async progressPhase(): Promise<{
    from: RelationshipPhase;
    to: RelationshipPhase;
  } | null> {
    const evaluation = await this.evaluateProgression();

    if (!evaluation.shouldProgress || !evaluation.nextPhase) {
      return null;
    }

    const from = evaluation.currentPhase;
    const to = evaluation.nextPhase;

    // Update soul with new phase
    await this.soul.updateSoul({
      relationshipPhase: to,
      reflectionNote: `Phase transition: ${from} → ${to}. ${evaluation.reason}`,
    });

    console.log(`[Relationship] Phase transition: ${from} → ${to}`);

    return { from, to };
  }

  /** Get current progress metrics */
  private async getProgressMetrics(criteria: PhaseTransitionCriteria): Promise<
    Record<string, { current: number; required: number; met: boolean }>
  > {
    const soul = await this.soul.getSoul();
    const factCount = this.memory.getFactCount();

    // Calculate days active from the oldest conversation
    const conversations = await this.memory.getConversations(1000);
    const oldest = conversations.length > 0
      ? conversations.reduce((min, c) =>
          new Date(c.startedAt) < new Date(min.startedAt) ? c : min
        )
      : null;
    const daysActive = oldest
      ? Math.floor(
          (Date.now() - new Date(oldest.startedAt).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : 0;

    return {
      interactions: {
        current: soul.interactionCount,
        required: criteria.minInteractions,
        met: soul.interactionCount >= criteria.minInteractions,
      },
      facts: {
        current: factCount,
        required: criteria.minFacts,
        met: factCount >= criteria.minFacts,
      },
      daysActive: {
        current: daysActive,
        required: criteria.minDaysActive,
        met: daysActive >= criteria.minDaysActive,
      },
    };
  }

  /** Get a human-readable relationship status */
  async getRelationshipStatus(): Promise<string> {
    const soul = await this.soul.getSoul();
    const evaluation = await this.evaluateProgression();

    let status = `🐦 Relationship Phase: ${soul.relationshipPhase.toUpperCase()}\n`;
    status += `📊 Interactions: ${soul.interactionCount}\n`;
    status += `🧠 Facts remembered: ${this.memory.getFactCount()}\n`;

    if (evaluation.nextPhase) {
      status += `\n📈 Progress to "${evaluation.nextPhase}":\n`;
      for (const [metric, data] of Object.entries(evaluation.progress)) {
        const icon = data.met ? '✅' : '⬜';
        status += `  ${icon} ${metric}: ${data.current}/${data.required}\n`;
      }
    } else {
      status += `\n🌟 Maximum relationship level reached!`;
    }

    return status;
  }
}
