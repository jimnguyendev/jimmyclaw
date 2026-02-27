/**
 * Step: api-key — Configure API key for Claude/Z.ai/Anthropic
 * Interactive prompt to collect and save API key to .env
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';

import { logger } from '../src/logger.js';
import { emitStatus } from './status.js';
import { readEnvFile } from '../src/env.js';

/**
 * Prompt user for input (hidden for passwords/secrets)
 */
function prompt(question: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    if (hidden) {
      // For hidden input, we need to use a different approach
      // This works on Unix-like systems
      const { stdin, stdout } = process;
      stdout.write(question);

      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');

      let password = '';
      const onData = (char: string) => {
        if (char === '\n' || char === '\r' || char === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          stdout.write('\n');
          rl.close();
          resolve(password);
        } else if (char === '\u0003') {
          // Ctrl+C
          process.exit(0);
        } else if (char === '\u007f') {
          // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
          }
        } else {
          password += char;
        }
      };

      stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

/**
 * Check if key is already set in .env
 */
function isKeySet(key: string): boolean {
  const env = readEnvFile([key]);
  return !!env[key];
}

/**
 * Write key to .env file
 */
function writeKey(key: string, value: string): void {
  const envPath = path.join(process.cwd(), '.env');
  let content = '';

  // Read existing content
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf-8');
  }

  // Check if key already exists
  const lines = content.split('\n');
  let keyFound = false;
  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return line;
    const existingKey = trimmed.slice(0, eqIdx).trim();
    if (existingKey === key) {
      keyFound = true;
      return `${key}=${value}`;
    }
    return line;
  });

  // If key wasn't found, append it
  if (!keyFound) {
    // Add a newline if file doesn't end with one
    if (content && !content.endsWith('\n')) {
      updatedLines.push('');
    }
    updatedLines.push(`${key}=${value}`);
  }

  // Write back to file
  fs.writeFileSync(envPath, updatedLines.join('\n') + '\n');
}

export async function run(args: string[]): Promise<void> {
  logger.info('Starting API key configuration');

  // Parse args for provider selection
  const providerIdx = args.indexOf('--provider');
  const keyIdx = args.indexOf('--key');
  const forceIdx = args.indexOf('--force');

  const force = forceIdx !== -1;
  let selectedProvider = providerIdx !== -1 ? args[providerIdx + 1] : null;
  let providedKey = keyIdx !== -1 ? args[keyIdx + 1] : null;

  // Check existing keys
  const hasZaiKey = isKeySet('Z_AI_API_KEY');
  const hasClaudeToken = isKeySet('CLAUDE_CODE_OAUTH_TOKEN');
  const hasAnthropicKey = isKeySet('ANTHROPIC_API_KEY');

  if (!force && (hasZaiKey || hasClaudeToken || hasAnthropicKey)) {
    const existing: string[] = [];
    if (hasZaiKey) existing.push('Z.ai');
    if (hasClaudeToken) existing.push('Claude Subscription');
    if (hasAnthropicKey) existing.push('Anthropic API');

    console.log(`\nExisting API keys found: ${existing.join(', ')}`);
    const reconfigure = await prompt('Do you want to reconfigure? (y/N): ');

    if (reconfigure.toLowerCase() !== 'y') {
      console.log('Skipping API key configuration.');
      emitStatus('API_KEY', {
        STATUS: 'skipped',
        MESSAGE: 'Existing keys found, user chose to skip',
      });
      return;
    }
  }

  // Select provider if not specified
  if (!selectedProvider) {
    console.log('\n=== API Provider Selection ===');
    console.log('1. Z.ai (Recommended)');
    console.log('   - Cost-effective alternative');
    console.log('   - Includes MCP servers (Vision, Search, Reader)');
    console.log('   - Get key at: https://z.ai/manage-apikey/apikey-list');
    console.log('');
    console.log('2. Claude Subscription (Pro/Max)');
    console.log('   - Use claude setup-token to get OAuth token');
    console.log('');
    console.log('3. Anthropic API Key');
    console.log('   - Direct API access');
    console.log('   - Get key at: https://console.anthropic.com/');
    console.log('');

    const choice = await prompt('Select provider (1-3): ');

    switch (choice.trim()) {
      case '1':
        selectedProvider = 'zai';
        break;
      case '2':
        selectedProvider = 'claude';
        break;
      case '3':
        selectedProvider = 'anthropic';
        break;
      default:
        console.log('Invalid choice. Exiting.');
        emitStatus('API_KEY', {
          STATUS: 'failed',
          ERROR: 'Invalid provider choice',
        });
        process.exit(1);
    }
  }

  // Get API key based on provider
  if (!providedKey) {
    switch (selectedProvider) {
      case 'zai':
        console.log('\n=== Z.ai API Key ===');
        console.log('Get your key at: https://z.ai/manage-apikey/apikey-list');
        providedKey = await prompt('Enter Z.ai API key: ', true);
        break;

      case 'claude':
        console.log('\n=== Claude Subscription ===');
        console.log('Run this in another terminal:');
        console.log('  claude setup-token');
        console.log('');
        providedKey = await prompt('Enter OAuth token: ', true);
        break;

      case 'anthropic':
        console.log('\n=== Anthropic API Key ===');
        console.log('Get your key at: https://console.anthropic.com/');
        providedKey = await prompt('Enter API key: ', true);
        break;

      default:
        console.log(`Unknown provider: ${selectedProvider}`);
        emitStatus('API_KEY', {
          STATUS: 'failed',
          ERROR: `Unknown provider: ${selectedProvider}`,
        });
        process.exit(1);
    }
  }

  // Validate key
  if (!providedKey || providedKey.length < 10) {
    console.log('Invalid API key. Key must be at least 10 characters.');
    emitStatus('API_KEY', {
      STATUS: 'failed',
      ERROR: 'Invalid API key',
    });
    process.exit(1);
  }

  // Write to .env
  let keyName: string;
  switch (selectedProvider) {
    case 'zai':
      keyName = 'Z_AI_API_KEY';
      break;
    case 'claude':
      keyName = 'CLAUDE_CODE_OAUTH_TOKEN';
      break;
    case 'anthropic':
      keyName = 'ANTHROPIC_API_KEY';
      break;
    default:
      keyName = 'ANTHROPIC_API_KEY';
  }

  writeKey(keyName, providedKey);

  console.log(`\n✓ API key saved to .env as ${keyName}`);

  if (selectedProvider === 'zai') {
    console.log('');
    console.log('Z.ai MCP servers will be automatically enabled:');
    console.log('  - Vision MCP: UI screenshots, OCR, diagrams, video analysis');
    console.log('  - Web Search MCP: Real-time web search');
    console.log('  - Web Reader MCP: Fetch and parse web pages');
  }

  logger.info({ provider: selectedProvider, keyName }, 'API key configured successfully');

  emitStatus('API_KEY', {
    STATUS: 'success',
    PROVIDER: selectedProvider,
    KEY_NAME: keyName,
  });
}
