# Using Supabase (one database for several machines)

Tesserax only needs `DATABASE_URL`. Point it at a free Supabase Postgres and every machine (home, laptop)
sees the same tasks, runs and settings. Run logs and worktrees (`.data/`) stay on the machine that made them.

## Job workers

Only one machine runs the job workers (agent runs, Jira sync, schedules) at a time: the first to start takes a
Postgres advisory lock, and any other machine logs `another machine runs the job workers` and only serves the
API and web app. It retries every 30 s, so it takes over by itself once the other machine stops or loses its
connection. Agent runs still in progress on the machine that stopped are finished as failed by the new one.

## Set up

1. Create a project at https://supabase.com/dashboard (free plan). Keep the database password.
2. Open **Connect**, pick **Session pooler** (port 5432, works over IPv4). Do not use the transaction pooler
   (port 6543): pg-boss needs a session connection.
3. Stop `pnpm dev`. In `.env`, set `DATABASE_URL` to that string with your password filled in and
   `?sslmode=no-verify` appended (Supabase signs its certificate with its own CA).
4. To keep your local data, run `scripts/db-to-supabase.sh` once, before tesserax first starts against Supabase.
   It copies the local Docker database into the empty Supabase one and never changes the local copy.
   Skip it to start empty: tesserax creates the tables on first start.
5. `pnpm dev`. With a non-local `DATABASE_URL` it no longer starts the local Docker Postgres.
6. On the other machine, put the same `DATABASE_URL` in its `.env`.

To go back, set `DATABASE_URL` to the local one again; the local database is untouched.

The free session pooler allows about 15 connections per project; each tesserax process uses up to 9.
If you see `max clients reached`, raise the pool size in Supabase under Database settings.
