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
}

export interface RAGConfig {
  dbPath: string;
  groupFolder: string;
  embeddingModel: string;
  embeddingDimension: number;
  chunkSize: number;
  chunkOverlap: number;
}
