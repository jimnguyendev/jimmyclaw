import { RAGDatabase } from './db.js';
import { EmbeddingClient } from './embedding.js';
import { SearchResult, SearchOptions, SearchConfig } from './types.js';

const DEFAULT_LIMIT = 5;

export class SearchEngine {
  private db: RAGDatabase;
  private embedding: EmbeddingClient;

  constructor(db: RAGDatabase, embedding: EmbeddingClient) {
    this.db = db;
    this.embedding = embedding;
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const config = this.db.getSearchConfig();
    const {
      query,
      limit = DEFAULT_LIMIT,
      bm25Weight = config.bm25_weight,
      vectorWeight = config.vector_weight,
      mmrLambda = config.mmr_lambda,
      sessionId,
    } = options;

    const candidateLimit = limit * 4;

    // Step 1: BM25 + Vector merge
    const [bm25Results, queryEmbedding] = await Promise.all([
      Promise.resolve(this.db.bm25Search(query, candidateLimit)),
      this.embedding.getEmbedding(query),
    ]);
    const vectorResults = this.db.vectorSearch(queryEmbedding, candidateLimit);

    const normalizedBM25 = this.normalizeScores(bm25Results);
    const normalizedVector = this.normalizeScores(vectorResults);
    const merged = this.mergeResults(normalizedBM25, normalizedVector, bm25Weight, vectorWeight);

    // Step 2: Temporal decay + access boost + session boost
    const sessionChunkIds = sessionId ? this.db.getSessionChunkIds(sessionId) : new Set<number>();
    const scored = this.applyDecayAndBoosts(merged, config, sessionChunkIds);

    // Step 3: MMR re-ranking from top candidates
    const candidates = scored.sort((a, b) => b.score - a.score).slice(0, limit * 3);
    const reranked = this.mmrRerank(candidates, mmrLambda, limit);

    // Step 4: Record access
    const resultIds = reranked.map(r => r.id);
    this.db.recordAccess(resultIds);
    if (sessionId) {
      this.db.recordSessionAccess(sessionId, resultIds);
    }

    return this.enrichResults(reranked);
  }

  private applyDecayAndBoosts(
    results: { id: number; score: number; source: 'bm25' | 'vector' | 'hybrid' }[],
    config: SearchConfig,
    sessionChunkIds: Set<number>,
  ): { id: number; score: number; source: 'bm25' | 'vector' | 'hybrid' }[] {
    const now = Date.now();

    return results.map(r => {
      const chunk = this.db.getChunkWithMeta(r.id);
      if (!chunk) return r;

      let score = r.score;

      // Temporal decay — knowledge/ files are evergreen
      if (!chunk.path.startsWith('knowledge/')) {
        const ageDays = (now - new Date(chunk.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        const accessCount = chunk.accessCount || 0;
        const effectiveAge = Math.max(0, ageDays - accessCount * config.decay_access_factor * config.decay_half_life);
        const decay = Math.pow(0.5, effectiveAge / config.decay_half_life);
        score *= decay;
      }

      // Access frequency boost
      const accessCount = chunk.accessCount || 0;
      if (accessCount > 0) {
        score *= 1 + Math.log1p(accessCount) * 0.1;
      }

      // Contextual session boost
      if (sessionChunkIds.has(r.id)) {
        score *= 1 + config.session_boost;
      }

      return { ...r, score };
    });
  }

  private mmrRerank(
    candidates: { id: number; score: number; source: 'bm25' | 'vector' | 'hybrid' }[],
    lambda: number,
    limit: number,
  ): { id: number; score: number; source: 'bm25' | 'vector' | 'hybrid' }[] {
    if (candidates.length <= 1) return candidates.slice(0, limit);

    // Pre-load embeddings for candidates
    const embeddings = new Map<number, number[]>();
    for (const c of candidates) {
      const chunk = this.db.getChunkWithMeta(c.id);
      if (chunk?.embedding) {
        embeddings.set(c.id, chunk.embedding as unknown as number[]);
      }
    }

    const selected: typeof candidates = [];
    const remaining = [...candidates];

    while (selected.length < limit && remaining.length > 0) {
      let bestIdx = 0;
      let bestMmrScore = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];
        const relevance = candidate.score;

        let maxSim = 0;
        const candEmb = embeddings.get(candidate.id);
        if (candEmb && selected.length > 0) {
          for (const sel of selected) {
            const selEmb = embeddings.get(sel.id);
            if (selEmb) {
              maxSim = Math.max(maxSim, this.cosineSimilarity(candEmb, selEmb));
            }
          }
        }

        const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
        if (mmrScore > bestMmrScore) {
          bestMmrScore = mmrScore;
          bestIdx = i;
        }
      }

      selected.push(remaining[bestIdx]);
      remaining.splice(bestIdx, 1);
    }

    return selected;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  findDuplicates(threshold: number = 0.92): { id1: number; id2: number; similarity: number; path1: string; path2: string; preview1: string; preview2: string }[] {
    const allEmbeddings = this.db.getAllEmbeddings();
    const duplicates: { id1: number; id2: number; similarity: number; path1: string; path2: string; preview1: string; preview2: string }[] = [];

    for (let i = 0; i < allEmbeddings.length; i++) {
      for (let j = i + 1; j < allEmbeddings.length; j++) {
        const sim = this.cosineSimilarity(allEmbeddings[i].embedding, allEmbeddings[j].embedding);
        if (sim >= threshold) {
          const chunk1 = this.db.getChunkById(allEmbeddings[i].id);
          const chunk2 = this.db.getChunkById(allEmbeddings[j].id);
          if (chunk1 && chunk2) {
            duplicates.push({
              id1: chunk1.id,
              id2: chunk2.id,
              similarity: sim,
              path1: chunk1.path,
              path2: chunk2.path,
              preview1: chunk1.content.slice(0, 100),
              preview2: chunk2.content.slice(0, 100),
            });
          }
        }
      }
    }

    return duplicates.sort((a, b) => b.similarity - a.similarity);
  }

  private normalizeScores(results: { id: number; score: number }[]): { id: number; score: number }[] {
    if (results.length === 0) return results;
    const scores = results.map(r => r.score);
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const range = maxScore - minScore;
    if (range === 0) return results.map(r => ({ ...r, score: 1 }));
    return results.map(r => ({ ...r, score: (r.score - minScore) / range }));
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
          content: chunk.content.length > 700 ? chunk.content.slice(0, 700) + '...' : chunk.content,
          score: result.score,
          source: result.source,
        });
      }
    }
    return enriched;
  }
}
