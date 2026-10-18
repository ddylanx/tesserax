# Security

## How Tesserax runs

Tesserax runs AI agents and shell commands on your machine. Each task gets a git worktree under `.data/worktrees`, and agents and checks run inside it with your user's permissions.

- The API and web app bind to 127.0.0.1 and have no login. Do not expose ports 4400 and 5180 to a network.
- Agents never push or merge. `ALWAYS_DENIED` in `packages/agent-runtime/src/launcher.ts` lists the commands that are always blocked.
- The only write to Jira is a comment, after you confirm it.
- Issue text is untrusted and is passed to prompts inside `<issue>` delimiters.

## What counts as a vulnerability

- An agent or check escaping its worktree.
- Secrets leaking into logs, the database or prompts.
- Prompt injection through issue text that gets around the rules above.
- Access to the API from outside localhost.

Not a vulnerability: an agent running a command you allowed in a workflow or skill.

## Reporting

Please do not open a public issue. Use GitHub private vulnerability reporting (the repository's Security tab → Report a vulnerability), or write to `<security-contact>`.

Include the version or commit, steps to reproduce, and the impact.
