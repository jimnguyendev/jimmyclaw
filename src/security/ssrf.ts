/**
 * SSRF (Server-Side Request Forgery) Protection
 * Blocks requests to internal/private networks and dangerous hosts.
 */

export interface SSRFRule {
  type: 'host' | 'ip' | 'cidr';
  value: string;
  reason: string;
}

export const BLOCKED_HOSTS: string[] = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  'localtest.me',
  'localtest',
  'metadata.google.internal',
  '169.254.169.254',
  'metadata',
  'kubernetes.default',
  'kubernetes.default.svc',
  'kubernetes.default.svc.cluster.local',
];

export const BLOCKED_IP_PREFIXES: string[] = [
  '10.',
  '172.16.',
  '172.17.',
  '172.18.',
  '172.19.',
  '172.20.',
  '172.21.',
  '172.22.',
  '172.23.',
  '172.24.',
  '172.25.',
  '172.26.',
  '172.27.',
  '172.28.',
  '172.29.',
  '172.30.',
  '172.31.',
  '192.168.',
  '127.',
  '0.',
  '169.254.',
  '224.',
  '225.',
  '226.',
  '227.',
  '228.',
  '229.',
  '230.',
  '231.',
  '232.',
  '233.',
  '234.',
  '235.',
  '236.',
  '237.',
  '238.',
  '239.',
  '240.',
  '241.',
  '242.',
  '243.',
  '244.',
  '245.',
  '246.',
  '247.',
  '248.',
  '249.',
  '250.',
  '251.',
  '252.',
  '253.',
  '254.',
  '255.',
];

export const BLOCKED_PORTS: number[] = [
  22,
  23,
  25,
  110,
  143,
  445,
  993,
  995,
  3306,
  5432,
  6379,
  27017,
];

export interface SSRFCheckResult {
  allowed: boolean;
  reason?: string;
  blockedHost?: string;
  blockedIp?: string;
  blockedPort?: number;
}

function isPrivateIP(ip: string): boolean {
  for (const prefix of BLOCKED_IP_PREFIXES) {
    if (ip.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

function extractHost(urlString: string): string | null {
  try {
    const url = new URL(urlString);
    return url.hostname.toLowerCase();
  } catch {
    const match = urlString.match(/^(?:https?:\/\/)?([^/:]+)/i);
    return match ? match[1].toLowerCase() : null;
  }
}

function extractPort(urlString: string): number | null {
  try {
    const url = new URL(urlString);
    return url.port ? parseInt(url.port, 10) : null;
  } catch {
    const match = urlString.match(/:(\d+)(?:\/|$)/);
    return match ? parseInt(match[1], 10) : null;
  }
}

export function checkSSRF(urlString: string): SSRFCheckResult {
  const host = extractHost(urlString);
  if (!host) {
    return { allowed: false, reason: 'Invalid URL format' };
  }

  if (host === urlString.toLowerCase() && !urlString.includes('.') && !urlString.includes('/')) {
    return { allowed: false, reason: 'Invalid URL: no valid host detected' };
  }

  const blockedHost = BLOCKED_HOSTS.find((h) => host === h || host.endsWith('.' + h));
  if (blockedHost) {
    return {
      allowed: false,
      reason: `Blocked host: ${blockedHost}`,
      blockedHost,
    };
  }

  const blockedPrefix = BLOCKED_IP_PREFIXES.find((p) => host.startsWith(p));
  if (blockedPrefix) {
    return {
      allowed: false,
      reason: `Private IP range: ${host}`,
      blockedIp: host,
    };
  }

  const ipMatch = host.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (ipMatch && isPrivateIP(ipMatch[1])) {
    return {
      allowed: false,
      reason: `Private IP address: ${ipMatch[1]}`,
      blockedIp: ipMatch[1],
    };
  }

  const port = extractPort(urlString);
  if (port !== null && BLOCKED_PORTS.includes(port)) {
    return {
      allowed: false,
      reason: `Blocked port: ${port}`,
      blockedPort: port,
    };
  }

  return { allowed: true };
}

export function isURLAllowed(urlString: string): boolean {
  return checkSSRF(urlString).allowed;
}

export function sanitizeURL(urlString: string): string {
  const result = checkSSRF(urlString);
  if (result.allowed) return urlString;
  
  throw new Error(`SSRF protection: ${result.reason}`);
}

export function getAllowedProtocols(): string[] {
  return ['http:', 'https:'];
}

export function isProtocolAllowed(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return getAllowedProtocols().includes(url.protocol);
  } catch {
    return false;
  }
}
