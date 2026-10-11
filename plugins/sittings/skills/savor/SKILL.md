---
name: savor
description: >-
  Pre-implementation spec audit. Structural review (systems correctness +
  codebase integration + testing strategy when the spec has a TDD plan) plus
  contextual personas chosen per-spec to cover blind spots the structural
  reviewers can't see. Tightens without growing or shrinking scope.
  Triggered by: "/savor", "savor this spec", "review this spec before shipping".
user_invocable: true
---

# Savor

Slow down before shipping. Spawn fresh-context reviewers against a spec to find things that are obvious from a clean perspective but invisible after hours of design work.

The mandate is **tighten, not grow or shrink**. Findings fix corner cases, clarify ambiguities, flag test breakage, and correct assumptions — they never add features, remove scope, or re-litigate design decisions.

## Input

The user provides a path to a spec (markdown). If no path is given, check `docs/backlog/` for recently modified `.spec.md` files and confirm which one.

## Phase 1: Context Gathering

Read the spec completely. Then identify every file the spec will modify (look for a "File touchlist" or "Modified" section — most specs have one). Read each of those files in full. Also read:

- `CLAUDE.md` — project conventions, test commands, commit style
- Any existing tests for the files being modified (e.g., `*_test.go`, `*.bats`, `*.test.ts`)
- If a knowledge graph exists (`graphify-out/GRAPH_REPORT.md`), read it to understand coupling beyond the direct touchlist

Build a mental model of: what the spec changes, what code it touches, what tests exist, and what downstream consumers depend on the APIs being modified.

### Staleness check

Before launching reviewers, verify that the spec's key claims match the current codebase. Grep for every function, type, method, constant, and event name the spec references, unless the repo has `docs/savor-checks.md`: its report already covers those searches, so skip the grep and work from the report (see Repo checks) instead of running the same search twice. Flag mismatches immediately — don't burn reviewer tokens on stale premises. Common staleness patterns:

- Spec says "Add `FooHelper`" but `FooHelper` already exists (shipped in an earlier cycle)
- Spec references `EventX` but the event was renamed or removed
- Spec lists a file as "Created" in the touchlist but the file already exists
- Spec assumes a struct field or method signature that has since changed

For each mismatch found, edit the spec inline (correct the claim, update the touchlist, fix the code example) and note it in a `## Staleness fixes applied` scratch section at the bottom of the spec. Delete this scratch section after Phase 3 merges everything.

This step is cheap (a few greps) and consistently saves reviewer attention for real design issues.

### Repo checks

If the repo has `docs/savor-checks.md`, read it now and follow it before Phase 2. It names the repo's own
mechanical checks (usually a script that prints a report), what to clear in the spec before reviewers launch,
and the lines each reviewer adds to its prompt. Hand each reviewer that report, so it judges what the report
flags instead of re-running the searches.

When writing a repo's checks script: it reports raw search hits, and the differences between those hits and
what the spec's own tables list. It never parses the spec's prose to infer intent, such as whether a file is
"mentioned" or a symbol is "deleted". Intent belongs in a table column the planner fills. A hit the tables
don't account for goes to a reviewer as a raw hit.

## Phase 2: Structural Review

Launch the structural agents **in parallel**: systems and integration always, and testing strategy whenever the spec proposes tests (see Agent 3's trigger). Each gets the spec path and a brief of what files to read. No agent sees another's findings — independent perspectives are the point.

### Agent 1: Systems Reviewer

"You are a systems programmer reviewing a spec for correctness before implementation."

This agent reads the spec against the **language and runtime**. It looks for:

- **Type mismatches** — does the spec propose returning a pointer where the underlying store holds values? Does it assume mutability where copies are returned?
- **Concurrency** — what runs on which goroutine/thread? Could a proposed side effect (I/O, syscall) block a hot path? Are shared data structures accessed safely?
- **API contracts** — do proposed method signatures hold under all call patterns? Are there off-by-one risks, nil/zero edge cases, or ordering assumptions?
- **Memory and performance** — does the spec's cost analysis hold? Are buffer sizes reasonable? Could a loop or scan become expensive at scale?
- **Semantic drift** — does a proposed change subtly alter the meaning of an existing return value, counter, or flag in a way callers won't expect?

Instruct the agent: "Report findings as a numbered list. For each: what the issue is, why it matters, and what the fix is if obvious. Do not suggest scope changes — only flag things that would cause test failures, bugs, or silent behavioral changes. Keep it under 400 words."

### Agent 2: Integration Reviewer

"You are a developer who knows this codebase, reviewing a spec for integration issues."

This agent reads the spec against the **codebase as it exists today**. It looks for:

- **Naming collisions** — does a proposed name conflict with an existing type, method, variable, or constant?
- **Test breakage** — which *existing* tests assert behavior that the spec changes? Will they fail, and does the spec's TDD plan account for updating them? (The tests the spec *proposes* belong to Agent 3.)
- **Consumer impact** — what widgets, commands, or modules call the APIs being changed? Will they see different behavior (different counts, different return types, new nil cases)?
- **Event/data flow** — does the spec assume a particular ordering, batching, or timing of data arrival that the actual code doesn't guarantee?
- **Convention mismatch** — does the spec follow the project's patterns (test naming, constant placement, error handling, struct initialization) or accidentally introduce a new one?
- **Missing state transitions** — are there events, modes, or lifecycle moments the spec doesn't handle (reset, shutdown, reconnect, first-run)?

Instruct the agent: "Report findings as a numbered list. For each: what the spec says, what the code actually does, and whether it's a problem. Do not suggest scope changes. Keep it under 400 words."

### Agent 3: Testing-Strategy Reviewer

**Trigger:** launch when the spec proposes tests — a TDD plan, RED steps, a test file in the touchlist, or named mutations. Skip for documentation-only specs and specs with no test plan; say so in the Phase 4 summary. This trigger is mechanical, like the historical reviewer's, so the agent is structural and never takes a contextual slot.

"You are a test engineer reviewing the tests a spec proposes, before any of them is written."

This agent reads the spec's **test plan** against the test harness and doubles as they exist today. The question it answers is not "is there enough coverage" but "can each proposed test prove what the spec says it proves". It looks for:

- **Red for the right reason** — will each RED test fail before the fix *because of the fault*, not because of a compile error, a missing import, or a hang? Is it still red at its step, or does an earlier cycle turn it green by accident?
- **Fail, not hang** — a test that waits on something that never settles (a reply, a timer, a stream) runs to the runner's timeout under its mutation, and a hang reads as a survived mutation. Does the plan bound the wait inside the test?
- **Mutation per test** — does each test name the mutation that proves it can fail, and would that mutation actually be caught? Flag a test whose only proof is "it passes".
- **Doubles model the contract** — does each fake, mock, or stub behave like the real dependency on the property the test depends on (abort, streaming, redirects, ordering, error shape)? A double more helpful or more blind than the real transport hides the fault.
- **Real writer, not seeds** — does a contract or invariant test go through the code path that writes the data in production, or through hand-built fixtures that can drift from it?
- **Races have a deterministic twin** — a test that relies on timing or interleaving needs a sequential twin that pins the same rule without depending on the schedule.
- **What the suite cannot see** — which behavior the spec commits to has no test that could observe it (chunk boundaries, encodings, wiring between two units that are each tested alone)? Name it, and name the one fixture or test that would make it visible, or say it belongs in the spec's residues.
- **Level** — is each test at the level that can see the fault (unit vs integration vs route)? Where is the wiring between tested units left untested?

Instruct the agent: "Report findings as a numbered list. For each: which proposed test, what it cannot prove as written, and the smallest change that fixes it. Tighten only the tests the spec already commits to; do not propose coverage for behavior the spec does not change. A fixture that exposes a gap in committed behavior counts as tightening. Do not suggest scope changes. Keep it under 400 words."

## Phase 2b: Contextual Personas

After launching the structural reviewers, read the spec one more time and ask:
**what risk surfaces does this spec expose that the structural reviewers
are blind to?**

Pick 1–2 contextual personas whose expertise covers those surfaces. Launch them
in parallel (they can overlap with the Phase 2 agents if timing allows). Each
gets the same mandate as Phase 2 agents: tighten only, no scope changes, 400
words, numbered findings.

**Announce your picks before launching.** Example:

> This spec has an interaction model (clicks, overlays, key cycling) and calls
> an external API, so I'm adding a **terminal UX reviewer** and a
> **reliability / failure-modes reviewer**.

### Persona selection guide

Match personas to what the spec actually touches — not every spec needs extras.
Pure plumbing specs (rename a field, add a config key) get 0.

| Spec touches…                        | Persona                          | Looks for…                                                                                       |
|---------------------------------------|----------------------------------|--------------------------------------------------------------------------------------------------|
| Interaction model (keys, clicks, mouse, overlays) | **UX / interaction reviewer**   | Hit-target ergonomics, discoverability, feedback loops, dismiss/toggle semantics, muscle-memory conflicts |
| External APIs or network              | **Reliability / failure-modes reviewer** | Timeout/retry behavior, partial failure, idempotency, backpressure, error surface coverage        |
| Visual rendering pipeline             | **Visual fidelity reviewer**     | Terminal compatibility, color space assumptions, animation frame budget, layout overflow, glyph width math |
| Security or trust boundaries          | **Attacker persona**             | Input validation, privilege escalation, injection surfaces, trust boundary crossings               |
| Data migration or schema change       | **Data integrity reviewer**      | Backward compatibility, zero-downtime migration, rollback path, data loss scenarios                |
| Touchlist with files that have deep git history (>10 commits at HEAD) | **Historical reviewer** | Re-litigation of reverted approaches, eroded rationale of origin commits, dormant-area risk, re-introduction patterns (cites SHAs) |

Most specs get 1 contextual persona. Specs that touch two surfaces in the table
get 2. Cap at 2 — more dilutes focus. There is no chaos-engineer row: its one
recurring finding, a race test with no deterministic twin, is on Agent 3's
checklist, and runtime ordering and TOCTOU belong to the systems reviewer.

**The historical reviewer is additive** — when its trigger fires (any
touchlist file exists at HEAD with >10 commits, and the spec is not
documentation-only — see its dedicated section below for the full
rule), it launches *in addition to* the structural-pattern picks and
does not count against the 2-cap. The cap exists to prevent
judgment-picked personas from diluting focus; the historical reviewer
is mechanically triggered by a touchlist property, not a judgment call.

Each contextual persona gets the same brief structure as the structural agents:
a role sentence, the spec path, the files to read, and the checklist of what to
look for. The "do not suggest scope changes" instruction is mandatory.

### The Historical Reviewer (embedded brief)

Unlike the structural-pattern personas above (whose checklists are constructed
per-spec to match the risk surface), the historical reviewer's brief is fixed
— the mining steps and disciplines port unchanged from spec to spec. Use the
brief below verbatim when this reviewer triggers.

**Trigger:** launch the historical reviewer when the touchlist contains at
least one file that exists at HEAD with >10 commits of history. Skip when
all touchlist files are net-new, all have ≤10 commits, or the spec is
documentation-only. The doc-only skip applies to `docs/**/*.md` and
`README*.md` only — `**/SKILL.md`, `**/CLAUDE.md`, and `agents/**.md` count
as executable prompt code and trigger the reviewer normally.

**Announce the pick:** *"This spec touches files with deep history, so I'm
adding a **historical reviewer**."*

**Brief (pass to the agent verbatim):**

> You are a regression auditor reviewing a spec against the git history of
> touched files. Flag four specific patterns. You are not writing provenance
> narrative — that's a separate command. Your job is bounded findings that
> change Phase 3's classification.
>
> **Setup (run once, before any per-file mining):**
>
> 1. **Resolve `<repo>`.** `git rev-parse --show-toplevel` from the spec's
>    directory. Use that path for every `git -C <repo>` call below. If the
>    command errors (not in a git repo), abort the reviewer and write a
>    single `investigation_notes` line.
> 2. **Shallow-clone check.** Run `git -C <repo> rev-parse
>    --is-shallow-repository`. If `true`, the >10-commit trigger, origin,
>    and dormancy results are all structurally misleading. Note in
>    `investigation_notes`, prefix every finding with `(shallow clone —
>    provenance is approximate)`, and continue — shallow data sometimes
>    catches re-litigation against recent commits.
> 3. **Per-file trigger gate.** For each touchlist entry, run
>    `git -C <repo> rev-list --count HEAD -- <file>`. Mine only files with
>    count >10. Skip `Create:` entries, missing files (count is 0), and
>    files with ≤10 commits; note each skip with reason in
>    `investigation_notes`.
> 4. **File cap.** Mine at most 5 files. If more pass the gate, mine the
>    5 with the highest commit counts; list overflow in
>    `investigation_notes`.
> 5. **Empty-result discipline.** Any *Mining* step (origin, inflection,
>    recent-activity, dormancy) that returns empty gets a one-line entry
>    in `investigation_notes` under `empty mining steps`. Do not fabricate
>    findings from missing data.
>
> **Mining (per file that passed the per-file trigger gate above):**
>
> 1. **Origin commit + body.**
>    ```bash
>    git -C <repo> log --follow --reverse --no-merges \
>      --pretty=tformat:'%h%x1f%ad%x1f%an%x1f%s%n%b%n---END---' \
>      --date=short -- <file> | sed -n '1,/---END---/p'
>    ```
>    Read the rationale. If the body is terse ("initial commit", "add
>    file"), note that — eroded-rationale findings need a quotable stated
>    reason to land.
>
>    **Do not add `-1` to this command.** It looks like the obvious way to
>    ask for one commit and it returns **nothing at all** — verified on git
>    2.50.1: `-1` truncates before `--follow` resolves the rename chain, so
>    the pipeline empties. It fails silently, which is the dangerous part:
>    the step reports "empty" rather than erroring, the reviewer records it
>    under `empty mining steps`, and the whole **eroded-rationale** category
>    — the only one that needs a quotable origin body — goes quietly dead
>    while the run still looks healthy. The `sed` above is what bounds the
>    output to one record instead; the body is multi-line, so `head -1` is
>    not a substitute.
>
>    **Known limitation:** `--follow` may still resolve to the rename commit
>    rather than the true origin when a file has been renamed. If the
>    returned commit subject looks like a rename ("rename", "move", "split
>    out"), flag the file in `investigation_notes` as "origin uncertain
>    (likely rename)" and downgrade eroded-rationale findings against it to
>    low-confidence.
>
> 2. **Inflection candidates (top 3 per file).**
>    ```bash
>    git -C <repo> log --follow --no-merges \
>      --pretty=tformat:'%h%x1f%ad%x1f%s%n%b%n---END---' \
>      --date=short -- <file>
>    ```
>    Select commits whose subject contains
>    `refactor|migrate|rewrite|rip out|flip|introduce|deprecate|split|merge`
>    OR whose body is >5 lines. Cap at 3 per file.
>
> 3. **Recent-activity sample (count-based, cadence-adaptive).**
>    ```bash
>    git -C <repo> log --max-count=10 --follow --no-merges \
>      --pretty=tformat:'%h%x1f%ad%x1f%s' --date=short -- <file>
>    ```
>    The last 10 commits, whatever timeframe they span. Use this to judge
>    whether the spec's premise matches what people have actually been
>    doing in the file lately, and as the cross-reference set for
>    re-introduction-pattern findings.
>
> 4. **Dormancy check (time-absolute).**
>    ```bash
>    git -C <repo> log -1 --since=90.days.ago -- <file>
>    ```
>    Empty result → file is dormant. `--no-merges` is deliberately omitted
>    here: on merge-heavy branches a file with only merge commits in the
>    last 90 days is still "being paid attention to."
>
> 5. **Symbol resolution (opportunistic).** If the spec names symbols
>    rather than paths, try LSP to map symbol → file:line. If LSP is
>    unavailable, fall back to grep across the touchlist files.
>    **Mandatory `investigation_notes` line:** record which resolution
>    path was taken — `lsp`, `grep`, or `direct` (spec named paths). Without
>    this line, synthesis can't tell whether file references are precise
>    or fuzzy, and the easiest way to lose this step is to silently skip it.
>
> **Conventions across all mining commands:** `tformat:` (not `format:`)
> for trailing newlines; `%x1f` field delimiter so pipes in commit messages
> don't corrupt parsing; `--no-merges` for signal *except* the dormancy
> check, where any commit counts as activity; `--follow` to track renames.
>
> **Findings categories (each finding gets exactly one tag):**
>
> - **re-litigation** — the spec re-proposes an approach that a prior
>   inflection commit explicitly tried and reverted. Cite both SHAs.
> - **eroded rationale** — the origin commit's stated reason still holds,
>   and the spec breaks the constraint motivating the code. Quote the
>   origin's body.
> - **dormant-area risk** — the file has no commits in the last 90 days.
>   Downstream consumers may have drifted from commit-history assumptions.
> - **re-introduction pattern** — three or more prior commits to this
>   file each re-introduced the same class of bug or undid the same
>   change. Cite the SHAs.
>
> **Category precedence:** if a finding fits both **re-litigation** and
> **eroded rationale**, tag re-litigation (the revert SHA is stronger
> citation). **re-introduction pattern** requires ≥3 prior commits with
> the same shape — a file with 11–14 commits cannot meaningfully surface
> this category; skip it (note in `investigation_notes`) and let the
> other three categories carry the file.
>
> **Output format (reproduce this skeleton verbatim per finding — do not
> collapse into prose):**
>
> ```
> N. [<category-tag>] <one-line summary>
>    File: <path>
>    SHAs: <abc123>, <def456>
>    Detail: <2–3 sentences of specifics, with quoted bodies if relevant>
> ```
>
> End with the `investigation_notes` section (always emit, even when empty
> — use `(none)` placeholders so synthesis can tell "checked, found
> nothing" from "forgot to check"):
>
> ```
> investigation_notes:
> - skipped files: <path: reason | (none)>
> - shallow clone: <yes — caveat applied | no>
> - resolution path: <lsp | grep | direct>
> - low-confidence origins (likely rename): <path | (none)>
> - empty mining steps: <path: step | (none)>
> - terse origin bodies (rationale unjudgeable): <path | (none)>
> ```
>
> **Discipline:**
>
> - **Tighten only.** No scope changes. No "this file has churned a lot,
>   consider redesigning."
> - **Cite SHAs.** Every finding references at least one commit.
> - **State gaps.** Don't pad with weak findings.
> - **Weak-finding test:** for each candidate, ask "would this change a
>   Phase 3 classification decision — fix-in-spec, code-comment, or
>   discard?" If the answer is "no, this is a vague historical
>   observation," drop it.
> - **400-word cap** on findings (excluding `investigation_notes`).
> - **Budget precedence:** if findings would exceed 400 words, drop the
>   weakest findings first; never truncate SHAs or quoted commit bodies
>   mid-finding.

**Default Phase 3 classification heuristics** (still subject to the signal
filter):

- **re-litigation** → usually *fix in spec* (change the proposed approach)
  or *code comment* if the spec keeps it consciously.
- **eroded rationale** → usually *fix in spec* (re-evaluate against the
  still-valid constraint) or *code comment* documenting the constraint.
- **re-introduction pattern** → usually *code comment* at the recurring
  site, warning future editors.
- **dormant-area risk** → usually *code comment* surfacing the
  under-attended status, or *discard* when no concrete consequence
  emerges. This category is informational by nature; the signal filter
  trims aggressively here — expected, not a bug.

## Phase 3: Synthesize

When all agents return (Phase 2 + 2b), merge their findings. Tag each finding with the reviewer that raised it (several tags when reviewers converged). Apply two filters before classifying:

**Signal filter:** For each finding, ask: "would this change code behavior or prevent a test failure?" If not — if it's stylistic preference, vague caution, or a theoretical concern with no concrete trigger — discard it. Reviewers casting a wide net is expected; your job is to narrow. Aim for fewer, sharper findings over comprehensive coverage.

**Resolve, don't punt:** When a finding identifies a real issue, resolve it in the spec right now. Do not leave it as a "risk to remember" or "consideration for implementation." If the fix is obvious, apply it. If it requires a design choice, make the choice and document the reasoning. The spec should leave this phase tighter than it entered — no loose threads for the implementer to carry.

For each surviving finding, classify:

- **Fix in spec** — the spec text is wrong or incomplete, update it
- **Code comment** — the spec is fine but the implementation needs a specific explanatory comment at a specific location (name the file and the function/block)
- **Not a problem** — the reviewer flagged something that's actually handled; discard

Present the merged findings as a numbered list with classifications. Then immediately apply all "fix in spec" items — edit the spec file directly. For "code comment" items, add a note in the relevant spec section with the exact location (e.g., "Add a comment in `handleEvent()` explaining why X is safe here").

## Phase 4: Summary

Present what changed:

```
Savor: [spec name]
  Structural: systems + integration [+ testing strategy, or "(no test plan)"]
  Contextual: [persona names, or "none — pure plumbing"]
  Findings: N total (X fixed in spec, Y noted for code comments, Z discarded)
  Kept by reviewer: [reviewer: count, ... — a converged finding counts for each]
  Sections modified: [list]
  No scope changes.
```

The `Contextual:` line lists every persona that actually ran, including
the **historical reviewer** when its trigger fired (see Phase 2b). When
nothing contextual ran, write `"none — pure plumbing"`.

The `Kept by reviewer:` line counts findings that survived the signal
filter, per reviewer. It exists so a persona that stops earning its place
can be cut on evidence rather than gut: a reviewer with zero kept findings
across many savors is a candidate for removal.

## Rules

- **Never grow scope.** Do not add features, cycles, phases, or new files to the touchlist.
- **Never shrink scope.** Do not remove features, defer work the spec committed to, or weaken acceptance criteria.
- **Tighten only.** Fix incorrect assumptions, add missing edge case handling within existing scope, clarify ambiguous language, flag test breakage the TDD plan missed, and make each proposed test able to fail for the reason it names.
- **Respect design decisions.** If the spec chose approach A over B, do not re-litigate. Only flag if approach A literally won't compile or has a bug.
- **Fresh context is the point.** The agents don't see the conversation that produced the spec. Their naivete is the value — they'll ask "wait, does this actually work?" about things the author assumed.
- **One pass.** Savor runs once. If the user wants another round after fixes, they invoke `/savor` again. Don't recursively self-audit.
- **No implementation.** Savor edits the spec markdown. It never creates or modifies source code, tests, or build files. That's `/spec-to-ship`'s job.
