/**
 * Quality Gates
 * Validates agent output before it reaches users.
 */

import { QualityGate, GateResult, HookContext, AgentEvalFunc, CommandEvalFunc } from './types.js';

export class QualityGateEngine {
  private runAgent: AgentEvalFunc | null = null;
  private runCommand: CommandEvalFunc | null = null;

  setAgentRunner(fn: AgentEvalFunc): void {
    this.runAgent = fn;
  }

  setCommandRunner(fn: CommandEvalFunc): void {
    this.runCommand = fn;
  }

  async evaluate(
    gates: QualityGate[],
    context: HookContext
  ): Promise<GateResult> {
    for (const gate of gates) {
      if (gate.event !== context.event) continue;

      const result = await this.evaluateGate(gate, context);
      if (!result.passed && gate.blockOnFailure) {
        return result;
      }
    }

    return { passed: true };
  }

  async evaluateSingle(
    gate: QualityGate,
    context: HookContext
  ): Promise<GateResult> {
    return this.evaluateGate(gate, context);
  }

  async evaluateWithRetry(
    gate: QualityGate,
    context: HookContext,
    maxRetries: number,
    onRetry?: (feedback: string, attempt: number) => Promise<string>
  ): Promise<GateResult & { revisedContent?: string }> {
    let currentContent = context.content;
    let attempts = 0;

    while (attempts <= maxRetries) {
      const evalContext = { ...context, content: currentContent };
      const result = await this.evaluateGate(gate, evalContext);

      if (result.passed) {
        return { ...result, revisedContent: currentContent };
      }

      if (!gate.blockOnFailure || attempts >= maxRetries) {
        return { ...result, revisedContent: currentContent };
      }

      attempts++;
      
      if (onRetry && result.feedback) {
        currentContent = await onRetry(result.feedback, attempts);
      }
    }

    return { passed: false, revisedContent: currentContent };
  }

  private async evaluateGate(
    gate: QualityGate,
    context: HookContext
  ): Promise<GateResult> {
    try {
      if (gate.type === 'command') {
        return await this.evaluateCommand(gate, context);
      } else if (gate.type === 'agent') {
        return await this.evaluateAgent(gate, context);
      }
      return { passed: true };
    } catch (err) {
      return {
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async evaluateCommand(
    gate: QualityGate,
    context: HookContext
  ): Promise<GateResult> {
    if (!this.runCommand || !gate.command) {
      return { passed: true };
    }

    const { exitCode, output } = await this.runCommand(gate.command, context.content);

    if (exitCode === 0) {
      return { passed: true };
    }

    return {
      passed: false,
      feedback: output || 'Command-based evaluation failed',
    };
  }

  private async evaluateAgent(
    gate: QualityGate,
    context: HookContext
  ): Promise<GateResult> {
    if (!this.runAgent || !gate.agent) {
      return { passed: true };
    }

    const prompt = this.buildEvalPrompt(context);
    const result = await this.runAgent(gate.agent, prompt);

    const decision = this.parseDecision(result.content);
    
    return {
      passed: decision.approved,
      feedback: decision.feedback,
    };
  }

  private buildEvalPrompt(context: HookContext): string {
    return `[Quality Evaluation Request]

Event: ${context.event}
User: ${context.userId}
${context.sourceAgentKey ? `Source Agent: ${context.sourceAgentKey}` : ''}
${context.targetAgentKey ? `Target Agent: ${context.targetAgentKey}` : ''}
${context.task ? `Original Task: ${context.task}` : ''}

Content to evaluate:
---
${context.content}
---

Please evaluate the above content and respond with:
- APPROVED if the content meets quality standards
- REJECTED if improvements are needed, followed by specific feedback

Format your response as:
DECISION: APPROVED or REJECTED
FEEDBACK: [Your specific feedback or reasons for approval]`;
  }

  private parseDecision(content: string): { approved: boolean; feedback: string } {
    const upperContent = content.toUpperCase();
    
    if (upperContent.includes('APPROVED')) {
      const feedbackMatch = content.match(/FEEDBACK:\s*([\s\S]+)$/i);
      return {
        approved: true,
        feedback: feedbackMatch?.[1]?.trim() || 'Content approved',
      };
    }

    if (upperContent.includes('REJECTED')) {
      const feedbackMatch = content.match(/FEEDBACK:\s*([\s\S]+)$/i);
      return {
        approved: false,
        feedback: feedbackMatch?.[1]?.trim() || 'Content needs improvement',
      };
    }

    return {
      approved: false,
      feedback: 'Could not determine evaluation decision',
    };
  }
}

export function parseQualityGates(config: unknown): QualityGate[] {
  if (!config || typeof config !== 'object') return [];
  
  const cfg = config as Record<string, unknown>;
  if (!Array.isArray(cfg.quality_gates)) return [];

  return cfg.quality_gates.filter((g): g is QualityGate => {
    return (
      typeof g === 'object' &&
      g !== null &&
      'event' in g &&
      'type' in g &&
      typeof g.blockOnFailure === 'boolean' &&
      typeof g.maxRetries === 'number'
    );
  });
}

export const defaultEngine = new QualityGateEngine();
