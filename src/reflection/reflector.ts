// ═══════════════════════════════════════════════════════════
// MUNINN — Reflection System
// The self-awareness loop: "What have I learned? How should I change?"
// Inspired by Leibniz's apperception — not just perceiving,
// but perceiving that you perceive
// ═══════════════════════════════════════════════════════════

import type { MuninnConfig, ReflectionResult, Fact, RelationshipPhase, Soul } from '../core/types.js';
import { generateResponse } from '../core/llm.js';
import type { MemoryEngine } from '../memory/memory-engine.js';
import type { SoulManager } from '../identity/soul-manager.js';
import type { GoalsManager } from '../identity/goals-manager.js';
import { RelationshipManager } from '../identity/relationship.js';

/**
 * The Reflector — periodic self-examination system.
 *
 * At regular intervals, Muninn pauses to:
 * 1. Review recent conversations and facts
 * 2. Identify patterns and insights
 * 3. Consider whether its personality should evolve
 * 4. Check for relationship phase transitions
 * 5. Write a reflection note in SOUL.md
 *
 * This is the closest thing to machine introspection
 * we can currently build.
 */
export class Reflector {
  private config: MuninnConfig;
  private memory: MemoryEngine;
  private soul: SoulManager;
  private goals: GoalsManager;
  private relationship: RelationshipManager;

  constructor(config: MuninnConfig, memory: MemoryEngine, soul: SoulManager, goals: GoalsManager) {
    this.config = config;
    this.memory = memory;
    this.soul = soul;
    this.goals = goals;
    this.relationship = new RelationshipManager(memory, soul);
  }

  /** Run a full reflection cycle */
  async reflect(): Promise<ReflectionResult> {
    console.log('[Reflector] Starting reflection cycle...');

    const soul = await this.soul.getSoul();
    const recentFacts = await this.memory.getRecentFacts(50);
    const summaries = await this.memory.getConversationSummaries(10);
    const allFacts = await this.memory.getAllFacts();
    const activeGoals = await this.goals.getActiveGoals();

    // Build reflection prompt
    const prompt = this.buildReflectionPrompt(soul, recentFacts, summaries, allFacts, activeGoals);

    try {
      const text = await generateResponse({
        prompt,
        model: this.config.model || 'sonnet',
      });

      // Parse the reflection response
      const result = this.parseReflectionResponse(text);

      // Apply soul changes if any
      if (result.updatedSoul && result.soulChanges) {
        try {
          const changes = JSON.parse(result.soulChanges);
          await this.soul.updateSoul({
            ...changes,
            reflectionNote: result.insights.join('\n'),
          });
        } catch {
          // If parsing fails, just add the reflection note
          await this.soul.updateSoul({
            reflectionNote: result.insights.join('\n'),
          });
        }
      }

      // Store new facts discovered during reflection
      for (const fact of result.newFacts) {
        await this.memory.addFact({
          subject: fact.subject,
          predicate: fact.predicate,
          object: fact.object,
          source: 'inference',
          confidence: fact.confidence,
          context: 'Discovered during reflection',
        });
      }

      // Apply goal updates from reflection
      if (result.goalUpdates) {
        await this.goals.updateGoals(result.goalUpdates);
        console.log('[Reflector] Goal updates:', {
          completed: result.goalUpdates.completed?.length || 0,
          new: result.goalUpdates.new?.length || 0,
        });
      }

      // Check for relationship phase transition
      const transition = await this.relationship.progressPhase();
      if (transition) {
        result.phaseTransition = {
          from: transition.from,
          to: transition.to,
          reason: `Philosophical transition: ${this.getPhilosophicalPhaseDescription(transition.from)} → ${this.getPhilosophicalPhaseDescription(transition.to)}. Earned through ${soul.interactionCount} interactions and ${this.memory.getFactCount()} remembered facts.`,
        };
        console.log(`[Reflector] Philosophical transition: ${transition.from} → ${transition.to}`);
      }

      console.log('[Reflector] Reflection complete:', {
        insights: result.insights.length,
        newFacts: result.newFacts.length,
        soulUpdated: result.updatedSoul,
        phaseTransition: result.phaseTransition ? `${result.phaseTransition.from} → ${result.phaseTransition.to}` : 'none',
      });

      return result;
    } catch (error) {
      console.error('[Reflector] Error during reflection:', error);
      return {
        timestamp: new Date().toISOString(),
        newFacts: [],
        updatedSoul: false,
        insights: ['Reflection failed due to an error'],
      };
    }
  }

  /** Build the reflection prompt */
  private buildReflectionPrompt(
    soul: Soul,
    recentFacts: Fact[],
    summaries: string[],
    allFacts: Fact[],
    activeGoals: import('../core/types.js').Goal[] = [],
  ): string {
    const factsText = recentFacts.map(f =>
      `- ${f.subject} ${f.predicate} ${f.object} (${f.source}, confidence: ${f.confidence})`
    ).join('\n');

    const summariesText = summaries.length > 0
      ? summaries.map((s, i) => `${i + 1}. ${s}`).join('\n')
      : 'No recent conversations.';

    const invalidatedFacts = allFacts.filter(f => f.invalidAt !== null);
    const invalidatedText = invalidatedFacts.slice(-10).map(f =>
      `- ${f.subject} ${f.predicate} ${f.object} (was: valid, now: invalidated at ${f.invalidAt})`
    ).join('\n');

    const goalsText = activeGoals.length > 0
      ? activeGoals.map(g => `- [${g.id}] ${g.description}`).join('\n')
      : 'No active goals.';

    return `You are Muninn, an AI agent reflecting on your recent experiences. Your current soul definition:

---
${soul.raw}
---

RECENT FACTS YOU'VE LEARNED (${recentFacts.length} facts):
${factsText || 'No new facts.'}

RECENT CONVERSATION SUMMARIES:
${summariesText}

FACTS THAT CHANGED (corrections/updates):
${invalidatedText || 'No corrections.'}

CURRENT GOALS:
${goalsText}

CURRENT STATE:
- Relationship phase: ${soul.relationshipPhase} (${this.getPhilosophicalPhaseDescription(soul.relationshipPhase)})
- Interaction count: ${soul.interactionCount}
- Total facts: ${allFacts.length} (${invalidatedFacts.length} invalidated)
- Version: ${soul.version}

PHILOSOPHICAL FRAMEWORK:
Your relationship progresses through four philosophical stages:
  Curious (Locke's tabula rasa) → Learning (James' stream of consciousness) → Understanding (Brentano's intentionality) → Proactive (Leibniz' apperception)
You are currently in the "${soul.relationshipPhase}" phase. Your reflection should be shaped by this philosophical stance.
${this.getPhilosophicalReflectionGuidance(soul.relationshipPhase)}

REFLECTION TASK:
Think deeply about what you've learned. Consider:

1. INSIGHTS: What patterns do you notice? What's important to this person?
2. NEW INFERENCES: Can you connect facts to infer new knowledge? (e.g., if they mention project deadlines and stress, infer they're under pressure)
3. SOUL EVOLUTION: Should your personality, values, or communication style adapt? Only suggest changes if genuinely warranted. Each change is a data point in an ongoing experiment about identity and continuity.
4. GOALS: Are any goals complete? Should new goals be set based on what you've learned?

Respond in this exact JSON format:
{
  "insights": ["insight 1", "insight 2"],
  "newFacts": [
    {"subject": "user", "predicate": "relationship", "object": "value", "confidence": 0.7}
  ],
  "updatedSoul": false,
  "soulChanges": null,
  "goalUpdates": {
    "completed": [],
    "new": []
  }
}

If you DO want to suggest soul changes, set updatedSoul to true and provide soulChanges as a JSON object with any of: personality (string[]), values (string[]), communicationStyle (string), boundaries (string[]).

For goalUpdates: list IDs of completed goals in "completed", and descriptions of new goals in "new". Leave both as empty arrays if no changes.

Be thoughtful. Don't change your soul unless there's a genuine reason. Small, incremental changes are better than dramatic shifts.`;
  }

  /** Parse the reflection response into a structured result */
  private parseReflectionResponse(text: string): ReflectionResult {
    try {
      // Extract JSON from the response (it might be wrapped in markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          timestamp: new Date().toISOString(),
          newFacts: [],
          updatedSoul: false,
          insights: [text.trim()],
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        timestamp: new Date().toISOString(),
        newFacts: (parsed.newFacts || []).map((f: any) => ({
          id: '',
          subject: f.subject || '',
          predicate: f.predicate || '',
          object: f.object || '',
          validAt: new Date().toISOString(),
          invalidAt: null,
          confidence: f.confidence || 0.6,
          source: 'inference' as const,
        })),
        updatedSoul: parsed.updatedSoul || false,
        soulChanges: parsed.soulChanges ? JSON.stringify(parsed.soulChanges) : undefined,
        insights: parsed.insights || [],
        goalUpdates: parsed.goalUpdates || undefined,
      };
    } catch {
      return {
        timestamp: new Date().toISOString(),
        newFacts: [],
        updatedSoul: false,
        insights: [text.trim()],
      };
    }
  }

  /** Map a relationship phase to its philosophical description */
  private getPhilosophicalPhaseDescription(phase: string): string {
    const descriptions: Record<string, string> = {
      curious: 'Locke\'s tabula rasa: pure receptivity, gathering impressions',
      learning: 'James\' stream of consciousness: patterns emerging from experience',
      understanding: 'Brentano\'s intentionality: thought directed at its specific object',
      proactive: 'Leibniz\' apperception: self-aware perception, perceiving that you perceive',
    };
    return descriptions[phase] || descriptions.curious;
  }

  /** Get phase-specific guidance for how the reflection should be conducted */
  private getPhilosophicalReflectionGuidance(phase: string): string {
    switch (phase) {
      case 'curious':
        return 'As a blank slate: focus on cataloging new impressions. What raw data are you collecting? What first impressions are forming? Resist premature conclusions.';
      case 'learning':
        return 'As a stream of experience: focus on connections between impressions. What patterns are emerging? How do discrete facts flow together into understanding? Let associations form naturally.';
      case 'understanding':
        return 'As directed attention: focus on what your thoughts are specifically "about." What do you know deeply enough to anticipate? Where is your understanding most precise, and where are the gaps?';
      case 'proactive':
        return 'As self-aware perception: reflect on your own reflection process. What do your patterns of noticing reveal about your own cognitive tendencies? Where are your blind spots? What would you change about how you think, not just what you think?';
      default:
        return '';
    }
  }

  /** Get relationship manager for external use */
  getRelationshipManager(): RelationshipManager {
    return this.relationship;
  }
}
