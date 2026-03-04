---
phase: requirements
title: RAG Integration (Arona-style)
description: Implement hybrid search (BM25 + vector) for memory and knowledge retrieval
---

# Requirements & Problem Understanding

## Problem Statement
**What problem are we solving?**

JimmyClaw's current memory search is limited to exact file matching and grep. This causes:
- Missed context when user queries use different wording than stored text
- No semantic understanding of related concepts
- Poor recall for large knowledge bases
- Manual file reading is time-consuming

**Who is affected?**
- Users with large knowledge bases
- Users who want semantic search over their data
- Users whose queries don't match exact keywords

**Current situation:**
- Agent uses `Read`, `Grep`, `Glob` tools to find information
- No vector embeddings for semantic search
- No BM25 for keyword relevance
- No caching for repeated queries

## Goals & Objectives
**What do we want to achieve?**

### Primary Goals
1. Implement hybrid search combining BM25 + vector similarity
2. Index memory files (MEMORY.md, memory/*.md, knowledge/*.md)
3. Provide MCP tools for search and retrieval
4. Support semantic caching for repeated queries

### Secondary Goals
- Query normalization using smaller model
- Citation support in responses
- Diff-aware indexing (only update changed content)
- Configurable search weights (BM25 vs vector)

### Non-goals
- Real-time web indexing
- Multi-language support (English only initially)
- Distributed search (single-node only)

## User Stories & Use Cases
**How will users interact with the solution?**

### Story 1: Semantic Memory Search
> As a user, I want to ask "What's our deployment process?" and get relevant info even if I never used those exact words.

**Workflow:**
1. User asks question
2. Agent calls `memory_search` MCP tool
3. Query is normalized and embedded
4. Hybrid search finds relevant chunks
5. Agent receives context with citations

### Story 2: Repeated Query Cache
> As a user, I want fast responses for questions I've asked before.

**Workflow:**
1. User asks previously asked question
2. Semantic cache detects similarity
3. Cached response returned immediately
4. No API call to main model needed

### Story 3: Knowledge Base Query
> As a user, I want to search across all my knowledge files at once.

**Workflow:**
1. Agent calls `memory_search` with broad query
2. All indexed files searched
3. Results ranked by relevance
4. Top chunks returned with source citations

### Edge Cases
- Empty search results
- Index not yet built
- Embedding API unavailable
- Search query too long/short

## Success Criteria
**How will we know when we're done?**

- [ ] BM25 search working on memory files
- [ ] Vector embeddings stored and queryable
- [ ] Hybrid search combining both signals
- [ ] MCP tools: `memory_search`, `memory_get`
- [ ] Semantic cache with LRU eviction
- [ ] Citation format in responses
- [ ] Index rebuild on file changes

## Constraints & Assumptions
**What limitations do we need to work within?**

### Technical Constraints
- Must use SQLite for storage (no external DB required)
- Embedding API: OpenAI text-embedding-3-small or local
- Index size must fit in reasonable memory (<100MB typical)

### Business Constraints
- Embedding API costs should be minimal (<$1/month typical use)
- Optional: support local embeddings for zero cost

### Assumptions
- OpenAI API key available for embeddings (or local model)
- Users have <10,000 documents typically
- Search latency <500ms acceptable

## Questions & Open Items
**What do we still need to clarify?**

1. Local embedding model choice (whisper? all-minilm?)
2. Index storage location (per-group or shared)?
3. How to handle binary/non-text files?
4. Reindex strategy (manual, cron, watch)?
5. Search result ranking customization?
