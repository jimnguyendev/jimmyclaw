import { AgentOrchestrator } from './orchestrator/index.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';
import { getRawDb } from './db.js';
import { getOrchestratorConfig } from './swarm-config.js';

let orchestrator: AgentOrchestrator | null = null;
let swarmEnabled = false;

export function initSwarmMode(): void {
  if (orchestrator) return;

  const rawDb = getRawDb();
  const config = getOrchestratorConfig();
  orchestrator = new AgentOrchestrator(rawDb, config);
  orchestrator.initialize();
  swarmEnabled = true;

  logger.info('Swarm mode initialized');
}

export function isSwarmEnabled(): boolean {
  return swarmEnabled;
}

export function getOrchestrator(): AgentOrchestrator | null {
  return orchestrator;
}

export async function runSwarmAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
): Promise<{ status: 'success' | 'error'; result?: string; error?: string }> {
  if (!orchestrator) {
    return { status: 'error', error: 'Swarm mode not initialized' };
  }

  try {
    const result = await orchestrator.processUserMessage(prompt, {
      userId: group.name,
      chatJid,
    });

    if (result.success) {
      return {
        status: 'success',
        result: result.result,
      };
    } else {
      return {
        status: 'error',
        error: result.error,
      };
    }
  } catch (error) {
    logger.error({ group: group.name, error }, 'Swarm agent error');
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export function shutdownSwarm(): void {
  if (orchestrator) {
    orchestrator.shutdown();
    orchestrator = null;
    swarmEnabled = false;
    logger.info('Swarm mode shutdown');
  }
}

export { AgentOrchestrator } from './orchestrator/index.js';
