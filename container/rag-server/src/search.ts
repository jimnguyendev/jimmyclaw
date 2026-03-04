import { RAGDatabase } from './db.js';
import { EmbeddingClient } from './embedding.js';
import { GraphSearch } from './graph.js';
import { SearchResult, SearchOptions, SearchConfig } from './types.js';

const DEFAULT_LIMIT = 5;
// RRF constant — rank 0 still gets a meaningful score
const RRF_K = 60;

export class SearchEngine {
  private db: RAGDatabase;
  private embedding: EmbeddingClient;
  private graph: GraphSearch;

  constructor(db: RAGDatabase, embedding: EmbeddingClient) {
    this.db = db;
    this.embedding = embedding;
    this.graph = new GraphSearch(db);
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const config = this.db.getSearchConfig();
    const {
      query,
      limit = DEFAULT_LIMIT,
      mmrLambda = config.mmr_lambda,
      sessionId,
      entitySeeds,
    } = options;

    const candidateLimit = limit * 4;

    // Step 1: Run BM25, Vector, Graph in parallel
    const [bm25Results, queryEmbedding] = await Promise.all([
      Promise.resolve(this.db.bm25Search(query, candidateLimit)),
      this.embedding.getEmbedding(query),
    ]);
    const vectorResults = this.db.vectorSearch(queryEmbedding, candidateLimit);
    const graphScores = entitySeeds && entitySeeds.length > 0
      ? this.graph.search(entitySeeds)
      : new Map<number, number>();
    const graphResults = this.graph.toRankedList(graphScores).slice(0, candidateLimit);

    // Step 2: RRF merge across all three signals
    const merged = this.rrfMerge(bm25Results, vectorResults, graphResults);

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
    results: { id: number; score: number; source: 'bm25' | 'vector' | 'hybrid' | 'graph' }[],
    config: SearchConfig,
    sessionChunkIds: Set<number>,
  ): { id: number; score: number; source: 'bm25' | 'vector' | 'hybrid' | 'graph' }[] {
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
    candidates: { id: number; score: number; source: 'bm25' | 'vector' | 'hybrid' | 'graph' }[],
    lambda: number,
    limit: number,
  ): { id: number; score: number; source: 'bm25' | 'vector' | 'hybrid' | 'graph' }[] {
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

  /**
   * Reciprocal Rank Fusion — position-based merge that is robust to score scale differences.
   * score(d) = Σ  1 / (k + rank_i(d))   for each result list i
   *
   * Advantages over weighted average:
   *   - No normalisation needed (rank is scale-free)
   *   - A document appearing in multiple lists is naturally boosted
   *   - k=60 prevents rank-1 from dominating
   */
  private rrfMerge(
    bm25: { id: number; score: number }[],
    vector: { id: number; score: number }[],
    graph: { id: number; score: number }[],
  ): { id: number; score: number; source: 'bm25' | 'vector' | 'hybrid' | 'graph' | 'graph' }[] {
    const scores = new Map<number, number>();
    const sources = new Map<number, Set<string>>();

    const addList = (list: { id: number; score: number }[], label: string) => {
      // Sort descending so rank 0 = best
      const sorted = [...list].sort((a, b) => b.score - a.score);
      sorted.forEach(({ id }, rank) => {
        scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
        if (!sources.has(id)) sources.set(id, new Set());
        sources.get(id)!.add(label);
      });
    };

    addList(bm25, 'bm25');
    addList(vector, 'vector');
    if (graph.length > 0) addList(graph, 'graph');

    return [...scores.entries()].map(([id, score]) => {
      const s = sources.get(id)!;
      let source: 'bm25' | 'vector' | 'hybrid' | 'graph' | 'graph';
      if (s.size > 1) source = 'hybrid';
      else if (s.has('graph')) source = 'graph';
      else if (s.has('vector')) source = 'vector';
      else source = 'bm25';
      return { id, score, source };
    });
  }

  private enrichResults(
    results: { id: number; score: number; source: 'bm25' | 'vector' | 'hybrid' | 'graph' }[]
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
