// ═══════════════════════════════════════════════════════════
// MIMIR — Embedding Engine
// Local semantic embeddings using all-MiniLM-L6-v2 (ONNX)
// Gracefully degrades when @huggingface/transformers is missing
// ═══════════════════════════════════════════════════════════

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const DIMENSION = 384;
const BATCH_SIZE = 32;

interface EmbeddingStore {
  model: string;
  dimension: number;
  embeddings: Record<string, number[]>;
}

export class EmbeddingEngine {
  private storePath: string;
  private store: EmbeddingStore = {
    model: MODEL_NAME,
    dimension: DIMENSION,
    embeddings: {},
  };
  private pipeline: any = null;
  private loading: Promise<any> | null = null;
  available = true;

  constructor(factsDir: string) {
    this.storePath = join(factsDir, 'embeddings.json');
  }

  /** Load embedding vectors from disk */
  async loadFromDisk(): Promise<void> {
    if (!existsSync(this.storePath)) return;
    try {
      const raw = await readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(raw) as EmbeddingStore;
      if (parsed.model === MODEL_NAME && parsed.dimension === DIMENSION) {
        this.store = parsed;
      } else {
        console.log('[Mimir Embeddings] Model mismatch, will re-embed');
        this.store.embeddings = {};
      }
    } catch {
      // Corrupted file, start fresh
    }
  }

  /** Save embedding vectors to disk */
  async saveToDisk(): Promise<void> {
    await writeFile(this.storePath, JSON.stringify(this.store), 'utf-8');
  }

  /** Lazy-load the model pipeline. Returns null if package unavailable. */
  private async getModel(): Promise<any> {
    if (this.pipeline) return this.pipeline;
    if (!this.available) return null;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        const { pipeline } = await import('@huggingface/transformers');
        this.pipeline = await pipeline('feature-extraction', MODEL_NAME, {
          dtype: 'fp32',
        });
        console.log('[Mimir Embeddings] Model ready.');
        return this.pipeline;
      } catch (err) {
        this.available = false;
        console.log('[Mimir Embeddings] Not available (package missing or model download failed). Using keyword-only search.');
        return null;
      } finally {
        this.loading = null;
      }
    })();

    return this.loading;
  }

  /** Generate embedding for a text string. Returns null if unavailable. */
  async embed(text: string): Promise<number[] | null> {
    const model = await this.getModel();
    if (!model) return null;

    const output = await model(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array).slice(0, DIMENSION);
  }

  /** Embed and store a single fact */
  async embedFact(factId: string, factText: string): Promise<void> {
    const vec = await this.embed(factText);
    if (vec) {
      this.store.embeddings[factId] = vec;
      await this.saveToDisk();
    }
  }

  /** Batch-embed facts that are missing vectors */
  async embedMissing(facts: Array<{ id: string; text: string }>): Promise<number> {
    const missing = facts.filter(f => !(f.id in this.store.embeddings));
    if (missing.length === 0) return 0;

    let embedded = 0;
    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      const batch = missing.slice(i, i + BATCH_SIZE);
      for (const fact of batch) {
        const vec = await this.embed(fact.text);
        if (vec) {
          this.store.embeddings[fact.id] = vec;
          embedded++;
        } else {
          return embedded; // Model unavailable, stop
        }
      }
    }

    if (embedded > 0) {
      await this.saveToDisk();
      console.log(`[Mimir Embeddings] Embedded ${embedded} facts`);
    }
    return embedded;
  }

  /** Remove embedding for a fact */
  removeEmbedding(factId: string): void {
    delete this.store.embeddings[factId];
  }

  /** Remove embeddings for multiple facts */
  removeEmbeddings(factIds: string[]): void {
    for (const id of factIds) {
      delete this.store.embeddings[id];
    }
  }

  /** Get stored embedding for a fact */
  getEmbedding(factId: string): number[] | undefined {
    return this.store.embeddings[factId];
  }

  /** Cosine similarity between two normalized vectors, clamped to [0, 1] */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return Math.max(0, Math.min(1, dot));
  }

  /** Check if embeddings are available for use */
  get isAvailable(): boolean {
    return this.available;
  }

  /** Count of stored embeddings */
  get count(): number {
    return Object.keys(this.store.embeddings).length;
  }
}
