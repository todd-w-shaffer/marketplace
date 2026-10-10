# Move the commit gate into the plugin

**Status:** draft, 2026-10-09. Review with `/savor` before building.

## Problem

`/commit`, `/ship` and shoots.film's commit gate share one contract, but it lives in four places across two
repositories:

| Rule | Lives in |
|---|---|
| The commit message format (`Recipe:` line; `/ship`'s docs subject) | `plugins/commit-skill/skills/commit/SKILL.md`, `plugins/ship-skill/skills/ship/SKILL.md` |
| Recognising `/ship`'s docs commit for the cost rollup | `plugins/commit-skill/bin/token-ledger` (`DOCS_SUBJECT`) |
| Admitting a commit only through `/commit` or `/ship` | shoots.film `scripts/commit-gate.sh`, `commit-gate-mint.sh`, `commit-gate-guard.sh`, `.claude/settings.json` |
| The tests that pin it | shoots.film `test/scripts/commit-gate-{contract,hooks}.test.mjs`, marketplace `test/token-ledger.test.js` |

On 2026-10-09 ship-skill 1.2.0 changed `/ship`'s docs subject to `docs(<scope>): sync with …`. Nothing in this
repository could see that shoots.film's gate admits only `Update docs to reflect:`, so every `/ship` that updates
docs in shoots.film would have been refused at its docs commit. 1.2.1 reverted the subject (`884bf44`).

The gate is part of the commit pipeline: it mints on the skills' names and checks the skills' formats. It should
ship with them, tested against the same matcher, in one plugin.

## Goals

- One plugin owns `/commit`, `/ship`, `token-ledger` and the gate, with one version and one test suite that CI runs.
- One matcher for "is this `/ship`'s docs commit?" and "does this message carry a Recipe?", used by both the gate
  and `token-ledger`.
- The gate is opt-in per repository. Installing the plugin alone changes nothing about how commits work anywhere.
- shoots.film keeps every guarantee it has today, proven by the same named tests, and drops its own copy.
- `/ship`'s typed docs subject (`docs(<scope>): sync with …`) returns, landing in the gate and the ledger together.

## Non-goals

- Closing the gate's known residues (below). They carry over unchanged.
- shoots.film's `pre-push` hook. It runs shoots.film's own checks and stays there.
- Enforcing the commit format beyond what the gate checks today. The `Recipe:` check stays loose on purpose (see
  the comment in `commit-gate.sh`: a stricter check would copy `SKILL.md` into a pattern).

## Decisions

### D1. One plugin: commit-skill absorbs `/ship`

ship-skill cannot work alone: it calls `/commit`, runs commit-skill's `token-ledger`, and its docs commit passes
the gate only under commit-skill's matcher. Two plugins means a version matrix ("requires commit-skill 1.3.2+")
that nothing enforces.

**Recommendation:** move `skills/ship/` into commit-skill as 2.0.0. `/commit` keeps its name
(`commit-skill:commit`), so existing installs don't move; `/ship` becomes `commit-skill:ship`. ship-skill gets a
final release whose description says it moved, and comes off the marketplace list one release later.

*Alternative:* a new plugin (e.g. `commit-ship`) holding both, with both old plugins deprecated. Cleaner name, two
migrations instead of one.

### D2. Opt-in: the `commit-msg` stub is the switch

A plugin can't install a git hook, and shouldn't: a public plugin must not gate commits in repositories that never
asked. The plugin's hooks also run in every project where it is enabled, so the mint and guard have to stay inert
where no gate is installed.

**Design:** a repository is gated when its `commit-msg` hook is the plugin's stub, recognised by a marker line. The
mint and the guard both check for the stub first and do nothing without it. So the plugin writes no token files
into ungated repositories' `.git/`, and the guard never denies `--no-verify` or `env -i` there.

### D3. The stub finds the gate on PATH, and fails closed

The plugin's `bin/` is on the Bash tool's PATH while it's enabled (documented), and the stub runs only when
`CLAUDECODE` is set, so it always runs under a Claude Code shell.

```sh
#!/bin/sh
# commit-skill commit gate: written by `commit-gate install`
[ -n "${CLAUDECODE:-}" ] || exit 0
command -v commit-gate >/dev/null 2>&1 || { echo "commit-gate: not on PATH; enable commit-skill, or run 'commit-gate uninstall' from a terminal" >&2; exit 1; }
exec commit-gate check "$@"
```

**Fails closed:** with the plugin disabled, a Claude Code session can't commit in a gated repository. That matches
today, where a branch without `scripts/commit-gate.sh` is refused. Outside Claude Code the stub exits 0, as now.

**Must be proven first:** that a git hook spawned by a Bash-tool `git commit` inherits the plugin's `bin/` on PATH.
The docs don't say. Probe it before building anything else; if it fails, the stub falls back to a path that
`commit-gate install` records.

### D4. Node, not bash, and no `jq` or `perl`

The gate, mint and guard are bash with `jq` and `perl`. As plugin code, they'd make every user install `jq` and
`perl`, and the matcher would live in a second language. `token-ledger` already requires Node.

**Design:** `bin/commit-gate` (Node) with subcommands `check <msgfile>`, `mint`, `guard`, `install`, `uninstall`,
`status`. A shared `lib/commit-format.js` exports `isShipDocs(subject)` and `hasRecipe(message)`, and
`token-ledger` requires it in place of its own `DOCS_SUBJECT`.

**Cost to watch:** the guard runs on every Bash call in every project. The hook command has to bail out before
starting Node when the repository isn't gated: a small `sh` front that checks for the stub marker, a single
`git rev-parse` plus a `grep`. Measure it: under 10 ms on an ungated repository.

### D5. Hooks ship in the plugin

`hooks/hooks.json`:

- `PreToolUse` on `Skill`: `commit-gate mint`
- `UserPromptSubmit`: `commit-gate mint`
- `PreToolUse` on `Bash`: `commit-gate guard`

Each command goes through `${CLAUDE_PLUGIN_ROOT}`. The mint keeps today's rules unchanged: the session id from
`CLAUDE_CODE_SESSION_ID`, the git dir from `CLAUDE_PROJECT_DIR`, subagent calls ignored, a day's pruning, and a
silent exit 0 on every path. It grants on `commit-skill:commit`, `commit-skill:ship`, typed `/commit` and `/ship`,
and, during the migration, `ship-skill:ship`.

## Migration

Ordered so that no step leaves shoots.film unable to commit.

1. **Probe** (D3). A throwaway repository with a stub that prints `command -v commit-gate`, committed from a Bash
   tool call. Record the result in this spec.
2. **commit-skill 2.0.0.** Add `lib/commit-format.js`, `bin/commit-gate`, `hooks/hooks.json` and `skills/ship/`, and
   point `token-ledger` at the shared matcher. `/ship` still writes `Update docs to reflect:`; the matcher accepts
   both forms. Port both shoots.film test files to `node:test`, keeping every test name and every row of S103's
   mutation table. CI runs them.
3. **shoots.film switches**, from a shoots.film session. With 2.0.0 enabled, the project's hooks and the plugin's
   both mint the same token file and both guard. That's harmless (deny wins, tokens are idempotent), so this
   overlap is the safe window.
   1. `install-hooks.sh` writes the plugin's stub for `commit-msg`, keeping its own `pre-push`. It writes the
      stub text itself, because `npm prepare` runs outside Claude Code where `commit-gate` isn't on PATH.
   2. Remove the three hook entries from `.claude/settings.json`.
   3. Remove `scripts/commit-gate*.sh` and the two test files.
   4. Update `CLAUDE.md` and `docs/e2e-testing.md:481` to point at the plugin.

   Each removal is Todd's call at the time (shoots.film's no-delete rule).
4. **Typed docs subject.** `/ship` writes `docs(<scope>): sync with …`. A gate test and a ledger test drive it from
   ship's `SKILL.md` template, as `token-ledger.test.js` does today. commit-skill 2.1.0.
5. **Retire ship-skill.** A last release whose description and skill say "moved to commit-skill", then off the list.

## Testing

Test-first throughout. Each ported test runs red against a deliberately broken gate before it goes green.

- **Ported:** every `it` in `commit-gate-contract.test.mjs` (the gate) and `commit-gate-hooks.test.mjs` (the mint
  and guard), renamed to describe the plugin, plus every mutation in S103's table.
- **New:**
  - The mint and the guard do nothing in a repository without the stub: no token directory, no deny.
  - The stub exits 0 outside Claude Code, and refuses with the named message when `commit-gate` isn't on PATH.
  - `install` refuses to overwrite a `commit-msg` hook it didn't write (as `install-hooks.sh` does today), and
    `uninstall` removes only its own.
  - `isShipDocs` and `hasRecipe` cases are shared between the gate and the ledger: one table, run against both.
  - ship's `SKILL.md` subject template passes `check` under a `ship-docs` token (the drift test, gate side).
  - The guard's fast path: an ungated repository never starts Node (assert on a missing-Node PATH).
- **Live proof**, as S103 did:
  1. A bare `git commit` from a session is refused.
  2. `/commit` lands.
  3. A `/ship` docs commit lands.
  4. Todd's terminal commit lands.
  5. `--no-verify` and `env -i` are denied.

## Carried residues (unchanged)

- A subagent's commit by hand can spend the main thread's token (shared session id).
- The guard is defence in depth: a script file, an alias or a flag spelled at run time passes it.
- `revert`, `cherry-pick` and `rebase` run no `commit-msg`. A session's non-fast-forward merge is refused.

## Open questions

1. D1: absorb into commit-skill (recommended), or a new plugin?
2. D3: fail closed (recommended) or open when the plugin is disabled in a gated repository?
3. Does the marketplace repository itself install the gate once it exists?
4. Should `commit-gate status` show up somewhere a user would see it, such as `/commit`'s summary when a
   repository is gated?
