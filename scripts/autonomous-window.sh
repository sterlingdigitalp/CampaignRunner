#!/bin/bash
# Nightly autonomous window launcher for Campaign Runner.
#
# Intended to be fired by launchd at windowStart (see com.campaignrunner.window.plist).
# Ensures the Next.js server is running, then kicks off an autonomous window run
# wrapped in caffeinate so the Mac cannot sleep mid-campaign. The runner itself
# stops at settings.windowEnd; --max-time is only a hard backstop.
#
# Configuration (override via environment or edit here):
APP_DIR="${APP_DIR:-$HOME/campaignrunner}"
PROJECT_ROOT="${PROJECT_ROOT:-$APP_DIR/Project}"
PORT="${PORT:-3000}"
LOG_DIR="$PROJECT_ROOT/logs"
MAX_WINDOW_SECONDS="${MAX_WINDOW_SECONDS:-43200}" # 12h backstop

set -u
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/autonomous-window.log"
log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG_FILE"; }

log "Autonomous window launcher starting (projectRoot=$PROJECT_ROOT, port=$PORT)."

# 1. Make sure the app server is up.
if ! curl -sf -m 3 "http://localhost:$PORT" > /dev/null 2>&1; then
  log "Server not running; starting it."
  cd "$APP_DIR" || { log "APP_DIR $APP_DIR missing"; exit 1; }
  if [ ! -f ".next/BUILD_ID" ]; then
    log "No production build found; building."
    npm run build >> "$LOG_FILE" 2>&1 || { log "Build failed"; exit 1; }
  fi
  nohup npm run start -- -p "$PORT" >> "$LOG_FILE" 2>&1 &
  for _ in $(seq 1 30); do
    sleep 2
    curl -sf -m 3 "http://localhost:$PORT" > /dev/null 2>&1 && break
  done
  if ! curl -sf -m 3 "http://localhost:$PORT" > /dev/null 2>&1; then
    log "Server failed to come up on port $PORT."
    exit 1
  fi
  log "Server is up."
fi

# 2. Run the window (LM Studio preflight happens inside the runner).
log "Starting autonomous window run."
RESULT=$(caffeinate -is curl -s -X POST "http://localhost:$PORT/api/run" \
  -H "Content-Type: application/json" \
  --max-time "$MAX_WINDOW_SECONDS" \
  -d "{\"projectRoot\":\"$PROJECT_ROOT\",\"mode\":\"window\"}")
log "Window run finished: $RESULT"
