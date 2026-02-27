import { RAGDatabase } from './db.js';
import { EmbeddingClient } from './embedding.js';
import { SearchResult, SearchOptions } from './types.js';

const DEFAULT_LIMIT = 5;
const DEFAULT_BM25_WEIGHT = 0.3;
const DEFAULT_VECTOR_WEIGHT = 0.7;

export class SearchEngine {
  private db: RAGDatabase;
  private embedding: EmbeddingClient;

  constructor(db: RAGDatabase, embedding: EmbeddingClient) {
    this.db = db;
    this.embedding = embedding;
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const {
      query,
      limit = DEFAULT_LIMIT,
      bm25Weight = DEFAULT_BM25_WEIGHT,
      vectorWeight = DEFAULT_VECTOR_WEIGHT,
    } = options;

    const candidateLimit = limit * 4;

    const [bm25Results, queryEmbedding] = await Promise.all([
      Promise.resolve(this.db.bm25Search(query, candidateLimit)),
      this.embedding.getEmbedding(query),
    ]);

    const vectorResults = this.db.vectorSearch(queryEmbedding, candidateLimit);

    const normalizedBM25 = this.normalizeScores(bm25Results);
    const normalizedVector = this.normalizeScores(vectorResults);

    const merged = this.mergeResults(normalizedBM25, normalizedVector, bm25Weight, vectorWeight);

    const sorted = merged.sort((a, b) => b.score - a.score).slice(0, limit);

    return this.enrichResults(sorted);
  }

  private normalizeScores(results: { id: number; score: number }[]): { id: number; score: number }[] {
    if (results.length === 0) return results;

    const scores = results.map(r => r.score);
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const range = maxScore - minScore;

    if (range === 0) {
      return results.map(r => ({ ...r, score: 1 }));
    }

    return results.map(r => ({
      ...r,
      score: (r.score - minScore) / range,
    }));
  }

  private mergeResults(
    bm25: { id: number; score: number }[],
    vector: { id: number; score: number }[],
    bm25Weight: number,
    vectorWeight: number
  ): { id: number; score: number; source: 'bm25' | 'vector' | 'hybrid' }[] {
    const merged = new Map<number, { id: number; score: number; source: 'bm25' | 'vector' | 'hybrid' }>();

    for (const r of bm25) {
      merged.set(r.id, { id: r.id, score: r.score * bm25Weight, source: 'bm25' });
    }

    for (const r of vector) {
      const existing = merged.get(r.id);
      if (existing) {
        existing.score += r.score * vectorWeight;
        existing.source = 'hybrid';
      } else {
        merged.set(r.id, { id: r.id, score: r.score * vectorWeight, source: 'vector' });
      }
    }

    return Array.from(merged.values());
  }

  private enrichResults(
    results: { id: number; score: number; source: 'bm25' | 'vector' | 'hybrid' }[]
  ): SearchResult[] {
    const enriched: SearchResult[] = [];

    for (const result of results) {
      const chunk = this.db.getChunkById(result.id);
      if (chunk) {
        enriched.push({
          id: chunk.id,
          path: chunk.path,
          lineStart: chunk.lineStart,
          lineEnd: chunk.lineEnd,
          content: chunk.content.length > 700 
            ? chunk.content.slice(0, 700) + '...'
            : chunk.content,
          score: result.score,
          source: result.source,
        });
      }
    }

    return enriched;
  }
}
