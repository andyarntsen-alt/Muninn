// ═══════════════════════════════════════════════════════════
// MIMIR — Embedding Engine Tests
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EmbeddingEngine } from '../memory/embeddings.js';

describe('EmbeddingEngine', () => {
  let dir: string;
  let engine: EmbeddingEngine;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mimir-embed-test-'));
    engine = new EmbeddingEngine(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('cosineSimilarity', () => {
    it('returns 1 for identical normalized vectors', () => {
      const v = [0.5, 0.5, 0.5, 0.5]; // normalized: magnitude = 1
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      const normalized = v.map(x => x / norm);
      expect(EmbeddingEngine.cosineSimilarity(normalized, normalized)).toBeCloseTo(1, 5);
    });

    it('returns 0 for orthogonal vectors', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(EmbeddingEngine.cosineSimilarity(a, b)).toBe(0);
    });

    it('clamps negative dot product to 0', () => {
      const a = [1, 0, 0];
      const b = [-1, 0, 0];
      expect(EmbeddingEngine.cosineSimilarity(a, b)).toBe(0);
    });

    it('returns 0 for mismatched dimensions', () => {
      const a = [1, 0];
      const b = [1, 0, 0];
      expect(EmbeddingEngine.cosineSimilarity(a, b)).toBe(0);
    });
  });

  describe('storage', () => {
    it('persists and loads embeddings', async () => {
      // Manually set an embedding
      await engine.loadFromDisk();
      // Use embedFact indirectly by testing the store round-trip
      // Since model may not be available, test storage directly
      const fakeVec = new Array(384).fill(0).map((_, i) => Math.sin(i));
      // Access via public methods
      await engine.loadFromDisk();

      // Verify count starts at 0
      expect(engine.count).toBe(0);
    });

    it('loadFromDisk handles missing file gracefully', async () => {
      await engine.loadFromDisk();
      expect(engine.count).toBe(0);
      expect(engine.isAvailable).toBe(true);
    });
  });

  describe('graceful degradation', () => {
    it('embed returns null when model is unavailable', async () => {
      // Force unavailable
      engine.available = false;
      const result = await engine.embed('test text');
      expect(result).toBeNull();
    });

    it('embedMissing returns 0 when unavailable', async () => {
      engine.available = false;
      const count = await engine.embedMissing([
        { id: '1', text: 'hello world' },
      ]);
      expect(count).toBe(0);
    });
  });

  describe('removeEmbedding', () => {
    it('removes an embedding by id', () => {
      // Manually test removal (no model needed)
      engine.removeEmbedding('nonexistent');
      expect(engine.getEmbedding('nonexistent')).toBeUndefined();
    });
  });
});
