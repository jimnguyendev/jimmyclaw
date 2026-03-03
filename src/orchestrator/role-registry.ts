import { readFileSync } from 'fs';
import { logger } from '../logger.js';

export interface RoleDefinition {
  id: string;
  description: string;
  defaultPrompt: string;
  canDelegate: boolean;
  keywords: string[];
}

export class AgentRoleRegistry {
  private roles = new Map<string, RoleDefinition>();

  loadFromConfig(roles: RoleDefinition[]): void {
    this.roles.clear();
    for (const role of roles) {
      this.roles.set(role.id, role);
      logger.debug({ roleId: role.id, keywordCount: role.keywords.length }, 'Role loaded from config');
    }
    logger.info({ roleCount: this.roles.size }, 'Agent role registry loaded');
  }

  getRole(id: string): RoleDefinition | undefined {
    return this.roles.get(id);
  }

  getAllRoles(): RoleDefinition[] {
    return Array.from(this.roles.values());
  }

  classifyTask(description: string): string {
    const lowerDesc = description.toLowerCase();
    let bestMatch = 'general';
    let maxScore = 0;

    for (const [roleId, role] of this.roles) {
      let score = 0;
      for (const keyword of role.keywords) {
        if (lowerDesc.includes(keyword.toLowerCase())) {
          score++;
        }
      }

      if (score > maxScore) {
        maxScore = score;
        bestMatch = roleId;
      }
    }

    logger.debug({ description: description.slice(0, 50), classifiedAs: bestMatch, score: maxScore }, 'Task classified');
    return bestMatch;
  }
}
