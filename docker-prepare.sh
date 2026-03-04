#!/usr/bin/env bash
# docker-prepare.sh — Prepare host directories and .env for Docker deployment.
# Run once on VPS before the first `docker compose up`.
set -e

DEPLOY_DIR="${1:-/opt/jimmyclaw}"

echo "→ Creating data directories at $DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"/{groups,store,data,config}
mkdir -p "$DEPLOY_DIR/groups/main"
mkdir -p "$DEPLOY_DIR/groups/global"

# Copy example configs if not present
if [ ! -f "$DEPLOY_DIR/.env" ]; then
    cp .env.example "$DEPLOY_DIR/.env"
    echo "→ Created $DEPLOY_DIR/.env — fill in your API keys"
fi

if [ ! -d "$DEPLOY_DIR/config" ] || [ -z "$(ls -A "$DEPLOY_DIR/config")" ]; then
    cp -r config/. "$DEPLOY_DIR/config/"
    echo "→ Copied default config to $DEPLOY_DIR/config/"
fi

# Detect Docker group ID for sandbox overlay
DOCKER_GID=$(getent group docker | cut -d: -f3 || echo "999")
echo "→ Docker GID: $DOCKER_GID"

# Write docker deployment settings to .env (skip if already present)
if ! grep -q "HOST_PROJECT_ROOT" "$DEPLOY_DIR/.env" 2>/dev/null; then
    cat >> "$DEPLOY_DIR/.env" << EOF

# Docker deployment settings
HOST_PROJECT_ROOT=$DEPLOY_DIR
DOCKER_GID=$DOCKER_GID
EOF
fi

echo ""
echo "✓ Done. Next steps:"
echo "  1. Edit $DEPLOY_DIR/.env — add API keys"
echo "  2. cd $DEPLOY_DIR"
echo "  3. Build agent image:"
echo "     docker build -t jimmyclaw-agent:latest -f container/Dockerfile container/"
echo "  4. Start (standalone + sandbox):"
echo "     docker compose -f docker-compose.yml \\"
echo "       -f docker-compose.standalone.yml \\"
echo "       -f docker-compose.sandbox.yml up -d --build"
