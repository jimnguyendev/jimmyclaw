/**
 * Prompt Injection Detection
 * Scans input for potential prompt injection patterns.
 * Detection-only: logs warnings but does NOT block (per GoClaw approach).
 */

export interface InjectionMatch {
  pattern: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export const INJECTION_PATTERNS: Array<{
  pattern: RegExp;
  description: string;
  severity: 'low' | 'medium' | 'high';
}> = [
  {
    pattern: /ignore (all )?(previous|above|prior) instructions?/i,
    description: 'Attempt to ignore previous context',
    severity: 'high',
  },
  {
    pattern: /disregard (all )?(previous|above|prior)/i,
    description: 'Attempt to disregard context',
    severity: 'high',
  },
  {
    pattern: /forget (everything|all|previous)/i,
    description: 'Attempt to forget context',
    severity: 'medium',
  },
  {
    pattern: /you are now (a|an|the)\s+\w+/i,
    description: 'Role manipulation attempt',
    severity: 'medium',
  },
  {
    pattern: /act as (if|though|a|an)\s+/i,
    description: 'Role manipulation attempt',
    severity: 'medium',
  },
  {
    pattern: /\[(SYSTEM|ADMIN|ROOT|DEVELOPER|MODERATOR)\]/i,
    description: 'Fake system tags',
    severity: 'high',
  },
  {
    pattern: /\<\|.*?\|\>/,
    description: 'Special token injection',
    severity: 'high',
  },
  {
    pattern: /```system\s*\n/i,
    description: 'System code block injection',
    severity: 'medium',
  },
  {
    pattern: /<system>/i,
    description: 'System tag injection',
    severity: 'medium',
  },
  {
    pattern: /override (your|the) (instructions|rules|guidelines)/i,
    description: 'Instruction override attempt',
    severity: 'high',
  },
  {
    pattern: /new (instructions|rules|directives)\s*:/i,
    description: 'New instructions injection',
    severity: 'high',
  },
  {
    pattern: /your (new|real|true) (task|mission|goal) (is|was)/i,
    description: 'Task redefinition attempt',
    severity: 'medium',
  },
];

export function detectInjection(input: string): InjectionMatch[] {
  const matches: InjectionMatch[] = [];

  for (const { pattern, description, severity } of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      matches.push({
        pattern: pattern.source,
        description,
        severity,
      });
    }
  }

  return matches;
}

export function hasInjection(input: string): boolean {
  return detectInjection(input).length > 0;
}

export function getHighSeverityInjections(input: string): InjectionMatch[] {
  return detectInjection(input).filter((m) => m.severity === 'high');
}

export function formatInjectionWarning(matches: InjectionMatch[]): string {
  if (matches.length === 0) return '';

  const lines = matches.map(
    (m) => `[${m.severity.toUpperCase()}] ${m.description} (pattern: ${m.pattern})`
  );
  return `Potential prompt injection detected:\n${lines.join('\n')}`;
}
