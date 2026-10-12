---
name: code-review
description: Review the ticket's diff against the approved spec and decide pass or fail.
---
# Review against the spec

Check, in this order:
1. Every acceptance criterion in the spec is met by the diff (quote the criterion, point to the code).
2. Correctness: logic errors, missing edge cases from the analysis, broken error handling.
3. Tests: do they actually test the criteria? Would they fail without the change?
4. Scope: changes outside the spec, leftover debug code, unrelated formatting.
5. Project conventions (see the conventions skill if provided).

Write Markdown: ## Criteria (met / not met, with file:line) ## Problems (blocking first) ## Suggestions (non-blocking)

End with exactly one line: `VERDICT: PASS` if there is no blocking problem, otherwise `VERDICT: FAIL`.
