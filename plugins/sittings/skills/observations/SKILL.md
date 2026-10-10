---
name: observations
description: >-
  Surface insights simplify can't reach: test gaps, doc staleness, architecture,
  security. Two-agent team — CI safety net + static codebase health. Use
  standalone or chain after /simplify. Triggered by: "observations", "what did
  you notice", "anything to flag".
user_invocable: true
---

Review the work done in this conversation. Launch two agents in parallel to surface findings that /simplify structurally cannot reach. Simplify owns the diff (reuse, quality, efficiency). Observations owns everything else.

Pass each agent a summary of what was changed in this session (files modified, features added, patterns introduced) so they have context without re-reading the full diff.

## Agent 1: CI Safety Net

"Would CI catch a regression in what we just built?"

Focus areas:
- **Untested error paths** in code that was touched — missing sad-path tests, uncovered branches
- **Edge cases** implied by the implementation that have no test (boundary values, empty inputs, nil/zero states)
- **Integration seams** — two systems that talk to each other (bash→Go JSONL, API→database, service→queue) where each side has tests but nothing verifies the contract between them
- **Golden test gaps** — widgets, renderers, or output-producing code that changed but has no frozen-output regression test
- **Stale test references** — tests that assert against constants, paths, or patterns that the implementation no longer uses
- **Coverage of new tunables** — if new configuration or parameters were added, are they exercised by tests with non-default values?

Only flag gaps in code that was touched or read in this session. Do not audit the entire test suite.

## Agent 2: Static Codebase Health

"If a new contributor read this codebase tomorrow, what would confuse them?"

Focus areas:
- **Doc staleness** — CLAUDE.md, README, design specs, inline comments that reference old names, removed features, or outdated architecture
- **Cross-file inconsistencies** — the same pattern done two different ways in different parts of the codebase (error handling, naming conventions, struct initialization, registry patterns)
- **Architecture observations** — coupling that might cause problems, boundaries that are blurry, abstractions that leak
- **Fragile coupling** — code that works because of how a dependency happens to behave today, not because an interface contract guarantees it. Magic numbers derived from library internals, types that assume a specific concrete return, patterns that would silently break on a minor version bump. Tests won't catch this because they share the same assumption.
- **Security** — missing input validation, auth gaps, data exposure, anything that looked off while working nearby. If nothing looked off, skip — do not manufacture findings.

Look beyond the diff. The value of this agent is noticing things in the surrounding codebase that the session's changes interact with.

## Rules for Both Agents

- Only report things actually observed while working, not generic best-practice advice
- Be specific: name files, functions, line numbers
- Keep each finding to 1-2 sentences
- Distinguish between "this is a problem now" and "this will become a problem at scale"
- Do NOT report code smells, performance issues, duplication, or reuse opportunities — those are /simplify's job
- If there's nothing notable, say so — don't manufacture observations

## Rollup Table

After both agents report, merge findings into a single rollup table:

| # | Observation | Category | Effort | When | Risk if ignored |
|---|-------------|----------|--------|------|-----------------|

Column definitions:
- **#**: Sequential number
- **Observation**: One-line summary (short enough to scan)
- **Category**: test-gap / doc-staleness / inconsistency / security / architecture
- **Effort**: `low` (< 30 min, single file), `medium` (1-2 hours, few files), `high` (half day+, cross-cutting)
- **When**: `now` (fix in this commit), `soon` (next session), `later` (backlog), `spec` (needs a design decision first)
- **Risk if ignored**: What breaks or degrades — one phrase
