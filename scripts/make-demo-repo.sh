#!/bin/sh
# Creates a small throwaway git repo at .data/demo-repo for trying the pipeline with fixtures (project DEMO).
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)/.data/demo-repo"
[ -d "$DIR/.git" ] && { echo "$DIR already exists"; exit 0; }
mkdir -p "$DIR/src" "$DIR/test" && cd "$DIR"
git init -q -b main
cat > README.md <<'MD'
# Demo app
A tiny app used to try the Tesserax pipeline.
MD
cat > package.json <<'JSON'
{
  "name": "demo-app",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
JSON
cat > src/login.js <<'JS'
export function submitLogin(form) {
  // Safari < 16 has no requestSubmit
  form.requestSubmit();
}
JS
cat > src/webhook.js <<'JS'
export const WEBHOOK_RETRY = { attempts: 5, backoffSeconds: [10, 30, 60, 300, 900] };
JS
cat > test/webhook.test.js <<'JS'
import test from 'node:test';
import assert from 'node:assert/strict';
import { WEBHOOK_RETRY } from '../src/webhook.js';

test('webhook retry config has 5 attempts', () => {
  assert.equal(WEBHOOK_RETRY.attempts, 5);
  assert.equal(WEBHOOK_RETRY.backoffSeconds.length, 5);
});
JS
git add -A && git -c user.name=demo -c user.email=demo@example.com -c commit.gpgsign=false commit -q -m "Initial demo app"
echo "$DIR"
