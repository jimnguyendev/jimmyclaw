import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { Chunk, IndexStats, RAGConfig, SearchConfig } from './types.js';

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
    this.migrateSchema();
  }

  private migrateSchema(): void {
    // Add access tracking columns if missing
    const cols = this.db.query(`PRAGMA table_info(documents)`).all() as { name: string }[];
    const colNames = new Set(cols.map(c => c.name));

    if (!colNames.has('access_count')) {
      this.db.run(`ALTER TABLE documents ADD COLUMN access_count INTEGER DEFAULT 0`);
    }
    if (!colNames.has('last_accessed')) {
      this.db.run(`ALTER TABLE documents ADD COLUMN last_accessed TIMESTAMP`);
    }

    // Persistent embedding cache
    this.db.run(`CREATE TABLE IF NOT EXISTS embedding_cache (
      hash TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Session context tracking
    this.db.run(`CREATE TABLE IF NOT EXISTS search_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      chunk_id INTEGER NOT NULL,
      accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_search_sessions_session ON search_sessions(session_id)`);

    // Tunable config
    this.db.run(`CREATE TABLE IF NOT EXISTS search_config (
      key TEXT PRIMARY KEY,
      value REAL NOT NULL
    )`);

    // Insert defaults if missing
    const defaults: [string, number][] = [
      ['bm25_weight', 0.3],
      ['vector_weight', 0.7],
      ['decay_half_life', 30],
      ['decay_access_factor', 0.1],
      ['mmr_lambda', 0.7],
      ['session_boost', 0.15],
    ];
    const insertConfig = this.db.query(`INSERT OR IGNORE INTO search_config (key, value) VALUES (?, ?)`);
    for (const [key, value] of defaults) {
      insertConfig.run(key, value);
    }
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

  recordAccess(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    this.db.run(
      `UPDATE documents SET access_count = access_count + 1, last_accessed = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
      ...ids
    );
  }

  recordSessionAccess(sessionId: string, chunkIds: number[]): void {
    const stmt = this.db.query(`INSERT INTO search_sessions (session_id, chunk_id) VALUES (?, ?)`);
    for (const id of chunkIds) {
      stmt.run(sessionId, id);
    }
  }

  getSessionChunkIds(sessionId: string, withinHours: number = 2): Set<number> {
    const stmt = this.db.query(
      `SELECT DISTINCT chunk_id FROM search_sessions WHERE session_id = ? AND accessed_at > datetime('now', ?)`,
    );
    const rows = stmt.all(sessionId, `-${withinHours} hours`) as { chunk_id: number }[];
    return new Set(rows.map(r => r.chunk_id));
  }

  cacheEmbedding(hash: string, embedding: number[]): void {
    const blob = Buffer.from(new Float32Array(embedding).buffer);
    this.db.query(`INSERT OR REPLACE INTO embedding_cache (hash, embedding) VALUES (?, ?)`).run(hash, blob);
  }

  getCachedEmbedding(hash: string): number[] | null {
    const row = this.db.query(`SELECT embedding FROM embedding_cache WHERE hash = ?`).get(hash) as { embedding: Buffer } | undefined;
    if (!row?.embedding) return null;
    return Array.from(new Float32Array(row.embedding.buffer));
  }

  getSearchConfig(): SearchConfig {
    const rows = this.db.query(`SELECT key, value FROM search_config`).all() as { key: string; value: number }[];
    const config: Record<string, number> = {};
    for (const r of rows) config[r.key] = r.value;
    return {
      bm25_weight: config.bm25_weight ?? 0.3,
      vector_weight: config.vector_weight ?? 0.7,
      decay_half_life: config.decay_half_life ?? 30,
      decay_access_factor: config.decay_access_factor ?? 0.1,
      mmr_lambda: config.mmr_lambda ?? 0.7,
      session_boost: config.session_boost ?? 0.15,
    };
  }

  setSearchConfig(key: string, value: number): void {
    this.db.query(`INSERT OR REPLACE INTO search_config (key, value) VALUES (?, ?)`).run(key, value);
  }

  getChunkWithMeta(id: number): (Chunk & { accessCount: number; path: string }) | null {
    const stmt = this.db.query(`
      SELECT id, path, chunk_index as chunkIndex, content, line_start as lineStart,
             line_end as lineEnd, hash, embedding, access_count as accessCount,
             created_at as createdAt, updated_at as updatedAt
      FROM documents WHERE id = $id
    `);
    const row = stmt.get({ $id: id }) as (Chunk & { accessCount: number; embedding: Buffer | null }) | null;
    if (!row) return null;
    if (row.embedding) {
      (row as any).embedding = Array.from(new Float32Array(row.embedding.buffer));
    }
    return row as any;
  }

  getAllEmbeddings(): { id: number; embedding: number[] }[] {
    const rows = this.db.query(`SELECT id, embedding FROM documents WHERE embedding IS NOT NULL`).all() as { id: number; embedding: Buffer }[];
    return rows.map(r => ({
      id: r.id,
      embedding: Array.from(new Float32Array(r.embedding.buffer)),
    }));
  }

  getEmbeddingCacheSize(): number {
    const row = this.db.query(`SELECT COUNT(*) as count FROM embedding_cache`).get() as { count: number };
    return row.count;
  }

  getAccessStats(): { totalAccesses: number; chunksWithAccess: number } {
    const row = this.db.query(`SELECT COALESCE(SUM(access_count),0) as total, COUNT(CASE WHEN access_count > 0 THEN 1 END) as withAccess FROM documents`).get() as { total: number; withAccess: number };
    return { totalAccesses: row.total, chunksWithAccess: row.withAccess };
  }

  close(): void {
    this.db.close();
  }
}
