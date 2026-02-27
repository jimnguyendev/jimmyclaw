import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { RAGDatabase } from './db.js';
import { EmbeddingClient } from './embedding.js';
import { RAGConfig } from './types.js';

const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];
const TEXT_EXTENSIONS = ['.txt', '.json'];

export class FileIndexer {
  private db: RAGDatabase;
  private embedding: EmbeddingClient;
  private config: RAGConfig;
  private groupPath: string;

  constructor(db: RAGDatabase, embedding: EmbeddingClient, config: RAGConfig) {
    this.db = db;
    this.embedding = embedding;
    this.config = config;
    this.groupPath = `/workspace/group`;
  }

  async indexAll(): Promise<{ indexed: number; skipped: number; errors: string[] }> {
    const errors: string[] = [];
    let indexed = 0;
    let skipped = 0;

    const directories = [
      { name: 'memory', prefix: 'memory' },
      { name: 'knowledge', prefix: 'knowledge' },
      { name: 'conversations', prefix: 'conversations' },
    ];

    const allPaths: string[] = [];

    for (const dir of directories) {
      const dirPath = path.join(this.groupPath, dir.name);
      if (!fs.existsSync(dirPath)) continue;

      const files = this.walkDirectory(dirPath);
      
      for (const file of files) {
        const relativePath = `${dir.prefix}${file.slice(dirPath.length)}`;
        allPaths.push(relativePath);

        try {
          const result = await this.indexFile(file, relativePath);
          if (result > 0) {
            indexed += result;
          } else {
            skipped++;
          }
        } catch (error) {
          errors.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    this.db.deleteStaleChunks(allPaths);
    this.db.setLastIndexed(new Date());

    return { indexed, skipped, errors };
  }

  async indexFile(filePath: string, relativePath: string): Promise<number> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const hash = this.hashContent(content);

    const existingHashes = this.db.getFileHashes();
    if (existingHashes.get(relativePath) === hash) {
      return 0;
    }

    this.db.deleteChunksByPath(relativePath);

    const chunks = this.chunkMarkdown(content, relativePath);
    
    for (const chunk of chunks) {
      chunk.hash = hash;
      const id = this.db.insertChunk(chunk);
      
      if (this.embedding.isEnabled()) {
        const embedding = await this.embedding.getEmbedding(chunk.content);
        this.db.updateEmbedding(id, embedding);
      }
    }

    return chunks.length;
  }

  private walkDirectory(dir: string): string[] {
    const files: string[] = [];

    const walk = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && this.isIndexable(entry.name)) {
          files.push(fullPath);
        }
      }
    };

    walk(dir);
    return files;
  }

  private isIndexable(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return MARKDOWN_EXTENSIONS.includes(ext) || TEXT_EXTENSIONS.includes(ext);
  }

  private chunkMarkdown(content: string, pathName: string): Omit<import('./types.js').Chunk, 'id' | 'createdAt' | 'updatedAt' | 'embedding'>[] {
    const lines = content.split('\n');
    const chunks: Omit<import('./types.js').Chunk, 'id' | 'createdAt' | 'updatedAt' | 'embedding'>[] = [];
    
    let currentChunk: string[] = [];
    let currentTokens = 0;
    let lineStart = 0;
    let chunkIndex = 0;

    const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineTokens = estimateTokens(line);

      if (currentTokens + lineTokens > this.config.chunkSize && currentChunk.length > 0) {
        chunks.push({
          path: pathName,
          chunkIndex: chunkIndex++,
          content: currentChunk.join('\n'),
          lineStart: lineStart + 1,
          lineEnd: i,
          hash: '',
        });

        const overlapLines = currentChunk.slice(-Math.ceil(this.config.chunkOverlap / 20));
        currentChunk = [...overlapLines, line];
        currentTokens = estimateTokens(currentChunk.join('\n'));
        lineStart = i - overlapLines.length;
      } else {
        currentChunk.push(line);
        currentTokens += lineTokens;
      }
    }

    if (currentChunk.length > 0) {
      chunks.push({
        path: pathName,
        chunkIndex: chunkIndex,
        content: currentChunk.join('\n'),
        lineStart: lineStart + 1,
        lineEnd: lines.length,
        hash: '',
      });
    }

    return chunks;
  }

  private hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}
