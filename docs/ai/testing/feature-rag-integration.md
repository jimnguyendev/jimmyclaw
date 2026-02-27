---
phase: testing
title: RAG Integration Testing
description: Testing strategy for RAG system
---

# Testing Strategy

## Test Coverage Goals
**What level of testing do we aim for?**

- Unit test coverage: 100% of core functions
- Integration testing: MCP server responds correctly
- End-to-end testing: Search returns relevant results

## Unit Tests
**What individual components need testing?**

### Embedding Client (embedding.ts)
- [ ] Test: getEmbedding returns array of correct length (1536)
- [ ] Test: getEmbedding uses cache for repeated queries
- [ ] Test: getEmbedding handles API errors with retry
- [ ] Test: getEmbedding truncates long input

### Chunker (indexer.ts)
- [ ] Test: chunkMarkdown splits at correct size
- [ ] Test: chunkMarkdown includes overlap
- [ ] Test: chunkMarkdown handles empty content
- [ ] Test: chunkMarkdown tracks line numbers correctly

```typescript
describe('chunkMarkdown', () => {
  it('splits content into chunks of ~400 tokens', () => {
    const content = 'Line 1\n'.repeat(200); // ~200 tokens
    const chunks = chunkMarkdown(content, 'test.md');
    
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(500);
    }
  });

  it('includes overlap between chunks', () => {
    const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
    const chunks = chunkMarkdown(content, 'test.md');
    
    if (chunks.length > 1) {
      // Check last lines of chunk 0 appear in chunk 1
      const chunk0End = chunks[0].content.split('\n').slice(-2);
      const chunk1Start = chunks[1].content.split('\n').slice(0, 2);
      expect(chunk0End).toEqual(chunk1Start);
    }
  });
});
```

### Search Engine (search.ts)
- [ ] Test: bm25Search returns results
- [ ] Test: vectorSearch returns results
- [ ] Test: hybridSearch merges results correctly
- [ ] Test: hybridSearch respects limit
- [ ] Test: Scores are normalized (0-1)

```typescript
describe('hybridSearch', () => {
  it('combines BM25 and vector scores', async () => {
    // Insert test documents
    await insertDocument('doc1.md', 'Python programming language');
    await insertDocument('doc2.md', 'JavaScript for web');
    
    const results = await hybridSearch('programming', db, 5);
    
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThanOrEqual(0);
    expect(results[0].score).toBeLessThanOrEqual(1);
  });
});
```

### MCP Tools (tools/*.ts)
- [ ] Test: memory_search returns formatted results
- [ ] Test: memory_search handles empty results
- [ ] Test: memory_get reads file correctly
- [ ] Test: memory_get handles missing file

## Integration Tests
**How do we test component interactions?**

### Database Integration
- [ ] SQLite creates tables on init
- [ ] FTS5 index works
- [ ] Documents can be inserted
- [ ] Documents can be searched

### Indexer Integration
- [ ] File watcher detects changes
- [ ] Changed files are re-indexed
- [ ] Deleted files are removed from index

### MCP Server Integration
- [ ] Server starts and listens
- [ ] Tools are registered
- [ ] Requests are handled

## End-to-End Tests
**What user flows need validation?**

### User Story 1: Semantic Search
- [ ] Given: Indexed memory files
- [ ] When: Agent calls memory_search("deployment process")
- [ ] Then: Returns relevant chunks even without exact match

### User Story 2: Citation
- [ ] Given: Search results returned
- [ ] When: Results displayed
- [ ] Then: Source path and lines included

### User Story 3: Performance
- [ ] Given: 1000 indexed documents
- [ ] When: Search performed
- [ ] Then: Response in <500ms

## Test Data
**What data do we use for testing?**

### Sample Documents
```markdown
# customers.md
## Acme Corp
- Contact: John Doe
- Contract: Enterprise
- Notes: Prefers quarterly reviews

## Beta Inc
- Contact: Jane Smith
- Contract: Startup
- Notes: Fast-growing company
```

```markdown
# preferences.md
## Communication
- Email: preferred for formal
- Chat: for quick questions
- Meeting: morning only

## Work Style
- Prefers detailed documentation
- Likes weekly check-ins
```

## Test Reporting & Coverage
**How do we verify and communicate test results?**

```bash
# Run tests
bun test container/rag-server/

# Coverage report
bun test --coverage

# Specific test file
bun test container/rag-server/src/services/search.test.ts
```

## Manual Testing
**What requires human validation?**

### Search Quality
1. Index sample documents
2. Query with various terms
3. Verify results are relevant
4. Check citation accuracy

### Index Updates
1. Add new document
2. Wait for indexing
3. Search for new content
4. Verify found

## Performance Testing
**How do we validate performance?**

| Metric | Target | Test Method |
|--------|--------|-------------|
| Search latency | <500ms (p95) | Timing in code |
| Index build (100 docs) | <5s | Timing measurement |
| Index build (1000 docs) | <30s | Timing measurement |
| Memory usage | <100MB | Process monitoring |

## Bug Tracking
**How do we manage issues?**

- Document in GitHub issues
- Label with `feature:rag-integration`
- Track in project board
