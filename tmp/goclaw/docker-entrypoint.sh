#!/bin/sh
set -e

case "${1:-serve}" in
  serve)
    # Managed mode: auto-upgrade (schema migrations + data hooks) before starting.
    if [ "$GOCLAW_MODE" = "managed" ] && [ -n "$GOCLAW_POSTGRES_DSN" ]; then
      echo "Managed mode: running upgrade..."
      /app/goclaw upgrade || \
        echo "Upgrade warning (may already be up-to-date)"
    fi
    exec /app/goclaw
    ;;
  upgrade)
    shift
    exec /app/goclaw upgrade "$@"
    ;;
  migrate)
    shift
    exec /app/goclaw migrate "$@"
    ;;
  onboard)
    exec /app/goclaw onboard
    ;;
  version)
    exec /app/goclaw version
    ;;
  *)
    exec /app/goclaw "$@"
    ;;
esac
