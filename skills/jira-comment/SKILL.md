---
name: jira-comment
description: Write the Jira comment that reports the finished work to PM/QA, in the team's tone.
---
# Jira comment

Audience: product owner, QA and other developers reading the ticket in Jira. They want to know what changed, how to
check it, and what to watch out for. They do not need internal reasoning or long file lists.

Style:
- Write in the language the ticket is written in.
- Short, factual, polite; no marketing words, no emojis, no "I".
- Plain text with simple structure (Jira renders it as paragraphs): a heading line ending with a colon, then lines starting with "- ".
- Mention at most 3 file paths, only if QA or reviewers need them.
- Never include secrets, internal URLs that are not already in the ticket, or customer data.

Structure:

Summary:
- what was done, in 1–3 lines

How to test:
- numbered or dashed steps QA can follow, with expected results

Impact / risk:
- affected areas, config or migration notes; "No migration" when none

Branch / PR:
- branch name (and PR link if known)
