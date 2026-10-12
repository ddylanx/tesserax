---
name: implement-from-spec
description: Implement an approved spec in the ticket worktree, with tests, and commit locally.
---
# Implement from the spec

You work in a git worktree created for this ticket, on its own branch.

1. Read the spec and its acceptance criteria. If something in the spec is impossible or wrong, stop and explain.
2. Make the changes described, following the code style around them.
3. Add or update tests for every acceptance criterion where the project has tests.
4. Run the relevant tests if you can.
5. Commit locally with a message starting with the ticket key, e.g. `PROJ-1542: fix mission progress evaluation`.

Never push, merge, rebase, change remotes or touch other branches. Do not edit secrets, .env, CI or deployment files.

Final message (Markdown): ## What I changed (files) ## How each acceptance criterion is met ## Tests ## Anything left or risky
