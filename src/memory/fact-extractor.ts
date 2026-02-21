// ═══════════════════════════════════════════════════════════
// MUNINN — Automatic Fact Extraction
// The raven notices things you didn't explicitly tell it
// Every conversation leaves traces — Leibniz's petites perceptions
// ═══════════════════════════════════════════════════════════

import type { MuninnConfig, Fact } from '../core/types.js';
import { generateCheapResponse } from '../core/llm.js';
import type { MemoryEngine } from './memory-engine.js';

/**
 * The Fact Extractor — runs after every conversation turn.
 *
 * Instead of relying solely on the LLM using the remember_fact tool
 * (which it sometimes forgets to do), this system analyzes each
 * message exchange and extracts facts automatically.
 *
 * This is the "unconscious memory" — the stuff you pick up
 * without trying to remember it.
 */
export class FactExtractor {
  private config: MuninnConfig;
  private memory: MemoryEngine;

  constructor(config: MuninnConfig, memory: MemoryEngine) {
    this.config = config;
    this.memory = memory;
  }

  /**
   * Extract facts from a user message.
   * Called after every user message, before the response.
   * Uses a small/fast model to keep costs low.
   */
  async extractFromMessage(
    userMessage: string,
    assistantResponse?: string,
  ): Promise<ExtractedFact[]> {
    try {
      // Get existing facts for context (avoid duplicates)
      const existingFacts = await this.memory.getRecentFacts(30);
      const existingContext = existingFacts.length > 0
        ? `\nAlready known facts:\n${existingFacts.map(f => `- ${f.subject} ${f.predicate} ${f.object}`).join('\n')}`
        : '';

      const prompt = `You are extracting PERSONAL facts about the user from a conversation. Your job is to remember things that help you know this person better over time.

ONLY extract facts that are:
- About the USER as a person: their life, preferences, relationships, work, habits, opinions, plans, feelings
- About people, places, or things the user has a PERSONAL connection to (their friends, their projects, their city)
- Stated or clearly implied BY THE USER (not by the assistant)

NEVER extract:
- News, current events, or world information the assistant mentioned
- Conversation metadata (language used, greetings, what channel this is)
- Things the assistant said, reported, or summarized (unless the user confirmed them as personally relevant)
- Vague or generic observations ("user is chatting", "user asked a question")
- Technical details about the bot itself

${existingContext}

User message: "${userMessage}"
${assistantResponse ? `Assistant response: "${assistantResponse}"` : ''}

Extract facts as JSON array. Each fact needs:
- subject: who/what (use "user" for the person talking, or a name for someone they mentioned)
- predicate: the relationship/attribute
- object: the value
- confidence: 0.0-1.0 (how certain this fact is)
- type: "stated" (user explicitly said it), "implied" (can be inferred), or "observed" (behavioral pattern)

Examples of GOOD facts (personal, useful):
- {"subject": "user", "predicate": "works as", "object": "software engineer", "confidence": 0.95, "type": "stated"}
- {"subject": "user", "predicate": "has a dog named", "object": "Max", "confidence": 0.95, "type": "stated"}
- {"subject": "user", "predicate": "prefers", "object": "dark mode", "confidence": 0.8, "type": "observed"}
- {"subject": "Lisa", "predicate": "is user's", "object": "sister", "confidence": 0.9, "type": "stated"}

Examples of BAD facts (never extract these):
- {"subject": "assistant", "predicate": "reported that", "object": "Trump introduced tariffs"} — news
- {"subject": "user", "predicate": "said", "object": "hei"} — greeting, not a fact
- {"subject": "user", "predicate": "sent message in", "object": "Norwegian"} — metadata
- {"subject": "bot", "predicate": "sent", "object": "screenshot to telegram"} — bot behavior

Return [] if no personal facts are present. Most messages won't have extractable facts — that's fine.

Respond ONLY with the JSON array, no other text.`;

      const text = await generateCheapResponse({ prompt });

      return this.parseFacts(text);
    } catch (error) {
      // Fact extraction is best-effort — never fail the conversation
      console.error('[FactExtractor] Extraction failed:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  /** Store extracted facts in memory */
  async storeExtractedFacts(facts: ExtractedFact[]): Promise<number> {
    let stored = 0;

    for (const fact of facts) {
      // Skip low-confidence facts
      if (fact.confidence < 0.6) continue;

      // Check if we already know this
      const existing = await this.memory.searchFacts(
        `${fact.subject} ${fact.predicate}`
      );
      const isDuplicate = existing.some(
        e => e.object.toLowerCase() === fact.object.toLowerCase()
      );

      if (!isDuplicate) {
        await this.memory.addFact({
          subject: fact.subject,
          predicate: fact.predicate,
          object: fact.object,
          source: fact.type === 'stated' ? 'user-stated' : fact.type === 'observed' ? 'observation' : 'inference',
          confidence: fact.confidence,
          context: `Auto-extracted from conversation`,
        });
        stored++;
      }
    }

    // Also extract entities from facts
    for (const fact of facts) {
      if (fact.confidence < 0.6) continue;

      // The subject is likely an entity
      if (fact.subject && fact.subject !== 'user') {
        const entityType = this.guessEntityType(fact);
        await this.memory.upsertEntity({
          name: fact.subject,
          type: entityType,
          attributes: { [`${fact.predicate}`]: fact.object },
        });
      }

      // The object might also be an entity (e.g., "user works at Acme")
      if (fact.predicate.match(/works at|lives in|goes to|member of|part of/i)) {
        const entityType = fact.predicate.match(/lives in/i) ? 'place'
          : fact.predicate.match(/works at|member of|part of/i) ? 'concept'
          : 'other';
        await this.memory.upsertEntity({
          name: fact.object,
          type: entityType as any,
          attributes: {},
        });
      }
    }

    if (stored > 0) {
      console.log(`[FactExtractor] Stored ${stored} new facts`);
    }

    return stored;
  }

  /** Filter out junk facts that the LLM extracts despite instructions */
  private isJunkFact(fact: ExtractedFact): boolean {
    const sub = fact.subject.toLowerCase();
    const pred = fact.predicate.toLowerCase();
    const obj = fact.object.toLowerCase();
    const full = `${sub} ${pred} ${obj}`;

    // Reject facts where the subject is the assistant/bot/system metadata
    if (/^(assistant|bot|muninn|ai|system|current time|user message|previous conversation|previous user message|telegram chat|landing page|landing\.html|relationship|conversation|write permission|claude code|muninn welcome message|user and assistant|landing page creation attempt|landing page file)$/i.test(sub)) return true;

    // Reject conversation metadata predicates
    if (pred.match(/^(said|sent|asked|responded|wrote|typed|messaged|greeted)\b/)) return true;
    if (pred.match(/language|in language|message is|channel|chat|telegram|conversation|is conducted in/)) return true;

    // Reject assistant behavior predicates
    if (pred.match(/reported|announced|informed|told about|mentioned that/)) return true;
    if (pred.match(/quoted|acknowledges|was curious about|only answers when|waits after/)) return true;
    if (pred.match(/is affirming|is connected to|is same channel|agreed to\b/)) return true;
    if (pred.match(/sent message|took\b|responded with|responded in/)) return true;

    // Reject very short/meaningless objects
    if (obj.length < 2) return true;

    // Reject facts that are just greetings or filler
    if (full.match(/\b(hei|hello|hi|hey|hva skjer|how are you|good morning|ja|nei|ok|norsk|nå da)\b/i)) return true;

    return false;
  }

  /** Guess entity type from a fact */
  private guessEntityType(fact: ExtractedFact): 'person' | 'project' | 'place' | 'concept' | 'preference' | 'event' | 'other' {
    const pred = fact.predicate.toLowerCase();
    if (pred.match(/friend|partner|colleague|boss|sibling|parent|child|knows/)) return 'person';
    if (pred.match(/project|working on|building|developing/)) return 'project';
    if (pred.match(/lives|located|from|born in/)) return 'place';
    if (pred.match(/likes|loves|prefers|favorite|enjoys|hates/)) return 'preference';
    if (pred.match(/event|meeting|appointment|birthday|anniversary/)) return 'event';
    return 'concept';
  }

  /** Parse the LLM response into facts */
  private parseFacts(text: string): ExtractedFact[] {
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((f: any) => f.subject && f.predicate && f.object)
        .map((f: any) => ({
          subject: String(f.subject),
          predicate: String(f.predicate),
          object: String(f.object),
          confidence: typeof f.confidence === 'number' ? f.confidence : 0.6,
          type: ['stated', 'implied', 'observed'].includes(f.type) ? f.type : 'implied',
        }))
        .filter((f: ExtractedFact) => !this.isJunkFact(f));
    } catch {
      return [];
    }
  }
}

export interface ExtractedFact {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  type: 'stated' | 'implied' | 'observed';
}
