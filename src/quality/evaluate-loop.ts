/**
 * Evaluate Loop
 * Generator-evaluator feedback cycle for quality-gated output.
 */

import { EvaluateLoopConfig, EvaluateLoopResult, AgentEvalFunc } from './types.js';

const DEFAULT_MAX_ROUNDS = 3;
const MAX_ROUNDS_LIMIT = 5;

export class EvaluateLoop {
  private runAgent: AgentEvalFunc | null = null;

  setAgentRunner(fn: AgentEvalFunc): void {
    this.runAgent = fn;
  }

  async run(config: EvaluateLoopConfig): Promise<EvaluateLoopResult> {
    if (!this.runAgent) {
      throw new Error('No agent runner configured');
    }

    const maxRounds = Math.min(
      config.maxRounds || DEFAULT_MAX_ROUNDS,
      MAX_ROUNDS_LIMIT
    );

    let currentContent = '';
    let feedback = '';
    let approved = false;

    for (let round = 1; round <= maxRounds; round++) {
      const generatorPrompt = this.buildGeneratorPrompt(config, feedback, round, maxRounds);
      const generatorResult = await this.runAgent(config.generator, generatorPrompt);
      currentContent = generatorResult.content;

      const evaluatorPrompt = this.buildEvaluatorPrompt(config, currentContent);
      const evaluatorResult = await this.runAgent(config.evaluator, evaluatorPrompt);
      
      const decision = this.parseDecision(evaluatorResult.content);
      approved = decision.approved;
      feedback = decision.feedback;

      if (approved) {
        return {
          approved: true,
          content: currentContent,
          rounds: round,
          feedback: decision.feedback,
        };
      }

      if (round === maxRounds) {
        return {
          approved: false,
          content: currentContent,
          rounds: round,
          feedback: `Max rounds (${maxRounds}) reached. Last feedback: ${feedback}`,
        };
      }
    }

    return {
      approved: false,
      content: currentContent,
      rounds: maxRounds,
      feedback,
    };
  }

  private buildGeneratorPrompt(
    config: EvaluateLoopConfig,
    previousFeedback: string,
    round: number,
    maxRounds: number
  ): string {
    const parts: string[] = [];

    if (round === 1) {
      parts.push('[Generator Task]');
      parts.push(config.task);
      if (config.context) {
        parts.push(`\n[Context]\n${config.context}`);
      }
    } else {
      parts.push(`[Revision Round ${round}/${maxRounds}]`);
      parts.push(`\nYour previous output was rejected. Please revise based on the feedback.`);
      parts.push(`\n[Previous Feedback]\n${previousFeedback}`);
      parts.push(`\n[Original Task]\n${config.task}`);
    }

    return parts.join('\n');
  }

  private buildEvaluatorPrompt(
    config: EvaluateLoopConfig,
    content: string
  ): string {
    return `[Evaluator Task]

[Pass Criteria]
${config.passCriteria}

[Original Task]
${config.task}

[Content to Evaluate]
---
${content}
---

Please evaluate the above content against the pass criteria.

Respond with:
- APPROVED if ALL criteria are met
- REJECTED if ANY criteria are not met, followed by specific, actionable feedback

Format:
DECISION: APPROVED or REJECTED
FEEDBACK: [Specific feedback or reasons]`;
  }

  private parseDecision(content: string): { approved: boolean; feedback: string } {
    const upperContent = content.toUpperCase();
    
    const decisionMatch = content.match(/DECISION:\s*(APPROVED|REJECTED)/i);
    const feedbackMatch = content.match(/FEEDBACK:\s*([\s\S]+?)(?=DECISION:|$)/i);

    const approved = decisionMatch?.[1]?.toUpperCase() === 'APPROVED' || 
                     upperContent.includes('APPROVED');
    
    let feedback = feedbackMatch?.[1]?.trim() || '';
    if (!feedback) {
      if (approved) {
        feedback = 'Content meets all quality criteria';
      } else {
        const lines = content.split('\n').filter(l => !l.match(/DECISION:/i));
        feedback = lines.join('\n').trim() || 'Content does not meet quality criteria';
      }
    }

    return { approved, feedback };
  }
}

export const defaultEvaluateLoop = new EvaluateLoop();

export async function runEvaluateLoop(
  config: EvaluateLoopConfig,
  runAgent: AgentEvalFunc
): Promise<EvaluateLoopResult> {
  const loop = new EvaluateLoop();
  loop.setAgentRunner(runAgent);
  return loop.run(config);
}
