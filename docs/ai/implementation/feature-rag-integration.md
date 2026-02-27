---
phase: implementation
title: RAG Integration Implementation
description: Technical implementation guide for RAG system
---

# Implementation Guide

## Development Setup
**How do we get started?**

**Prerequisites:**
- Bun runtime
- OpenAI API key (for embeddings)
- SQLite with FTS5 support

**Setup:**
```bash
cd container/rag-server
bun install
```

## Code Structure
**How is the code organized?**

```
container/rag-server/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts          # MCP server entry
    ├── tools/
    │   ├── search.ts     # memory_search tool
    │   └── get.ts        # memory_get tool
    ├── services/
    │   ├── embedding.ts  # OpenAI embedding client
    │   ├── indexer.ts    # File watcher + chunker
    │   └── search.ts     # Hybrid search logic
    ├── db/
    │   ├── schema.ts     # SQLite schema
    │   └── client.ts     # Database client
    └── types.ts          # TypeScript types
```

## Implementation Notes
**Key technical details to remember:**

### Database Schema (db/schema.ts)
```typescript
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  line_start INTEGER,
  line_end INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(path, chunk_index)
);

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  content,
  content='documents',
  content_rowid='id'
);

CREATE INDEX IF NOT EXISTS idx_documents_path ON documents(path);
`;
```

### Embedding Client (services/embedding.ts)
```typescript
import OpenAI from 'openai';
import { LRUCache } from 'lru-cache';

const cache = new LRUCache<string, number[]>({ max: 500, ttl: 3600000 });

export async function getEmbedding(text: string): Promise<number[]> {
  const cached = cache.get(text);
  if (cached) return cached;

  const openai = new OpenAI();
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000), // Limit input size
  });

  const embedding = response.data[0].embedding;
  cache.set(text, embedding);
  return embedding;
}
```

### Chunker (services/indexer.ts)
```typescript
const CHUNK_SIZE = 400;  // tokens
const CHUNK_OVERLAP = 80;

export function chunkMarkdown(content: string, path: string): Chunk[] {
  const lines = content.split('\n');
  const chunks: Chunk[] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;
  let lineStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineTokens = estimateTokens(line);

    if (currentTokens + lineTokens > CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push({
        path,
        chunkIndex: chunks.length,
        content: currentChunk.join('\n'),
        lineStart: lineStart + 1,
        lineEnd: i,
      });
      
      // Keep overlap
      const overlapLines = currentChunk.slice(-CHUNK_OVERLAP / 10);
      currentChunk = [...overlapLines, line];
      currentTokens = estimateTokens(currentChunk.join('\n'));
      lineStart = i - overlapLines.length;
    } else {
      currentChunk.push(line);
      currentTokens += lineTokens;
    }
  }

  // Final chunk
  if (currentChunk.length > 0) {
    chunks.push({
      path,
      chunkIndex: chunks.length,
      content: currentChunk.join('\n'),
      lineStart: lineStart + 1,
      lineEnd: lines.length,
    });
  }

  return chunks;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
```

### Hybrid Search (services/search.ts)
```typescript
export async function hybridSearch(
  query: string,
  db: Database,
  limit: number = 5
): Promise<SearchResult[]> {
  // Get query embedding
  const queryEmbedding = await getEmbedding(query);

  // Parallel: BM25 + Vector search
  const [bm25Results, vectorResults] = await Promise.all([
    bm25Search(db, query, limit * 4),
    vectorSearch(db, queryEmbedding, limit * 4),
  ]);

  // Normalize scores
  const maxBM25 = Math.max(...bm25Results.map(r => r.score), 1);
  const maxVec = Math.max(...vectorResults.map(r => r.score), 1);

  // Merge with weights
  const merged = new Map<string, SearchResult>();
  
  for (const r of bm25Results) {
    merged.set(r.id, { ...r, score: 0.3 * (r.score / maxBM25) });
  }
  
  for (const r of vectorResults) {
    const existing = merged.get(r.id);
    if (existing) {
      existing.score += 0.7 * (r.score / maxVec);
    } else {
      merged.set(r.id, { ...r, score: 0.7 * (r.score / maxVec) });
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
```

### MCP Tool (tools/search.ts)
```typescript
import { tool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export const memorySearchTool = tool(
  'memory_search',
  'Search memory files using hybrid BM25 + vector search',
  {
    query: z.string().describe('Search query'),
    limit: z.number().default(5).describe('Max results'),
  },
  async ({ query, limit }) => {
    const results = await hybridSearch(query, getDb(), limit);
    
    return {
      content: [{
        type: 'text',
        text: results.map(r => 
          `Source: ${r.path}#${r.lineStart}-${r.lineEnd}\n${r.content}\n`
        ).join('\n---\n'),
      }],
    };
  }
);
```

## Integration Points
**How do pieces connect?**

1. **Container Start**: RAG server starts as MCP server
2. **Indexer**: Watches `/workspace/group/` for file changes
3. **Agent**: Calls `memory_search` via MCP protocol
4. **Results**: Returned with citations for verification

## Error Handling
**How do we handle failures?**

| Scenario | Handling |
|----------|----------|
| Embedding API fails | Retry with exponential backoff |
| Database locked | Wait and retry |
| File too large | Skip with warning |
| Invalid encoding | Skip file |

## Performance Considerations
**How do we keep it fast?**

- Embedding cache: 500 entries, 1 hour TTL
- Debounced indexing: 1.5s delay
- Search timeout: 500ms max
- Result limit: 20 max

## Security Notes
**What security measures are in place?**

- Only index files in `/workspace/group/`
- No execution of file content
- API keys via environment only
- Sanitize paths before database insert
