import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { RAGDatabase } from './db.js';
import { EmbeddingClient } from './embedding.js';
import { FileIndexer } from './indexer.js';
import { SearchEngine } from './search.js';
import { GraphSearch } from './graph.js';
import { RAGConfig } from './types.js';

const GROUP_FOLDER = process.env.JIMMYCLAW_GROUP_FOLDER || 'main';
const DATA_DIR = '/workspace/project/data';
const DB_PATH = path.join(DATA_DIR, 'rag', `${GROUP_FOLDER}.sqlite`);

const config: RAGConfig = {
  dbPath: DB_PATH,
  groupFolder: GROUP_FOLDER,
  embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
  embeddingDimension: parseInt(process.env.EMBEDDING_DIMENSION || '1536', 10),
  chunkSize: 400,
  chunkOverlap: 80,
};

const db = new RAGDatabase(config);
const embeddingClient = new EmbeddingClient();
embeddingClient.setDatabase(db);
const indexer = new FileIndexer(db, embeddingClient, config);
const searchEngine = new SearchEngine(db, embeddingClient);
const graphSearch = new GraphSearch(db);

const server = new McpServer({
  name: 'nanoclaw-rag',
  version: '1.0.0',
});

server.tool(
  'memory_search',
  'Search memory files using tri-hybrid search (BM25 + vector + knowledge graph) with RRF merging, temporal decay, access boost, and MMR re-ranking. Returns relevant chunks with citations.',
  {
    query: z.string().describe('Search query'),
    limit: z.number().min(1).max(20).default(5).describe('Maximum number of results'),
    reindex: z.boolean().default(false).describe('Force reindex before searching'),
    session_id: z.string().optional().describe('Session ID for contextual boosting of recently accessed chunks'),
    mmr_lambda: z.number().min(0).max(1).optional().describe('MMR diversity parameter (0=max diversity, 1=max relevance)'),
    entity_seeds: z.array(z.string()).optional().describe('Entity names to seed knowledge graph BFS (boosts chunks mentioning related entities)'),
  },
  async ({ query, limit, reindex, session_id, mmr_lambda, entity_seeds }) => {
    if (reindex) {
      await indexer.indexAll();
    }

    const results = await searchEngine.search({
      query,
      limit,
      sessionId: session_id,
      mmrLambda: mmr_lambda,
      entitySeeds: entity_seeds,
    });

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
  'Get statistics about the memory index, including access stats and cache size.',
  {},
  async () => {
    const stats = db.getStats();
    const accessStats = db.getAccessStats();
    const cacheSize = db.getEmbeddingCacheSize();
    const config = db.getSearchConfig();

    return {
      content: [{
        type: 'text' as const,
        text: `Memory Index Statistics\n\n` +
          `- Total chunks: ${stats.totalChunks}\n` +
          `- Total files: ${stats.totalFiles}\n` +
          `- Last indexed: ${stats.lastIndexed?.toISOString() || 'never'}\n` +
          `- Embedding dimension: ${stats.embeddingDimension}\n` +
          `- Embeddings enabled: ${embeddingClient.isEnabled()}\n` +
          `- Embedding cache size: ${cacheSize}\n` +
          `- Total accesses: ${accessStats.totalAccesses}\n` +
          `- Chunks with access: ${accessStats.chunksWithAccess}\n\n` +
          `Search Config:\n` +
          Object.entries(config).map(([k, v]) => `  ${k}: ${v}`).join('\n'),
      }],
    };
  }
);

server.tool(
  'memory_config',
  'View or update search configuration parameters at runtime.',
  {
    action: z.enum(['get', 'set']).describe('Get current config or set a parameter'),
    key: z.string().optional().describe('Config key (bm25_weight, vector_weight, decay_half_life, decay_access_factor, mmr_lambda, session_boost)'),
    value: z.number().optional().describe('New value for the config key'),
  },
  async ({ action, key, value }) => {
    if (action === 'get') {
      const config = db.getSearchConfig();
      return {
        content: [{
          type: 'text' as const,
          text: `Search Configuration:\n\n` +
            Object.entries(config).map(([k, v]) => `  ${k}: ${v}`).join('\n'),
        }],
      };
    }

    if (!key || value === undefined) {
      return {
        content: [{
          type: 'text' as const,
          text: 'Error: both key and value are required for set action.',
        }],
      };
    }

    const validKeys = ['bm25_weight', 'vector_weight', 'decay_half_life', 'decay_access_factor', 'mmr_lambda', 'session_boost'];
    if (!validKeys.includes(key)) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error: invalid key "${key}". Valid keys: ${validKeys.join(', ')}`,
        }],
      };
    }

    db.setSearchConfig(key, value);
    return {
      content: [{
        type: 'text' as const,
        text: `Updated ${key} = ${value}`,
      }],
    };
  }
);

server.tool(
  'memory_dedup',
  'Find semantically duplicate chunks across memory files. Returns pairs with similarity scores for review.',
  {
    threshold: z.number().min(0.5).max(1.0).default(0.92).describe('Cosine similarity threshold for considering chunks as duplicates'),
    limit: z.number().min(1).max(50).default(10).describe('Maximum number of duplicate pairs to return'),
  },
  async ({ threshold, limit }) => {
    const duplicates = searchEngine.findDuplicates(threshold);
    const topDuplicates = duplicates.slice(0, limit);

    if (topDuplicates.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: `No duplicate chunks found above threshold ${threshold}.`,
        }],
      };
    }

    const text = topDuplicates.map((d, i) =>
      `${i + 1}. Similarity: ${d.similarity.toFixed(4)}\n` +
      `   Chunk ${d.id1} (${d.path1}): ${d.preview1}...\n` +
      `   Chunk ${d.id2} (${d.path2}): ${d.preview2}...`
    ).join('\n\n');

    return {
      content: [{
        type: 'text' as const,
        text: `Found ${duplicates.length} duplicate pairs (showing top ${topDuplicates.length}):\n\n${text}`,
      }],
    };
  }
);

// ── Knowledge Graph Tools ────────────────────────────────────────────────────

server.tool(
  'memory_kg_index',
  'Save entities and relationships extracted from a conversation or document into the knowledge graph. Call this after learning new facts: people, projects, concepts and how they connect.',
  {
    source: z.string().describe('Where this info came from, e.g. "MEMORY.md" or "conversation 2026-03-04"'),
    entities: z.array(z.object({
      name: z.string().describe('Entity name (person, project, concept, place)'),
      type: z.enum(['person', 'project', 'concept', 'place', 'other']).default('other'),
      aliases: z.array(z.string()).optional().describe('Alternative names or nicknames'),
    })).describe('Entities to save'),
    relationships: z.array(z.object({
      from: z.string().describe('Source entity name'),
      to: z.string().describe('Target entity name'),
      relation: z.string().describe('Relationship description, e.g. "works on", "reports to", "owns"'),
      valid_from: z.string().optional().describe('ISO date — when this relationship started being true in the real world. Defaults to now.'),
      valid_until: z.string().optional().describe('ISO date — when this relationship stopped being true. Omit if still valid.'),
    })).optional().default([]).describe('Relationships between entities'),
  },
  async ({ source, entities, relationships }) => {
    let nodesCreated = 0;
    let edgesCreated = 0;

    // Upsert all entities first
    const nameToId = new Map<string, number>();
    for (const ent of entities) {
      const id = db.upsertNode(ent.name, ent.type);
      nameToId.set(ent.name.trim().toLowerCase(), id);
      nodesCreated++;

      if (ent.aliases) {
        for (const alias of ent.aliases) {
          db.upsertAlias(alias, id);
        }
      }
    }

    // Upsert relationships
    for (const rel of relationships) {
      const fromId = nameToId.get(rel.from.trim().toLowerCase()) ?? db.resolveEntity(rel.from);
      const toId = nameToId.get(rel.to.trim().toLowerCase()) ?? db.resolveEntity(rel.to);
      if (fromId !== null && toId !== null) {
        db.upsertEdge(fromId, toId, rel.relation, {
          validFrom: rel.valid_from,
          validUntil: rel.valid_until,
        });
        edgesCreated++;
      }
    }

    const stats = db.getKGStats();
    return {
      content: [{
        type: 'text' as const,
        text: `Knowledge graph updated from "${source}"\n` +
          `- Entities processed: ${nodesCreated}\n` +
          `- Relationships processed: ${edgesCreated}\n\n` +
          `Graph totals: ${stats.nodeCount} nodes, ${stats.edgeCount} edges, ${stats.aliasCount} aliases`,
      }],
    };
  },
);

server.tool(
  'memory_entities',
  'List or search entities in the knowledge graph. Use this to explore what is known about people, projects, and concepts.',
  {
    search: z.string().optional().describe('Search by name (partial match). Omit to list top entities by mention count.'),
    limit: z.number().min(1).max(100).default(20).describe('Maximum entities to return'),
    with_relations: z.boolean().default(false).describe('Include relationships for each entity'),
  },
  async ({ search, limit, with_relations }) => {
    const nodes = search
      ? db.searchNodes(search, limit)
      : db.listNodes(limit);

    if (nodes.length === 0) {
      return {
        content: [{ type: 'text' as const, text: 'No entities found. Use memory_kg_index to add entities.' }],
      };
    }

    const lines = nodes.map(node => {
      let line = `• [${node.nodeType}] **${node.name}** (mentioned ${node.mentionCount}×)`;
      if (with_relations) {
        const edges = db.getEdgesForNode(node.id);
        if (edges.length > 0) {
          const relLines = edges.slice(0, 5).map(e =>
            `    ↔ ${e.sourceName === node.name ? e.targetName : e.sourceName}: ${e.relation}`,
          );
          line += '\n' + relLines.join('\n');
          if (edges.length > 5) line += `\n    ... and ${edges.length - 5} more`;
        }
      }
      return line;
    });

    return {
      content: [{
        type: 'text' as const,
        text: `Entities in knowledge graph (${nodes.length} shown):\n\n${lines.join('\n')}`,
      }],
    };
  },
);

server.tool(
  'memory_connect',
  'Find the shortest relationship path between two entities in the knowledge graph. Useful for "how are X and Y connected?"',
  {
    from: z.string().describe('Starting entity name'),
    to: z.string().describe('Target entity name'),
    max_hops: z.number().min(1).max(8).default(6).describe('Maximum relationship hops to search'),
  },
  async ({ from, to, max_hops }) => {
    const path = graphSearch.findPath(from, to, max_hops);

    if (path.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: `No connection found between "${from}" and "${to}" within ${max_hops} hops.\n` +
            `Make sure both entities exist: use memory_entities to check.`,
        }],
      };
    }

    const fromId = db.resolveEntity(from);
    const toId = db.resolveEntity(to);
    const fromNode = fromId ? db.getNodeById(fromId) : null;
    const toNode = toId ? db.getNodeById(toId) : null;

    return {
      content: [{
        type: 'text' as const,
        text: `Connection: ${from} → ${to} (${path.length - 1} hops)\n\n` +
          `Path: ${path.join(' → ')}\n\n` +
          (fromNode ? `"${fromNode.name}" mentioned ${fromNode.mentionCount}× in memory\n` : '') +
          (toNode ? `"${toNode.name}" mentioned ${toNode.mentionCount}× in memory\n` : ''),
      }],
    };
  },
);

server.tool(
  'memory_kg_stats',
  'Show knowledge graph statistics: node count, edge count, top entities, and graph density.',
  {},
  async () => {
    const stats = db.getKGStats();
    const topNodes = db.listNodes(10);

    const topList = topNodes.map((n, i) =>
      `  ${i + 1}. [${n.nodeType}] ${n.name} (${n.mentionCount} mentions)`,
    ).join('\n');

    return {
      content: [{
        type: 'text' as const,
        text: `Knowledge Graph Statistics\n\n` +
          `- Nodes (entities): ${stats.nodeCount}\n` +
          `- Edges (relationships): ${stats.edgeCount}\n` +
          `- Aliases: ${stats.aliasCount}\n` +
          `- Chunk mentions linked: ${stats.mentionCount}\n\n` +
          `Top entities by mention count:\n${topList || '  (none yet)'}`,
      }],
    };
  },
);

server.tool(
  'memory_kg_expire',
  'Mark a relationship in the knowledge graph as no longer valid. Use when a fact has changed: "Alice left Project X", "Bob no longer reports to Carol". The relationship is archived with a valid_until timestamp — it remains queryable for historical analysis.',
  {
    from: z.string().describe('Source entity name'),
    to: z.string().describe('Target entity name'),
    relation: z.string().describe('The relationship to expire, e.g. "works on", "reports to"'),
    valid_until: z.string().optional().describe('ISO date when this relationship ended. Defaults to now.'),
  },
  async ({ from, to, relation, valid_until }) => {
    const fromId = db.resolveEntity(from);
    const toId = db.resolveEntity(to);

    if (fromId === null || toId === null) {
      return {
        content: [{
          type: 'text' as const,
          text: `Entity not found: ${fromId === null ? `"${from}"` : `"${to}"`}. Use memory_entities to check.`,
        }],
      };
    }

    const expired = db.expireEdge(fromId, toId, relation, { validUntil: valid_until });

    if (!expired) {
      return {
        content: [{
          type: 'text' as const,
          text: `No open relationship "${relation}" found between "${from}" and "${to}". It may already be expired or never existed.`,
        }],
      };
    }

    return {
      content: [{
        type: 'text' as const,
        text: `Relationship expired: "${from}" → "${to}" (${relation})\nValid until: ${valid_until ?? new Date().toISOString()}\nThe fact is archived and still queryable via memory_kg_timeline.`,
      }],
    };
  },
);

server.tool(
  'memory_kg_timeline',
  'Query the knowledge graph at a specific point in time. Supports two query modes: (1) "as_of" — what relationships existed on a given real-world date; (2) "as_known_at" — what the system believed on a given date (useful for auditing). Also supports fetching the full history of a specific relationship.',
  {
    mode: z.enum(['as_of', 'as_known_at', 'history']).describe(
      'Query mode: "as_of" = real-world state at date; "as_known_at" = system knowledge at date; "history" = full change log for an entity pair',
    ),
    date: z.string().optional().describe('ISO date string for as_of / as_known_at queries (e.g. "2025-01-15")'),
    from: z.string().optional().describe('Source entity name (required for "history" mode)'),
    to: z.string().optional().describe('Target entity name (required for "history" mode)'),
    relation: z.string().optional().describe('Relationship type (optional filter for "history" mode)'),
    limit: z.number().min(1).max(100).default(20).describe('Maximum edges to return'),
  },
  async ({ mode, date, from, to, relation, limit }) => {
    if (mode === 'history') {
      if (!from || !to) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Error: "history" mode requires both "from" and "to" entity names.',
          }],
        };
      }

      const fromId = db.resolveEntity(from);
      const toId = db.resolveEntity(to);
      if (fromId === null || toId === null) {
        return {
          content: [{
            type: 'text' as const,
            text: `Entity not found: ${fromId === null ? `"${from}"` : `"${to}"`}.`,
          }],
        };
      }

      const histories = relation
        ? db.getEdgeHistory(fromId, toId, relation)
        : db.getEdgesForNode(fromId, {}).filter(e =>
            (e.sourceId === fromId && e.targetId === toId) ||
            (e.sourceId === toId && e.targetId === fromId),
          );

      if (histories.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: `No relationship history found between "${from}" and "${to}"${relation ? ` with relation "${relation}"` : ''}.`,
          }],
        };
      }

      const lines = histories.slice(0, limit).map((e, i) => {
        const status = e.validUntil ? `ended ${e.validUntil}` : 'still valid';
        return `${i + 1}. [${e.relation}] ${e.sourceName} → ${e.targetName}\n` +
          `   Valid: ${e.validFrom} → ${e.validUntil ?? '(ongoing)'} (${status})\n` +
          `   Recorded: ${e.knownFrom} → ${e.knownUntil ?? '(current)'}\n` +
          `   Weight: ${e.weight}`;
      });

      return {
        content: [{
          type: 'text' as const,
          text: `Relationship history: "${from}" ↔ "${to}" (${histories.length} records)\n\n${lines.join('\n\n')}`,
        }],
      };
    }

    // as_of or as_known_at mode
    if (!date) {
      return {
        content: [{
          type: 'text' as const,
          text: 'Error: "date" is required for as_of and as_known_at modes.',
        }],
      };
    }

    const edges = mode === 'as_of'
      ? db.queryAsOf(date)
      : db.queryAsKnownAt(date);

    if (edges.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: `No relationships found for ${mode === 'as_of' ? 'real-world date' : 'system knowledge date'}: ${date}`,
        }],
      };
    }

    const modeLabel = mode === 'as_of'
      ? `Real-world state AS OF ${date}`
      : `System knowledge AS KNOWN AT ${date}`;

    const lines = edges.slice(0, limit).map((e, i) =>
      `${i + 1}. [${e.relation}] ${e.sourceName} → ${e.targetName} (weight: ${e.weight.toFixed(1)})`,
    );

    return {
      content: [{
        type: 'text' as const,
        text: `${modeLabel}\n${edges.length} relationship(s) found (showing ${Math.min(edges.length, limit)}):\n\n${lines.join('\n')}`,
      }],
    };
  },
);

// ────────────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[rag-server] MCP server started');
}

main().catch(console.error);
