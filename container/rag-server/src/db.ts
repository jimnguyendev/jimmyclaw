import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { Chunk, IndexStats, KGEdge, KGNode, RAGConfig, SearchConfig } from './types.js';

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
      ['graph_weight', 0.2],   // weight for graph signal in RRF
    ];
    const insertConfig = this.db.query(`INSERT OR IGNORE INTO search_config (key, value) VALUES (?, ?)`);
    for (const [key, value] of defaults) {
      insertConfig.run(key, value);
    }

    // ── Knowledge Graph ──────────────────────────────────────────────────────
    this.db.run(`CREATE TABLE IF NOT EXISTS kg_nodes (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL UNIQUE,
      node_type TEXT NOT NULL DEFAULT 'other',
      mention_count INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    this.db.run(`CREATE TABLE IF NOT EXISTS kg_edges (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id    INTEGER NOT NULL REFERENCES kg_nodes(id),
      target_id    INTEGER NOT NULL REFERENCES kg_nodes(id),
      relation     TEXT NOT NULL,
      weight       REAL NOT NULL DEFAULT 1.0,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      -- Bi-temporal: T timeline (real-world validity)
      valid_from   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      valid_until  TIMESTAMP,               -- NULL = still valid in real world
      -- Bi-temporal: T' timeline (system knowledge)
      known_from   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      known_until  TIMESTAMP,               -- NULL = system still believes this
      UNIQUE(source_id, target_id, relation, valid_from)
    )`);
    this.migrateKGEdges();

    // alias → canonical node id  (e.g. "Jim" → id of "Jimmy Nguyen")
    this.db.run(`CREATE TABLE IF NOT EXISTS kg_aliases (
      alias        TEXT PRIMARY KEY,
      canonical_id INTEGER NOT NULL REFERENCES kg_nodes(id)
    )`);

    // Which document chunks mention which entities
    this.db.run(`CREATE TABLE IF NOT EXISTS kg_chunk_mentions (
      node_id  INTEGER NOT NULL REFERENCES kg_nodes(id),
      chunk_id INTEGER NOT NULL REFERENCES documents(id),
      PRIMARY KEY (node_id, chunk_id)
    )`);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_kg_edges_source ON kg_edges(source_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_kg_edges_target ON kg_edges(target_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_kg_edges_valid   ON kg_edges(valid_from, valid_until)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_kg_edges_known   ON kg_edges(known_from, known_until)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_kg_mentions_node ON kg_chunk_mentions(node_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_kg_mentions_chunk ON kg_chunk_mentions(chunk_id)`);
  }

  /** Add bi-temporal columns to kg_edges if they don't exist (safe for existing DBs). */
  private migrateKGEdges(): void {
    const cols = this.db.query(`PRAGMA table_info(kg_edges)`).all() as { name: string }[];
    const names = new Set(cols.map(c => c.name));
    if (!names.has('valid_from')) {
      this.db.run(`ALTER TABLE kg_edges ADD COLUMN valid_from  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
    }
    if (!names.has('valid_until')) {
      this.db.run(`ALTER TABLE kg_edges ADD COLUMN valid_until TIMESTAMP`);
    }
    if (!names.has('known_from')) {
      this.db.run(`ALTER TABLE kg_edges ADD COLUMN known_from  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
    }
    if (!names.has('known_until')) {
      this.db.run(`ALTER TABLE kg_edges ADD COLUMN known_until TIMESTAMP`);
    }
    // Fix UNIQUE constraint: old DBs have UNIQUE(source, target, relation),
    // new schema has UNIQUE(source, target, relation, valid_from).
    // We can't alter a UNIQUE constraint in SQLite, but since we only INSERT
    // new records when valid_from differs, the old constraint is fine for
    // existing rows and we simply rely on application-level logic for new ones.
  }

  // ── Knowledge Graph API ────────────────────────────────────────────────────

  /** Upsert a node, returning its id. Increments mention_count on re-insert. */
  upsertNode(name: string, nodeType: string): number {
    const canonical = name.trim().toLowerCase();
    this.db.run(`
      INSERT INTO kg_nodes (name, node_type, mention_count, updated_at)
      VALUES (?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET
        mention_count = mention_count + 1,
        node_type = excluded.node_type,
        updated_at = CURRENT_TIMESTAMP
    `, canonical, nodeType);
    const row = this.db.query(`SELECT id FROM kg_nodes WHERE name = ?`).get(canonical) as { id: number };
    return row.id;
  }

  /** Register alias → canonical node. */
  upsertAlias(alias: string, canonicalId: number): void {
    this.db.run(
      `INSERT OR REPLACE INTO kg_aliases (alias, canonical_id) VALUES (?, ?)`,
      alias.trim().toLowerCase(), canonicalId,
    );
  }

  /** Resolve alias or exact name to node id. Returns null if not found. */
  resolveEntity(name: string): number | null {
    const key = name.trim().toLowerCase();
    const alias = this.db.query(`SELECT canonical_id FROM kg_aliases WHERE alias = ?`).get(key) as { canonical_id: number } | undefined;
    if (alias) return alias.canonical_id;
    const node = this.db.query(`SELECT id FROM kg_nodes WHERE name = ?`).get(key) as { id: number } | undefined;
    return node?.id ?? null;
  }

  /**
   * Upsert an edge with optional bi-temporal validity range.
   *
   * Bi-temporal semantics:
   *   validFrom  / validUntil  → T  timeline: when true in the real world
   *   knownFrom  / knownUntil  → T' timeline: when the system recorded/retracted this
   *
   * If a current edge (same source/target/relation, valid_until IS NULL) already
   * exists, it increments the weight. If validFrom differs (new period), a new
   * edge row is inserted.
   */
  upsertEdge(
    sourceId: number,
    targetId: number,
    relation: string,
    opts: { validFrom?: string; validUntil?: string } = {},
  ): number {
    const now = new Date().toISOString();
    const validFrom = opts.validFrom ?? now;
    const validUntil = opts.validUntil ?? null;

    // Check if an "open" edge (valid_until IS NULL) already exists for this triple
    const existing = this.db.query(`
      SELECT id FROM kg_edges
      WHERE source_id = ? AND target_id = ? AND relation = ? AND valid_until IS NULL
    `).get(sourceId, targetId, relation) as { id: number } | undefined;

    if (existing && !opts.validFrom) {
      // Same ongoing fact — just bump weight
      this.db.run(`UPDATE kg_edges SET weight = weight + 1.0 WHERE id = ?`, existing.id);
      return existing.id;
    }

    // New temporal period — insert a fresh edge row
    const result = this.db.run(`
      INSERT INTO kg_edges
        (source_id, target_id, relation, weight, valid_from, valid_until, known_from, known_until)
      VALUES (?, ?, ?, 1.0, ?, ?, ?, NULL)
    `, sourceId, targetId, relation, validFrom, validUntil, now);
    return result.lastInsertRowid as number;
  }

  /**
   * Mark a currently-open edge as no longer valid in the real world (T timeline).
   * Sets valid_until = now (or the provided date) and known_until = now (T' timeline).
   */
  expireEdge(
    sourceId: number,
    targetId: number,
    relation: string,
    opts: { validUntil?: string } = {},
  ): boolean {
    const now = new Date().toISOString();
    const validUntil = opts.validUntil ?? now;
    const result = this.db.run(`
      UPDATE kg_edges
      SET valid_until = ?, known_until = ?
      WHERE source_id = ? AND target_id = ? AND relation = ? AND valid_until IS NULL
    `, validUntil, now, sourceId, targetId, relation);
    return (result.changes ?? 0) > 0;
  }

  /** Link entity mention to a document chunk. */
  linkMention(nodeId: number, chunkId: number): void {
    this.db.run(
      `INSERT OR IGNORE INTO kg_chunk_mentions (node_id, chunk_id) VALUES (?, ?)`,
      nodeId, chunkId,
    );
  }

  /** Get chunk ids that mention a given node. */
  getChunkIdsByNode(nodeId: number): number[] {
    const rows = this.db.query(`SELECT chunk_id FROM kg_chunk_mentions WHERE node_id = ?`).all(nodeId) as { chunk_id: number }[];
    return rows.map(r => r.chunk_id);
  }

  /**
   * Get direct neighbours of a node (adjacency list).
   * @param asOf  ISO date string — only return edges valid at this real-world time (T timeline).
   *              Defaults to "now" (only currently-valid edges).
   *              Pass undefined to return ALL edges regardless of validity.
   */
  getNeighbours(
    nodeId: number,
    asOf?: string | null,
  ): { nodeId: number; relation: string; weight: number; direction: 'out' | 'in' }[] {
    // Build temporal filter: only edges where valid_from <= asOf AND (valid_until IS NULL OR valid_until > asOf)
    const temporalClause = asOf !== undefined
      ? `AND valid_from <= ? AND (valid_until IS NULL OR valid_until > ?)`
      : `AND valid_until IS NULL`;  // default: only currently-open edges

    const params = asOf !== undefined
      ? [nodeId, asOf, asOf]
      : [nodeId];

    const out = this.db.query(`
      SELECT target_id as nodeId, relation, weight, 'out' as direction
      FROM kg_edges WHERE source_id = ? ${temporalClause}
    `).all(...params) as any[];

    const incParams = asOf !== undefined ? [nodeId, asOf, asOf] : [nodeId];
    const inc = this.db.query(`
      SELECT source_id as nodeId, relation, weight, 'in' as direction
      FROM kg_edges WHERE target_id = ? ${temporalClause}
    `).all(...incParams) as any[];

    return [...out, ...inc];
  }

  /** Get node degree (currently-open edges only). Used for hub-node detection. */
  getNodeDegree(nodeId: number): number {
    const row = this.db.query(`
      SELECT COUNT(*) as cnt FROM kg_edges
      WHERE (source_id = ? OR target_id = ?) AND valid_until IS NULL
    `).get(nodeId, nodeId) as { cnt: number };
    return row.cnt;
  }

  getNodeById(id: number): KGNode | null {
    const row = this.db.query(`
      SELECT id, name, node_type as nodeType, mention_count as mentionCount,
             created_at as createdAt, updated_at as updatedAt
      FROM kg_nodes WHERE id = ?
    `).get(id) as KGNode | null;
    return row;
  }

  /** Full-text style search over node names. */
  searchNodes(query: string, limit = 10): KGNode[] {
    const pattern = `%${query.trim().toLowerCase()}%`;
    return this.db.query(`
      SELECT id, name, node_type as nodeType, mention_count as mentionCount,
             created_at as createdAt, updated_at as updatedAt
      FROM kg_nodes WHERE name LIKE ? ORDER BY mention_count DESC LIMIT ?
    `).all(pattern, limit) as KGNode[];
  }

  listNodes(limit = 50): KGNode[] {
    return this.db.query(`
      SELECT id, name, node_type as nodeType, mention_count as mentionCount,
             created_at as createdAt, updated_at as updatedAt
      FROM kg_nodes ORDER BY mention_count DESC LIMIT ?
    `).all(limit) as KGNode[];
  }

  /**
   * Get all edges for a node with bi-temporal fields.
   * @param opts.asOf       Only return edges valid at this real-world time (T). Defaults to current open edges.
   * @param opts.asKnownAt  Only return edges the system knew about at this transaction time (T'). Optional.
   */
  getEdgesForNode(
    nodeId: number,
    opts: { asOf?: string; asKnownAt?: string } = {},
  ): (KGEdge & { sourceName: string; targetName: string })[] {
    const conditions: string[] = ['(e.source_id = ? OR e.target_id = ?)'];

    if (opts.asOf) {
      conditions.push(`e.valid_from <= '${opts.asOf}' AND (e.valid_until IS NULL OR e.valid_until > '${opts.asOf}')`);
    } else {
      conditions.push('e.valid_until IS NULL');
    }

    if (opts.asKnownAt) {
      conditions.push(`e.known_from <= '${opts.asKnownAt}' AND (e.known_until IS NULL OR e.known_until > '${opts.asKnownAt}')`);
    }

    return this.db.query(`
      SELECT e.id, e.source_id as sourceId, e.target_id as targetId,
             e.relation, e.weight, e.created_at as createdAt,
             e.valid_from as validFrom, e.valid_until as validUntil,
             e.known_from as knownFrom, e.known_until as knownUntil,
             s.name as sourceName, t.name as targetName
      FROM kg_edges e
      JOIN kg_nodes s ON s.id = e.source_id
      JOIN kg_nodes t ON t.id = e.target_id
      WHERE ${conditions.join(' AND ')}
    `).all(nodeId, nodeId) as any[];
  }

  /**
   * Return all edges valid at a given real-world time (T timeline — "AS OF").
   * Answers: "What relationships existed on this date?"
   */
  queryAsOf(asOf: string): (KGEdge & { sourceName: string; targetName: string })[] {
    return this.db.query(`
      SELECT e.id, e.source_id as sourceId, e.target_id as targetId,
             e.relation, e.weight, e.created_at as createdAt,
             e.valid_from as validFrom, e.valid_until as validUntil,
             e.known_from as knownFrom, e.known_until as knownUntil,
             s.name as sourceName, t.name as targetName
      FROM kg_edges e
      JOIN kg_nodes s ON s.id = e.source_id
      JOIN kg_nodes t ON t.id = e.target_id
      WHERE e.valid_from <= ? AND (e.valid_until IS NULL OR e.valid_until > ?)
      ORDER BY e.valid_from DESC
    `).all(asOf, asOf) as any[];
  }

  /**
   * Return all edges the system knew about at a given transaction time (T' timeline — "AS KNOWN AT").
   * Answers: "What did we believe last week?"
   */
  queryAsKnownAt(asKnownAt: string): (KGEdge & { sourceName: string; targetName: string })[] {
    return this.db.query(`
      SELECT e.id, e.source_id as sourceId, e.target_id as targetId,
             e.relation, e.weight, e.created_at as createdAt,
             e.valid_from as validFrom, e.valid_until as validUntil,
             e.known_from as knownFrom, e.known_until as knownUntil,
             s.name as sourceName, t.name as targetName
      FROM kg_edges e
      JOIN kg_nodes s ON s.id = e.source_id
      JOIN kg_nodes t ON t.id = e.target_id
      WHERE e.known_from <= ? AND (e.known_until IS NULL OR e.known_until > ?)
      ORDER BY e.known_from DESC
    `).all(asKnownAt, asKnownAt) as any[];
  }

  /**
   * Get the full history of an edge relationship (all temporal periods).
   * Answers: "How has this relationship changed over time?"
   */
  getEdgeHistory(
    sourceId: number,
    targetId: number,
    relation: string,
  ): (KGEdge & { sourceName: string; targetName: string })[] {
    return this.db.query(`
      SELECT e.id, e.source_id as sourceId, e.target_id as targetId,
             e.relation, e.weight, e.created_at as createdAt,
             e.valid_from as validFrom, e.valid_until as validUntil,
             e.known_from as knownFrom, e.known_until as knownUntil,
             s.name as sourceName, t.name as targetName
      FROM kg_edges e
      JOIN kg_nodes s ON s.id = e.source_id
      JOIN kg_nodes t ON t.id = e.target_id
      WHERE e.source_id = ? AND e.target_id = ? AND e.relation = ?
      ORDER BY e.valid_from ASC
    `).all(sourceId, targetId, relation) as any[];
  }

  getKGStats(): { nodeCount: number; edgeCount: number; aliasCount: number; mentionCount: number } {
    const nodes = (this.db.query(`SELECT COUNT(*) as c FROM kg_nodes`).get() as { c: number }).c;
    const edges = (this.db.query(`SELECT COUNT(*) as c FROM kg_edges`).get() as { c: number }).c;
    const aliases = (this.db.query(`SELECT COUNT(*) as c FROM kg_aliases`).get() as { c: number }).c;
    const mentions = (this.db.query(`SELECT COUNT(*) as c FROM kg_chunk_mentions`).get() as { c: number }).c;
    return { nodeCount: nodes, edgeCount: edges, aliasCount: aliases, mentionCount: mentions };
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
      graph_weight: config.graph_weight ?? 0.2,
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
