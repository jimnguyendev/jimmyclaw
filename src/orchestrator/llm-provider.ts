import {
  LLMConfig,
  LLMResponse,
  LLMStreamChunk,
  LLMProvider,
  PartialLLMConfig,
  resolveModel,
  calculateCost,
  DEFAULT_FREE_MODEL,
} from './llm-types.js';
import { logger } from '../logger.js';

export class LLMProviderService {
  private openCodePath: string;
  private apiKeyCache: Map<string, string> = new Map();

  constructor() {
    this.openCodePath = process.env.OPENCODE_PATH || '/Users/macos/.opencode/bin/opencode';
  }

  async generate(config: LLMConfig, prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    const resolved = resolveModel(config.model);
    if (!resolved) {
      throw new Error(`Unknown model: ${config.model}`);
    }

    const { provider, modelName } = resolved;

    try {
      switch (provider) {
        case 'opencode':
          return await this.callOpenCode(modelName, prompt, systemPrompt, config);
        case 'google':
          return await this.callGoogleGemini(modelName, prompt, systemPrompt, config);
        case 'groq':
          return await this.callGroq(modelName, prompt, systemPrompt, config);
        case 'anthropic':
          return await this.callAnthropic(modelName, prompt, systemPrompt, config);
        default:
          return await this.callOpenCode(modelName, prompt, systemPrompt, config);
      }
    } catch (error) {
      logger.error({ provider, model: modelName, error }, 'LLM call failed');
      throw error;
    }
  }

  async *generateStream(
    config: LLMConfig,
    prompt: string,
    systemPrompt?: string,
  ): AsyncGenerator<LLMStreamChunk> {
    const resolved = resolveModel(config.model);
    if (!resolved) {
      throw new Error(`Unknown model: ${config.model}`);
    }

    const { provider, modelName } = resolved;

    switch (provider) {
      case 'opencode':
        yield* this.streamOpenCode(modelName, prompt, systemPrompt, config);
        break;
      case 'google':
        yield* this.streamGoogleGemini(modelName, prompt, systemPrompt, config);
        break;
      default:
        const response = await this.generate(config, prompt, systemPrompt);
        yield { content: response.content, done: true, tokensUsed: response.tokensUsed?.total };
    }
  }

  private async callOpenCode(
    model: string,
    prompt: string,
    systemPrompt?: string,
    config?: LLMConfig,
  ): Promise<LLMResponse> {
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    const timeout = config?.timeoutMs || 120000;

    const args = ['run', '-m', model, '--format', 'json', fullPrompt];

    logger.debug({ model, args }, 'Calling OpenCode');

    try {
      const proc = Bun.spawn([this.openCodePath, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, NO_COLOR: '1' },
        timeout,
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        logger.error({ model, exitCode, stderr }, 'OpenCode failed');
        throw new Error(`OpenCode exited with code ${exitCode}: ${stderr.slice(0, 200)}`);
      }

      return this.parseOpenCodeOutput(stdout);
    } catch (error) {
      logger.error({ model, error }, 'OpenCode call error');
      throw error;
    }
  }

  private parseOpenCodeOutput(output: string): LLMResponse {
    const lines = output.trim().split('\n');
    let content = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: LLMResponse['finishReason'] = 'stop';

    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const parsed = JSON.parse(line);
        
        if (parsed.type === 'text' && parsed.part?.text) {
          content += parsed.part.text;
        }
        
        if (parsed.type === 'step_finish' && parsed.part?.tokens) {
          inputTokens = parsed.part.tokens.input || 0;
          outputTokens = parsed.part.tokens.output || 0;
          finishReason = parsed.part.reason === 'stop' ? 'stop' : 'length';
        }
      } catch {
        // Not JSON, skip
      }
    }

    const totalTokens = inputTokens + outputTokens;
    const cost = calculateCost('opencode', inputTokens, outputTokens);

    return {
      content: content.trim(),
      tokensUsed: { input: inputTokens, output: outputTokens, total: totalTokens },
      cost,
      model: 'opencode',
      provider: 'opencode',
      finishReason,
    };
  }

  private async *streamOpenCode(
    model: string,
    prompt: string,
    systemPrompt?: string,
    config?: LLMConfig,
  ): AsyncGenerator<LLMStreamChunk> {
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    const timeout = config?.timeoutMs || 120000;

    const args = ['run', '-m', model, '--format', 'json', fullPrompt];

    const proc = Bun.spawn([this.openCodePath, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, NO_COLOR: '1' },
      timeout,
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'text' && parsed.part?.text) {
              yield { content: parsed.part.text, done: false };
            }
          } catch {
            // Not JSON, skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { content: '', done: true };
  }

  private async callGoogleGemini(
    model: string,
    prompt: string,
    systemPrompt?: string,
    config?: LLMConfig,
  ): Promise<LLMResponse> {
    const apiKey = await this.getApiKey('GOOGLE_API_KEY');
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY not configured');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const body = {
      contents: [
        {
          parts: [{ text: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt }],
        },
      ],
      generationConfig: {
        temperature: config?.temperature ?? 0.7,
        maxOutputTokens: config?.maxTokens ?? 8192,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const content = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    const inputTokens = data.usageMetadata?.promptTokenCount || 0;
    const outputTokens = data.usageMetadata?.candidatesTokenCount || 0;

    return {
      content,
      tokensUsed: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
      cost: calculateCost(model, inputTokens, outputTokens),
      model,
      provider: 'google',
      finishReason: (data.candidates?.[0]?.finishReason as LLMResponse['finishReason']) || 'stop',
    };
  }

  private async *streamGoogleGemini(
    model: string,
    prompt: string,
    systemPrompt?: string,
    config?: LLMConfig,
  ): AsyncGenerator<LLMStreamChunk> {
    const apiKey = await this.getApiKey('GOOGLE_API_KEY');
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY not configured');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

    const body = {
      contents: [
        {
          parts: [{ text: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt }],
        },
      ],
      generationConfig: {
        temperature: config?.temperature ?? 0.7,
        maxOutputTokens: config?.maxTokens ?? 8192,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        try {
          const data = JSON.parse(line.slice(6));
          const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (content) {
            yield { content, done: false };
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    yield { content: '', done: true };
  }

  private async callGroq(
    model: string,
    prompt: string,
    systemPrompt?: string,
    config?: LLMConfig,
  ): Promise<LLMResponse> {
    const apiKey = await this.getApiKey('GROQ_API_KEY');
    if (!apiKey) {
      throw new Error('GROQ_API_KEY not configured');
    }

    const url = 'https://api.groq.com/openai/v1/chat/completions';

    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const body = {
      model,
      messages,
      temperature: config?.temperature ?? 0.7,
      max_tokens: config?.maxTokens ?? 8192,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const content = data.choices?.[0]?.message?.content || '';
    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;

    return {
      content,
      tokensUsed: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
      cost: calculateCost(model, inputTokens, outputTokens),
      model,
      provider: 'groq',
      finishReason: (data.choices?.[0]?.finish_reason as LLMResponse['finishReason']) || 'stop',
    };
  }

  private async callAnthropic(
    model: string,
    prompt: string,
    systemPrompt?: string,
    config?: LLMConfig,
  ): Promise<LLMResponse> {
    const apiKey = await this.getApiKey('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const url = 'https://api.anthropic.com/v1/messages';

    const body = {
      model,
      max_tokens: config?.maxTokens ?? 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string;
    };

    const content = data.content?.filter((c) => c.type === 'text').map((c) => c.text).join('') || '';
    const inputTokens = data.usage?.input_tokens || 0;
    const outputTokens = data.usage?.output_tokens || 0;

    return {
      content,
      tokensUsed: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
      cost: calculateCost(model, inputTokens, outputTokens),
      model,
      provider: 'anthropic',
      finishReason: (data.stop_reason as LLMResponse['finishReason']) || 'stop',
    };
  }

  private async getApiKey(keyName: string): Promise<string | undefined> {
    if (this.apiKeyCache.has(keyName)) {
      return this.apiKeyCache.get(keyName);
    }

    const key = process.env[keyName];
    if (key) {
      this.apiKeyCache.set(keyName, key);
      return key;
    }

    return undefined;
  }

  async generateWithFallback(
    models: string[],
    prompt: string,
    systemPrompt?: string,
    config?: PartialLLMConfig,
  ): Promise<LLMResponse> {
    const errors: Error[] = [];

    for (const model of models) {
      try {
        return await this.generate({ ...config, provider: config?.provider ?? 'opencode', model }, prompt, systemPrompt);
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
        logger.warn({ model, error }, 'Model failed, trying next');
      }
    }

    throw new Error(`All models failed: ${errors.map((e) => e.message).join('; ')}`);
  }
}

export const llmProvider = new LLMProviderService();
