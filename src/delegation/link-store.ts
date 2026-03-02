/**
 * Agent Link Store
 * Manages permission links between agents for delegation.
 */

import { AgentLink, LinkSettings } from './types.js';

export class AgentLinkStore {
  private links: Map<string, AgentLink> = new Map();

  private makeKey(source: string, target: string): string {
    return `${source}:${target}`;
  }

  createLink(link: AgentLink): void {
    const key = this.makeKey(link.sourceAgent, link.targetAgent);
    this.links.set(key, link);

    if (link.direction === 'bidirectional') {
      const reverseKey = this.makeKey(link.targetAgent, link.sourceAgent);
      this.links.set(reverseKey, {
        ...link,
        sourceAgent: link.targetAgent,
        targetAgent: link.sourceAgent,
      });
    }
  }

  getLink(source: string, target: string): AgentLink | undefined {
    const key = this.makeKey(source, target);
    return this.links.get(key);
  }

  hasLink(source: string, target: string): boolean {
    return this.links.has(this.makeKey(source, target));
  }

  canDelegate(source: string, target: string): boolean {
    const link = this.getLink(source, target);
    if (!link) return false;

    return (
      link.direction === 'outbound' ||
      link.direction === 'bidirectional'
    );
  }

  checkUserPermission(source: string, target: string, userId: string): boolean {
    const link = this.getLink(source, target);
    if (!link) return false;

    const settings = link.settings;
    if (!settings) return true;

    if (settings.userDeny?.includes(userId)) {
      return false;
    }

    if (settings.userAllow && settings.userAllow.length > 0) {
      return settings.userAllow.includes(userId);
    }

    return true;
  }

  getOutboundLinks(agent: string): AgentLink[] {
    const result: AgentLink[] = [];
    for (const link of this.links.values()) {
      if (link.sourceAgent === agent && link.direction !== 'inbound') {
        result.push(link);
      }
    }
    return result;
  }

  getInboundLinks(agent: string): AgentLink[] {
    const result: AgentLink[] = [];
    for (const link of this.links.values()) {
      if (link.targetAgent === agent && link.direction !== 'outbound') {
        result.push(link);
      }
    }
    return result;
  }

  removeLink(source: string, target: string): boolean {
    const key = this.makeKey(source, target);
    const existed = this.links.delete(key);

    const reverseKey = this.makeKey(target, source);
    this.links.delete(reverseKey);

    return existed;
  }

  clear(): void {
    this.links.clear();
  }

  getAllLinks(): AgentLink[] {
    return Array.from(this.links.values());
  }

  importLinks(links: AgentLink[]): void {
    for (const link of links) {
      this.createLink(link);
    }
  }

  exportLinks(): AgentLink[] {
    return this.getAllLinks();
  }
}

export const defaultLinkStore = new AgentLinkStore();
