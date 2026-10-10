# Move the commit gate into the plugin

**Status:** steps 1–4 done, 2026-10-10. Step 2: commit-skill 2.0.0. Step 3: shoots.film `00bb077e` and `db4a6767`, live
proof passed. Step 4: shoots.film `faed905e`, commit-skill 2.1.0. Step 5 open. Savored 2026-10-09; D1 and D3 settled with Todd.

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

**Decided (Todd, 2026-10-09):** move `skills/ship/` into commit-skill as 2.0.0. `/commit` keeps its name
(`commit-skill:commit`), so existing installs don't move and the gate's mint keeps matching it; `/ship` becomes
`commit-skill:ship`. ship-skill gets a final release whose description says it moved, and comes off the
marketplace list one release later.

A new plugin holding both was rejected: it renames `/commit` too, so every name the mint and shoots.film's
`autopilot.sh` match would change at once, across two migrations.

### D2. Opt-in: the `commit-msg` stub is the switch

A plugin can't install a git hook, and shouldn't: a public plugin must not gate commits in repositories that never
asked. The plugin's hooks also run in every project where it is enabled, so the mint and guard have to stay inert
where no gate is installed.

**Design:** a repository is gated when its `commit-msg` hook is the plugin's stub, recognised by a marker line. The
mint and the guard both check for the stub first and do nothing without it. So the plugin writes no token files
into ungated repositories' `.git/`, and the guard never denies `--no-verify` or `env -i` there.

**Which repository.** The mint, the guard's `sh` front and `install` find the hooks directory the same way:
`git -C <dir> rev-parse --path-format=absolute --git-path hooks`, or the plain-shell shortcut in D4. If they
disagreed, the gate would run while the mint stayed inert, and every commit would be refused. The mint keeps
today's rule (`CLAUDE_PROJECT_DIR`, else the payload's `cwd`). The guard treats a command as gated when
`CLAUDE_PROJECT_DIR` **or** the payload's `cwd` is gated. Otherwise a session that `cd`ed into an ungated
directory could run `git -C <gated repo> commit --no-verify` past it.

`install` refuses when `core.hooksPath` is set: git would not run a stub in `.git/hooks`, and the D4 shortcut
would not find one elsewhere.

### D3. The stub finds the gate on PATH, and fails closed

The plugin's `bin/` is on the Bash tool's PATH while it's enabled (documented). The stub runs the gate only when
`CLAUDECODE` is set; Claude Code sets it in the Bash shell (observed, not documented), and any child of that
shell inherits it.

```sh
#!/bin/sh
# commit-skill commit gate: written by `commit-gate install`
[ -n "${CLAUDECODE:-}" ] || exit 0
command -v commit-gate >/dev/null 2>&1 || { echo "commit-gate: commit-skill is not enabled, so a Claude Code session cannot commit in this repository. Enable commit-skill, or remove .git/hooks/commit-msg from a terminal to ungate it." >&2; exit 1; }
exec commit-gate check "$@"
```

**Fails closed (decided, Todd, 2026-10-09):** with the plugin disabled, a Claude Code session can't commit in a
gated repository. That matches today, where a branch without `scripts/commit-gate.sh` is refused. Failing open
would ungate the repository whenever `enabledPlugins` turned the plugin off, which a session can write itself.
Outside Claude Code the stub exits 0, as now. If `commit-gate` is found but Node is missing, `env node` exits 127
and the commit is refused without the named message; the stub test pins that it still refuses.

**`install` and `uninstall` refuse when `CLAUDECODE` is set.** They are on the session's PATH, and today ungating
takes a hand edit of the hook, not a shipped command. A person runs them from a terminal, where `bin/` is not on
PATH: `node <plugin dir>/bin/commit-gate uninstall`, or removing `.git/hooks/commit-msg` by hand. The stub's message
names the second, which needs nothing installed.

**Probed 2026-10-09, CLI 2.1.296, maintainer's local directory source:** a `commit-msg` hook run by a Bash-tool
`git commit` saw `CLAUDECODE=1` and found `token-ledger` on PATH, so a git hook inherits `bin/`. On this machine
that entry is the working copy (`~/Desktop/apps/marketplace/plugins/commit-skill/bin`), not the plugin cache.
**Repeated from a URL install, 2026-10-09** (commit-skill 1.3.3 installed by URL into an isolated
`CLAUDE_CONFIG_DIR`): the hook saw `CLAUDECODE=1` and resolved `token-ledger` to
`<config>/plugins/cache/todd-w-shaffer/commit-skill/1.3.3/bin/token-ledger`. PATH lookup holds for both install
kinds. The fallback below is not needed. The resolved path names the version, which is why the stub must look up
`commit-gate` on PATH rather than record where it was found.

**Fallback, if the URL probe fails:** the stub runs a launcher that `install` writes under `${CLAUDE_PLUGIN_DATA}`,
which survives plugin updates, and the mint rewrites that launcher to point at the current `${CLAUDE_PLUGIN_ROOT}`.
It must not record a path in the cache: `cache/<marketplace>/commit-skill/<version>/` changes on every update, and
with the gate failing closed a stale path locks the repository out.

### D4. Node, not bash, and no `jq` or `perl`

The gate, mint and guard are bash with `jq` and `perl`. As plugin code, they'd make every user install `jq` and
`perl`, and the matcher would live in a second language. `token-ledger` already requires Node.

**Design:** `bin/commit-gate` (Node) with subcommands `check <msgfile>`, `mint`, `guard`, `install`, `uninstall`,
`status`. A shared `lib/commit-format.js` exports `isShipDocs(subject)` and `hasRecipe(message)`, and
`token-ledger` requires it in place of its own `DOCS_SUBJECT`.

**The matcher's contract.**

- `isShipDocs(subject)` takes a subject that has already been extracted, and is today's `DOCS_SUBJECT`: loose on
  case, spacing, a breaking-change `!` and nested parentheses in the scope, because a model writes the subject.
  `token-ledger.test.js` pins those slips. **The gate loosens to match (Todd, 2026-10-09):** under a `ship-docs`
  token it admits what the ledger counts, typed form included. Only a `/ship` call mints that token, so a capital
  letter shouldn't refuse its docs commit.
- Each caller keeps its own way of extracting the subject. The gate reads the raw message file: the first line
  that is neither blank nor starts with `#`. `#` is fixed, as today; `core.commentChar` is not read. The ledger
  reads git's cleaned `%s`.
- `hasRecipe(message)` is `/^Recipe:/m` over the raw text, comment lines included, as `grep -q '^Recipe:'` reads it
  today. A CRLF message is a test row.

**`check` keeps today's order and spends the token atomically.** It checks the `commit` token before
`ship-docs`, and a refused message keeps its token. It claims a token with `unlinkSync` and admits the commit only
if that call succeeded, so two parallel commits in one session can't both spend one token. The mint prunes tokens
older than 24 hours (`find -mtime +0` today).
*Code comment:* in `commit-gate check`, explain the order and why the claim is an unlink.

**Cost to watch:** the guard runs on every Bash call in every project, so the hook command bails out before
starting Node when the repository isn't gated. `sh` plus `git rev-parse` plus `grep` measured 12–14 ms, which is
over budget, so the `sh` front tests in plain shell first:

- When `$CLAUDE_PROJECT_DIR/.git` (and the payload's `cwd` the same way) is a directory, it reads
  `.git/hooks/commit-msg` directly.
- It calls `git rev-parse` only when `.git` is a file, i.e. a linked worktree.
- `grep` takes the hook file as an argument, never stdin, because stdin carries the hook's JSON. Errors go to
  `/dev/null`, and the front prints nothing.

Measure it: under 10 ms on an ungated repository and outside any repository. **Measured 2026-10-09:** 8.4 ms
median on an ungated repository, against 3.4 ms for a bare `sh -c true` spawned the same way. The front skips
`grep` when there is no `commit-msg` hook at all.

### D5. Hooks ship in the plugin

`hooks/hooks.json`:

- `PreToolUse` on `Skill`: `commit-gate mint`
- `UserPromptSubmit`: `commit-gate mint`
- `PreToolUse` on `Bash`: `commit-gate guard`

Each command calls `"${CLAUDE_PLUGIN_ROOT}/scripts/gated" mint|guard`, quoted, never a bare name: the docs don't say
whether `bin/` is on PATH for hook commands. `scripts/gated` is D4's `sh` front; it lives outside `bin/` so it isn't
on the session's PATH, and it runs `node "${0%/*}/../bin/commit-gate"`. Each hook sets `"timeout": 5` (the defaults are 600 s and 30 s).

The mint keeps today's rules unchanged:

- the session id comes from `CLAUDE_CODE_SESSION_ID` (observed in the environment, not documented);
- the git dir comes from `CLAUDE_PROJECT_DIR`;
- subagent calls are ignored;
- tokens older than a day are pruned;
- it exits 0 silently on every path. `UserPromptSubmit` stdout goes into the session's context, so it prints
  nothing.

It grants on **exact names only**: `commit-skill:commit`, `commit-skill:ship`, typed `/commit` and `/ship`, and
`ship-skill:ship`. `ship-skill:ship` stays until ship-skill is uninstalled where it's used, not just off the
list. Skill names carry no marketplace, so another plugin's `foo:ship` must not match.

The guard keeps today's denials and adds three, because the move puts new things on the session's PATH:

- `commit-gate` followed by `mint`, `guard`, `install` or `uninstall`;
- a `PATH` assignment (`PATH=`, `PATH+=`, `export PATH`) on a command line that holds `git … commit`, which would
  put a fake `commit-gate` ahead of the real one. Today's stub runs a fixed path, so this hole is new.

## Migration

Ordered so that no step leaves shoots.film unable to commit.

1. **Probe** (D3). PATH inheritance passed on the local directory source and on a URL install (see D3). Still to
   probe, and record here:
   - that a plugin `PreToolUse` hook on `Skill` sees `tool_input.skill == "commit-skill:ship"`;
   - whether a session's own write of `enabledPlugins: false` takes effect mid-session. If it does, the guard
     disappears while the stub refuses, and `--no-verify` then skips the stub: add that to the residues.
2. **commit-skill 2.0.0.**
   - **Built 2026-10-09.** 157 tests pass. All 26 mutations (S103's eleven that port, plus one per new rule)
     each turned their named test red. The one that first survived, the mint ignoring the gate, was masked by the
     front; the test "the mint writes no token into an ungated project when only the cwd is gated" catches it.
   - Add `lib/commit-format.js`, `bin/commit-gate`, `scripts/gated`, `hooks/hooks.json` and `skills/ship/`, and point `token-ledger`
     at the shared matcher. `/ship` still writes `Update docs to reflect:`; the matcher accepts both forms.
   - Port both shoots.film test files to `node:test` (see Testing). CI runs `node --test plugins/commit-skill/test/`
     in place of the one hardcoded file.
   - Point `token-ledger.test.js`'s `shipDocsSubjects()` at `../skills/ship/SKILL.md`. It reads
     `../../ship-skill/...` today, which would keep passing on the stale copy.
   - Update the references to the old layout: ship `SKILL.md:18` ("`token-ledger` comes from commit-skill") and
     `:106` (names shoots.film's `scripts/commit-gate.sh`), and the `token-ledger:8-9` comment ("ship-skill ships no
     copy of its own").
   - On the maintainer's machine the marketplace is a local directory source, so an uncommitted edit that breaks
     `check` takes effect at once and refuses every session commit in shoots.film. Recovery: remove
     `.git/hooks/commit-msg` from a terminal, then run `install-hooks.sh` again.

   2a. **shoots.film learns the new name, before 2.0.0 is enabled there.** Until step 3.1 installs the plugin's
   stub, D2 keeps the plugin's mint inert, so shoots.film's own mint is the only one running. It treats
   `commit-skill:ship` as another skill and deletes the token, so `/ship`'s docs commit would be refused. In one
   shoots.film commit:
   - `commit-gate-mint.sh` grants `ship-docs` on `commit-skill:ship`;
   - `autopilot.sh:219` and `:391` accept `commit-skill:ship` beside `ship-skill:ship`;
   - `commit-gate-hooks.test.mjs` and `autopilot-contract.test.mjs` get a row each.
3. **shoots.film switches**, from a shoots.film session. Once the plugin's stub is installed, the project's hooks
   and the plugin's both mint and both guard. Every matching hook runs in parallel and none is deduplicated. After
   2a both mints decide the same way, and the guards can only add denials, so the overlap is harmless.

   Steps 1–3 below land as **one commit**. `commit-gate-contract.test.mjs` copies `install-hooks.sh` and asserts the
   old stub, so changing the installer alone turns pre-push red.
   1. `install-hooks.sh` writes the plugin's stub for `commit-msg`, keeping its own `pre-push`. It writes the stub
      text itself, because `npm prepare` runs outside Claude Code, where `commit-gate` isn't on PATH. It replaces a
      `commit-msg` that carries either its old `GATE_MARKER` or the plugin's marker, and still refuses any other.
      Its stub text is pinned byte for byte to the plugin's (see Testing).
   2. Remove the three hook entries from `.claude/settings.json`.
   3. Remove `scripts/commit-gate*.sh` and the two test files, keeping the installer's tests (moved or rewritten)
      and the byte-equality test.
   4. Update `CLAUDE.md:34` and `docs/e2e-testing.md:481` to point at the plugin.

   Each removal is proposed to Todd and is his call at the time (shoots.film's no-delete rule).
4. **Typed docs subject.** `/ship` writes `docs(<scope>): sync with …`.
   - A gate test and a ledger test drive it from ship's `SKILL.md` template.
   - In the same window, shoots.film's `autopilot.sh:231-232` accepts the typed subject beside `Update docs to
     reflect:`, with rows in `autopilot-contract.test.mjs` (187, 560–589).
   - commit-skill 2.1.0.
5. **Retire ship-skill.** A last release whose description and skill say "moved to commit-skill", then off the list.
   - The mint drops `ship-skill:ship` only after that.
   - Todd's memory files that name `ship-skill` need updating, and are his to edit:
     `anthropic-studies-plugin/memory/feedback_commit_ship_skills.md` and
     `coolant/memory/reference_commit_skill_location.md`.

## Testing

Test-first throughout. Each ported test runs red against a deliberately broken gate before it goes green.

**Harness rules, for every test in the suite:**

- **The environment is a whitelist**, like `token-ledger.test.js`'s: `HOME`, the `GIT_AUTHOR_*` and
  `GIT_COMMITTER_*` identity, and a `PATH` made of the working tree's `bin/` plus the system directories. Nothing
  else from the runner gets through, so an installed `commit-gate`, a stray `CLAUDE_PROJECT_DIR` or the shell's own
  `CLAUDECODE` can't leak in.
- **Every refusal goes through one `refused(r, reason)` helper**, which asserts the exit status, an unmoved `HEAD`
  and the gate's own reason in stderr. Without the reason, "not on PATH" or a Node crash would pass for a
  refusal.
- **Every `spawnSync` has `timeout: 5000`** and asserts `!r.signal`. `node:test` has no default timeout, and a
  hook that waits on stdin must fail, not hang.

**Ported.** Every `it` in `commit-gate-contract.test.mjs` (the gate) and `commit-gate-hooks.test.mjs` (the mint
and guard), renamed to describe the plugin, with these changes:

- **Mint and guard tests run in a gated repository.** `beforeEach` runs `commit-gate install`, and the payload's
  `cwd` and `CLAUDE_PROJECT_DIR` both point at that repository. Otherwise D2 makes both hooks inert, and every
  "allowed" and "writes nothing" row passes trivially.
- **They run the commands in `hooks/hooks.json`.** Each is read from the file and run with `sh -c`, with
  `CLAUDE_PLUGIN_ROOT` set to the working tree. That puts the `sh` front under test and replaces the three tests
  that read `.claude/settings.json`.
- **"admits Todd's commit on a branch that predates the gate script" is rewritten, not ported.** The script no
  longer lives on the branch. Its replacement: Todd's terminal commit lands in a gated repository with the plugin
  disabled.

S103's mutation table ports for these rows:

- Recipe;
- leftover token;
- session id;
- mint on every skill;
- the deletion;
- `-n`;
- the prompt anchor;
- the mint's directory;
- the payload's session id;
- the subagent;
- the `commit-gate/` boundary (the `>commit-gate/t` and `--directory=commit-gate/` denied rows).

These rows don't port; they stay in shoots.film with what they test:

- the watcher milestone;
- the README log name;
- the pre-push installer.

**New.**

- **The mint and the guard do nothing in a repository without the stub:** no token directory, no deny. This
  covers the cwd outside any repository too, and has its own `describe`.
- **The guard treats a command as gated when the project or the `cwd` is gated** (`git -C <gated> commit -n` from
  an ungated `cwd` is denied). It also denies `commit-gate mint|guard|install|uninstall` and a `PATH` assignment on
  a `git commit` line.
- **The stub tests run the exact file `install` writes, through a real `git commit`.**
  - It exits 0 outside Claude Code.
  - With `PATH` set to git's own directory plus `/bin`, it refuses with D3's exact message.
  - With `commit-gate` found but no `node`, it refuses.
- **`install` and `uninstall` guard the hook.**
  - `install` refuses to overwrite a `commit-msg` hook it didn't write (as `install-hooks.sh` does today), and
    refuses when `core.hooksPath` is set.
  - `uninstall` removes only its own stub.
  - Both refuse when `CLAUDECODE` is set.
- **`isShipDocs` and `hasRecipe` share one table of raw messages**, including rows with `#` comments, leading
  blank lines, case variants and CRLF.
  - The gate runs each row through a real commit under the matching token.
  - The ledger runs the `isShipDocs` rows through `git log %s` and `ship`.
  - `hasRecipe` has no caller in the ledger, so its rows run against the gate only.
- **The drift test, gate side:** ship's `SKILL.md` subject template (`../skills/ship/SKILL.md`) passes `check` under
  a `ship-docs` token.
- **The guard's fast path.** The test builds a bin directory holding only `git`, `grep` and `cat` (the front's tools), plus a fake `node`
  that writes a sentinel file. The sentinel must be written in a gated repository and not in an ungated one, so
  a missing `git` can't pass the test by reading as "ungated".
- **If step 1 forces the D3 fallback**, a stub test for the launcher path.
- **shoots.film keeps a test that pins its installer's stub byte for byte to the plugin's**, so the plugin's
  `uninstall` and marker check recognise it.

**Live proof**, as S103 did:

1. A bare `git commit` from a session is refused.
2. `/commit` lands.
3. A `/ship` docs commit lands. A plugin hook minted it for `commit-skill:ship`.
4. Todd's terminal commit lands.
5. `--no-verify` and `env -i` are denied.
6. In an ungated repository with the plugin enabled, a session commit lands, and no `.git/commit-gate` appears.

**Run 2026-10-10 in shoots.film (reported by its step 3 session):**
- 1: a bare session commit was refused with "no /commit call made room for this commit".
- 2: the step 3 commits landed through `/commit`.
- 3: `/ship`'s docs commit `552964c7` landed under a `ship-docs` token minted on `commit-skill:ship`. The plugin's
  mint was the only one left in the project.
- 4: Todd's terminal commit `12e343c4` landed, on a scratch branch.
- 5: both commands were denied by the plugin's guard.
- 6: still open. It needs a session that started with 2.0.0 or later committing in an ungated repository.

## Residues

Carried unchanged:

- A subagent's commit by hand can spend the main thread's token (shared session id).
- The guard is defence in depth: a script file, an alias or a flag spelled at run time passes it. That includes a
  `PATH` override hidden in a script file.
- `revert`, `cherry-pick` and `rebase` run no `commit-msg`. A session's non-fast-forward merge is refused.
- The mint can be run by hand with a crafted payload through a path the guard doesn't spell, as
  `scripts/commit-gate-mint.sh` can today.

New with the move:

- A command that commits in a gated repository that is neither the project nor the `cwd` passes the guard. The
  stub still runs the gate.
- On a shoots.film branch older than step 3, `npm install`'s `prepare` exits non-zero: the old installer doesn't
  recognise the plugin's stub, and leaves it in place. The gate still works; rebasing fixes the install.
- If gating the marketplace repository itself (open question 3), a session there could edit the gate it is
  running from the working copy, as it can edit `scripts/commit-gate.sh` in shoots.film today.

Gone: S103's "a session on a branch older than `e70b76ad` is refused". The plugin's stub doesn't depend on the
branch.

## Open questions

1. ~~D1~~: settled, absorb into commit-skill.
2. ~~D3~~: settled, fail closed.
3. Does the marketplace repository itself install the gate once it exists?
4. Should `commit-gate status` show up somewhere a user would see it, such as `/commit`'s summary when a
   repository is gated?
