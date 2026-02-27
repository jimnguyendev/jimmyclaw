import { LRUCache } from 'lru-cache';
import crypto from 'crypto';

const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const EMBEDDING_DIMENSION = 1536;
const MAX_INPUT_LENGTH = 8000;
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/embeddings';

export class EmbeddingClient {
  private apiKey: string | undefined;
  private cache: LRUCache<string, number[]>;
  private enabled: boolean;

  constructor() {
    // Support both OPENROUTER_API_KEY and Z_AI_API_KEY
    this.apiKey = process.env.OPENROUTER_API_KEY || process.env.Z_AI_API_KEY;
    this.enabled = !!this.apiKey;
    this.cache = new LRUCache<string, number[]>({
      max: 500,
      ttl: 1000 * 60 * 60,
    });
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

    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    if (!this.enabled || !this.apiKey) {
      return this.dummyEmbedding();
    }

    try {
      const embedding = await this.callOpenRouterAPI([truncated]);
      if (embedding && embedding.length > 0) {
        this.cache.set(cacheKey, embedding[0]);
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
      const cached = this.cache.get(key);
      
      if (cached) {
        results[i] = cached;
      } else {
        uncached.push({ index: i, text: truncated, key });
      }
    }

    if (uncached.length > 0) {
      try {
        const embeddings = await this.callOpenRouterAPI(uncached.map(u => u.text));
        
        for (let i = 0; i < uncached.length; i++) {
          if (embeddings[i]) {
            results[uncached[i].index] = embeddings[i];
            this.cache.set(uncached[i].key, embeddings[i]);
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

  private hashText(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  private dummyEmbedding(): number[] {
    const arr = new Array(EMBEDDING_DIMENSION).fill(0);
    arr[0] = 1;
    return arr;
  }
}
