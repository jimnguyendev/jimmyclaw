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
  source: 'bm25' | 'vector' | 'hybrid';
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
}

export interface SearchConfig {
  bm25_weight: number;
  vector_weight: number;
  decay_half_life: number;
  decay_access_factor: number;
  mmr_lambda: number;
  session_boost: number;
}

export interface RAGConfig {
  dbPath: string;
  groupFolder: string;
  embeddingModel: string;
  embeddingDimension: number;
  chunkSize: number;
  chunkOverlap: number;
}
