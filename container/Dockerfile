# NanoClaw Agent Container
# Runs Claude Agent SDK in isolated Linux VM with browser automation
# Pure Bun runtime - no Node.js

FROM oven/bun:1

# Install system dependencies for Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    libdrm2 \
    libxshmfence1 \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path for agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Install agent-browser and claude-code globally with bun
RUN bun install -g agent-browser @anthropic-ai/claude-code

# Create app directory
WORKDIR /app

# ===== Agent Runner =====
COPY agent-runner/package.json ./agent-runner/
WORKDIR /app/agent-runner
RUN bun install
COPY agent-runner/ ./
RUN bun run build

# ===== RAG Server =====
WORKDIR /app
COPY rag-server/package.json ./rag-server/
WORKDIR /app/rag-server
RUN bun install
COPY rag-server/ ./
RUN bun run build

# ===== OpenRouter Server =====
WORKDIR /app
COPY openrouter-server/package.json ./openrouter-server/
WORKDIR /app/openrouter-server
RUN bun install
COPY openrouter-server/ ./
RUN bun run build

# Create workspace directories
WORKDIR /app
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input /workspace/project/data/rag

# Create non-root user for security (required by Claude Code CLI)
RUN useradd -m -s /bin/bash nanoclaw && \
    chown -R nanoclaw:nanoclaw /app /workspace

# Create /home/node directory for when running with --user flag from host
# The host user (e.g., UID 501) needs a writable home directory
RUN mkdir -p /home/node/.claude && \
    chmod -R 777 /home/node

# Create entrypoint script
RUN printf '#!/bin/bash\nset -e\ncat > /tmp/input.json\nbun run /app/agent-runner/dist/index.js < /tmp/input.json\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Set permissions for writable directories
RUN chmod -R 777 /workspace

# Set working directory to group workspace
WORKDIR /workspace/group

# Switch to non-root user
USER nanoclaw

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/app/entrypoint.sh"]
