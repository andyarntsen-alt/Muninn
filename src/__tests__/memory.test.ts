// ═══════════════════════════════════════════════════════════
// MIMIR — Memory Engine Tests
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryEngine } from '../memory/memory-engine.js';

describe('MemoryEngine', () => {
  let dataDir: string;
  let memory: MemoryEngine;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'mimir-test-'));
    memory = new MemoryEngine(dataDir);
    await memory.initialize();
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  describe('Facts', () => {
    it('should add a fact', async () => {
      const fact = await memory.addFact({
        subject: 'Andy',
        predicate: 'works at',
        object: 'Tech Company',
        source: 'conversation',
      });

      expect(fact.id).toBeTruthy();
      expect(fact.subject).toBe('Andy');
      expect(fact.predicate).toBe('works at');
      expect(fact.object).toBe('Tech Company');
      expect(fact.invalidAt).toBeNull();
    });

    it('should search facts', async () => {
      await memory.addFact({
        subject: 'Andy',
        predicate: 'likes',
        object: 'TypeScript',
        source: 'conversation',
      });
      await memory.addFact({
        subject: 'Andy',
        predicate: 'lives in',
        object: 'Norway',
        source: 'user-stated',
      });

      const results = await memory.searchFacts('Andy');
      expect(results.length).toBe(2);

      const tsResults = await memory.searchFacts('TypeScript');
      expect(tsResults.length).toBe(1);
    });

    it('should invalidate contradicting facts', async () => {
      await memory.addFact({
        subject: 'Andy',
        predicate: 'works at',
        object: 'Company A',
        source: 'conversation',
      });

      await memory.addFact({
        subject: 'Andy',
        predicate: 'works at',
        object: 'Company B',
        source: 'conversation',
      });

      const currentFacts = await memory.searchFacts('works at');
      expect(currentFacts.length).toBe(1);
      expect(currentFacts[0].object).toBe('Company B');

      // Old fact should be invalidated but still exist
      const allFacts = await memory.getAllFacts();
      const invalidated = allFacts.filter(f => f.invalidAt !== null);
      expect(invalidated.length).toBe(1);
      expect(invalidated[0].object).toBe('Company A');
    });

    it('should persist facts across reloads', async () => {
      await memory.addFact({
        subject: 'Andy',
        predicate: 'likes',
        object: 'Chess',
        source: 'conversation',
      });

      // Create a new engine pointing at the same directory
      const memory2 = new MemoryEngine(dataDir);
      await memory2.initialize();

      const facts = await memory2.searchFacts('Chess');
      expect(facts.length).toBe(1);
    });

    it('should search relevant facts without embeddings (fallback)', async () => {
      await memory.addFact({ subject: 'Andy', predicate: 'refactors when', object: 'blocked', source: 'conversation' });
      await memory.addFact({ subject: 'Andy', predicate: 'likes', object: 'TypeScript', source: 'conversation' });
      await memory.addFact({ subject: 'Andy', predicate: 'works on', object: 'Mimir project', source: 'conversation' });

      // Keyword fallback should still find results
      const results = await memory.searchRelevantFacts('Andy blocked');
      expect(results.length).toBeGreaterThan(0);
      // The "blocked" fact should rank highest
      expect(results[0].object).toBe('blocked');
    });

    it('rebuildEmbeddings should not crash when model is unavailable', async () => {
      await memory.addFact({ subject: 'Test', predicate: 'is', object: 'fact', source: 'conversation' });
      // Should return 0 (model unavailable in test env) without throwing
      const count = await memory.rebuildEmbeddings();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should return recent facts sorted by time', async () => {
      await memory.addFact({ subject: 'A', predicate: 'is', object: 'first', source: 'conversation' });
      // tiny delay so timestamps differ
      await new Promise(r => setTimeout(r, 10));
      await memory.addFact({ subject: 'B', predicate: 'is', object: 'second', source: 'conversation' });

      const recent = await memory.getRecentFacts(2);
      expect(recent[0].subject).toBe('B'); // Most recent first
    });
  });

  describe('Entities', () => {
    it('should create an entity', async () => {
      const entity = await memory.upsertEntity({
        name: 'Andy',
        type: 'person',
        attributes: { role: 'developer' },
      });

      expect(entity.id).toBeTruthy();
      expect(entity.name).toBe('Andy');
      expect(entity.type).toBe('person');
    });

    it('should update existing entity', async () => {
      await memory.upsertEntity({
        name: 'Andy',
        type: 'person',
        attributes: { role: 'developer' },
      });

      const updated = await memory.upsertEntity({
        name: 'Andy',
        type: 'person',
        attributes: { hobby: 'chess' },
      });

      expect(updated.attributes.role).toBe('developer');
      expect(updated.attributes.hobby).toBe('chess');
    });

    it('should find entities by name', async () => {
      await memory.upsertEntity({
        name: 'Andy',
        type: 'person',
        attributes: {},
      });

      const found = await memory.findEntity('andy'); // case insensitive
      expect(found).toBeTruthy();
      expect(found!.name).toBe('Andy');
    });
  });

  describe('Conversations', () => {
    it('should create and save conversations', async () => {
      const convo = await memory.startConversation();
      convo.messages.push({
        role: 'user',
        content: 'Hello!',
        timestamp: new Date().toISOString(),
      });
      convo.messages.push({
        role: 'assistant',
        content: 'Hi there!',
        timestamp: new Date().toISOString(),
      });

      await memory.saveConversation(convo);

      const loaded = await memory.getConversations(1);
      expect(loaded.length).toBe(1);
      expect(loaded[0].messages.length).toBe(2);
    });
  });
});
