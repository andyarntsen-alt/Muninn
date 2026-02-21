// ═══════════════════════════════════════════════════════════
// MUNINN — Relationship Progression Tests
// ═══════════════════════════════════════════════════════════

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryEngine } from '../memory/memory-engine.js';
import { SoulManager } from '../identity/soul-manager.js';
import { RelationshipManager } from '../identity/relationship.js';

describe('RelationshipManager', () => {
  let dataDir: string;
  let memory: MemoryEngine;
  let soul: SoulManager;
  let relationship: RelationshipManager;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'muninn-rel-test-'));
    memory = new MemoryEngine(dataDir);
    await memory.initialize();
    soul = new SoulManager(dataDir);
    await soul.initialize();
    relationship = new RelationshipManager(memory, soul);
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('should start in curious phase', async () => {
    const eval_ = await relationship.evaluateProgression();
    assert.equal(eval_.currentPhase, 'curious');
  });

  it('should not progress without enough interactions', async () => {
    const eval_ = await relationship.evaluateProgression();
    assert.equal(eval_.shouldProgress, false);
  });

  it('should track progress metrics', async () => {
    // Add some interactions and facts
    for (let i = 0; i < 5; i++) {
      await soul.incrementInteraction();
    }
    for (let i = 0; i < 3; i++) {
      await memory.addFact({
        subject: 'user',
        predicate: `fact${i}`,
        object: `value${i}`,
        source: 'conversation',
      });
    }

    const eval_ = await relationship.evaluateProgression();
    assert.equal(eval_.progress.interactions.current, 5);
    assert.equal(eval_.progress.facts.current, 3);
  });

  it('should produce readable status', async () => {
    const status = await relationship.getRelationshipStatus();
    assert.ok(status.includes('Relationship Phase'));
    assert.ok(status.includes('CURIOUS'));
  });
});
