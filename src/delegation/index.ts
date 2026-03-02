/**
 * Delegation Module
 * Inter-agent task delegation with permission links and concurrency control.
 */

export * from './types.js';
export { AgentLinkStore, defaultLinkStore } from './link-store.js';
export { DelegationManager, defaultManager } from './manager.js';
export { DelegationTools, defaultTools, type DelegateToolResult } from './tools.js';
