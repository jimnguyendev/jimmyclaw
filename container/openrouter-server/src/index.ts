/**
 * OpenRouter MCP Server
 *
 * Exposes a `ask` tool that routes queries to a configurable OpenRouter model.
 * Use this for general Q&A, life advice, research — tasks where the primary
 * coding model (Z.ai/GLM) is not suitable.
 *
 * Default model: arcee-ai/trinity-large-preview:free
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'arcee-ai/trinity-large-preview:free';
const BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';

if (!OPENROUTER_API_KEY) {
  process.stderr.write('OPENROUTER_API_KEY not set — openrouter-server will reject all calls\n');
}

const server = new McpServer({
  name: 'openrouter',
  version: '1.0.0',
});

server.tool(
  'ask',
  `Ask a question to ${DEFAULT_MODEL} via OpenRouter. Best for: general knowledge, life advice, ` +
    'research questions, current events, cooking, health, travel, relationships, and any non-coding topics. ' +
    'The primary coding model handles code tasks; use this tool for everything else.',
  {
    prompt: z.string().describe('The question or request'),
    model: z
      .string()
      .optional()
      .describe(`OpenRouter model ID to use. Defaults to ${DEFAULT_MODEL}`),
    system: z
      .string()
      .optional()
      .describe('Optional system prompt to guide the response style'),
  },
  async ({ prompt, model, system }) => {
    if (!OPENROUTER_API_KEY) {
      return { content: [{ type: 'text', text: 'Error: OPENROUTER_API_KEY not configured.' }] };
    }

    const targetModel = model || DEFAULT_MODEL;
    const messages: Array<{ role: string; content: string }> = [];

    if (system) {
      messages.push({ role: 'system', content: system });
    }
    messages.push({ role: 'user', content: prompt });

    try {
      const res = await fetch(BASE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/jimmyclaw',
          'X-Title': 'JimmyClaw',
        },
        body: JSON.stringify({
          model: targetModel,
          messages,
          max_tokens: 2048,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        return { content: [{ type: 'text', text: `OpenRouter error ${res.status}: ${err}` }] };
      }

      const data = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
        model: string;
      };

      const text = data.choices?.[0]?.message?.content ?? '(no response)';
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Request failed: ${msg}` }] };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
