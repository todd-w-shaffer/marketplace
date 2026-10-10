---
name: clearmind
description: >-
  Audit auto-memory for stale, shipped, redundant, or trivial entries.
  Proposes removals and consolidations, applies after approval. Finishes
  with context-awareness notes on CLAUDE.md, MCP servers, and unused
  skills/plugins. Triggered by: "/clearmind", "clean up memories",
  "memory audit", "trim context".
user_invocable: true
---

# Clearmind

Audit the memory system for signal quality — entries that Claude ignores or
that duplicate what the code already says are worse than large entries that
drive behavior. Size matters less than adherence.

## Phase 1: Inventory

**Check for `/context` output first.** Scan the conversation history for
output from the `/context` built-in command (a colored grid showing token
breakdown by category). This is a built-in CLI command that cannot be
invoked programmatically — but the user may have run it before invoking
`/clearmind`.

**If `/context` output is present:** Use it as the authoritative token
breakdown. Skip the manual estimation below and proceed with real numbers
for memory, CLAUDE.md, MCP, skills, and conversation history.

**If `/context` output is NOT present:** Gather context costs from what
you can directly measure:
- **Memory files** — read `MEMORY.md` and every file it references, sum sizes
- **CLAUDE.md** — read all CLAUDE.md files (project, global, local), sum sizes
- **Skills** — count registered skills visible in the system prompt
- **MCP servers** — count connected MCP tools visible in deferred tool lists
  (tool count is a proxy for schema weight — more tools = heavier context)

Run the full audit with these estimates. At the end of the Phase 3 report,
add:

> For deeper analysis, run `/context` then `/clearmind` again — I'll pick
> up the token breakdown automatically.

For each memory file, capture:
- **Name and type** (user / feedback / project / reference)
- **Size** (bytes)
- **Age** (file modification date vs today)
- **One-line summary** of what it says

Also check for orphans: files in the memory directory that aren't listed in
`MEMORY.md`, and `MEMORY.md` entries that point to missing files.

## Phase 2: Signal Quality

Evaluate each memory on two axes: **staleness** and **signal density**.

### Staleness signals

| Signal | Applies to | Test |
|--------|-----------|------|
| **Shipped** | project | Describes a feature that's done and merged. The code is the record now. |
| **Complete** | project | All items checked off, no pending work remains. |
| **Redundant with code** | project, reference | Information derivable from reading current source or git log. |
| **Redundant with CLAUDE.md** | any | Already documented in a CLAUDE.md file. |
| **Redundant with another memory** | any | Substantially overlaps a different memory file. |
| **Trivial** | any | Content is one line or contains no non-obvious information. |
| **Speculative** | project | Describes future work with no concrete plan or timeline. |
| **Stale reference** | reference | Points to a tool, URL, or system that may no longer apply. |
| **Orphaned** | any | Not in MEMORY.md index, or index entry points to missing file. |

### Signal density

A memory earns its context cost if Claude demonstrably follows it. Flag
memories where:
- The rule is so obvious Claude would do it anyway (low signal)
- The rule is routinely violated despite being present (not landing)
- The information is correct but never relevant to this project's work

A memory can be flagged by multiple signals. Not every flag means removal.

**Preserve bias for feedback type**: feedback memories capture behavioral
rules and lessons learned. Unless the rule is contradicted by a newer
feedback memory or the codebase has fundamentally changed, keep it. The
cost of re-learning a lesson exceeds the cost of a few hundred tokens.

## Phase 3: Report

Present findings as a table before taking any action:

```
## Memory Audit

### Summary
- Total memories: X
- Total size: X KB (~X tokens)
- Flagged for removal: X (X KB)
- Flagged for consolidation: X → X (saves X KB)
- Clean: X

### Removals

| File | Type | Size | Signal | Why it's stale |
|------|------|------|--------|----------------|

### Consolidations

| Source files | → Target | Signal | What merges |
|-------------|----------|--------|-------------|

### Orphans

| Issue | File / Entry |
|-------|-------------|

### Kept (no action)

| File | Type | Why it stays |
|------|------|-------------|
```

Wait for user approval. The user may override any recommendation.

## Phase 4: Apply

After approval:

1. **Remove** flagged files using the appropriate tool. Update MEMORY.md to
   drop their index entries.
2. **Consolidate** by writing the merged file, removing source files, and
   updating MEMORY.md entries.
3. **Fix orphans** — remove stale index lines, or add missing entries.
4. **Verify** — re-read MEMORY.md and confirm every entry has a matching
   file and every file has an index entry.

Report final counts: removed, consolidated, orphans fixed, new total size.

## Phase 5: Context Awareness

After the memory audit, add a **"While you're here"** section with
observations about the broader context picture. This is advisory — clearmind
doesn't act on these, just flags them.

### MCP servers

MCP tool schemas are the single largest context consumer — one server with
20+ tools can outweigh all memory and CLAUDE.md combined. Note which MCP
servers are connected and their approximate tool count. If `/context` output
is available, call out MCP's share of total context. Recommend the user
review whether all connected servers are needed for this project.

### CLAUDE.md

If CLAUDE.md is large relative to memory (e.g., 2x+ the size of all memory
files), note it and recommend running `/claude-md-improver` for a dedicated
audit. Do not attempt to edit CLAUDE.md — that skill handles it.

### Skills and plugins

List any registered skills or enabled plugins. Note which ones haven't been
invoked recently in this project — not as a "delete these" but as a
"these are loaded, are they earning it?" nudge. Low priority, low pressure.

## Phase 6: Token Discrepancy (reference only)

If `/context` and the thinking status line disagree on token count, note it
in the report but don't chase it — a prior investigation (2026-04-11) found:

- `--debug "api"` logs request routing, **not** response `usage` blocks —
  it cannot confirm actual wire token counts
- OTEL telemetry is noisy and may not surface `input_tokens` reliably
- The one confirmed case was a Heisenbug (stale session state, vanished
  under observation)

If a user reports this, recommend restarting the session first. If it
persists across fresh sessions, it's worth filing with Anthropic — but the
debug tooling available today can't isolate it.

## Rules

- **Never remove without approval.** Phase 3 is a mandatory checkpoint.
- **Never remove user-type memories** unless the user explicitly flags them.
  Identity context is always load-bearing.
- **Feedback memories get the benefit of the doubt.** Only remove if
  contradicted or if the entire domain they reference no longer exists.
- **Project memories are the most common removals.** Features ship, plans
  complete, backlogs get absorbed into code or issues.
- **Update, don't just delete.** If a memory has one stale paragraph and
  one current paragraph, edit it rather than removing the whole file.
- **Keep MEMORY.md tight.** Each entry should be one line, under 150
  characters. If the index itself is bloated, trim descriptions.
- **Phase 5 is advisory only.** Don't act on MCP/CLAUDE.md/skill findings.
  Flag them and let the user decide.
