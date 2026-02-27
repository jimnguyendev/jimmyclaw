import fs from 'fs';
import path from 'path';

interface Extraction {
  type: 'decision' | 'preference' | 'task';
  text: string;
  context: string;
}

const DECISION_PATTERNS = [
  /(?:decided|agreed|will do|going with|quyết định|sẽ làm|let's go with|we'll use|chosen|picked)\s+(.{10,200})/gi,
];

const PREFERENCE_PATTERNS = [
  /(?:prefer|like|don't like|always|never|thích|không thích|rather|instead of)\s+(.{10,200})/gi,
];

const TASK_PATTERNS = [
  /(?:TODO|need to|should|action item|cần làm|nhớ|remember to|don't forget)\s*:?\s*(.{10,200})/gi,
];

function extractFromText(text: string): Extraction[] {
  const extractions: Extraction[] = [];

  for (const pattern of DECISION_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      extractions.push({ type: 'decision', text: match[0].trim(), context: getSurrounding(text, match.index) });
    }
  }

  for (const pattern of PREFERENCE_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      extractions.push({ type: 'preference', text: match[0].trim(), context: getSurrounding(text, match.index) });
    }
  }

  for (const pattern of TASK_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      extractions.push({ type: 'task', text: match[0].trim(), context: getSurrounding(text, match.index) });
    }
  }

  return extractions;
}

function getSurrounding(text: string, index: number): string {
  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + 250);
  return text.slice(start, end).replace(/\n/g, ' ').trim();
}

function isDuplicate(existing: string, newEntry: string): boolean {
  const normNew = newEntry.toLowerCase().trim();
  const lines = existing.split('\n');
  for (const line of lines) {
    const normLine = line.toLowerCase().trim();
    if (normLine.includes(normNew) || normNew.includes(normLine)) {
      if (normLine.length > 20) return true;
    }
  }
  return false;
}

function appendToFile(filePath: string, entries: string[]): number {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  let appended = 0;

  for (const entry of entries) {
    if (!isDuplicate(existing, entry)) {
      fs.appendFileSync(filePath, entry + '\n');
      appended++;
    }
  }

  return appended;
}

export function extractFromTranscript(transcriptContent: string, sourceFile: string): { decisions: number; preferences: number; tasks: number } {
  const extractions = extractFromText(transcriptContent);
  if (extractions.length === 0) return { decisions: 0, preferences: 0, tasks: 0 };

  const date = new Date().toISOString().split('T')[0];
  const knowledgeDir = '/workspace/group/knowledge';

  const fileMap: Record<Extraction['type'], string> = {
    decision: path.join(knowledgeDir, 'decisions.md'),
    preference: path.join(knowledgeDir, 'preferences.md'),
    task: path.join(knowledgeDir, 'tasks.md'),
  };

  const headerMap: Record<Extraction['type'], string> = {
    decision: '# Decisions\n\n',
    preference: '# Preferences\n\n',
    task: '# Tasks\n\n',
  };

  const counts = { decisions: 0, preferences: 0, tasks: 0 };

  for (const type of ['decision', 'preference', 'task'] as const) {
    const items = extractions.filter(e => e.type === type);
    if (items.length === 0) continue;

    const filePath = fileMap[type];
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, headerMap[type]);
    }

    const entries = items.map(item =>
      `- [${date}] ${item.text} _(from: ${path.basename(sourceFile)})_`
    );

    const countKey = type === 'decision' ? 'decisions' : type === 'preference' ? 'preferences' : 'tasks';
    counts[countKey] = appendToFile(filePath, entries);
  }

  return counts;
}
