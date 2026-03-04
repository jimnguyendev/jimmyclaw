export interface Chunk {
  id: number;
  path: string;
  chunkIndex: number;
  content: string;
  embedding?: number[];
  lineStart: number;
  lineEnd: number;
  hash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SearchResult {
  id: number;
  path: string;
  lineStart: number;
  lineEnd: number;
  content: string;
  score: number;
  source: 'bm25' | 'vector' | 'hybrid' | 'graph';
}

export interface IndexStats {
  totalChunks: number;
  totalFiles: number;
  lastIndexed: Date | null;
  embeddingDimension: number;
}

export interface SearchOptions {
  query: string;
  limit?: number;
  sources?: ('memory' | 'knowledge' | 'conversations')[];
  bm25Weight?: number;
  vectorWeight?: number;
  mmrLambda?: number;
  sessionId?: string;
  /** Entity names to seed the knowledge-graph BFS signal */
  entitySeeds?: string[];
}

export interface SearchConfig {
  bm25_weight: number;
  vector_weight: number;
  decay_half_life: number;
  decay_access_factor: number;
  mmr_lambda: number;
  session_boost: number;
  graph_weight: number;
}

export interface RAGConfig {
  dbPath: string;
  groupFolder: string;
  embeddingModel: string;
  embeddingDimension: number;
  chunkSize: number;
  chunkOverlap: number;
}

// ── Knowledge Graph ──────────────────────────────────────────────────────────

export interface KGNode {
  id: number;
  name: string;           // canonical name
  nodeType: string;       // person | project | concept | place | other
  mentionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KGEdge {
  id: number;
  sourceId: number;
  targetId: number;
  relation: string;       // free-text: "works on", "reports to", etc.
  weight: number;         // 1.0 default, increases with repeated mentions
  createdAt: string;
  // Bi-temporal fields
  validFrom: string;      // T:  when this fact became true in the real world
  validUntil: string | null;  // T:  when this fact stopped being true (null = still valid)
  knownFrom: string;      // T': when the system first recorded this fact
  knownUntil: string | null;  // T': when the system learned this fact was no longer valid
}

export interface EntityInput {
  name: string;
  type: string;
  aliases?: string[];
}

export interface RelationshipInput {
  from: string;           // entity name
  to: string;             // entity name
  relation: string;
  /** ISO date string — when did this relationship start being true? Defaults to now. */
  validFrom?: string;
  /** ISO date string — when did this relationship stop being true? Omit if still valid. */
  validUntil?: string;
}

export interface KGIndexInput {
  source: string;         // e.g. "MEMORY.md" — for traceability
  entities: EntityInput[];
  relationships: RelationshipInput[];
}

/** Bi-temporal query parameters */
export interface TemporalQuery {
  /** "AS OF" — query the real-world state at this point in time (T timeline) */
  asOf?: string;
  /** "AS KNOWN AT" — query what the system knew at this point (T' timeline) */
  asKnownAt?: string;
}

export interface GraphSearchResult {
  nodeId: number;
  name: string;
  nodeType: string;
  chunkIds: number[];     // document chunks mentioning this entity
  hopDistance: number;    // BFS distance from seed
}

export interface SearchResultWithSource extends SearchResult {
  graphBoost?: number;    // extra score from knowledge graph signal
}
