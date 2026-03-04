#!/bin/sh
set -e

case "${1:-start}" in
  start)
    exec bun run /app/dist/index.js
    ;;
  dev)
    exec bun run /app/src/index.ts
    ;;
  auth)
    exec bun run /app/src/whatsapp-auth.ts
    ;;
  *)
    exec "$@"
    ;;
esac
