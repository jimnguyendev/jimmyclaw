import { describe, test, expect, beforeEach } from 'bun:test';
import { QualityGateEngine, parseQualityGates } from './gates.js';
import { EvaluateLoop, runEvaluateLoop } from './evaluate-loop.js';
import { QualityGate, HookContext, EvaluateLoopConfig } from './types.js';

describe('QualityGateEngine', () => {
  let engine: QualityGateEngine;
  const context: HookContext = {
    event: 'output.ready',
    userId: 'user1',
    content: 'Test content',
  };

  beforeEach(() => {
    engine = new QualityGateEngine();
  });

  test('evaluates command gate with exit code 0', async () => {
    engine.setCommandRunner(async () => ({
      exitCode: 0,
      output: 'OK',
    }));

    const gate: QualityGate = {
      event: 'output.ready',
      type: 'command',
      command: 'echo "test"',
      blockOnFailure: true,
      maxRetries: 0,
    };

    const result = await engine.evaluateSingle(gate, context);
    expect(result.passed).toBe(true);
  });

  test('evaluates command gate with non-zero exit code', async () => {
    engine.setCommandRunner(async () => ({
      exitCode: 1,
      output: 'Content too short',
    }));

    const gate: QualityGate = {
      event: 'output.ready',
      type: 'command',
      command: 'check-length',
      blockOnFailure: true,
      maxRetries: 0,
    };

    const result = await engine.evaluateSingle(gate, context);
    expect(result.passed).toBe(false);
    expect(result.feedback).toContain('short');
  });

  test('evaluates agent gate with APPROVED response', async () => {
    engine.setAgentRunner(async () => ({
      content: 'DECISION: APPROVED\nFEEDBACK: Good work',
    }));

    const gate: QualityGate = {
      event: 'output.ready',
      type: 'agent',
      agent: 'reviewer',
      blockOnFailure: true,
      maxRetries: 0,
    };

    const result = await engine.evaluateSingle(gate, context);
    expect(result.passed).toBe(true);
  });

  test('evaluates agent gate with REJECTED response', async () => {
    engine.setAgentRunner(async () => ({
      content: 'DECISION: REJECTED\nFEEDBACK: Needs more detail',
    }));

    const gate: QualityGate = {
      event: 'output.ready',
      type: 'agent',
      agent: 'reviewer',
      blockOnFailure: true,
      maxRetries: 0,
    };

    const result = await engine.evaluateSingle(gate, context);
    expect(result.passed).toBe(false);
    expect(result.feedback).toContain('detail');
  });

  test('skips gates for different events', async () => {
    const gates: QualityGate[] = [
      {
        event: 'delegation.completed',
        type: 'agent',
        agent: 'reviewer',
        blockOnFailure: true,
        maxRetries: 0,
      },
    ];

    const result = await engine.evaluate(gates, context);
    expect(result.passed).toBe(true);
  });

  test('blocks on failure when configured', async () => {
    engine.setAgentRunner(async () => ({
      content: 'REJECTED',
    }));

    const gates: QualityGate[] = [
      {
        event: 'output.ready',
        type: 'agent',
        agent: 'reviewer',
        blockOnFailure: true,
        maxRetries: 0,
      },
    ];

    const result = await engine.evaluate(gates, context);
    expect(result.passed).toBe(false);
  });

  test('continues on failure when not blocking', async () => {
    engine.setAgentRunner(async () => ({
      content: 'REJECTED',
    }));

    const gates: QualityGate[] = [
      {
        event: 'output.ready',
        type: 'agent',
        agent: 'reviewer',
        blockOnFailure: false,
        maxRetries: 0,
      },
    ];

    const result = await engine.evaluate(gates, context);
    expect(result.passed).toBe(true);
  });

  test('evaluateWithRetry retries on failure', async () => {
    let callCount = 0;
    engine.setAgentRunner(async () => {
      callCount++;
      if (callCount < 3) {
        return { content: 'DECISION: REJECTED\nFEEDBACK: Try again' };
      }
      return { content: 'DECISION: APPROVED\nFEEDBACK: Good now' };
    });

    const gate: QualityGate = {
      event: 'output.ready',
      type: 'agent',
      agent: 'reviewer',
      blockOnFailure: true,
      maxRetries: 3,
    };

    let revisedContent = context.content;
    const result = await engine.evaluateWithRetry(
      gate,
      context,
      3,
      async (feedback) => {
        revisedContent = `Revised: ${feedback}`;
        return revisedContent;
      }
    );

    expect(result.passed).toBe(true);
    expect(callCount).toBe(3);
  });
});

describe('parseQualityGates', () => {
  test('parses valid gates config', () => {
    const config = {
      quality_gates: [
        {
          event: 'output.ready',
          type: 'agent',
          agent: 'reviewer',
          blockOnFailure: true,
          maxRetries: 2,
        },
      ],
    };

    const gates = parseQualityGates(config);
    expect(gates.length).toBe(1);
    expect(gates[0].event).toBe('output.ready');
    expect(gates[0].agent).toBe('reviewer');
  });

  test('returns empty array for invalid config', () => {
    expect(parseQualityGates(null)).toEqual([]);
    expect(parseQualityGates(undefined)).toEqual([]);
    expect(parseQualityGates({})).toEqual([]);
    expect(parseQualityGates({ quality_gates: 'invalid' })).toEqual([]);
  });
});

describe('EvaluateLoop', () => {
  let loop: EvaluateLoop;

  beforeEach(() => {
    loop = new EvaluateLoop();
  });

  test('approves on first round', async () => {
    loop.setAgentRunner(async (agentKey) => {
      if (agentKey === 'reviewer') {
        return { content: 'DECISION: APPROVED\nFEEDBACK: Perfect' };
      }
      return { content: 'Generated content' };
    });

    const config: EvaluateLoopConfig = {
      generator: 'writer',
      evaluator: 'reviewer',
      task: 'Write a summary',
      passCriteria: 'Must be concise and accurate',
      maxRounds: 3,
    };

    const result = await loop.run(config);
    expect(result.approved).toBe(true);
    expect(result.rounds).toBe(1);
  });

  test('rejects after max rounds', async () => {
    loop.setAgentRunner(async (agentKey) => {
      if (agentKey === 'reviewer') {
        return { content: 'DECISION: REJECTED\nFEEDBACK: Not good enough' };
      }
      return { content: 'Generated content' };
    });

    const config: EvaluateLoopConfig = {
      generator: 'writer',
      evaluator: 'reviewer',
      task: 'Write a summary',
      passCriteria: 'Must be perfect',
      maxRounds: 3,
    };

    const result = await loop.run(config);
    expect(result.approved).toBe(false);
    expect(result.rounds).toBe(3);
    expect(result.feedback).toContain('Max rounds');
  });

  test('approves after revision', async () => {
    let evalCount = 0;
    loop.setAgentRunner(async (agentKey) => {
      if (agentKey === 'reviewer') {
        evalCount++;
        if (evalCount < 2) {
          return { content: 'DECISION: REJECTED\nFEEDBACK: Add more detail' };
        }
        return { content: 'DECISION: APPROVED\nFEEDBACK: Good now' };
      }
      return { content: 'Generated content' };
    });

    const config: EvaluateLoopConfig = {
      generator: 'writer',
      evaluator: 'reviewer',
      task: 'Write a summary',
      passCriteria: 'Must be detailed',
      maxRounds: 3,
    };

    const result = await loop.run(config);
    expect(result.approved).toBe(true);
    expect(result.rounds).toBe(2);
  });

  test('limits max rounds to 5', async () => {
    loop.setAgentRunner(async () => ({
      content: 'DECISION: REJECTED\nFEEDBACK: Try again',
    }));

    const config: EvaluateLoopConfig = {
      generator: 'writer',
      evaluator: 'reviewer',
      task: 'Write a summary',
      passCriteria: 'Must be perfect',
      maxRounds: 10,
    };

    const result = await loop.run(config);
    expect(result.rounds).toBe(5);
  });

  test('throws without agent runner', async () => {
    const config: EvaluateLoopConfig = {
      generator: 'writer',
      evaluator: 'reviewer',
      task: 'Write',
      passCriteria: 'Good',
      maxRounds: 3,
    };

    await expect(loop.run(config)).rejects.toThrow('No agent runner');
  });
});

describe('runEvaluateLoop helper', async () => {
  test('runs evaluate loop with provided runner', async () => {
    const config: EvaluateLoopConfig = {
      generator: 'writer',
      evaluator: 'reviewer',
      task: 'Write',
      passCriteria: 'Good',
      maxRounds: 3,
    };

    const result = await runEvaluateLoop(config, async () => ({
      content: 'DECISION: APPROVED\nFEEDBACK: Good',
    }));

    expect(result.approved).toBe(true);
  });
});
