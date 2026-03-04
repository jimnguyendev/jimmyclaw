/**
 * /workspace commands — manage additional mounts for agent containers via chat.
 * /model commands    — manage OpenRouter model selection via chat.
 *
 * Usage:
 *   /workspace list              — show current mounts for this group
 *   /workspace add <path>        — mount a directory (read-write by default)
 *   /workspace add <path> ro     — mount read-only
 *   /workspace remove <name>     — remove a mount by containerPath name
 *
 *   /model                       — show current OpenRouter model
 *   /model set <model-id>        — set OpenRouter model for this group
 *   /model reset                 — reset to default model
 */
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { setRegisteredGroup } from './db.js';
import { loadMountAllowlist, validateMount } from './mount-security.js';
import { AdditionalMount, RegisteredGroup } from './types.js';

export interface CommandResult {
  handled: boolean;
  response?: string;
  error?: string;
}

const DEFAULT_OPENROUTER_MODEL = 'arcee-ai/trinity-large-preview:free';

export function isWorkspaceCommand(prompt: string): boolean {
  const t = prompt.trimStart();
  return t.startsWith('/workspace') || t.startsWith('/model');
}

export async function handleWorkspaceCommand(
  prompt: string,
  group: RegisteredGroup & { jid: string },
): Promise<CommandResult> {
  const parts = prompt.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();

  if (cmd === '/model') {
    const sub = parts[1]?.toLowerCase();
    switch (sub) {
      case 'set':
        return cmdModelSet(group, parts[2]);
      case 'reset':
        return cmdModelReset(group);
      case 'embedding':
        return cmdEmbeddingSet(group, parts[2], parts[3]);
      default:
        return cmdModelShow(group);
    }
  }

  // /workspace subcommands
  const sub = parts[1]?.toLowerCase();
  switch (sub) {
    case 'list':
      return cmdList(group);
    case 'add':
      return cmdAdd(group, parts.slice(2));
    case 'remove':
    case 'rm':
      return cmdRemove(group, parts[2]);
    default:
      return {
        handled: true,
        response: `📁 **Workspace commands**
\`/workspace list\` — show mounted directories
\`/workspace add <path>\` — mount a directory (read-write)
\`/workspace add <path> ro\` — mount read-only
\`/workspace remove <name>\` — unmount by name`,
      };
  }
}

function cmdList(group: RegisteredGroup & { jid: string }): CommandResult {
  const mounts = group.containerConfig?.additionalMounts ?? [];
  if (mounts.length === 0) {
    return {
      handled: true,
      response: `📁 No extra workspaces mounted for *${group.name}*.\nUse \`/workspace add <path>\` to add one.`,
    };
  }

  const lines = mounts.map((m) => {
    const name = m.containerPath || path.basename(m.hostPath);
    const rw = m.readonly === false ? 'rw' : 'ro';
    return `• \`/workspace/extra/${name}\` ← \`${m.hostPath}\` (${rw})`;
  });

  return {
    handled: true,
    response: `📁 **Workspaces mounted for ${group.name}:**\n${lines.join('\n')}`,
  };
}

function cmdAdd(group: RegisteredGroup & { jid: string }, args: string[]): CommandResult {
  if (args.length === 0) {
    return { handled: true, response: '❌ Usage: `/workspace add <path> [ro]`' };
  }

  const hostPath = args[0].replace(/^~/, process.env.HOME || '');
  const readonly = args[1]?.toLowerCase() === 'ro' ? true : false;
  const containerPath = path.basename(hostPath);

  // Check allowlist
  const allowlist = loadMountAllowlist();
  if (!allowlist) {
    return {
      handled: true,
      response: `❌ No mount allowlist configured. Create \`~/.config/jimmyclaw/mount-allowlist.json\` first.`,
    };
  }

  const mount: AdditionalMount = { hostPath, containerPath, readonly };
  const isMain = group.folder === 'main';
  const result = validateMount(mount, isMain);

  if (!result.allowed) {
    return { handled: true, response: `❌ Mount rejected: ${result.reason}` };
  }

  // Check duplicate
  const existing = group.containerConfig?.additionalMounts ?? [];
  if (existing.some((m) => m.containerPath === containerPath || m.hostPath === hostPath)) {
    return { handled: true, response: `⚠️ Already mounted as \`${containerPath}\`.` };
  }

  const updated: RegisteredGroup = {
    ...group,
    containerConfig: {
      ...group.containerConfig,
      additionalMounts: [...existing, { hostPath, containerPath, readonly }],
    },
  };

  setRegisteredGroup(group.jid, updated);

  const rw = readonly ? 'read-only' : 'read-write';
  return {
    handled: true,
    response: `✅ Mounted \`${hostPath}\` → \`/workspace/extra/${containerPath}\` (${rw})\nTakes effect on next agent invocation.`,
  };
}

function cmdRemove(group: RegisteredGroup & { jid: string }, name: string): CommandResult {
  if (!name) {
    return { handled: true, response: '❌ Usage: `/workspace remove <name>`' };
  }

  const existing = group.containerConfig?.additionalMounts ?? [];
  const filtered = existing.filter(
    (m) => (m.containerPath || path.basename(m.hostPath)) !== name,
  );

  if (filtered.length === existing.length) {
    return { handled: true, response: `❌ No mount named \`${name}\` found. Use \`/workspace list\` to see current mounts.` };
  }

  const updated: RegisteredGroup = {
    ...group,
    containerConfig: {
      ...group.containerConfig,
      additionalMounts: filtered,
    },
  };

  setRegisteredGroup(group.jid, updated);

  return {
    handled: true,
    response: `✅ Removed mount \`${name}\`. Takes effect on next agent invocation.`,
  };
}

// ── /model commands ──────────────────────────────────────────────────────────

const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const DEFAULT_EMBEDDING_DIM = 1536;

function cmdModelShow(group: RegisteredGroup & { jid: string }): CommandResult {
  const current = group.containerConfig?.openrouterModel ?? DEFAULT_OPENROUTER_MODEL;
  const embedding = group.containerConfig?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
  const dim = group.containerConfig?.embeddingDimension ?? DEFAULT_EMBEDDING_DIM;
  return {
    handled: true,
    response: `🤖 **Models for ${group.name}:**

**General (OpenRouter):** \`${current}\`${!group.containerConfig?.openrouterModel ? ' (default)' : ''}
**Embedding (RAG):** \`${embedding}\` (dim: ${dim})${!group.containerConfig?.embeddingModel ? ' (default)' : ''}

Commands:
\`/model set <id>\` — set OpenRouter model
\`/model embedding <id> [dim]\` — set embedding model
\`/model reset\` — reset both to defaults

Browse free models: https://openrouter.ai/models?q=:free`,
  };
}

function cmdModelSet(group: RegisteredGroup & { jid: string }, modelId: string): CommandResult {
  if (!modelId) {
    return { handled: true, response: '❌ Usage: `/model set <model-id>`\nExample: `/model set google/gemini-2.0-flash-exp:free`' };
  }

  const updated: RegisteredGroup = {
    ...group,
    containerConfig: {
      ...group.containerConfig,
      openrouterModel: modelId,
    },
  };
  setRegisteredGroup(group.jid, updated);

  // Delete settings.json so it gets regenerated with new model on next agent run
  const settingsFile = path.join(DATA_DIR, 'sessions', group.folder, '.claude', 'settings.json');
  if (fs.existsSync(settingsFile)) fs.unlinkSync(settingsFile);

  return {
    handled: true,
    response: `✅ OpenRouter model set to \`${modelId}\` for *${group.name}*.\nTakes effect on next agent invocation.`,
  };
}

function cmdModelReset(group: RegisteredGroup & { jid: string }): CommandResult {
  const updated: RegisteredGroup = {
    ...group,
    containerConfig: {
      ...group.containerConfig,
      openrouterModel: undefined,
      embeddingModel: undefined,
      embeddingDimension: undefined,
    },
  };
  setRegisteredGroup(group.jid, updated);

  const settingsFile = path.join(DATA_DIR, 'sessions', group.folder, '.claude', 'settings.json');
  if (fs.existsSync(settingsFile)) fs.unlinkSync(settingsFile);

  return {
    handled: true,
    response: `✅ Models reset to defaults for *${group.name}*:\n• OpenRouter: \`${DEFAULT_OPENROUTER_MODEL}\`\n• Embedding: \`${DEFAULT_EMBEDDING_MODEL}\``,
  };
}

function cmdEmbeddingSet(
  group: RegisteredGroup & { jid: string },
  modelId: string,
  dimStr?: string,
): CommandResult {
  if (!modelId) {
    return {
      handled: true,
      response: '❌ Usage: `/model embedding <model-id> [dimension]`\nExample: `/model embedding openai/text-embedding-3-large 3072`',
    };
  }

  const dim = dimStr ? parseInt(dimStr, 10) : undefined;
  if (dimStr && isNaN(dim!)) {
    return { handled: true, response: '❌ Dimension must be a number.' };
  }

  const updated: RegisteredGroup = {
    ...group,
    containerConfig: {
      ...group.containerConfig,
      embeddingModel: modelId,
      embeddingDimension: dim,
    },
  };
  setRegisteredGroup(group.jid, updated);

  const settingsFile = path.join(DATA_DIR, 'sessions', group.folder, '.claude', 'settings.json');
  if (fs.existsSync(settingsFile)) fs.unlinkSync(settingsFile);

  const dimNote = dim ? ` (dim: ${dim})` : ' (using model default dimension)';
  return {
    handled: true,
    response: `✅ Embedding model set to \`${modelId}\`${dimNote} for *${group.name}*.\n⚠️ Existing RAG index will need reindex with new embeddings.`,
  };
}
