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

### 1. Build

`commit-run` (step 5) runs the build itself, before it stages anything: a `build` script in `package.json`, else `build.sh`, else a `Makefile`. Decide only its flag:

- The project's `CLAUDE.md` documents a different build command: pass `--build '<cmd>'`.
- The commit touches no source files (docs, notes, config the build does not read): pass `--no-build`.
- Otherwise pass neither.

### 2. Analyze and chunk changes

Know what changed before writing the message:
- Which files were modified
- The nature of each change (new feature, bug fix, content update, refactor, etc.)

If every change in the tree was made or reported in this conversation (your own edits, and the files a subagent said it changed), you already know this: skip the look and go on. Otherwise run `git status` and `git diff` (both staged and unstaged) first. Look when in doubt: when a subagent's report did not list its files, when the person may have edited files themselves, or when the session was summarized since the edits.

`commit-run` lists what it left in the tree (step 5), which is the check on skipping. A file there that belonged in this commit was a missed path: name it under **Remaining** in the summary (step 6), so it gets its own commit.

Then check: do all changes belong to one logical unit, or are there independent threads? Group by shared intent — files modified for the same reason travel together. Signals of independent threads:
- Files with no import/dependency relationship to each other
- Changes serving different purposes (feature work vs skill/tooling changes vs doc-only updates)
- Work that could be described with completely different subject lines

If everything is one unit, proceed silently. If multiple independent threads exist, what happens next depends on who called this skill (see "After the commit"):

- **A person asked for the commit directly:** break silence and present the proposed split:

  ```
  Detected N independent threads in this diff:
    (A) <type>(<scope>): <subject> — file1, file2, file3
    (B) <type>: <subject> — file4, file5
    (C) <type>(<scope>): <subject> — file6

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
<type>(<scope>): <concise narrative subject line>

Recipe: <distilled prompt that would reproduce this outcome in one
shot — captures the full arc of the conversation as a self-contained
instruction>

Changes:
  <file path> — <1-2 sentence narrative of what changed and why>
  <file path> — <1-2 sentence narrative of what changed and why>
```

Rules:
- Subject line: imperative mood, under 70 characters counting the prefix, no period
- If the prefix pushes the subject past 70, shorten the description, not the scope: `feat(cli): add --dry-run flag to preview writes`
- Type: the one that names the commit's main purpose. A feature that ships with its own tests is `feat`, not `test`; the type answers "why does this commit exist?"
  - `feat` — adds a new feature
  - `fix` — fixes a bug
  - `refactor` — restructures code without fixing a bug or adding a feature
  - `perf` — a refactor aimed at performance
  - `test` — adds missing tests or corrects existing ones
  - `docs` — documentation only, such as the README
  - `style` — formatting that doesn't change meaning (whitespace, semicolons)
  - `build` — build system, dependencies, project version
  - `ci` — continuous integration config
  - `ops` — infrastructure, deployment, backup, recovery
  - `chore` — miscellaneous changes that touch neither source nor tests (e.g. `.gitignore`)
  - `revert` — reverts a previous commit
- Scope: optional. Add it when the change sits in one clear area (a plugin, module, or directory a reader would recognize), e.g. `fix(token-ledger): …`. Leave it off when the change spans areas rather than inventing a vague umbrella
- Never include `Co-Authored-By` lines
- The Recipe is a synthesized artifact — it should read like something the user could paste into a new conversation and get 90% of the way to the same result
- The Changes section is narrative — explain *what* and *why*, not line counts
- Pass the message on stdin through a quoted HEREDOC (step 5)

### 5. Stage and commit

Make the commit with one Bash call to `commit-run`, naming the paths to commit and passing the message on stdin:

```
commit-run [--no-build | --build '<cmd>'] <path>... <<'EOF'
<the commit message>
EOF
```

It builds, runs `git add -- <paths>`, commits, then prints the commit, its files, what is left in the tree, any build warnings, and the `token-ledger commit` line. Do not run `git add`, `git commit`, `git status` or `token-ledger commit` yourself around it.

- Name only the files that are part of the current work, deletions included. Never name `.env`, credentials, or unrelated files. If the build produces tracked output files, name them too.
- A failed build stops `commit-run` before it stages anything: the commit is blocked (see "After the commit"). A refused `git commit` leaves the paths staged; fix the cause and run `commit-run` again with the same paths.
- Check its `left in the tree` list against your plan. A file you meant to commit that is still listed means a wrong path.
- Its last line, when it starts `**Cost:**`, is the Cost line in step 6: paste it verbatim, and never compute, estimate, or adjust the numbers yourself. With a split diff, each chunk is its own call and its own Cost line. No Cost line means the tally failed; omit it and carry on, since the tally never blocks a commit.
- If `commit-run` is not on PATH, fall back to separate Bash calls: `git add <paths>` as its own Bash call, then `git commit`, then `git status`, then `token-ledger commit`. A session in a worktree runs under an isolation guard that refuses a line joining git to another step, and refuses git inside `$(…)`.

### 6. Print summary

After a successful commit, print ONLY the following (and nothing else before it):

```
**Subject:** <subject line>

**Recipe:** <the recipe text>

**Changes:**
  <file> — <narrative>
  <file> — <narrative>

**Cost:** <the Cost line from `commit-run`, verbatim>
```

If `commit-run` listed build warnings, append them:

```
**Warnings:**
  <warning text>
  <warning text>
```

Omit the Warnings section entirely if there were none.

If a larger task called this skill and step 2 found more than one thread, or `commit-run` left a file in the tree that belonged in this commit, append what is still to commit, so the caller can call this skill for each:

```
**Remaining:** N threads, one call each
  (B) <type>(<scope>): <subject> — file3, file4
  (C) <type>: <subject> — file5
```

This is the only user-visible output for the entire commit run. Then follow "After the commit": the run is over, but the turn may not be.

## Important constraints

- Build failures block the commit — fix or report, do not proceed
- Build warnings are informational — do not block
- Never amend previous commits — always create new ones
- Never push to remote — only local commit
- If there are no changes to commit, say so in one line and hand control back to the caller: a larger task goes on to its next step; a person who asked for just a commit gets the one line and the turn ends
