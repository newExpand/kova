#!/bin/bash
# Auto-detect available port for parallel Tauri dev instances.
# Usage: ./scripts/dev.sh [starting-port]

PORT=${VITE_PORT:-${1:-1420}}

while lsof -i :"$PORT" > /dev/null 2>&1; do
  PORT=$((PORT + 1))
done

echo "Starting Tauri dev on port $PORT"

VITE_PORT=$PORT \
TAURI_CONFIG="{\"build\":{\"devUrl\":\"http://localhost:$PORT\"}}" \
exec tauri dev
