---
name: commit
description: Structured narrative commit workflow with build validation and recipe distillation. This skill should be used when the user wants to commit code, says "commit this", "let's commit", "commit", "save this", "commit what we have", "make a commit", "commit my changes", or any variation of requesting a git commit. Use this skill for ALL commit requests, even casual ones.
---

# Commit Skill

Validate, build, and commit with a structured narrative commit message.

## Execution style

Run silently — do NOT output intermediate progress, tool results, or commentary. The only user-visible output of a commit run should be the final summary printed after a successful commit (or an error message if the commit fails). Do not narrate what you are about to do or describe steps as you execute them.

Silence governs output, not the turn. The summary ends the commit run; it does not by itself end the turn.

## After the commit

The summary is a checkpoint, not the end of the turn. What happens after it depends on who called this skill:

- **A larger task called it.** The commit is one step of something bigger: a sitting, a spec-to-ship run, a multi-commit plan, `/ship` (which calls `/commit` first), or a request that lists more steps after the commit ("commit A, then commit B, then …"). Print the summary, then go straight on to the caller's next step in the same turn: the next tool call follows the summary in the same message. Do not end the turn on the summary.
- **A person asked for just a commit.** Their message asks for a commit and nothing after it. Print the summary and end the turn.

If a plan, a brief, or another skill is still in progress, a larger task called this skill.

The real stops are not checkpoints: a failed build blocks the commit and ends the run, and the caller does not go on as if the commit landed.

## Workflow

### 1. Build (if applicable)

Check whether the project has a build step by looking for common indicators in order of precedence:

1. A `build` script in `package.json`
2. A `build.sh` or `Makefile` in the project root
3. A build command documented in the project's `CLAUDE.md`

If a build step exists and any source files are dirty (modified or untracked), run it. If the build fails, STOP — do not commit. If no build step is found, or no source files are dirty, skip this step.

### 2. Analyze and chunk changes

Run `git status` and `git diff` (both staged and unstaged) to understand what changed. Identify:
- Which files were modified
- The nature of each change (new feature, bug fix, content update, refactor, etc.)

Then check: do all changes belong to one logical unit, or are there independent threads? Group by shared intent — files modified for the same reason travel together. Signals of independent threads:
- Files with no import/dependency relationship to each other
- Changes serving different purposes (feature work vs skill/tooling changes vs doc-only updates)
- Work that could be described with completely different subject lines

If everything is one unit, proceed silently. If multiple independent threads exist, what happens next depends on who called this skill (see "After the commit"):

- **A person asked for the commit directly:** break silence and present the proposed split:

  ```
  Detected N independent threads in this diff:
    (A) <subject> — file1, file2, file3
    (B) <subject> — file4, file5
    (C) <subject> — file6

  Commit separately, or send as one?
  ```

  Wait for the user's choice. The user's reply ends this call, so do not commit in it: call this skill again through the Skill tool, once per chunk if committing separately, or once for everything if the user says "just send it", naming the chunk as the call's scope.

- **A larger task called this skill:** do not ask. Commit the first thread only, running steps 3-6 for it, and list the remaining threads in the summary (step 6). The caller calls this skill again for each remaining thread. If the caller named what to commit, that is the scope: commit only those threads and leave the rest of the tree alone.

**One call, one commit.** In a Claude Code session, a git hook refuses a commit that no call to this skill made room for, and each call makes room for exactly one commit. A second commit in the same call is refused.

If a knowledge graph exists (`graphify-out/GRAPH_REPORT.md`), use community structure to confirm groupings — files in the same community likely belong together.

### 3. Distill the recipe

Look back through the full conversation history that led to the current changes. The goal is NOT to capture the user's exact words — it's to synthesize a single, self-contained prompt that would reproduce this outcome in a cold conversation without multi-turn back-and-forth.

Guidelines for the recipe:
- Capture **intent and constraints**, not implementation details.
- Read like a good ticket: what to build, what the boundaries are, what the expected behavior is.
- If the conversation involved design decisions (e.g., "we considered X but rejected it because Y"), fold the *conclusion* into the recipe, not the deliberation.
- Omit conversational scaffolding ("yes", "let's do that", "what do you think"). Distill to the signal.

### 4. Write the commit message

Format:

```
<concise narrative subject line>

Recipe: <distilled prompt that would reproduce this outcome in one
shot — captures the full arc of the conversation as a self-contained
instruction>

Changes:
  <file path> — <1-2 sentence narrative of what changed and why>
  <file path> — <1-2 sentence narrative of what changed and why>
```

Rules:
- Subject line: imperative mood, under 70 characters, no period
- Never include `Co-Authored-By` lines
- The Recipe is a synthesized artifact — it should read like something the user could paste into a new conversation and get 90% of the way to the same result
- The Changes section is narrative — explain *what* and *why*, not line counts
- Use a HEREDOC to pass the commit message to `git commit -m`

### 5. Stage and commit

- Stage only the files that are part of the current work. Never stage `.env`, credentials, or unrelated files.
- If a build step produced output artifacts that are tracked by git, include them.
- Create the commit. Run `git status` after to confirm success.
- Run `token-ledger commit --sha $(git rev-parse HEAD)`. Its single line of output is the `**Cost:**` line in step 6 — paste it verbatim, and never compute, estimate, or adjust the numbers yourself. With a split diff, each chunk is its own call and tallies itself after its own commit, so each chunk's summary carries its own Cost line. If the script is missing or fails, omit the Cost line and carry on: the tally never blocks a commit.

### 6. Print summary

After a successful commit, print ONLY the following (and nothing else before it):

```
**Title:** <subject line>

**Recipe:** <the recipe text>

**Changes:**
  <file> — <narrative>
  <file> — <narrative>

**Cost:** <the `token-ledger commit` line, verbatim>
```

If the build produced any warnings, append them:

```
**Warnings:**
  <warning text>
  <warning text>
```

Omit the Warnings section entirely if there were none.

If a larger task called this skill and step 2 found more than one thread, append the threads still to commit, so the caller can call this skill for each:

```
**Remaining:** N threads, one call each
  (B) <subject> — file3, file4
  (C) <subject> — file5
```

This is the only user-visible output for the entire commit run. Then follow "After the commit": the run is over, but the turn may not be.

## Important constraints

- Build failures block the commit — fix or report, do not proceed
- Build warnings are informational — do not block
- Never amend previous commits — always create new ones
- Never push to remote — only local commit
- If there are no changes to commit, say so in one line and hand control back to the caller: a larger task goes on to its next step; a person who asked for just a commit gets the one line and the turn ends
