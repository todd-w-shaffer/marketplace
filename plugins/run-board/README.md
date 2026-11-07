# run-board

A Claude Code mod that shows the shoots.film autopilot runs beside the chat. It reads the files the
dispatcher writes and never starts a model turn, so it costs no tokens.

- **Hint line.** The end of the dim line under the prompt shows each lane's running sitting with its stage
  as a one-cell-per-phase bar, the phase in flight and how long it has run, or that the lane is idle, then
  how many briefs wait and the cost so far: `● S393 ⣿⣤⣀⣀⣀⣀⡇ c2 1h12m │ fix idle │ $12.22`.
  It is empty when nothing runs or waits.
- **Progress bar.** Each run's card has a braille block per phase of the fixed chain: each cycle, then `⋮` where
  session 2 takes over, simplify, the xhigh review, the ship and the archive. A block is a full `⣿` run in green when done, a
  peach taper in flight and a grey `⣀` baseline to come, and the bar ends in a `⡇` cap. The lane's name is a
  pill on the raised surface, in the lane's colour (pink epic, teal fix), as on its recent rows. The cycle count is the brief's `### Cycle` headings (or `**Cycle` lines)
  on `origin/main`, counted once per blob. Cycle k closes when a `/commit` naming `cycle k` is followed by a
  `code-review low` line; the ship starts at `/ship` or a push, and the archive at the first `/commit` after
  the ship's push. Under the bar, the phase line reads `cycle 2 of 2 · Bash: Run the focused check`: the
  phase, the stage when it adds to it, and the newest tool call, read from the last 256 KiB of the run's
  stream-json `.log` with `tail -c`, because the log can pass the 4 MiB read cap.
- **The architecture loop.** While `scripts/archloop.sh` holds its lock, the fix lane shows the loop's stage
  in place of idle, `◐ loop review p1 14m`, and a fix run that is one of the loop's landings is tagged
  `(loop)`. The loop's spend counts toward the cost in flight.
- **Header.** The pane opens on a card in the design language of coolant's thermo dashboard: `autopilot`,
  the dispatcher's state and the local time (`date +%z` gives the offset, since the engine gives a mod no
  time zone), then four figures drawn as 3-by-7 dot numerals in braille, running, queued, on deck and `$ in
  flight`, each in its section's colour and grey at zero. Each figure sits right-aligned over a thin dim rule as wide
  as the tile, with its label under the rule in plain lowercase grey (other surfaces than the terminal draw the label at
  caption size). A second row of tiles shows spend in whole dollars over the last 24 hours, 7 days and 30 days,
  and in all, from `~/.claude/token-ledger.jsonl` (each commit's `cost.usd` and each ship's `overhead.usd`,
  across every project). The ledger outgrows one 4 MiB read, so the board reads it once in 3 MiB chunks,
  then only the bytes past where it stopped; a file that shrank is read again from the start.
- **`/board`** opens a pane with a rounded card per lane (`epic`, `fix`): its run's progress bar, phase line,
  time, cost and last sentence, or `idle`. Below them come the queue with what each
  entry waits for, and RECENT: the last 10 sittings that finished, newest first, one ledger row each: a green `●` or a
  red `✗`, the lane as a lowercase tag (pink epic, teal fix) while the dispatcher still lists the run, the
  sitting and its name, then its time, a six-cell braille meter of its cost scaled to the costliest run listed,
  the cost, and how long ago it ended (`14m`, `5h`, `3d`). A run that stopped gets its reason on a second line
  in red. RECENT comes from each sitting's `.progress` file, whose last `finished:` line is its latest
  outcome, so it survives a dispatcher restart, which empties status.json's finished list. ON DECK, between the queue and RECENT, lists each brief on
  `origin/main` in `docs/briefs/` that no run holds and the queue does not list, lowest sitting first:
  `◇ S342 gallery-pass-keeps-stars  epic · minisite/E4 · after S340, S341`. A brief with an `Epic:` header
  line is on the epic lane and one without is on fix; a brief not marked `**Mode: autopilot.**` reads
  `interactive`. `/board` again closes it.
- **Colours.** The pane paints in Catppuccin Macchiato, from the `F` table in `hooks/register.tsx`: the pane
  on base, each section in a card on mantle (the lanes, the queue, on deck, recent), green done, peach in flight, surface grey to come, lavender headings,
  blue queued, mauve on deck. The colours are fixed hex values and do not follow the terminal theme; the
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
