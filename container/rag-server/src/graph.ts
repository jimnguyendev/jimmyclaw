/**
 * graph.ts — Knowledge Graph BFS search
 *
 * Implements:
 *   - BFS traversal from one or more seed entities
 *   - Hub-node capping: high-degree nodes (degree > HUB_THRESHOLD) stop at 1 hop
 *   - Multi-seed intersection: only return chunks reachable from ALL seeds
 *     (falls back to union if intersection is empty)
 */

import { RAGDatabase } from './db.js';
import { GraphSearchResult, TemporalQuery } from './types.js';

const HUB_THRESHOLD = 15;   // nodes with more edges than this get capped at 1 hop
const MAX_HOPS = 3;         // maximum BFS depth

export class GraphSearch {
  constructor(private db: RAGDatabase) {}

  /**
   * Given a list of entity names (seeds), find all related chunk IDs via BFS.
   * Returns a map of chunkId → normalized graph relevance score (0–1).
   * @param temporal  Optional bi-temporal filter. asOf restricts edges to those valid at that real-world time.
   */
  search(entityNames: string[], maxHops = MAX_HOPS, temporal?: TemporalQuery): Map<number, number> {
    if (entityNames.length === 0) return new Map();

    // Resolve names to node IDs
    const seedIds: number[] = [];
    for (const name of entityNames) {
      const id = this.db.resolveEntity(name);
      if (id !== null) seedIds.push(id);
    }
    if (seedIds.length === 0) return new Map();

    // BFS from each seed → Set<chunkId> with hop-weighted scores
    const perSeedChunks: Map<number, number>[] = seedIds.map(seedId =>
      this.bfsFromSeed(seedId, maxHops, temporal?.asOf),
    );

    // Multi-seed intersection with union fallback
    const merged = this.intersectOrUnion(perSeedChunks);

    return merged;
  }

  /**
   * BFS from a single seed. Returns chunkId → score, where score = 1/(1+hop).
   * Hub nodes (degree > threshold) are limited to 1 hop.
   * @param asOf  If provided, only traverse edges valid at this real-world time.
   */
  private bfsFromSeed(seedId: number, maxHops: number, asOf?: string): Map<number, number> {
    const chunkScores = new Map<number, number>();
    const visited = new Set<number>();
    // queue: [nodeId, hopDistance]
    const queue: [number, number][] = [[seedId, 0]];

    while (queue.length > 0) {
      const [nodeId, hop] = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      // Collect chunks for this node
      const score = 1 / (1 + hop);
      for (const chunkId of this.db.getChunkIdsByNode(nodeId)) {
        const existing = chunkScores.get(chunkId) ?? 0;
        chunkScores.set(chunkId, Math.max(existing, score));
      }

      if (hop >= maxHops) continue;

      // Check if hub node — cap at 1 hop if so
      const isHub = this.db.getNodeDegree(nodeId) > HUB_THRESHOLD;
      if (isHub && hop >= 1) continue;

      // Expand neighbours — pass asOf for temporal filtering
      for (const { nodeId: neighbourId } of this.db.getNeighbours(nodeId, asOf)) {
        if (!visited.has(neighbourId)) {
          queue.push([neighbourId, hop + 1]);
        }
      }
    }

    return chunkScores;
  }

  /**
   * If multiple seeds provided, return only chunks reachable from ALL seeds
   * (intersection). Falls back to union if intersection is empty.
   * Scores are averaged across seeds.
   */
  private intersectOrUnion(maps: Map<number, number>[]): Map<number, number> {
    if (maps.length === 0) return new Map();
    if (maps.length === 1) return maps[0];

    // Try intersection first
    const allKeys = maps.map(m => new Set(m.keys()));
    const intersection = [...allKeys[0]].filter(k => allKeys.every(s => s.has(k)));

    const sourceKeys = intersection.length > 0 ? intersection : [...new Set(maps.flatMap(m => [...m.keys()]))];

    const result = new Map<number, number>();
    for (const chunkId of sourceKeys) {
      const scores = maps.map(m => m.get(chunkId) ?? 0);
      const avg = scores.reduce((a, b) => a + b, 0) / maps.length;
      result.set(chunkId, avg);
    }
    return result;
  }

  /**
   * Find the shortest BFS path between two entities.
   * Returns list of node names along the path, or [] if not connected.
   */
  findPath(fromName: string, toName: string, maxHops = 6): string[] {
    const fromId = this.db.resolveEntity(fromName);
    const toId = this.db.resolveEntity(toName);
    if (fromId === null || toId === null || fromId === toId) return [];

    const prev = new Map<number, number | null>();
    prev.set(fromId, null);
    const queue: number[] = [fromId];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const hop = this.getHop(prev, nodeId, fromId);
      if (hop >= maxHops) continue;

      for (const { nodeId: neighbourId } of this.db.getNeighbours(nodeId, null)) {
        if (prev.has(neighbourId)) continue;
        prev.set(neighbourId, nodeId);
        if (neighbourId === toId) {
          return this.reconstructPath(prev, fromId, toId);
        }
        queue.push(neighbourId);
      }
    }
    return [];
  }

  private getHop(prev: Map<number, number | null>, nodeId: number, startId: number): number {
    let hop = 0;
    let cur: number | null = nodeId;
    while (cur !== null && cur !== startId) {
      cur = prev.get(cur) ?? null;
      hop++;
      if (hop > 20) break; // safety
    }
    return hop;
  }

  private reconstructPath(prev: Map<number, number | null>, fromId: number, toId: number): string[] {
    const ids: number[] = [];
    let cur: number | null = toId;
    while (cur !== null) {
      ids.unshift(cur);
      cur = prev.get(cur) ?? null;
    }
    return ids.map(id => this.db.getNodeById(id)?.name ?? String(id));
  }

  /**
   * Exposed for SearchEngine: convert raw graph scores to ranked SearchResult-compatible list.
   */
  toRankedList(graphScores: Map<number, number>): { id: number; score: number }[] {
    return [...graphScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, score]) => ({ id, score }));
  }
}
