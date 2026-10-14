---
name: ticket-doc
description: Write the ticket's permanent document in the repo (docs/<KEY>-<slug>.md), detailed enough that a future AI or engineer has full context.
---
# Ticket document

This file stays in the repository next to the code. Its reader is a future engineer or AI agent who knows nothing
about this ticket. Be complete and concrete; prefer facts and file references over prose.

Use the approved analysis, spec, implementation summary, test results and review. Look at the code on this branch
to confirm details. Do not invent anything that is not in those sources or the code.

Markdown, with these sections:

# <KEY>: <title>
- Ticket: <link> · Branch: <branch> · Date: <today>

## Context
Why this work exists; the business/user problem in 2–5 sentences.

## Requirements and acceptance criteria
Numbered, as finally approved.

## Decision
Options considered (one line each) and the chosen approach with the reason.

## Changes
File by file: what changed and why (file paths, key classes/functions).

## Data, config and migrations
New/changed tables, columns, config keys, env variables, queues, cron. "None" if none.

## How to test
Automated tests added/updated (paths) and manual steps.

## Risks, limits and follow-ups

## Glossary
Domain terms a newcomer would not know (only if any).
