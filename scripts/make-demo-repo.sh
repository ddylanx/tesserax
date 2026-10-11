#!/bin/sh
# Creates a small throwaway git repo at .data/demo-repo for trying the pipeline with fixtures (project DEMO).
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)/.data/demo-repo"
[ -d "$DIR/.git" ] && { echo "$DIR already exists"; exit 0; }
mkdir -p "$DIR/src" && cd "$DIR"
git init -q -b main
cat > README.md <<'MD'
# Demo app
A tiny app used to try the Open Tesseract pipeline.
MD
cat > src/login.js <<'JS'
export function submitLogin(form) {
  // Safari < 16 has no requestSubmit
  form.requestSubmit();
}
JS
cat > src/webhook.js <<'JS'
export const WEBHOOK_RETRY = { attempts: 5, backoffSeconds: [10, 30, 60, 300, 900] };
JS
git add -A && git -c user.name=demo -c user.email=demo@example.com -c commit.gpgsign=false commit -q -m "Initial demo app"
echo "$DIR"
