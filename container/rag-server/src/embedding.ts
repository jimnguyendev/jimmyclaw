import crypto from 'crypto';
import { RAGDatabase } from './db.js';

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'openai/text-embedding-3-small';
const EMBEDDING_DIMENSION = parseInt(process.env.EMBEDDING_DIMENSION || '1536', 10);
const MAX_INPUT_LENGTH = 8000;
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/embeddings';
const L1_CACHE_MAX = 50;

export class EmbeddingClient {
  private apiKey: string | undefined;
  private enabled: boolean;
  private l1Cache: Map<string, number[]> = new Map();
  private db: RAGDatabase | null = null;

  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY || process.env.Z_AI_API_KEY;
    this.enabled = !!this.apiKey;
  }

  setDatabase(db: RAGDatabase): void {
    this.db = db;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getDimension(): number {
    return EMBEDDING_DIMENSION;
  }

  async getEmbedding(text: string): Promise<number[]> {
    const truncated = text.slice(0, MAX_INPUT_LENGTH);
    const cacheKey = this.hashText(truncated);

    // L1 hot cache
    const l1 = this.l1Cache.get(cacheKey);
    if (l1) return l1;

    // L2 DB cache
    if (this.db) {
      const cached = this.db.getCachedEmbedding(cacheKey);
      if (cached) {
        this.setL1(cacheKey, cached);
        return cached;
      }
    }

    if (!this.enabled || !this.apiKey) {
      return this.dummyEmbedding();
    }

    try {
      const embedding = await this.callOpenRouterAPI([truncated]);
      if (embedding && embedding.length > 0) {
        this.setL1(cacheKey, embedding[0]);
        this.db?.cacheEmbedding(cacheKey, embedding[0]);
        return embedding[0];
      }
      return this.dummyEmbedding();
    } catch (error) {
      console.error('[embedding] API error:', error);
      return this.dummyEmbedding();
    }
  }

  async getEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.enabled || !this.apiKey) {
      return texts.map(() => this.dummyEmbedding());
    }

    const results: number[][] = new Array(texts.length);
    const uncached: { index: number; text: string; key: string }[] = [];

    for (let i = 0; i < texts.length; i++) {
      const truncated = texts[i].slice(0, MAX_INPUT_LENGTH);
      const key = this.hashText(truncated);

      // Check L1
      const l1 = this.l1Cache.get(key);
      if (l1) { results[i] = l1; continue; }

      // Check L2
      if (this.db) {
        const cached = this.db.getCachedEmbedding(key);
        if (cached) { this.setL1(key, cached); results[i] = cached; continue; }
      }

      uncached.push({ index: i, text: truncated, key });
    }

    if (uncached.length > 0) {
      try {
        const embeddings = await this.callOpenRouterAPI(uncached.map(u => u.text));
        for (let i = 0; i < uncached.length; i++) {
          if (embeddings[i]) {
            results[uncached[i].index] = embeddings[i];
            this.setL1(uncached[i].key, embeddings[i]);
            this.db?.cacheEmbedding(uncached[i].key, embeddings[i]);
          } else {
            results[uncached[i].index] = this.dummyEmbedding();
          }
        }
      } catch (error) {
        console.error('[embedding] Batch API error:', error);
        for (const u of uncached) {
          results[u.index] = this.dummyEmbedding();
        }
      }
    }

    return results;
  }

  private setL1(key: string, value: number[]): void {
    if (this.l1Cache.size >= L1_CACHE_MAX) {
      // Evict oldest entry
      const firstKey = this.l1Cache.keys().next().value!;
      this.l1Cache.delete(firstKey);
    }
    this.l1Cache.set(key, value);
  }

  private async callOpenRouterAPI(texts: string[]): Promise<number[][]> {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://nanoclaw.dev',
        'X-Title': 'NanoClaw RAG',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    return data.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding);
  }

  hashText(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  private dummyEmbedding(): number[] {
    const arr = new Array(EMBEDDING_DIMENSION).fill(0);
    arr[0] = 1;
    return arr;
  }
}
