// ═══════════════════════════════════════════════════════════
// MUNINN — Memory Engine
// The temporal knowledge graph that makes Muninn remember
// Inspired by Leibniz's petites perceptions:
// every experience leaves a trace, even if imperceptible
// ═══════════════════════════════════════════════════════════

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type { Fact, Entity, Conversation, Message } from '../core/types.js';

export interface AddFactInput {
  subject: string;
  predicate: string;
  object: string;
  source: Fact['source'];
  confidence?: number;
  context?: string;
}

/**
 * The Muninn Memory Engine — file-based temporal knowledge graph.
 *
 * Design principles:
 * 1. Everything is a file — git-friendly, inspectable, portable
 * 2. Facts have time dimensions — validAt/invalidAt for temporal queries
 * 3. No database required — just JSONL files and markdown
 * 4. Memory is never deleted, only invalidated (temporal tombstones)
 */
export class MemoryEngine {
  private dataDir: string;
  private factsDir: string;
  private entitiesDir: string;
  private conversationsDir: string;

  // In-memory caches (loaded on init)
  private facts: Fact[] = [];
  private entities: Map<string, Entity> = new Map();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.factsDir = join(dataDir, 'facts');
    this.entitiesDir = join(dataDir, 'entities');
    this.conversationsDir = join(dataDir, 'conversations');
  }

  /** Initialize the memory system — create directories and load data */
  async initialize(): Promise<void> {
    // Create directories
    for (const dir of [this.factsDir, this.entitiesDir, this.conversationsDir]) {
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
    }

    // Load facts from JSONL
    await this.loadFacts();
    // Load entities
    await this.loadEntities();

    console.log(`[Muninn Memory] Loaded ${this.facts.length} facts, ${this.entities.size} entities`);
  }

  // ─── Fact Operations ───────────────────────────────────

  /** Add a new fact to the knowledge graph */
  async addFact(input: AddFactInput): Promise<Fact> {
    const fact: Fact = {
      id: nanoid(),
      subject: input.subject,
      predicate: input.predicate,
      object: input.object,
      validAt: new Date().toISOString(),
      invalidAt: null,
      confidence: input.confidence ?? 0.8,
      source: input.source,
      context: input.context,
    };

    // Check for contradictions — invalidate old facts
    const contradictions = this.facts.filter(f =>
      f.subject.toLowerCase() === fact.subject.toLowerCase() &&
      f.predicate.toLowerCase() === fact.predicate.toLowerCase() &&
      f.invalidAt === null &&
      f.object.toLowerCase() !== fact.object.toLowerCase()
    );

    for (const old of contradictions) {
      old.invalidAt = new Date().toISOString();
      console.log(`[Muninn Memory] Invalidated: ${old.subject} ${old.predicate} ${old.object}`);
    }

    this.facts.push(fact);
    await this.persistFacts();

    return fact;
  }

  /** Invalidate facts matching a query (forget) */
  async invalidateFacts(query: string): Promise<number> {
    const q = query.toLowerCase();
    let count = 0;

    for (const fact of this.facts) {
      if (fact.invalidAt !== null) continue;
      if (
        fact.subject.toLowerCase().includes(q) ||
        fact.object.toLowerCase().includes(q) ||
        (fact.context?.toLowerCase().includes(q) ?? false)
      ) {
        fact.invalidAt = new Date().toISOString();
        count++;
      }
    }

    if (count > 0) {
      await this.persistFacts();
      console.log(`[Muninn Memory] Invalidated ${count} facts matching "${query}"`);
    }

    return count;
  }

  /** Search facts by keyword */
  async searchFacts(query: string): Promise<Fact[]> {
    const q = query.toLowerCase();
    return this.facts
      .filter(f => f.invalidAt === null) // Only current facts
      .filter(f =>
        f.subject.toLowerCase().includes(q) ||
        f.predicate.toLowerCase().includes(q) ||
        f.object.toLowerCase().includes(q) ||
        (f.context?.toLowerCase().includes(q) ?? false)
      )
      .sort((a, b) => new Date(b.validAt).getTime() - new Date(a.validAt).getTime());
  }

  /** Get facts about a specific subject */
  async getFactsAbout(subject: string): Promise<Fact[]> {
    const s = subject.toLowerCase();
    return this.facts
      .filter(f => f.invalidAt === null)
      .filter(f => f.subject.toLowerCase().includes(s));
  }

  /** Get the N most recent facts */
  async getRecentFacts(limit: number = 20): Promise<Fact[]> {
    return this.facts
      .filter(f => f.invalidAt === null)
      .sort((a, b) => new Date(b.validAt).getTime() - new Date(a.validAt).getTime())
      .slice(0, limit);
  }

  /** Get all facts (including invalidated) for reflection */
  async getAllFacts(): Promise<Fact[]> {
    return [...this.facts];
  }

  /** Get fact count */
  getFactCount(): number {
    return this.facts.filter(f => f.invalidAt === null).length;
  }

  /**
   * Hard-delete facts matching filter patterns.
   * Unlike invalidateFacts (soft-delete), this removes lines from the JSONL entirely.
   * Use for purging junk that should never have been stored.
   */
  async purgeFacts(filter: {
    subjects?: RegExp;
    predicates?: RegExp;
    objects?: RegExp;
  }): Promise<number> {
    const before = this.facts.length;

    this.facts = this.facts.filter(fact => {
      const sub = fact.subject.toLowerCase();
      const pred = fact.predicate.toLowerCase();
      const obj = fact.object.toLowerCase();

      if (filter.subjects && filter.subjects.test(sub)) return false;
      if (filter.predicates && filter.predicates.test(pred)) return false;
      if (filter.objects && filter.objects.test(obj)) return false;

      return true;
    });

    const purged = before - this.facts.length;
    if (purged > 0) {
      await this.persistFacts();
      console.log(`[Muninn Memory] Purged ${purged} junk facts (${this.facts.length} remaining)`);
    }

    return purged;
  }

  // ─── Entity Operations ─────────────────────────────────

  /** Add or update an entity */
  async upsertEntity(entity: Omit<Entity, 'id' | 'firstSeen' | 'lastSeen'> & { id?: string }): Promise<Entity> {
    const existing = [...this.entities.values()].find(
      e => e.name.toLowerCase() === entity.name.toLowerCase()
    );

    if (existing) {
      existing.lastSeen = new Date().toISOString();
      existing.attributes = { ...existing.attributes, ...entity.attributes };
      if (entity.type) existing.type = entity.type;
      this.entities.set(existing.id, existing);
      await this.persistEntities();
      return existing;
    }

    const newEntity: Entity = {
      id: entity.id || nanoid(),
      name: entity.name,
      type: entity.type,
      attributes: entity.attributes,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };

    this.entities.set(newEntity.id, newEntity);
    await this.persistEntities();
    return newEntity;
  }

  /** Get all entities */
  async getEntities(): Promise<Entity[]> {
    return [...this.entities.values()];
  }

  /** Find an entity by name */
  async findEntity(name: string): Promise<Entity | undefined> {
    const n = name.toLowerCase();
    return [...this.entities.values()].find(
      e => e.name.toLowerCase().includes(n)
    );
  }

  // ─── Conversation Operations ───────────────────────────

  /** Start a new conversation */
  async startConversation(): Promise<Conversation> {
    return {
      id: nanoid(),
      startedAt: new Date().toISOString(),
      messages: [],
    };
  }

  /** Save a conversation to disk */
  async saveConversation(conversation: Conversation): Promise<void> {
    const filename = `${conversation.id}.json`;
    const filepath = join(this.conversationsDir, filename);
    await writeFile(filepath, JSON.stringify(conversation, null, 2), 'utf-8');
  }

  /** Load recent conversations, sorted by startedAt descending */
  async getConversations(limit: number = 10): Promise<Conversation[]> {
    if (!existsSync(this.conversationsDir)) return [];

    const files = await readdir(this.conversationsDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    const conversations: Conversation[] = [];
    for (const file of jsonFiles) {
      try {
        const content = await readFile(join(this.conversationsDir, file), 'utf-8');
        conversations.push(JSON.parse(content));
      } catch {
        // Skip corrupted files
      }
    }

    return conversations
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, limit);
  }

  /** Get conversation summaries for context */
  async getConversationSummaries(limit: number = 5): Promise<string[]> {
    const conversations = await this.getConversations(limit);
    return conversations
      .filter(c => c.summary)
      .map(c => c.summary!);
  }

  // ─── Persistence ───────────────────────────────────────

  /** Load facts from JSONL file */
  private async loadFacts(): Promise<void> {
    const filepath = join(this.factsDir, 'facts.jsonl');
    if (!existsSync(filepath)) {
      this.facts = [];
      return;
    }

    const content = await readFile(filepath, 'utf-8');
    this.facts = content
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line) as Fact;
        } catch {
          return null;
        }
      })
      .filter((f): f is Fact => f !== null);
  }

  /** Persist facts to JSONL file */
  private async persistFacts(): Promise<void> {
    const filepath = join(this.factsDir, 'facts.jsonl');
    const content = this.facts.map(f => JSON.stringify(f)).join('\n');
    await writeFile(filepath, content, 'utf-8');
  }

  /** Load entities from JSON file */
  private async loadEntities(): Promise<void> {
    const filepath = join(this.entitiesDir, 'entities.json');
    if (!existsSync(filepath)) {
      this.entities = new Map();
      return;
    }

    try {
      const content = await readFile(filepath, 'utf-8');
      const arr: Entity[] = JSON.parse(content);
      this.entities = new Map(arr.map(e => [e.id, e]));
    } catch {
      this.entities = new Map();
    }
  }

  /** Persist entities to JSON file */
  private async persistEntities(): Promise<void> {
    const filepath = join(this.entitiesDir, 'entities.json');
    const arr = [...this.entities.values()];
    await writeFile(filepath, JSON.stringify(arr, null, 2), 'utf-8');
  }

  /** Export all memory data (for backup/migration) */
  async exportAll(): Promise<{ facts: Fact[]; entities: Entity[]; conversations: Conversation[] }> {
    return {
      facts: [...this.facts],
      entities: [...this.entities.values()],
      conversations: await this.getConversations(100),
    };
  }
}
