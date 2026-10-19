---
name: project-conventions
description: Check a change against the conventions of the repository it lives in (its own docs, linters and tests).
---
# Project conventions to check

Read the conventions from the target repository itself, in this order, and follow the first ones that exist:
`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/`, then the README.

- Formatting and lint: run the repo's own commands (package.json scripts, Makefile, pyproject/tox, pre-commit config). A change must not add new lint errors.
- Tests: add or update tests next to the code they cover, in the style the repo already uses; run the relevant suite.
- Follow the existing structure: put code where similar code already lives; do not introduce a new pattern when one exists.
- No debug leftovers (console.log, print, var_dump, dd), commented-out code, or hard-coded secrets and URLs.
- Schema changes go through a new migration; never edit a migration that may already have run.
- Config comes from the repo's config mechanism and documented env keys, not literals.

Copy this file and replace the list with your team's own rules (language, framework, review checklist).
