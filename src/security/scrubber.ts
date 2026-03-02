/**
 * Credential Scrubber
 * Automatically redacts sensitive information from outputs.
 */

export interface ScrubRule {
  pattern: RegExp;
  replacement: string;
  description: string;
}

export const DEFAULT_SCRUB_RULES: ScrubRule[] = [
  {
    pattern: /sk-[a-zA-Z0-9]{20,}/g,
    replacement: '[REDACTED_API_KEY]',
    description: 'OpenAI/Anthropic API key',
  },
  {
    pattern: /sk-or-[a-zA-Z0-9]{20,}/g,
    replacement: '[REDACTED_API_KEY]',
    description: 'OpenRouter API key',
  },
  {
    pattern: /xox[baprs]-[a-zA-Z0-9-]+/g,
    replacement: '[REDACTED_TOKEN]',
    description: 'Slack token',
  },
  {
    pattern: /ghp_[a-zA-Z0-9]{36}/g,
    replacement: '[REDACTED_TOKEN]',
    description: 'GitHub personal access token',
  },
  {
    pattern: /gho_[a-zA-Z0-9]{36}/g,
    replacement: '[REDACTED_TOKEN]',
    description: 'GitHub OAuth token',
  },
  {
    pattern: /ghu_[a-zA-Z0-9]{36}/g,
    replacement: '[REDACTED_TOKEN]',
    description: 'GitHub user token',
  },
  {
    pattern: /ghs_[a-zA-Z0-9]{36}/g,
    replacement: '[REDACTED_TOKEN]',
    description: 'GitHub server token',
  },
  {
    pattern: /ghr_[a-zA-Z0-9]{36}/g,
    replacement: '[REDACTED_TOKEN]',
    description: 'GitHub refresh token',
  },
  {
    pattern: /Bearer\s+[a-zA-Z0-9_-]+/gi,
    replacement: 'Bearer [REDACTED]',
    description: 'Bearer token',
  },
  {
    pattern: /Authorization:\s*Bearer\s+[a-zA-Z0-9_-]+/gi,
    replacement: 'Authorization: Bearer [REDACTED]',
    description: 'Authorization header',
  },
  {
    pattern: /api[_-]?key\s*[=:]\s*['"]?[a-zA-Z0-9_-]{20,}['"]?/gi,
    replacement: 'api_key=[REDACTED]',
    description: 'API key in config',
  },
  {
    pattern: /password\s*[=:]\s*['"]?[^'"\s]+['"]?/gi,
    replacement: 'password=[REDACTED]',
    description: 'Password in config',
  },
  {
    pattern: /secret\s*[=:]\s*['"]?[a-zA-Z0-9_-]{16,}['"]?/gi,
    replacement: 'secret=[REDACTED]',
    description: 'Secret in config',
  },
  {
    pattern: /token\s*[=:]\s*['"]?[a-zA-Z0-9_-]{20,}['"]?/gi,
    replacement: 'token=[REDACTED]',
    description: 'Token in config',
  },
  {
    pattern: /[a-f0-9]{32,}/gi,
    replacement: '[REDACTED_HASH]',
    description: 'Hex hash/token',
  },
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b.*password/gi,
    replacement: '[REDACTED_CREDENTIALS]',
    description: 'Email with password',
  },
];

export function scrubCredentials(
  text: string,
  rules: ScrubRule[] = DEFAULT_SCRUB_RULES
): string {
  let result = text;

  for (const { pattern, replacement } of rules) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

export function findCredentials(
  text: string,
  rules: ScrubRule[] = DEFAULT_SCRUB_RULES
): Array<{ match: string; description: string; index: number }> {
  const findings: Array<{ match: string; description: string; index: number }> = [];

  for (const { pattern, description } of rules) {
    let match: RegExpExecArray | null;
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    
    while ((match = globalPattern.exec(text)) !== null) {
      findings.push({
        match: match[0].slice(0, 20) + (match[0].length > 20 ? '...' : ''),
        description,
        index: match.index,
      });
    }
  }

  return findings;
}

export function hasCredentials(text: string, rules: ScrubRule[] = DEFAULT_SCRUB_RULES): boolean {
  return findCredentials(text, rules).length > 0;
}
