// ═══════════════════════════════════════════════════════════
// MUNINN — Memory Engine Tests
// ═══════════════════════════════════════════════════════════

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryEngine } from '../memory/memory-engine.js';

describe('MemoryEngine', () => {
  let dataDir: string;
  let memory: MemoryEngine;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'muninn-test-'));
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

      assert.ok(fact.id);
      assert.equal(fact.subject, 'Andy');
      assert.equal(fact.predicate, 'works at');
      assert.equal(fact.object, 'Tech Company');
      assert.equal(fact.invalidAt, null);
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
      assert.equal(results.length, 2);

      const tsResults = await memory.searchFacts('TypeScript');
      assert.equal(tsResults.length, 1);
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
      assert.equal(currentFacts.length, 1);
      assert.equal(currentFacts[0].object, 'Company B');

      // Old fact should be invalidated but still exist
      const allFacts = await memory.getAllFacts();
      const invalidated = allFacts.filter(f => f.invalidAt !== null);
      assert.equal(invalidated.length, 1);
      assert.equal(invalidated[0].object, 'Company A');
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
      assert.equal(facts.length, 1);
    });

    it('should return recent facts sorted by time', async () => {
      await memory.addFact({ subject: 'A', predicate: 'is', object: 'first', source: 'conversation' });
      // tiny delay so timestamps differ
      await new Promise(r => setTimeout(r, 10));
      await memory.addFact({ subject: 'B', predicate: 'is', object: 'second', source: 'conversation' });

      const recent = await memory.getRecentFacts(2);
      assert.equal(recent[0].subject, 'B'); // Most recent first
    });
  });

  describe('Entities', () => {
    it('should create an entity', async () => {
      const entity = await memory.upsertEntity({
        name: 'Andy',
        type: 'person',
        attributes: { role: 'developer' },
      });

      assert.ok(entity.id);
      assert.equal(entity.name, 'Andy');
      assert.equal(entity.type, 'person');
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

      assert.equal(updated.attributes.role, 'developer');
      assert.equal(updated.attributes.hobby, 'chess');
    });

    it('should find entities by name', async () => {
      await memory.upsertEntity({
        name: 'Andy',
        type: 'person',
        attributes: {},
      });

      const found = await memory.findEntity('andy'); // case insensitive
      assert.ok(found);
      assert.equal(found!.name, 'Andy');
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
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].messages.length, 2);
    });
  });
});
