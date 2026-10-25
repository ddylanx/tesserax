#!/usr/bin/env bash
# Copies the local Docker Postgres into the empty database DATABASE_URL in .env points at (e.g. Supabase).
# The local database is only read, never changed. Stop `pnpm dev` first so nothing writes meanwhile.
set -euo pipefail
cd "$(dirname "$0")/.."

target=$(node -e "process.loadEnvFile('.env'); process.stdout.write(process.env.DATABASE_URL ?? '')")
case "$target" in
  ""|*@127.0.0.1*|*@localhost*) echo "DATABASE_URL in .env still points at the local database; paste the Supabase URL first." >&2; exit 1 ;;
esac
# node-pg wants sslmode=no-verify; pg_dump/psql (libpq) call the same thing sslmode=require.
target=${target//sslmode=no-verify/sslmode=require}

compose="docker compose -f infra/compose.dev.yml"
$compose up -d --wait

tables=$($compose exec -T postgres psql "$target" -Atc "select count(*) from pg_tables where schemaname in ('public','pgboss')")
if [ "$tables" != "0" ]; then
  echo "The target already has $tables tables (did tesserax start against it?). Reset it in Supabase and run this again." >&2
  exit 1
fi

$compose exec -T postgres pg_dump -U tesserax -d tesserax --no-owner --no-privileges --no-comments \
  | $compose exec -T postgres psql "$target" -v ON_ERROR_STOP=1 --single-transaction -q
echo "Done. Start tesserax with \`pnpm dev\`; it now uses the database in .env."
