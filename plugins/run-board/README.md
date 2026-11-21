# run-board

A Claude Code mod that shows the shoots.film autopilot runs beside the chat. It reads the files the
dispatcher writes and never starts a model turn, so it costs no tokens.

- **Hint line.** The end of the dim line under the prompt shows each running sitting with its stage
  as a one-cell-per-phase bar, the phase in flight and how long it has run, then
  how many briefs wait and the cost so far: `● S393 ⣿⣤⣀⣀⣀⣀⡇ c2 1h12m │ ○ 1 │ $12.22`.
  It is empty when nothing runs or waits.
- **Progress bar.** Each run's card has a braille block per phase of the fixed chain: step 0's `savor` when the run has one (from the
  `sittings:savor launch` line to the `/commit` that holds its edits, or to the launcher's `savored:` line), each cycle, then `⋮` where session 2 takes over, simplify, the xhigh review, the ship and the archive. A block is a full `⣿` run in green when done, a
  peach taper in flight and a grey `⣀` baseline to come, and the bar ends in a `⡇` cap. The lane's name is a
  pill on the raised surface, in the lane's colour (pink epic, teal fix). The cycle count is the brief's `### Cycle` headings (or `**Cycle` lines)
  on `origin/main`, counted once per blob. Cycle k closes when a `/commit` naming `cycle k` is followed by a
  `code-review low` line; the ship starts at `/ship` or a push, and the archive at the first `/commit` after
  the ship's push. Under the bar, the phase line reads `session 1 · Bash: Run the focused check`: the
  session in flight (the savor is session 0, a cycle session 1, simplify through the archive session 2; the
  bar's lit label names the phase), the stage when it adds to it, and the newest tool call, read from the last 256 KiB of the run's
  stream-json `.log` with `tail -c`, because the log can pass the 4 MiB read cap.
- **The architecture loop.** While `scripts/archloop.sh` holds its lock, a card and the hint line show the loop's stage,
  `◐ loop review p1 14m`, and a fix run that is one of the loop's landings is tagged
  `(loop)`. The loop's spend counts toward the cost in flight.
- **Header.** The pane opens on a card in the design language of coolant's thermo dashboard: `autopilot`,
  the dispatcher's state and the local time (`date +%z` gives the offset, since the engine gives a mod no
  time zone), then three figures drawn as 3-by-7 dot numerals in braille, running, queued and on deck,
  each in its section's colour and grey at zero. Each figure sits right-aligned over a thin dim rule as wide
  as the tile, with its label under the rule in plain lowercase grey (other surfaces than the terminal draw the label at
  caption size). The cost in flight stays on the hint line. One line under the figures shows spend in whole dollars with
  thousands separators over the last 24 hours, 7 days and 30 days, and in all, `spend $608 24h · $4,629 7d ·
  $11,964 30d · $15,742 all`, and is absent when the ledger cannot be read. It reads
  from `~/.claude/token-ledger.jsonl` (each commit's `cost.usd` and each ship's `overhead.usd`,
  across every project). The ledger outgrows one 4 MiB read, so the board reads it once in 3 MiB chunks,
  then only the bytes past where it stopped; a file that shrank is read again from the start.
- **`/board`** opens a pane with a rounded card per slot that holds a run: its progress bar, phase line,
  time and cost. A free slot has no card. Below them comes the queue as a tree of who waits on whom: each
  running run that something waits on is a root, and each entry hangs under the running or queued sitting
  on its brief's `After:` line that sits deepest in the tree, on a solid blue joint (`└─`). Its note names only
  the waits the tree does not draw: each running, queued or held sitting on its `After:` line other than its
  parent (`after S396`), so a row with no other wait has no note. An entry that needs nothing running or queued is a root of
  its own under the dispatcher's reason (`a free slot`); one held only because a run touches the same
  paths reads `held · S518 shares CLAUDE.md` in yellow, with no joint, since a hold orders nothing. After the free
  roots comes each block that holds a chain, in BLOCKED's order: the stuck sitting in yellow, `‖ S684
  home-gallery-sections  blocked ↑ · holds 8`, and under it every brief it holds on a yellow `‖`, queued or not,
  each under the sitting on its `After:` line that sits deepest in the block. A held entry draws only there. The
  card draws when something is queued or a block holds something. The `After:` lines come from `origin/main`, read with the briefs for ON DECK.
  Then RECENT: the last 10 sittings live in production, newest first, one ledger row each: a green `●`,
  the sitting and its name, then its time, a six-cell braille meter of its cost scaled to the costliest run listed,
  the cost in whole dollars, and how long ago it ended (`14m`, `5h`, `3d`). A run over twice the median draws its time
  in peach. Under a rule, a totals row reads `10 live in 12h · median 1h04m`: the count of every listed run and the
  oldest one's age, then the median time, the total time under the time column and the total cost, bold, under the
  cost column. The median and the time read only runs with minutes; the cost sums the unrounded costs, then rounds,
  so it can differ from the rows' sum. A stop and a `shipped; deploy failed` run are left
  out: they belong to BLOCKED. RECENT comes from each sitting's `.progress` file, whose last `finished:` line is its latest
  outcome, so it survives a dispatcher restart, which empties status.json's finished list. ON DECK, between the queue and RECENT, lists each brief on
  `origin/main` in `docs/briefs/` that no run holds and the queue does not list, drawn as a tree under three
  group headings, each with its count: green `ready` (marked `**Mode: autopilot.**`, so it can be queued), yellow
  `enrich` (no Mode line yet: it needs a pass before autopilot), and red `needs you` (marked
  `**Mode: interactive.**`, a run with Todd in the session). Inside its group a brief hangs on a solid joint under
  the brief its `After:` line names that sits deepest in the group, and otherwise dashed under the heading. Its note
  names one wait, the nearest: of the named sittings still on deck, queued or running, the one that sits deepest
  across the queue and on deck, a tie going to the brief's tree parent. A brief under that parent names no wait, and
  a queued wait's sitting reads in blue. Then the epic, and for `needs you` the text after the marker, which says
  why: `└╌◇ S436 retire-held-path  after S434 · Removes a wrangler.toml line.`
  `/board` again closes it.
- **BLOCKED.** A red-bordered card above the running cards, drawn only when something is stuck: one block per root cause,
  the one that holds the most first. A sitting is stuck when its last `finished:` line is not live, nothing runs or
  queues it, and its brief is still on `origin/main`, or it is a red deploy (`shipped; deploy failed`) with no live
  run after it, whose run's latest attempt did not pass. Each block shows a kind tag by who acts (`? you` a decision, `÷ plan` a split, `✗ code` a red
  deploy, `! run` anything else), a headline (a decision quotes the handoff's `**Question:**` or `**Question for Todd:**` line, read from
  `handoff/<name>.md` in the run's worktree), one line of why, a pipeline strip (savor, cycles, push, staging,
  prod) marking where it broke, one line naming the chain it holds (`holds 8 ‖ S685 → S686 → S698 +5, drawn in
  the queue ↓`: the first three in the queue's order), and one `next` line. The why-line states the handoff's
  `**Stop:**` number in words from the stop table in `hooks/board.ts`, which copies `docs/briefs/rules/autopilot.md`
  § "Stop only for these" (`savor found a failed premise · nothing pushed · 19m · $13.12`); two numbers join with
  `and`, a number off the table reads `stop N` after the stage where it broke, and a handoff with no stop line keeps
  that stage. The kind is
  status.json's `finished[].kind`, else the `kind:` line above the progress file's last `finished:` line. A queued
  entry is held by status.json's `queued[].cause`; a dispatcher that writes no `cause` key is read through the
  `After:` lines instead. A brief held upstream is a line under its cause, never a block of its own, and never
  appears on deck. A red deploy's strip reads its latest attempt with `gh run view`: once for a run older than the
  newest live run, and again each minute for one that still blocks, so a re-run that passes clears its block.
- **Folding.** The headers of blocked, queued, on deck and recent are Buttons on `b`, `q`, `d` and `r` (with the
  pane focused). A folded card keeps a one-line summary. A fold set by hand is kept in `$.store` across sessions;
  otherwise recent and on deck fold themselves while BLOCKED shows.
- **Colours.** The pane paints in Catppuccin Macchiato, from the `F` table in `hooks/register.tsx`: the pane
  on base, each section in a card on mantle (the lanes, the queue, on deck, recent), green done, peach in flight, surface grey to come, lavender headings,
  blue queued (an on-deck wait that is queued included), mauve on deck, yellow for a block's chain in the queue, on deck's groups in green, yellow and red, and peach
  for a recent run over twice the median. The colours are fixed hex values and do not follow the terminal theme; the
  pane's ground is set when it opens, so a change shows after `/board` closes and opens again. The hint
  line is plain text and takes none.
- **Toast.** A run that finishes while the session is open raises a toast with its outcome.

Every 5 seconds it reads `~/Library/Logs/shootsfilm-autopilot/status.json` (written by
`scripts/dispatch.sh` in the shoots.film repo) and each running sitting's `.progress` file, and runs `ps`
to check that the dispatcher and each run are alive. A run whose process is gone without a finished
line shows as `launcher gone`.

For ON DECK it runs `git ls-tree -r origin/main docs/briefs/` in `~/Desktop/apps/shootsfilm` and reads each
brief's header with `git cat-file`, once per blob. It never fetches: a push from any worktree of the checkout
moves `origin/main`, and a brief pushed from another machine shows after the next fetch.

For the loop it reads `~/Library/Logs/shootsfilm-archloop/.lock/pid`, and lists the newest run directory
(`<UTC date>-<HHMM>`) and its `p<n>/` pass directories. The loop's `progress` file logs a stage only when it
exits, so the stage in flight is the newest session log or landing output: `p1/review.log` reads as
`review p1`, `p1/verify-01.log` as `verify 01`, `p1/plan-01.log` as `plan 01`, `p1/plan-01.autopilot` as
`landing 01`. It never reads a session log, which can pass the 4 MiB read cap.

## Install

```bash
claude plugin install run-board@todd-w-shaffer
```

## Develop

```bash
claude plugin validate plugins/run-board
claude plugin test plugins/run-board
```
