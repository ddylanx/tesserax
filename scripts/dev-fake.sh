#!/bin/sh
# Runs the API against the fake Jira (scripts/fake-jira.mjs) without touching .env. For local testing only.
cd "$(dirname "$0")/../apps/api" && \
  JIRA_BASE_URL=http://127.0.0.1:4499 JIRA_EMAIL=dev@example.com JIRA_API_TOKEN=fake \
  exec node -r @swc-node/register src/main.ts
