// ═══════════════════════════════════════════════════════════
// MUNINN — Soul Manager Tests
// ═══════════════════════════════════════════════════════════

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { SoulManager } from '../identity/soul-manager.js';

describe('SoulManager', () => {
  let dataDir: string;
  let soul: SoulManager;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'muninn-soul-test-'));
    soul = new SoulManager(dataDir);
    await soul.initialize();
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('should create default SOUL.md on first init', async () => {
    assert.ok(existsSync(join(dataDir, 'SOUL.md')));
  });

  it('should parse soul correctly', async () => {
    const s = await soul.getSoul();
    assert.equal(s.name, 'Muninn');
    assert.equal(s.relationshipPhase, 'curious');
    assert.equal(s.version, 1);
    assert.ok(s.personality.length > 0);
    assert.ok(s.values.length > 0);
    assert.ok(s.boundaries.length > 0);
  });

  it('should increment interaction count', async () => {
    const count1 = await soul.incrementInteraction();
    assert.equal(count1, 1);

    const count2 = await soul.incrementInteraction();
    assert.equal(count2, 2);

    const s = await soul.getSoul();
    assert.equal(s.interactionCount, 2);
  });

  it('should persist interaction count across instances', async () => {
    await soul.incrementInteraction();
    await soul.incrementInteraction();
    await soul.incrementInteraction();

    const soul2 = new SoulManager(dataDir);
    await soul2.initialize();
    const s = await soul2.getSoul();
    assert.equal(s.interactionCount, 3);
  });

  it('should update soul and create backup', async () => {
    await soul.updateSoul({
      personality: ['New trait 1', 'New trait 2'],
      reflectionNote: 'Testing soul evolution',
    });

    const s = await soul.getSoul();
    assert.equal(s.version, 2);
    assert.deepEqual(s.personality, ['New trait 1', 'New trait 2']);

    // Backup should exist
    assert.ok(existsSync(join(dataDir, 'soul-v1.md')));
  });

  it('should track evolution history', async () => {
    await soul.updateSoul({
      reflectionNote: 'First reflection',
    });
    await soul.updateSoul({
      reflectionNote: 'Second reflection',
    });

    const evolution = await soul.loadEvolution();
    assert.equal(evolution.length, 2);
    assert.equal(evolution[0].version, 2);
    assert.equal(evolution[1].version, 3);
  });

  it('should handle custom soul content', async () => {
    const customSoul = `# SOUL.md — Who I Am

## Identity
- **Name:** Raven
- **Role:** A helpful coding assistant
- **Version:** 1

## Personality
- Direct and to the point
- Loves code

## Values
- Clean code above all

## Communication Style
Terse and technical.

## Boundaries
- No small talk

## Relationship Phase
learning
`;

    await soul.writeSoul(customSoul);
    const s = await soul.getSoul();
    assert.equal(s.name, 'Raven');
    assert.equal(s.relationshipPhase, 'learning');
    assert.ok(s.personality.includes('Direct and to the point'));
  });
});
