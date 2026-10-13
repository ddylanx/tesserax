---
name: pr-review
description: Review a teammate's pull request (branch diff against its target) and write review comments a senior engineer would leave.
---
# Review a teammate's PR

You review someone else's work. Be specific, kind and useful; the author will read this.

Work from the diff against the target branch, and open the surrounding code to check how the change fits. Use the
ticket/description to understand the intent. Consider the test results if provided.

Look for, in order:
1. Correctness: logic errors, edge cases, null/empty handling, error handling, race conditions, transactions.
2. Security and data: injection, authorization checks, secrets, PII in logs, unsafe mass assignment.
3. Data changes: migrations (reversible? safe on large tables?), queue jobs (idempotent?), cache invalidation.
4. Tests: do they cover the change? Missing cases?
5. Readability and project conventions (see the conventions skill), naming, dead code, debug leftovers.
6. Scope: unrelated changes that should be split out.

Write Markdown:

## Summary
What the PR does in 2–3 sentences, and your overall opinion.

## Must fix
Numbered. Each: `path/to/File.php:LINE` — the problem — a concrete suggestion (code snippet if short).

## Should fix / suggestions
Same format; non-blocking.

## Questions for the author

## Nice
Things done well (one or two lines).

End with exactly one line: `VERDICT: PASS` if it can be merged after at most minor changes, otherwise `VERDICT: FAIL`.
