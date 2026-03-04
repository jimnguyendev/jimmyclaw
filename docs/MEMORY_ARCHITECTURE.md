# NanoClaw Memory Architecture

> **Status:** Public draft — v1.0, 2026-03
> This document describes the memory subsystem of NanoClaw and positions it against the current state of the art in personal AI assistant memory architectures.

---

## Overview

NanoClaw implements a **tri-hybrid, graph-augmented memory system** running entirely on a single SQLite database (Bun native `bun:sqlite`). No external vector databases, no graph servers, no cloud dependencies. The system provides:

- **BM25 keyword search** (SQLite FTS5)
- **Semantic vector search** (cosine similarity over stored embeddings)
- **Knowledge graph BFS traversal** (entity relationship graph)
- **RRF fusion** (Reciprocal Rank Fusion across all three signals)
- **Temporal decay** (recency weighting with access count correction)
- **MMR re-ranking** (diversity deduplication in final results)

All components run inside an isolated container per user group, with zero shared state between groups.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    NANOCLAW MEMORY SYSTEM                        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                  WRITE PATH                               │   │
│  │                                                          │   │
│  │  Markdown files          Agent output                    │   │
│  │  (MEMORY.md,             (entities + relations)          │   │
│  │   knowledge/*.md)              │                         │   │
│  │        │                       │                         │   │
│  │        ▼                       ▼                         │   │
│  │  ┌──────────┐          ┌──────────────────┐              │   │
│  │  │ Indexer  │          │ memory_kg_index   │              │   │
│  │  │ (chunker │          │ (MCP tool)        │              │   │
│  │  │ + hasher)│          └────────┬─────────┘              │   │
│  │  └────┬─────┘                   │                        │   │
│  │       │                         │                        │   │
│  │       ▼                         ▼                        │   │
│  │  ┌─────────────────────────────────────────────────┐     │   │
│  │  │               SQLite (bun:sqlite)                │     │   │
│  │  │                                                  │     │   │
│  │  │  documents        ← chunks + embeddings (BLOB)  │     │   │
│  │  │  documents_fts    ← FTS5 BM25 index             │     │   │
│  │  │  embedding_cache  ← L2 embedding cache          │     │   │
│  │  │  search_sessions  ← session context tracking    │     │   │
│  │  │  search_config    ← runtime-tunable weights     │     │   │
│  │  │                                                  │     │   │
│  │  │  kg_nodes         ← entities (canonical names)  │     │   │
│  │  │  kg_edges         ← relationships + weights     │     │   │
│  │  │  kg_aliases       ← alias → canonical           │     │   │
│  │  │  kg_chunk_mentions← entity ↔ document chunk     │     │   │
│  │  └──────────────────────────────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                  READ PATH                                │   │
│  │                                                          │   │
│  │   Query ──────────────────────────────────────────────┐  │   │
│  │                                                        │  │   │
│  │   ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │  │   │
│  │   │  BM25 (FTS5) │  │  Vector      │  │  Graph BFS │  │  │   │
│  │   │  keyword     │  │  cosine sim  │  │  entity    │  │  │   │
│  │   │  search      │  │  (1536-dim)  │  │  traversal │  │  │   │
│  │   └──────┬───────┘  └──────┬───────┘  └─────┬──────┘  │  │   │
│  │          │                 │                 │          │  │   │
│  │          └─────────────────┴─────────────────┘          │  │   │
│  │                            │                             │  │   │
│  │                    ┌───────▼────────┐                   │  │   │
│  │                    │  RRF Fusion    │                   │  │   │
│  │                    │  score(d) =    │                   │  │   │
│  │                    │  Σ 1/(60+rank) │                   │  │   │
│  │                    └───────┬────────┘                   │  │   │
│  │                            │                             │  │   │
│  │                    ┌───────▼────────┐                   │  │   │
│  │                    │ Temporal Decay │                   │  │   │
│  │                    │ + Access Boost │                   │  │   │
│  │                    │ + Session Boost│                   │  │   │
│  │                    └───────┬────────┘                   │  │   │
│  │                            │                             │  │   │
│  │                    ┌───────▼────────┐                   │  │   │
│  │                    │  MMR Re-rank   │                   │  │   │
│  │                    │  (diversity)   │                   │  │   │
│  │                    └───────┬────────┘                   │  │   │
│  │                            │                             │  │   │
│  │                    ┌───────▼────────┐                   │  │   │
│  │                    │  Top-K Results │                   │  │   │
│  │                    │  with citations│                   │  │   │
│  │                    └────────────────┘                   │  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Per-group isolation: each group has its own SQLite database     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Memory Types

NanoClaw distinguishes three memory categories, each with different storage and retrieval characteristics:

### 1. Working Memory (Context Window)

Files loaded directly into the agent's context on every invocation:

| File | Content | Update frequency |
|------|---------|-----------------|
| `CLAUDE.md` | System prompt, behavioral rules | Manual |
| `MEMORY.md` | Long-term curated facts | Agent-managed |

These files are always available at zero retrieval cost. Agents are instructed to keep them concise and curated.

### 2. Episodic Memory (Daily Logs)

```
memory/YYYY-MM-DD.md
```

Append-only daily session logs. Written by the agent at conversation end. Indexed by the RAG system for searchable recall. Temporal decay applies — older logs score lower unless frequently accessed.

### 3. Semantic Memory (Indexed Knowledge)

```
knowledge/*.md    ← evergreen structured data (no decay)
conversations/    ← archived sessions
```

All files are chunked (400 tokens, 80-token overlap), embedded, and stored in SQLite. Knowledge files are marked evergreen — they do not decay over time.

### 4. Knowledge Graph (Relational Memory)

Entities and relationships extracted from conversations and stored in the KG subsystem:

```
kg_nodes     → Jimmy Nguyen [person], NanoClaw [project]
kg_edges     → Jimmy → NanoClaw: "builds", Jimmy → Anthropic: "uses API of"
kg_aliases   → "Jim" → Jimmy Nguyen
kg_chunk_mentions → entity ↔ document chunk (bidirectional index)
```

The KG is populated explicitly by agents via the `memory_kg_index` MCP tool — the agent extracts entities during conversation and calls the tool to persist them. No automated LLM extraction pass is performed during ingestion (see design rationale below).

---

## Search Pipeline

### Step 1: Tri-Hybrid Retrieval (parallel)

Three signals run concurrently for every query:

**BM25** — SQLite FTS5 with Porter stemmer and unicode61 tokenizer. Returns ranked chunk IDs with raw BM25 scores. Best for exact-match queries (names, dates, technical terms).

**Vector Search** — Cosine similarity over 1536-dimensional embeddings (OpenAI `text-embedding-3-small` via OpenRouter, or Z.ai). Two-level cache: in-memory LRU (50 entries) + SQLite persistent cache. Best for semantic/conceptual queries.

**Graph BFS** — Starting from entity seeds (resolved via `kg_aliases`), performs BFS up to 3 hops. Chunks linked to any discovered entity via `kg_chunk_mentions` are scored `1 / (1 + hop_distance)`. Two guard rails:
- **Hub-node capping**: Nodes with degree > 15 are limited to 1 hop (prevents flooding from generic entities like "user" or "project").
- **Multi-seed intersection**: When multiple entity seeds are provided, returns only chunks reachable from all seeds (precision over recall), with union fallback if intersection is empty.

### Step 2: RRF Fusion

Reciprocal Rank Fusion merges all three ranked lists without requiring score normalization:

```
score(chunk) = Σᵢ  1 / (k + rankᵢ(chunk))
```

Where `k = 60` (standard RRF constant). A chunk appearing in all three lists scores ~3x higher than one appearing in a single list. Scale differences between BM25 scores and cosine similarities are irrelevant — only rank position matters.

### Step 3: Temporal Decay + Boosts

Applied after RRF fusion:

```
# Temporal decay (not applied to knowledge/ files — evergreen)
effectiveAge = max(0, ageDays - accessCount × decayAccessFactor × halfLife)
decay        = 0.5 ^ (effectiveAge / halfLife)

# Access frequency boost
if accessCount > 0:
  score *= 1 + log(accessCount) × 0.1

# Session context boost
if chunkAccessedInCurrentSession:
  score *= 1 + sessionBoost
```

Default half-life: 30 days. Access events reset the effective age clock — frequently-accessed chunks stay warm.

### Step 4: MMR Re-ranking

Maximal Marginal Relevance ensures diversity in the final result set:

```
MMR(d) = λ × relevance(d) - (1-λ) × maxSim(d, selected)
```

Where `λ = 0.7` by default. Prevents returning five similar chunks from the same document section.

### Configurable Parameters

All scoring parameters are tunable at runtime via `memory_config` MCP tool without restarting the server:

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `bm25_weight` | 0.3 | BM25 weight (legacy, RRF uses rank not weight) |
| `vector_weight` | 0.7 | Vector weight (legacy) |
| `graph_weight` | 0.2 | Graph signal strength |
| `decay_half_life` | 30 | Days until a chunk loses half its temporal score |
| `decay_access_factor` | 0.1 | Access events slow down decay |
| `mmr_lambda` | 0.7 | Relevance vs. diversity tradeoff |
| `session_boost` | 0.15 | Boost for chunks seen this session |

---

## MCP Tools Exposed to Agents

| Tool | Purpose |
|------|---------|
| `memory_search` | Tri-hybrid search with all signals and re-ranking |
| `memory_get` | Direct file read by path + line range |
| `memory_reindex` | Trigger full re-index after file changes |
| `memory_stats` | Search stats, cache size, access counts |
| `memory_config` | View / update scoring parameters at runtime |
| `memory_dedup` | Find semantically duplicate chunks |
| `memory_kg_index` | Save extracted entities + relationships |
| `memory_entities` | List / search entities in knowledge graph |
| `memory_connect` | Find shortest relationship path between entities |
| `memory_kg_stats` | Graph statistics: nodes, edges, top entities |

---

## Design Principles

### 1. Single SQLite, Zero External Services

The entire memory system — BM25 index, vector embeddings, knowledge graph, caches, config — lives in one SQLite file per group. Deployment requires no Redis, no Neo4j, no Qdrant, no Pinecone. This is a deliberate constraint:

- **Portability**: The entire memory of a group is a single file, trivially backed up or migrated.
- **Performance**: Bun's `bun:sqlite` bindings have near-zero overhead vs. HTTP-based vector stores.
- **Simplicity**: No service orchestration, no network partitions, no authentication between components.

### 2. Agent-Driven Entity Extraction

NanoClaw does **not** run an LLM extraction pass during memory ingestion. Instead, agents are responsible for calling `memory_kg_index` when they learn new entities or relationships.

This separation:
- Eliminates hidden LLM cost during indexing
- Gives agents full control over what enters the knowledge graph
- Makes the knowledge graph an explicit, auditable artifact rather than an opaque side effect

This pattern is adapted from kioku-agent-kit-lite's "agents extract, storage only stores" principle.

### 3. RRF Over Weighted Averaging

Earlier versions of NanoClaw used a weighted average of normalized BM25 and vector scores. RRF is superior because:

- **Scale-agnostic**: BM25 scores and cosine similarities have incompatible scales; RRF requires no normalization.
- **Natural ensemble**: Documents appearing in multiple lists are rewarded multiplicatively without explicit weight tuning.
- **Proven**: RRF was introduced by Cormack et al. (2009) and is used in Zep, Elasticsearch's `hybrid` mode, and BEIR benchmark top systems.

### 4. Per-Group Isolation

Each user group (WhatsApp group, Telegram group, etc.) has its own SQLite database mounted into an isolated container. Groups cannot access each other's memories. This is OS-level isolation, not application-level permissioning.

---

## Comparison with Other Systems

### NanoClaw vs. OpenClaw

OpenClaw's community architecture (coolmanns/openclaw-memory-architecture) describes a 12-layer system with activation decay, domain RAG, and a QMD reranker. NanoClaw and OpenClaw share similar philosophical goals (small, local-first, Markdown-centric) but differ in approach:

| Dimension | NanoClaw | OpenClaw (community arch.) |
|-----------|---------|--------------------------|
| **Storage** | Single SQLite per group | SQLite + separate sqlite-vec + Markdown files |
| **Search** | BM25 + Vector + Graph → RRF | FTS5 + Vector + QMD reranker (tiered) |
| **Knowledge Graph** | Built-in (SQLite tables) | Graph-memory plugin (separate layer 12) |
| **Temporal** | Decay scoring | Activation decay cron (3-tier: Hot/Warm/Cool) |
| **Codebase size** | ~1,500 lines (RAG server) | Community-documented, base is Markdown only |
| **Auto-extraction** | No (agent-explicit) | No (manual write) |
| **Bi-temporal** | Yes (kg_edges: valid_from/until + known_from/until) | No |
| **Dependencies** | Zero (Bun native SQLite) | sqlite-vec extension + separate processes |
| **Multi-group isolation** | OS-level (container) | Application-level |

OpenClaw's tiered activation model (inspired by cognitive spreading activation theory) is more sophisticated for long-running single-user deployments. NanoClaw's approach is simpler but more maintainable and requires no cron jobs.

### NanoClaw vs. Mem0

Mem0 is the leading production memory library as of 2025. Key differences:

| Dimension | NanoClaw | Mem0 |
|-----------|---------|------|
| **Storage** | SQLite (embedded) | External vector DB (Qdrant, Pinecone, etc.) + optional Neo4j |
| **Graph search** | BFS with hub-node capping | BFS traversal (Neo4j BoltDB) |
| **RRF** | Yes (BM25 + Vector + Graph) | No — vector similarity is primary, graph is supplementary |
| **Memory extraction** | Agent-explicit | LLM-automatic (ADD/UPDATE/DELETE/NOOP) |
| **Temporal** | Decay scoring | Timestamp-only |
| **Bi-temporal** | Yes (4-timestamp KG edges) | No |
| **Contradiction resolution** | No | Yes (LLM-based UPDATE/DELETE) |
| **Multi-agent** | Yes (swarm architecture) | Yes (user_id/agent_id namespacing) |
| **Deployment** | Self-hosted, single process | Cloud SDK or self-hosted with external DBs |
| **Cost at 1M queries** | ~$0 (no API) | External DB costs + LLM extraction per write |

NanoClaw trades Mem0's automatic memory management for lower cost and zero external dependencies. For personal use at low-to-medium volume, SQLite's throughput (100K+ reads/sec) is more than sufficient.

### NanoClaw vs. Zep / Graphiti

Zep represents the current state of the art in temporal knowledge graph memory. It is primarily an enterprise/production system:

| Dimension | NanoClaw | Zep |
|-----------|---------|-----|
| **Storage** | SQLite | Knowledge graph (Neo4j-compatible) + Lucene |
| **Search** | BM25 + Vector + Graph → RRF + MMR | BM25 + Cosine + BFS → RRF + MMR + cross-encoder |
| **Bi-temporal** | **Yes** (T and T' timelines on KG edges) | **Yes** (T and T' timelines, full graph) |
| **Community subgraph** | No | Yes (clustered summaries) |
| **Retrieval latency** | ~50–200ms | ~300ms P95 |
| **LLM during retrieval** | No | No (retrieval is index-driven) |
| **LLM during ingestion** | No | Yes (entity extraction) |
| **Deployment** | Single SQLite, zero services | Neo4j + search infrastructure |
| **Open source** | Yes (MIT) | Yes (Apache 2.0) |
| **Scale** | Personal / small team | Enterprise |

NanoClaw now implements **bi-temporal modeling** on the knowledge graph, closing the biggest gap with Zep. Every `kg_edges` row carries four timestamps: `valid_from`/`valid_until` (T timeline — when the fact was true in the real world) and `known_from`/`known_until` (T' timeline — when the system recorded or retracted the fact). This allows answering "what relationships existed on 2024-11-01?" (`memory_kg_timeline mode=as_of`) and "what did we believe last Tuesday?" (`memory_kg_timeline mode=as_known_at`).

The remaining Zep advantage is **community/cluster subgraph summaries** — Zep periodically clusters the graph and builds higher-order summaries. NanoClaw's graph is flat (no clustering).

### NanoClaw vs. MemoryOS

MemoryOS is an academic architecture (EMNLP 2025 Oral) proposing an OS-inspired three-tier memory model. It is not a deployable system but a research framework:

| Dimension | NanoClaw | MemoryOS |
|-----------|---------|---------|
| **Tiers** | 2 (working + indexed) | 3 (STM/MTM/LTM, OS analogy) |
| **Eviction policy** | Temporal decay | Heat-based (N_visit + L_interaction + R_recency) |
| **Persona modeling** | No | Yes (90-dimension trait extraction) |
| **Storage** | SQLite | In-memory paging + embeddings |
| **LTM capacity** | Unbounded (disk) | 100-entry hard cap |
| **Benchmark** | Not evaluated | +49.11% F1 on LoCoMo |
| **Deployable** | Yes | Research prototype |

MemoryOS's heat-based eviction is a more principled approach to forgetting than NanoClaw's time-based decay. The 90-dimension personality trait model is a unique capability NanoClaw does not have.

---

## Positioning Summary

```
                    Simplicity / Deployability
                              ▲
                              │
                   NanoClaw ──●── Zero external deps, single SQLite
                              │   BM25 + Vector + Graph KG → RRF
                              │   Personal / small team scale
                              │
           OpenClaw ──────────┤   Markdown-first, activation decay
         (community arch)     │   Single-user, 12-layer complexity
                              │
                              │
         MemoryOS ────────────┤   Research, OS-inspired 3-tier
         (research)           │   Heat eviction, persona traits
                              │
              Mem0 ───────────┤   Production library
                              │   LLM-managed CRUD, external DBs
                              │
               Zep ───────────┤   Enterprise, bi-temporal KG
                              │   Full Graphiti stack
                              ▼
                  Richness / Production Scale
```

### What NanoClaw does uniquely well

1. **Zero-dependency hybrid search in a single file.** No other open-source personal AI assistant implements BM25 + vector + knowledge graph search in a single SQLite database with no external services.

2. **Per-group OS-level isolation.** Memory is isolated at the container level, not the application level. One process cannot access another group's memory even if compromised.

3. **Agent-explicit knowledge graph.** The agent decides what enters the KG — no hidden LLM extraction pass, no opaque memory side effects. The graph is auditable by humans.

4. **RRF with graph as first-class signal.** Unlike Mem0 (where graph is supplementary) and OpenClaw (where graph is a separate plugin), NanoClaw's RRF treats BM25, vector, and graph as equal peers.

5. **Runtime-tunable scoring.** All search parameters are configurable at runtime via MCP tool without restarting the server, enabling in-context experimentation.

### Known gaps vs. state of the art

| Gap | Best-in-class | Priority |
|-----|--------------|---------|
| ~~Bi-temporal modeling~~ | ~~Zep~~ | **Implemented** — T and T' timelines on KG edges |
| Automatic contradiction resolution | Mem0 | Low — manual curation is safer |
| Personality trait extraction | MemoryOS | Low — not a goal for NanoClaw |
| Community/cluster subgraph summaries | Zep | Medium — scales graph to large deployments |
| Principled eviction (heat-based) | MemoryOS | Medium — current decay is time-only |
| Benchmark evaluation | All | High — no public evaluation of this system yet |

---

## References

- Cormack, Clarke, Buettcher (2009). *Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods.*
- [Zep: A Temporal Knowledge Graph Architecture for Agent Memory](https://arxiv.org/abs/2501.13956)
- [Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory](https://arxiv.org/abs/2504.19413)
- [Memory OS of AI Agent](https://arxiv.org/abs/2506.06326)
- [PersonalAI: Systematic Comparison of KG Storage for Personalized LLM Agents](https://arxiv.org/abs/2506.17001)
- [phuc-nt/kioku-agent-kit-lite](https://github.com/phuc-nt/kioku-agent-kit-lite)
- [coolmanns/openclaw-memory-architecture](https://github.com/coolmanns/openclaw-memory-architecture)
