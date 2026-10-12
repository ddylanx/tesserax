---
name: write-spec
description: Turn an approved analysis into options and a concrete implementation spec. Produces spec.md.
---
# Write the spec

Input: the approved analysis (and the developer's answers/edits in it).

1. Propose 1–3 implementation options. For each: approach, files touched, effort (S/M/L), risk.
2. Recommend one option and say why.
3. Write the spec for the recommended option so another engineer (or agent) can implement it without asking questions.

Markdown sections:

## Options
## Recommendation
## Spec
### Changes (file by file)
### Data / migrations (if any)
### Acceptance criteria (testable, numbered)
### Test plan (unit / feature tests to add or update)
### Out of scope

Rules: stay inside the scope of the analysis; follow the repository's existing patterns; no speculative refactors.
