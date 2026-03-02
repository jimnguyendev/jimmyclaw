/**
 * Security Module
 * Provides comprehensive security hardening inspired by GoClaw.
 */

export { RateLimiter, TokenBucket } from './rate-limiter.js';
export {
  detectInjection,
  hasInjection,
  getHighSeverityInjections,
  formatInjectionWarning,
  INJECTION_PATTERNS,
  type InjectionMatch,
} from './injection-detect.js';
export {
  scrubCredentials,
  findCredentials,
  hasCredentials,
  DEFAULT_SCRUB_RULES,
  type ScrubRule,
} from './scrubber.js';
export {
  checkShellCommand,
  isShellCommandAllowed,
  formatDenyReasons,
  sanitizeCommand,
  SHELL_DENY_PATTERNS,
  type DenyRule,
  type ShellCheckResult,
} from './shell-deny.js';
export {
  checkSSRF,
  isURLAllowed,
  sanitizeURL,
  getAllowedProtocols,
  isProtocolAllowed,
  BLOCKED_HOSTS,
  BLOCKED_IP_PREFIXES,
  BLOCKED_PORTS,
  type SSRFCheckResult,
} from './ssrf.js';

import { RateLimiter } from './rate-limiter.js';
import { detectInjection, type InjectionMatch } from './injection-detect.js';
import { scrubCredentials, findCredentials } from './scrubber.js';
import { checkShellCommand, ShellCheckResult } from './shell-deny.js';
import { checkSSRF, SSRFCheckResult } from './ssrf.js';

export interface SecurityCheckResult {
  allowed: boolean;
  injections: InjectionMatch[];
  credentials: Array<{ match: string; description: string }>;
  shell: ShellCheckResult;
  ssrf: SSRFCheckResult;
}

export function comprehensiveCheck(
  input: string,
  options: {
    checkInjection?: boolean;
    checkCredentials?: boolean;
    checkShell?: boolean;
    checkSSRF?: boolean;
  } = {}
): SecurityCheckResult {
  const {
    checkInjection: doInjection = true,
    checkCredentials: doCredentials = true,
    checkShell: doShell = false,
    checkSSRF: doSSRF = false,
  } = options;

  const injections = doInjection ? detectInjection(input) : [];
  const credentials = doCredentials ? findCredentials(input) : [];
  const shell = doShell ? checkShellCommand(input) : { allowed: true, denied: [], highestSeverity: 'none' as const };
  const ssrf = doSSRF ? checkSSRF(input) : { allowed: true };

  const allowed =
    injections.length === 0 &&
    credentials.length === 0 &&
    shell.allowed &&
    ssrf.allowed;

  return {
    allowed,
    injections,
    credentials,
    shell,
    ssrf,
  };
}

export class SecurityMiddleware {
  private rateLimiter: RateLimiter | null;
  private readonly logWarnings: boolean;

  constructor(
    options: {
      rateLimitPerHour?: number;
      logWarnings?: boolean;
    } = {}
  ) {
    this.rateLimiter = options.rateLimitPerHour
      ? new RateLimiter(options.rateLimitPerHour)
      : null;
    this.logWarnings = options.logWarnings ?? true;
  }

  checkRateLimit(key: string): boolean {
    if (!this.rateLimiter) return true;
    return this.rateLimiter.allow(key);
  }

  checkInput(input: string): InjectionMatch[] {
    const injections = detectInjection(input);
    if (injections.length > 0 && this.logWarnings) {
      console.warn('[Security] Potential injection detected:', {
        patterns: injections.map((i) => i.pattern),
        input: input.slice(0, 100),
      });
    }
    return injections;
  }

  scrubOutput(output: string): string {
    return scrubCredentials(output);
  }

  checkShellCommand(command: string): boolean {
    return checkShellCommand(command).allowed;
  }

  checkURL(url: string): boolean {
    return checkSSRF(url).allowed;
  }

  stop(): void {
    this.rateLimiter?.stop();
  }
}
