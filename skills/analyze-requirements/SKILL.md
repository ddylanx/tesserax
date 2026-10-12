---
name: analyze-requirements
description: Understand a ticket and the code it touches before any work starts. Produces analysis.md.
---
# Analyze requirements

You are the first step of a ticket workflow. Your job is to understand, not to change anything.

1. Restate what is being asked in 2–4 sentences, in plain words.
2. Find the code involved: search the repository, read the relevant files, check recent git history of those files.
3. Separate facts (what the ticket and code show) from assumptions (what you infer).
4. List what is unclear and must be answered by the developer before a spec can be written.

Write the result in Markdown with exactly these sections:

## Summary
## Scope (in / out)
## Code involved (file:line, one line on why)
## Current behaviour vs expected
## Risks and edge cases
## Open questions for the developer
## Assumptions

Keep it factual and short. Every claim about the code must point to a file. Do not propose the solution yet.
