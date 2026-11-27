#!/usr/bin/env sh
# Run Highway Player locally on macOS or Linux: ./start.sh
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-5500}"
URL="http://localhost:$PORT"

echo "Highway Player is starting at $URL (press Ctrl+C to stop)"

( sleep 2
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
  fi ) &

if command -v python3 >/dev/null 2>&1; then exec python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then exec python -m http.server "$PORT"
elif command -v npx >/dev/null 2>&1; then exec npx --yes serve -l "$PORT" .
else
  echo "Could not find Python or Node.js. Install one and run this again."
  exit 1
fi
