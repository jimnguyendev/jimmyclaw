import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { Chunk, IndexStats, RAGConfig } from './types.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  hash TEXT NOT NULL,
  embedding BLOB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(path, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_documents_path ON documents(path);
CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(hash);

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  content,
  content='documents',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS index_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

export class RAGDatabase {
  private db: Database;
  private config: RAGConfig;

  constructor(config: RAGConfig) {
    this.config = config;
    
    const dbDir = path.dirname(config.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(config.dbPath);
    this.db.run('PRAGMA journal_mode = WAL');
    this.initialize();
  }

  private initialize(): void {
    this.db.run(SCHEMA);
  }

  insertChunk(chunk: Omit<Chunk, 'id' | 'createdAt' | 'updatedAt'>): number {
    const stmt = this.db.query(`
      INSERT INTO documents (path, chunk_index, content, line_start, line_end, hash, embedding)
      VALUES ($path, $chunkIndex, $content, $lineStart, $lineEnd, $hash, $embedding)
      ON CONFLICT(path, chunk_index) DO UPDATE SET
        content = excluded.content,
        line_start = excluded.line_start,
        line_end = excluded.line_end,
        hash = excluded.hash,
        embedding = excluded.embedding,
        updated_at = CURRENT_TIMESTAMP
    `);

    const embeddingBlob = chunk.embedding 
      ? Buffer.from(new Float32Array(chunk.embedding).buffer)
      : null;

    const result = stmt.run({
      $path: chunk.path,
      $chunkIndex: chunk.chunkIndex,
      $content: chunk.content,
      $lineStart: chunk.lineStart,
      $lineEnd: chunk.lineEnd,
      $hash: chunk.hash,
      $embedding: embeddingBlob,
    });

    return result.lastInsertRowid as number;
  }

  updateEmbedding(id: number, embedding: number[]): void {
    const stmt = this.db.query(`
      UPDATE documents SET embedding = $embedding WHERE id = $id
    `);
    const embeddingBlob = Buffer.from(new Float32Array(embedding).buffer);
    stmt.run({ $embedding: embeddingBlob, $id: id });
  }

  getChunksWithoutEmbeddings(): Pick<Chunk, 'id' | 'content'>[] {
    const stmt = this.db.query(`SELECT id, content FROM documents WHERE embedding IS NULL`);
    return stmt.all() as Pick<Chunk, 'id' | 'content'>[];
  }

  getChunkEmbedding(id: number): number[] | null {
    const stmt = this.db.query(`SELECT embedding FROM documents WHERE id = $id`);
    const row = stmt.get({ $id: id }) as { embedding: Buffer } | undefined;
    if (!row?.embedding) return null;
    
    const float32 = new Float32Array(row.embedding.buffer);
    return Array.from(float32);
  }

  bm25Search(query: string, limit: number): { id: number; score: number }[] {
    const stmt = this.db.query(`
      SELECT rowid as id, bm25(documents_fts) as score
      FROM documents_fts
      WHERE documents_fts MATCH ?
      ORDER BY score ASC
      LIMIT ?
    `);
    
    try {
      const results = stmt.all(query, limit) as { id: number; score: number }[];
      return results.map(r => ({ id: r.id, score: -r.score }));
    } catch {
      return [];
    }
  }

  vectorSearch(embedding: number[], limit: number): { id: number; score: number }[] {
    const stmt = this.db.query(`
      SELECT id, embedding FROM documents WHERE embedding IS NOT NULL
    `);
    
    const rows = stmt.all() as { id: number; embedding: Buffer }[];
    const results: { id: number; score: number }[] = [];

    for (const row of rows) {
      const docEmbedding = Array.from(new Float32Array(row.embedding.buffer));
      const similarity = this.cosineSimilarity(embedding, docEmbedding);
      results.push({ id: row.id, score: similarity });
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  getChunkById(id: number): Chunk | null {
    const stmt = this.db.query(`
      SELECT id, path, chunk_index as chunkIndex, content, line_start as lineStart, 
             line_end as lineEnd, hash, created_at as createdAt, updated_at as updatedAt
      FROM documents WHERE id = $id
    `);
    return stmt.get({ $id: id }) as Chunk | null;
  }

  getChunksByPath(pathPattern: string): Chunk[] {
    const stmt = this.db.query(`
      SELECT id, path, chunk_index as chunkIndex, content, line_start as lineStart, 
             line_end as lineEnd, hash, created_at as createdAt, updated_at as updatedAt
      FROM documents WHERE path LIKE ?
      ORDER BY chunk_index
    `);
    return stmt.all(`${pathPattern}%`) as Chunk[];
  }

  deleteChunksByPath(path: string): void {
    const stmt = this.db.query(`DELETE FROM documents WHERE path = ? OR path LIKE ?`);
    stmt.run(path, `${path}/%`);
  }

  deleteStaleChunks(paths: string[]): void {
    if (paths.length === 0) return;
    
    const placeholders = paths.map(() => '?').join(', ');
    const stmt = this.db.query(`DELETE FROM documents WHERE path NOT IN (${placeholders})`);
    stmt.run(...paths);
  }

  getStats(): IndexStats {
    const countStmt = this.db.query(`SELECT COUNT(*) as count FROM documents`);
    const fileStmt = this.db.query(`SELECT COUNT(DISTINCT path) as count FROM documents`);
    const lastStmt = this.db.query(`SELECT value FROM index_meta WHERE key = 'last_indexed'`);

    const count = (countStmt.get() as { count: number }).count;
    const fileCount = (fileStmt.get() as { count: number }).count;
    const lastRow = lastStmt.get() as { value: string } | undefined;

    return {
      totalChunks: count,
      totalFiles: fileCount,
      lastIndexed: lastRow ? new Date(lastRow.value) : null,
      embeddingDimension: this.config.embeddingDimension,
    };
  }

  setLastIndexed(date: Date): void {
    const stmt = this.db.query(`
      INSERT OR REPLACE INTO index_meta (key, value) VALUES ('last_indexed', ?)
    `);
    stmt.run(date.toISOString());
  }

  getFileHashes(): Map<string, string> {
    const stmt = this.db.query(`SELECT path, hash FROM documents GROUP BY path`);
    const rows = stmt.all() as { path: string; hash: string }[];
    return new Map(rows.map(r => [r.path, r.hash]));
  }

  close(): void {
    this.db.close();
  }
}
