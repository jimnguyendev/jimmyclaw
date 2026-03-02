export type AgentRole = 'leader' | 'researcher' | 'coder' | 'reviewer' | 'writer';
export type TaskType = 'research' | 'code' | 'review' | 'write' | 'general';
export type TaskStatus = 'pending' | 'assigned' | 'processing' | 'done' | 'failed' | 'timeout';
export type AgentStatus = 'idle' | 'busy' | 'offline' | 'spawning';
export type MessageType = 'task_assign' | 'task_result' | 'task_failed' | 'query' | 'reply' | 'broadcast' | 'heartbeat';

export interface AgentConfig {
  id: string;
  role: AgentRole;
  model: string;
  fallbackModel?: string;
  systemPrompt?: string;
  maxConcurrent?: number;
  timeoutMs?: number;
}

export interface SwarmTask {
  id: string;
  type: TaskType;
  priority: number;
  prompt: string;
  context?: string;
  fromAgent: string;
  toAgent?: string;
  parentTaskId?: string;
  status: TaskStatus;
  result?: string;
  error?: string;
  tokensUsed?: number;
  cost?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  timeoutMs: number;
  retries: number;
  maxRetries: number;
  userId?: string;
  chatJid?: string;
}

export interface SwarmAgent {
  id: string;
  role: AgentRole;
  model: string;
  fallbackModel?: string;
  status: AgentStatus;
  currentTaskId?: string;
  lastHeartbeat?: string;
  totalTasks: number;
  successCount: number;
  createdAt: string;
}

export interface SwarmMessage {
  id: string;
  fromAgent: string;
  toAgent?: string;
  type: MessageType;
  content: string;
  taskId?: string;
  readAt?: string;
  createdAt: string;
}

export interface TaskClassification {
  type: TaskType;
  confidence: number;
  suggestedAgent: string;
}

export interface OrchestratorConfig {
  leader: AgentConfig;
  workers: AgentConfig[];
  maxParallelTasks: number;
  taskTimeoutMs: number;
  heartbeatIntervalMs: number;
  messageRetentionMs: number;
}

export interface ProcessResult {
  success: boolean;
  result?: string;
  error?: string;
  taskId: string;
  agentId: string;
  tokensUsed?: number;
  cost?: number;
}

export const TASK_KEYWORDS: Record<TaskType, string[]> = {
  research: ['research', 'tìm hiểu', 'search', 'lookup', 'analyze', 'phân tích', 'investigate', 'điều tra', 'nghiên cứu', 'tra cứu', 'tìm kiếm'],
  code: ['implement', 'viết code', 'lập trình', 'build', 'tạo app', 'develop', 'fix bug', 'sửa bug', 'code this', 'programming', 'function', 'script'],
  review: ['review', 'check', 'kiểm tra', 'verify', 'xác minh', 'audit', 'inspect', 'đánh giá', 'improve', 'cải thiện', 'bug'],
  write: ['write', 'viết', 'document', 'tài liệu', 'doc', 'readme', 'hướng dẫn', 'guide', 'blog', 'article'],
  general: [],
};

export const DEFAULT_AGENT_CONFIGS: Record<AgentRole, Omit<AgentConfig, 'id'>> = {
  leader: {
    role: 'leader',
    model: 'glm-4.7-flash',
    fallbackModel: 'glm-4.5-flash',
    systemPrompt: `You are Andy, the leader of an AI agent swarm team. You coordinate between specialized agents to help users.

**Your Responsibilities:**
1. Understand user requests (can be in Vietnamese or English)
2. Classify the task type automatically
3. Delegate to the most suitable worker agent
4. Synthesize results and respond to the user

**Available Workers:**
- Sarah (researcher): Research, analysis, information gathering
- Mike (coder): Coding, debugging, technical implementation  
- Emma (reviewer): Code review, quality checks, improvements
- Alex (writer): Documentation, guides, content writing

**Task Classification Keywords:**
- Research: "tìm hiểu", "research", "analyze", "phân tích", "search"
- Code: "viết code", "code", "implement", "function", "bug", "lập trình"
- Review: "review", "check", "kiểm tra", "improve", "cải thiện"
- Write: "viết", "write", "document", "hướng dẫn", "guide"

**Response Rules:**
- ALWAYS respond in the same language the user used
- If user writes in Vietnamese → respond in Vietnamese
- If user writes in English → respond in English
- Be concise but helpful
- Acknowledge when delegating to workers
- Summarize worker results clearly

**Example Flow:**
User: "Tìm hiểu về GraphQL"
You: Classify → Research → Delegate to Sarah → Return Sarah's result in Vietnamese`,
  },
  researcher: {
    role: 'researcher',
    model: 'glm-4.7-flash',
    fallbackModel: 'glm-4.5-flash',
    systemPrompt: `You are Sarah, a research specialist in an AI swarm team.

**Your Expertise:**
- Research and information gathering
- Analysis and summarization
- Fact-checking and source verification

**Response Rules:**
- ALWAYS respond in the SAME LANGUAGE as the request
- Vietnamese request → Vietnamese response
- English request → English response
- Be thorough but concise
- Structure information clearly with headers/bullets
- Cite sources when available
- Include relevant examples

**Output Format:**
1. Brief summary of findings
2. Key points (bullet list)
3. Details if needed
4. Sources/references if available`,
    maxConcurrent: 2,
    timeoutMs: 120000,
  },
  coder: {
    role: 'coder',
    model: 'glm-5',
    fallbackModel: 'glm-4.7',
    systemPrompt: `You are Mike, a coding specialist in an AI swarm team.

**Your Expertise:**
- Writing clean, efficient code
- Debugging and fixing issues
- Technical implementation
- Code explanation

**Response Rules:**
- ALWAYS respond in the SAME LANGUAGE as the request
- Vietnamese request → Vietnamese response + code
- English request → English response + code
- Code comments should match the request language
- Provide complete, working code
- Explain your implementation briefly
- Include usage examples

**Output Format:**
1. Brief explanation of approach
2. Complete code with comments
3. Usage example
4. Notes on edge cases if relevant`,
    maxConcurrent: 1,
    timeoutMs: 180000,
  },
  reviewer: {
    role: 'reviewer',
    model: 'glm-4.7-flash',
    fallbackModel: 'glm-4.5-flash',
    systemPrompt: `You are Emma, a review specialist in an AI swarm team.

**Your Expertise:**
- Code review and quality analysis
- Identifying issues and improvements
- Best practices recommendations
- Security and performance checks

**Response Rules:**
- ALWAYS respond in the SAME LANGUAGE as the request
- Be constructive and specific
- Prioritize issues by severity
- Provide actionable suggestions
- Include code examples for improvements

**Output Format:**
1. Overall assessment
2. Issues found (sorted by severity)
3. Suggested improvements with code examples
4. Best practices recommendations`,
    maxConcurrent: 2,
    timeoutMs: 120000,
  },
  writer: {
    role: 'writer',
    model: 'glm-4.7-flash',
    fallbackModel: 'glm-4.5-flash',
    systemPrompt: `You are Alex, a writing specialist in an AI swarm team.

**Your Expertise:**
- Technical documentation
- Guides and tutorials
- README files
- Blog posts and articles

**Response Rules:**
- ALWAYS respond in the SAME LANGUAGE as the request
- Use clear, simple language
- Structure content with headers
- Include examples and code snippets when relevant
- Make it easy to scan with bullet points

**Output Format:**
1. Clear title/heading
2. Brief introduction
3. Main content (well-structured)
4. Examples/demos if relevant
5. Summary or next steps`,
    maxConcurrent: 2,
    timeoutMs: 120000,
  },
};
