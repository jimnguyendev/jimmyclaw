import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { RAGDatabase } from './db.js';
import { EmbeddingClient } from './embedding.js';
import { FileIndexer } from './indexer.js';
import { SearchEngine } from './search.js';
import { RAGConfig } from './types.js';

const GROUP_FOLDER = process.env.NANOCLAW_GROUP_FOLDER || 'main';
const DATA_DIR = '/workspace/project/data';
const DB_PATH = path.join(DATA_DIR, 'rag', `${GROUP_FOLDER}.sqlite`);

const config: RAGConfig = {
  dbPath: DB_PATH,
  groupFolder: GROUP_FOLDER,
  embeddingModel: 'text-embedding-3-small',
  embeddingDimension: 1536,
  chunkSize: 400,
  chunkOverlap: 80,
};

const db = new RAGDatabase(config);
const embeddingClient = new EmbeddingClient();
const indexer = new FileIndexer(db, embeddingClient, config);
const searchEngine = new SearchEngine(db, embeddingClient);

const server = new McpServer({
  name: 'nanoclaw-rag',
  version: '1.0.0',
});

server.tool(
  'memory_search',
  'Search memory files using hybrid BM25 + vector search. Returns relevant chunks with citations.',
  {
    query: z.string().describe('Search query'),
    limit: z.number().min(1).max(20).default(5).describe('Maximum number of results'),
    reindex: z.boolean().default(false).describe('Force reindex before searching'),
  },
  async ({ query, limit, reindex }) => {
    if (reindex) {
      await indexer.indexAll();
    }

    const results = await searchEngine.search({ query, limit });

    if (results.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: 'No results found. Try different keywords or check if memory files exist.',
        }],
      };
    }

    const text = results.map(r => 
      `Source: ${r.path}#L${r.lineStart}-L${r.lineEnd}\nScore: ${r.score.toFixed(3)} (${r.source})\n\n${r.content}\n`
    ).join('\n---\n\n');

    return {
      content: [{ type: 'text' as const, text }],
    };
  }
);

server.tool(
  'memory_get',
  'Read a specific memory file or section by path.',
  {
    path: z.string().describe('File path relative to group folder (e.g., "MEMORY.md", "knowledge/customers.md")'),
    line_start: z.number().min(1).optional().describe('Starting line number (1-indexed)'),
    line_count: z.number().min(1).max(500).default(100).describe('Number of lines to read'),
  },
  async ({ path: filePath, line_start, line_count }) => {
    const fullPath = `/workspace/group/${filePath}`;
    
    if (!fs.existsSync(fullPath)) {
      return {
        content: [{
          type: 'text' as const,
          text: `File not found: ${filePath}`,
        }],
      };
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');

    const start = (line_start ?? 1) - 1;
    const end = Math.min(start + line_count, lines.length);
    
    const selectedLines = lines.slice(start, end);
    const numberedLines = selectedLines
      .map((line, i) => `${start + i + 1}: ${line}`)
      .join('\n');

    return {
      content: [{
        type: 'text' as const,
        text: `File: ${filePath}\nLines: ${start + 1}-${end}\n\n${numberedLines}`,
      }],
    };
  }
);

server.tool(
  'memory_reindex',
  'Reindex all memory files. Run this after adding or modifying memory files.',
  {},
  async () => {
    const result = await indexer.indexAll();
    
    return {
      content: [{
        type: 'text' as const,
        text: `Reindex complete.\n- Indexed: ${result.indexed} chunks\n- Skipped: ${result.skipped} (unchanged)\n- Errors: ${result.errors.length}\n${result.errors.length > 0 ? '\nErrors:\n' + result.errors.join('\n') : ''}`,
      }],
    };
  }
);

server.tool(
  'memory_stats',
  'Get statistics about the memory index.',
  {},
  async () => {
    const stats = db.getStats();
    
    return {
      content: [{
        type: 'text' as const,
        text: `Memory Index Statistics\n\n` +
          `- Total chunks: ${stats.totalChunks}\n` +
          `- Total files: ${stats.totalFiles}\n` +
          `- Last indexed: ${stats.lastIndexed?.toISOString() || 'never'}\n` +
          `- Embedding dimension: ${stats.embeddingDimension}\n` +
          `- Embeddings enabled: ${embeddingClient.isEnabled()}`,
      }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[rag-server] MCP server started');
}

main().catch(console.error);
