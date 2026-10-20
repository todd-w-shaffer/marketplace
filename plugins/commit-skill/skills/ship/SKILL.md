---
name: ship
description: Post-commit propagation cascade. Use when the user says "ship", "ship it", "push", "push it", "push and update docs", "propagate", "commit and ship", or any variation of wanting to push code and cascade documentation updates. Handles uncommitted changes automatically by invoking /commit first. Do NOT use for commit-only requests (those go to /commit).
---

# Ship Skill

Push committed code and propagate all downstream documentation changes.

## Execution style

Run silently — do NOT output intermediate progress, tool results, or commentary. The only user-visible output should be the final summary printed at the end (or an error message if something fails). Do not narrate what you are about to do or describe steps as you execute them.

## Workflow

### 0. Pre-flight

Run `token-ledger ship-begin` before anything else. It records the pre-push upstream sha that step 8 measures the rollup from, and prints nothing. `token-ledger` ships in this plugin beside `/commit`; if it isn't on PATH, the cost lines drop out and the ship carries on.

**Find the target**, the remote branch this ship pushes to. Run `git fetch origin` first.

- **The branch has an upstream** (`git rev-parse --abbrev-ref @{u}` succeeds): the target is `@{u}`.
- **No upstream, and the repo's CLAUDE.md says work goes straight to the default branch:** read the default from `git symbolic-ref refs/remotes/origin/HEAD` (never assume `main`). The target is `origin/<default>`.
- **No upstream otherwise:** this is a new branch. The target is `origin/<branch>`, and the push will publish it.

Note the target's current sha, if the target exists. Step 2 diffs from it.

Check `git status` for uncommitted changes.

- If there are **uncommitted changes**: invoke the `/commit` skill first. Wait for it to complete before proceeding. If the commit fails, STOP.
- If the working tree is clean and `git log <target>..HEAD` lists commits, or the target doesn't exist yet: proceed to step 1.
- If `git log <target>..HEAD` is empty: nothing to push. Say so and stop.

### 1. Push

**Pick the push command** for the target from step 0.

- **Upstream:** `git push`.
- **Straight to the default branch:** check `git merge-base --is-ancestor origin/<default> HEAD`.
  If it fails, run `git pull --rebase origin <default>` once; a conflict STOPs the ship. Then
  `git push origin HEAD:<default>`.
- **New branch:** `git push -u origin HEAD`. This publishes the branch and sets its upstream. It
  never touches the default branch, and opening a PR is left to the user.

**Run it in the background.** Run the push with the Bash tool's `run_in_background: true`, then
wait for its completion notification. Do not poll or sleep. A pre-push hook that runs the full
check can take ten minutes or more, and it may first wait behind another worktree's push lock.
A foreground timeout would make a working push read as a failed one. When the notification
arrives, read the output. A backgrounded command can exit 0 through a pipe even when the push was
refused, so the exit code decides nothing. Decide every attempt's outcome by `git fetch`: the
push succeeded only if the target now equals HEAD. The output says why an attempt failed, not whether it did.

**If the hook refuses the push**, never retry with `--no-verify`. If the refusal names failing
tests, rerun those files alone before deciding. A file that passes alone, in an area the pushed
commits don't touch, is a flake: retry the push once. Otherwise, or on a second refusal, STOP and
report the hook's output.

**If it fails with a non-fast-forward / "fetch first" rejection**, the remote has
moved since your last fetch — commonly a CI job or bot that writes back to the
branch. Run `git pull --rebase` (`git pull --rebase origin <default>` when pushing straight to the
default branch) and push again, once. If the rebase hits conflicts, or the second push also fails, STOP and report — do
not keep retrying and never force-push.

**Transport failures are retryable.** `RPC failed`, `curl 56`, `curl 22` with HTTP 408 or 5xx,
`the remote end hung up`, and `unexpected disconnect` are transport failures, not refusals. Retry
the push up to 3 times, adding `-c http.postBuffer=157286400` on the retries, and decide each
attempt by the fetch-and-compare above. If the third retry still fails, STOP and report.
The same applies to every `git fetch` in this skill, the one in step 0 and the one that decides
whether a push landed: retry a transport failure up to 3 times before treating it as a failure.

For any other push failure (auth, protected branch), STOP and report the error without retrying.
Only a hook refusal or a non-transport error stops the ship.

### 2. Determine the blast radius

Run `git diff <pre-push sha>..HEAD`, using the sha step 0 noted (i.e., the diff of everything that was just pushed). For a branch that was just published, which had no sha, use `git diff origin/<default>...HEAD`.

Read the diff and classify each changed file by what *kind* of change it represents (new route, changed middleware, new template, altered data model, added/removed source files, test count change, feature shipped/removed, etc.).

Then discover which documentation targets could be stale:

1. **CLAUDE.md** — scan the file's actual section headings and content. For each section, ask: "does the diff touch anything this section describes?" Only flag sections with a plausible connection.
2. **README.md** — the user-facing entry point, and the target most likely to be silently stale, because agents naturally reach for CLAUDE.md and stop there. Check it whenever the diff changes anything a *user* would encounter: a new or removed surface, an install or upgrade step, a new runtime dependency, a CLI flag, a hook or event, a directory that appears in a "project structure" listing. Do not skip it because CLAUDE.md already covers the change — they have different audiences, and CLAUDE.md being current is not evidence that README.md is.
3. **User-facing copy outside the docs** — installer prompts, `--help` text, onboarding strings, and anything else that describes the product to a user in prose. This drifts for exactly the same reason README.md does and is even easier to miss, since it lives in source files the diff may not have touched. Grep for the feature's old description, not just its name.
4. **docs/** — check if any docs describe systems touched by the diff (e.g., an auth spec when auth logic changed). Only read docs that are likely affected — do not scan every file.
5. **Memory index** — read `MEMORY.md` and identify any memory files that track state affected by the diff (feature status, test counts, architectural patterns). Memory file names vary by project — use the index to find them, don't assume names.

Reporting "Docs verified" is a claim about what you actually inspected. If a target above was not opened, it was not verified — say so rather than letting a green summary imply coverage the run did not have.

### 3. Read and compare

For each potentially stale target identified in step 2:

1. Read the specific section (not the whole file — use offset/limit for CLAUDE.md sections).
2. Compare against the diff. Ask: **"Is any statement in this section now factually wrong?"**
3. If yes, note the specific line(s) that need to change and what the correct statement is.
4. If no, skip it — do NOT rewrite sections that are still accurate.

**Critical rule: only edit lines that are now factually wrong.** Do not:
- Rewrite surrounding paragraphs for "flow"
- Add new sections unless a wholly new architectural concept was introduced
- Reorganize or reformat existing content
- Update prose style or wording that is technically correct

### 4. Read and compare — Memory

Read the memory index (`MEMORY.md`) and any memory files identified in step 2 as potentially affected by the changes.

Apply the same rule: **only update facts that are now wrong.** Common updates:
- Test count changed
- Feature status changed (shipped, removed, redesigned)
- New architectural pattern introduced that future conversations need to know

Do NOT create new memory files unless the changes introduced something that is:
- Not derivable from the code or CLAUDE.md
- Relevant to future conversations (not just this one)
- A user preference, project decision, or external reference

### 5. Apply updates

Make all edits using the Edit tool. Prefer surgical `old_string → new_string` replacements over rewriting blocks.

### 6. Commit documentation updates

If any files were changed in steps 3-4:

1. Stage only the documentation/memory files that were updated.
2. Commit with the message format:

```
docs(<scope>): sync with <description from the code commit>

Changes:
  <file> — <what was updated and why>
```

   - Take the scope and description from the code commit's subject (`feat(cli): add --dry-run flag` gives `docs(cli): sync with add --dry-run flag`). If the code commit had no scope, write `docs: sync with …`. If several code commits were pushed, describe the one the docs changes follow from.
   - Keep `sync with` word for word. token-ledger recognises /ship's own docs commit by that phrase, and in a repository with the commit gate installed (`commit-gate install`) git admits /ship's docs commit only under a subject the two recognise alike (`lib/commit-format.js`).
   - The subject stays under 70 characters. If it runs over, shorten the description, not the scope.
   - Never include `Co-Authored-By` lines, the same rule /commit follows.

3. Push the documentation commit.

If no files needed updating, skip this step.

### 7. Staleness nudge (only if the project opts in)

If — and only if — `scripts/staleness.mjs` exists in the repo, run it:

```bash
node scripts/staleness.mjs
```

Append its output verbatim to the end of the summary in step 8. Do not
reformat, expand, or editorialize it — the whole point is a small, glanceable
line, and padding it recreates the noise it exists to avoid.

If the script is missing, skip this step silently. Most projects will not have
it; that is expected, not a problem to report.

If the script errors or prints nothing, skip it and carry on. It is a nudge, not
a gate — it must never block or fail a ship.

### 8. Print summary

Run `token-ledger ship`. Its output is the `**Ship cost:**` block below — paste it verbatim, and never compute or adjust the numbers yourself. If the script is missing or fails, omit the block and carry on: the rollup never fails a ship.

Print ONLY the following:

```
**Shipped:** <commit subject line(s) that were pushed>

**Ship cost:** <the `token-ledger ship` block, verbatim>

**Docs updated:**
  <file> — <what changed>
  <file> — <what changed>

**Docs verified (no changes needed):**
  <file — section name>
```

If no docs were updated, replace the "Docs updated" section with:

```
**Docs verified:** All documentation is current — no updates needed.
```

## Important constraints

- Push failures are fatal — do not proceed to doc updates if push fails
- Never force-push
- Never amend previous commits
- Documentation commits are always separate from code commits
- If CLAUDE.md doesn't exist, skip that target — not the whole propagation step. README.md and user-facing copy are independent targets and are checked regardless
- If memory directory doesn't exist, skip memory propagation
- The bar for "needs updating" is **factual incorrectness**, not stylistic preference
- When updating test counts, get the actual count from the most recent test run output or `npm run test` — do not guess
