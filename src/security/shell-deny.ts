/**
 * Shell Command Deny Patterns
 * Blocks potentially dangerous shell command patterns.
 * Ported from GoClaw's security hardening.
 */

export interface DenyRule {
  pattern: RegExp;
  reason: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export const SHELL_DENY_PATTERNS: DenyRule[] = [
  {
    pattern: /\|\s*(sh|bash|zsh|fish|dash|ksh)\b/,
    reason: 'Pipe to shell interpreter',
    severity: 'critical',
  },
  {
    pattern: /\|\s*(sudo\s+)?(sh|bash|zsh|fish|dash|ksh)\b/,
    reason: 'Pipe to privileged shell',
    severity: 'critical',
  },
  {
    pattern: /curl\s+.*\|\s*(sh|bash|zsh)/,
    reason: 'Remote code execution via curl|sh',
    severity: 'critical',
  },
  {
    pattern: /wget\s+.*\|\s*(sh|bash|zsh)/,
    reason: 'Remote code execution via wget|sh',
    severity: 'critical',
  },
  {
    pattern: /eval\s+\$\(/,
    reason: 'Eval with command substitution',
    severity: 'critical',
  },
  {
    pattern: /\$\([^)]*\)\s*\|/,
    reason: 'Command substitution piped',
    severity: 'high',
  },
  {
    pattern: /base64\s+.*\|\s*(sh|bash|zsh)/,
    reason: 'Obfuscated code execution',
    severity: 'critical',
  },
  {
    pattern: />\s*\/dev\/tcp\//,
    reason: 'Reverse shell via /dev/tcp',
    severity: 'critical',
  },
  {
    pattern: />\s*[&]?\s*\/dev\/tcp\//,
    reason: 'Reverse shell via /dev/tcp',
    severity: 'critical',
  },
  {
    pattern: />&\s*\/dev\/tcp\//,
    reason: 'Reverse shell via /dev/tcp with redirect',
    severity: 'critical',
  },
  {
    pattern: />\s*\/dev\/udp\//,
    reason: 'Reverse shell via /dev/udp',
    severity: 'critical',
  },
  {
    pattern: /nc\s+.*-e\s+(\/bin\/)?(sh|bash)/,
    reason: 'Netcat reverse shell',
    severity: 'critical',
  },
  {
    pattern: /ncat\s+.*--(sh|bash)-exec/,
    reason: 'Ncat reverse shell',
    severity: 'critical',
  },
  {
    pattern: /python\s+-c\s+['"]import\s+socket/,
    reason: 'Python reverse shell',
    severity: 'critical',
  },
  {
    pattern: /perl\s+-e\s+['"]use\s+Socket/,
    reason: 'Perl reverse shell',
    severity: 'critical',
  },
  {
    pattern: /ruby\s+-e\s+['"]require\s+['"]socket/,
    reason: 'Ruby reverse shell',
    severity: 'critical',
  },
  {
    pattern: /php\s+-r\s+['"].*fsockopen/,
    reason: 'PHP reverse shell',
    severity: 'critical',
  },
  {
    pattern: /rm\s+-rf\s+\//,
    reason: 'Destructive filesystem command',
    severity: 'critical',
  },
  {
    pattern: /mkfs\s+/,
    reason: 'Filesystem formatting',
    severity: 'critical',
  },
  {
    pattern: /dd\s+.*of=\/dev\//,
    reason: 'Disk overwrite',
    severity: 'critical',
  },
  {
    pattern: /:\(\)\{\s*:\|:&\s*\}\s*;/,
    reason: 'Fork bomb',
    severity: 'high',
  },
  {
    pattern: /chmod\s+[0-7]*777\s+\//,
    reason: 'World-writable permissions',
    severity: 'medium',
  },
  {
    pattern: /chown\s+.*:.*\s+\//,
    reason: 'Ownership change on root path',
    severity: 'medium',
  },
  {
    pattern: /sudo\s+chmod\s+/,
    reason: 'Privileged chmod',
    severity: 'medium',
  },
  {
    pattern: /sudo\s+rm\s+/,
    reason: 'Privileged removal',
    severity: 'high',
  },
  {
    pattern: />\s*\/etc\/passwd/,
    reason: 'Password file modification',
    severity: 'critical',
  },
  {
    pattern: />\s*\/etc\/shadow/,
    reason: 'Shadow file modification',
    severity: 'critical',
  },
  {
    pattern: /\/etc\/sudoers/,
    reason: 'Sudoers modification attempt',
    severity: 'critical',
  },
];

export interface ShellCheckResult {
  allowed: boolean;
  denied: DenyRule[];
  highestSeverity: 'none' | 'low' | 'medium' | 'high' | 'critical';
}

const SEVERITY_ORDER = ['none', 'low', 'medium', 'high', 'critical'] as const;

export function checkShellCommand(command: string): ShellCheckResult {
  const denied: DenyRule[] = [];
  let highestSeverity: ShellCheckResult['highestSeverity'] = 'none';

  for (const rule of SHELL_DENY_PATTERNS) {
    if (rule.pattern.test(command)) {
      denied.push(rule);
      
      if (SEVERITY_ORDER.indexOf(rule.severity) > SEVERITY_ORDER.indexOf(highestSeverity)) {
        highestSeverity = rule.severity;
      }
    }
  }

  return {
    allowed: denied.length === 0,
    denied,
    highestSeverity,
  };
}

export function isShellCommandAllowed(command: string): boolean {
  return checkShellCommand(command).allowed;
}

export function formatDenyReasons(result: ShellCheckResult): string {
  if (result.allowed) return '';

  const lines = result.denied.map(
    (r) => `[${r.severity.toUpperCase()}] ${r.reason}`
  );
  return `Shell command blocked:\n${lines.join('\n')}`;
}

export function sanitizeCommand(command: string): string {
  const result = checkShellCommand(command);
  if (result.allowed) return command;
  
  throw new Error(formatDenyReasons(result));
}
