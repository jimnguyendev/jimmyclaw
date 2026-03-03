import { AgentConfig, RoleDefinition, TaskPlan } from './types.js';
import { llmProvider } from './llm-provider.js';
import { AgentRoleRegistry } from './role-registry.js';
import { logger } from '../logger.js';

export class TaskPlanner {
  private roleRegistry: AgentRoleRegistry;

  constructor(private model: string, private agents: AgentConfig[], private roles: RoleDefinition[]) {
    this.roleRegistry = new AgentRoleRegistry();
    if (roles.length > 0) this.roleRegistry.loadFromConfig(roles);
  }

  async plan(taskDescription: string, availableAgents: AgentConfig[]): Promise<TaskPlan> {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const prompt = this.buildPrompt(taskDescription, availableAgents, this.roles);
    
    try {
      const response = await llmProvider.generate(
        { provider: 'opencode', model: this.model, timeoutMs: 60000 },
        prompt,
        'You are a task planning expert. Break down complex tasks into subtasks for an AI agent team.',
      );

      const plan = this.parsePlan(response.content, taskId, taskDescription);
      
      if (this.validatePlan(plan)) {
        logger.info({ taskId, subtaskCount: plan.subtasks.length }, 'Task plan created');
        return plan;
      } else {
        logger.warn({ taskId }, 'Invalid plan, falling back to single subtask');
        return this.createFallbackPlan(taskId, taskDescription, availableAgents);
      }
    } catch (error) {
      logger.error({ error, taskId }, 'Failed to create plan, falling back to single subtask');
      return this.createFallbackPlan(taskId, taskDescription, availableAgents);
    }
  }

  private buildPrompt(taskDescription: string, agents: AgentConfig[], roles: RoleDefinition[]): string {
    const rolesDescription = roles.map(role => 
      `- ${role.id}: ${role.description}\n  Keywords: ${role.keywords.join(', ')}`
    ).join('\n');

    const availableRoles = roles.map(r => r.id).join(', ');

    return `You are a team lead. Break this task into subtasks for your team.

Available roles:
${rolesDescription}

Task: ${taskDescription}

Instructions:
1. If the task is simple enough for one agent, return a single subtask
2. If complex, break into multiple subtasks with dependencies
3. Each subtask should specify which role should handle it
4. Dependencies: list subtask IDs that must complete first (empty array if no deps)
5. Avoid circular dependencies

Return JSON format:
{
  "subtasks": [
    {
      "id": "s1",
      "role": "researcher",
      "description": "what to do",
      "deps": [],
      "expectedOutput": "what the result should look like"
    }
  ]
}`;
  }

  private parsePlan(content: string, taskId: string, goal: string): TaskPlan {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      if (!parsed.subtasks || !Array.isArray(parsed.subtasks)) {
        throw new Error('Invalid plan format: missing subtasks array');
      }

      return {
        taskId,
        goal,
        subtasks: parsed.subtasks,
      };
    } catch (error) {
      throw new Error(`Failed to parse plan: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private validatePlan(plan: TaskPlan): boolean {
    if (plan.subtasks.length === 0) {
      return false;
    }

    const subtaskIds = new Set(plan.subtasks.map(s => s.id));
    if (subtaskIds.size !== plan.subtasks.length) {
      return false;
    }

    for (const subtask of plan.subtasks) {
      if (!subtask.id || !subtask.role || !subtask.description) {
        return false;
      }

      for (const dep of subtask.deps) {
        if (!subtaskIds.has(dep)) {
          return false;
        }
      }
    }

    return true;
  }

  private createFallbackPlan(taskId: string, goal: string, agents: AgentConfig[]): TaskPlan {
    // Use role registry to pick the best role; fall back to 'researcher' if registry is empty
    const bestRole = this.roleRegistry.getAllRoles().length > 0
      ? this.roleRegistry.classifyTask(goal)
      : 'researcher';

    // Prefer a local agent with matching role, otherwise take any available agent
    const matchingAgent = agents.find(a => a.role === bestRole) ?? agents[0];
    const role = matchingAgent?.role ?? bestRole;

    return {
      taskId,
      goal,
      subtasks: [
        {
          id: 's1',
          role,
          description: goal,
          deps: [],
          expectedOutput: 'Complete the task as described',
        },
      ],
    };
  }
}
