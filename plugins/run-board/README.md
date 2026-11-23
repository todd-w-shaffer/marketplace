# run-board

A Claude Code mod that shows the shoots.film autopilot runs beside the chat. It reads the files the
dispatcher writes and never starts a model turn, so it costs no tokens.

- **Hint line.** The end of the dim line under the prompt shows each running sitting with its stage
  as a one-cell-per-phase bar, the phase in flight and how long it has run, then
  how many briefs wait and the cost so far: `● S393 ⣿⣤⣀⣀⣀⣀⡇ c2 1h12m │ ○ 1 │ $12.22`.
  It is empty when nothing runs or waits.
- **Progress bar.** Each run's card has a braille block per phase of its run record's `phases`, in the record's order: step 0's `savor` when the run has one,
  each cycle, then `⋮` where session 2 takes over, simplify, the xhigh review, the ship and the archive. The record is
  `<name>.run.json`, at the running entry's `run_record` in status.json, and `scripts/run-status.mjs` in the
  shoots.film repo owns it: its header states each field and when each phase closes, and the board shows the record's
  `stage`, `phases` and `phase_since` as written. A block is a full `⣿` run in green when done, a
  peach block in flight filled to how far the phase has come (see **Phase fill**), and a grey `⣀` baseline to come, and the bar ends in a `⡇` cap. The lane's name is a
  pill on the raised surface, in the lane's colour (pink epic, teal fix). A record of a version the board does not
  know draws no bar, and the card reads `the record is newer than the board`. A run with no record the board can read
  draws what `node <main>/scripts/run-status.mjs --print <progress> <brief>` prints for it, once per key (the progress
  file's mtime, the brief's path and mtime, and `run-status.mjs`'s mtime), and with neither it draws from status.json
  alone, its stage `starting`. Under the bar, the phase line reads `committing · Bash: Run the focused check`: the
  stage when it adds to the phase (the bar's lit label names the phase), and the newest tool call, read from the last 256 KiB of the run's
  stream-json `.log` with `tail -c`, because the log can pass the 4 MiB read cap.
- **Phase fill.** The block in flight fills left to right, each cell climbing `⣀⣤⣶⣿`, from the run's stream-json `.log`:
  one `grep -noE` pulls a few short marks per event (tool calls and their first input field, Skill args, `task_started`,
  `task_progress` and `task_notification`, tool results, the parent id that nests an agent's calls), the newest `LOG_MARK_LINES` of them.
  Each phase opens at its skill call and passes checkpoints: a cycle its first edit, a build and its commit; the savor and
  simplify first fill by how many of their agents are back; the xhigh review at its forked task's end, then a fix and its commit;
  the ship at its `/ship`'s end; the archive at its commit and its push. Between checkpoints the fill creeps toward the next one
  with each tool call, agents' calls included, and never reaches it, so a long step still moves but claims nothing it has not
  passed. A live block never fills and never steps backwards. When the marks cannot be read the block shows one step.
- **Time in phase.** A live card's header reads `9m · 15m · $10.63`: the time in the phase in flight, then the run's
  time and cost. The clock starts at the record's `phase_since`. It is peach, the lit label's colour, and red once it passes that phase's median
  over RECENT. Every cycle is one sample of the cycle median; a phase no recent run timed has no median and stays peach.
- **The architecture loop.** While `scripts/archloop.sh` holds its lock, a card and the hint line show the loop's stage,
  `◐ loop review p1 14m`, and a fix run that is one of the loop's landings is tagged
  `(loop)`. The loop's spend counts toward the cost in flight.
- **Header.** The pane opens on a card in the design language of coolant's thermo dashboard: `autopilot`,
  the dispatcher's state and the local time (`date +%z` gives the offset, since the engine gives a mod no
  time zone), then three figures drawn as 3-by-7 dot numerals in braille, running, queued and on deck,
  each in its section's colour and grey at zero. Each figure sits right-aligned over a thin dim rule as wide
  as the tile, with its label under the rule in plain lowercase grey (other surfaces than the terminal draw the label at
  caption size). The cost in flight stays on the hint line. One line under the figures is a spend sparkline: a bar
  per local day for the last 14 days, `▁` to `█`, today's peach, a day with spend grey and an empty day faint, then
  `$568 today · $7.1k 14d`, today's spend and the 14 days', a figure of $1,000 or more after rounding to a tenth of
  a thousand reading `$N.Nk`. Each spend falls in the local day of its time, in the `date +%z` offset (UTC when it
  does not parse), and a spend after now in none. The bars scale to the second-highest day, the 90th percentile by
  nearest rank, so one runaway day tops out and the rest keep their shape; with under two days of spend they scale
  to the highest. The figures keep their width and the bars give way first. The line is absent when the ledger
  cannot be read. It reads
  from `~/.claude/token-ledger.jsonl` (each commit's `cost.usd` and each ship's `overhead.usd`,
  across every project). The ledger outgrows one 4 MiB read, so the board reads it once in 3 MiB chunks,
  then only the bytes past where it stopped; a file that shrank is read again from the start.
- **`/board`** opens a pane with a rounded card per slot that holds a run: its progress bar, phase line,
  time and cost. A free slot has no card. Then EPICS, drawn when a live brief has an `Epic:` line: one row per
  epic, `design system  ■■□□□□  1/6  ● S693 running`. The label is the plan epic's title, from the `### E2: design
  system` heading of `docs/plans/<plan>.md` on `origin/main`, the plan being the part of `dashboard/E2` before the
  last `/` and the heading's id the part after it, matched exactly; a plan file or heading that is missing leaves
  the raw `Epic:` value. Each sitting is a cell: a green `■` shipped (each claim in `docs/briefs/sittings.json`
  whose record's `epic` names the epic), a peach `■` running and a faint `□` to come (each brief on `origin/main`
  whose `Epic:` line names it, a running one kept after its archive), a sitting in both counting once, as shipped.
  Labels pad to the widest label and cells to the widest epic, ending in `…` past the room. Then `shipped/total`,
  and where the next sitting stands: `● S693 running` in peach, `blocked at S684` in red, `‖ held` in yellow,
  `queued` or `on deck`. Epics go by their lowest sitting still to come. Below them comes the queue as a tree of who waits on whom: each
  running run that something waits on is a root, and each entry hangs under the running or queued sitting
  on its brief's `After:` line that sits deepest in the tree, on a solid blue joint (`└─`). Its note names only
  the waits the tree does not draw: each running, queued or held sitting on its `After:` line other than its
  parent (`after S396`), so a row with no other wait has no note. An entry that needs nothing running or queued is a root of
  its own under the dispatcher's reason (`a free slot`). One held only because a running run touches the same
  paths hangs under that run on a dashed yellow joint (`└┄`): the hold lifts when that run lands, and orders
  nothing after. When the board does not show that run running, the entry is a root that reads `held · S518`
  in yellow. After the free
  roots comes each block that holds a chain, in BLOCKED's order: the stuck sitting in yellow, `‖ S684
  home-gallery-sections  blocked ↑ · holds 8`, and under it every brief it holds on a yellow `‖`, queued or not,
  each under the sitting on its `After:` line that sits deepest in the block. A held entry draws only there.
  A row is Todd's when status.json's `next` for it is not `machine`: it draws `◇` in place of `○` or `‖`, and
  the `◇` and the id share one colour, text for `waiting`, yellow for `soon`, red for `you`. A `next` the board
  does not know draws a text `◇` whose note leads with the value as written; a record with no `next` is the
  machine's. Rails and joints keep their colours, so a held chain stays yellow under a `◇`. A stopped node (a
  queued record with a `stop`) is a block whose kind is its `stop`, and its row is a red `◇` that reads
  `blocked ↑`, with ` · holds N` when it holds something; it draws once, as that block. A `needs` cause holds
  nothing. The card draws when something is queued or a block holds something. The `After:` lines come from `origin/main`, read with the briefs for ON DECK.
  A queue row whose brief was split reads `split ×2`: the briefs on `origin/main` whose `Split from:` line names it,
  and the archived claims in `docs/briefs/sittings.json` whose `split_from` list does, each child once.
  Each queue and on-deck row ends in a box pinned to its right edge: a square per cycle the brief plans, or a dim
  `·` with no cycle headings, in a slot as wide as the most cycles, then the projected build cost, `~$23`,
  right-aligned. The squares are blue queued, yellow held, peach for a running brief's cycles done or under way and
  grey for the rest, and an on-deck brief's take its group's colour. The cost is the median cost per cycle of
  RECENT's runs times the brief's cycles: each run's cost over the highest `cycle k` its `/commit` lines name, among
  runs with both. It reads `~$?` when the cycles or the median are unknown, and dim yellow on a held row. The box is
  one width across the queue and on deck, so the costs end in one column; the row's note sits between the name
  and the box and gives way first.
  The TIMELINE sits under BLOCKED and above the running cards: a lane per dispatcher slot (`slot 1` to the highest slot the board sees), then `you` and
  `held`, over a window from 8h before now to 6h after, under even-hour labels (`2p`, `12a`) and with a peach
  now-line. It draws in braille, 2 dots a cell. A bar is `⣿` cells in its colour with its last dot column blank:
  green for a run that went live, red for one that stopped, and the run in flight green to now and peach to its
  start plus RECENT's median. Queued entries (blue) and ready briefs on deck (mauve) follow as projected bars:
  each takes the slot where it can start soonest, no earlier than the projected end of each `After:` sitting.
  Idle slot time is a faint `⣀` track. A sitting number sits inside its bar, mantle on the bar's colour, where
  it fits, else beside it; a bar clipped at the window start reads `◂ S677`. A run's slot comes from status.json's
  `slot`, `slot_taken` and `slot_released`, else from each of its record's `launch_spans`, so a run the finished
  list dropped keeps its slot; a span the record leaves open on a run that is not running ends at the progress
  file's mtime; a run that names no slot goes
  on the lowest slot free over its span. `you` is a red bar from the oldest decision stop's finish to now,
  `S684 ? 19m`, with `+N` for each other one. `held` is a dashed yellow strip from now, `3 held · ~3h12m`: every
  brief BLOCKED holds and every queued entry a `cause` holds, at the median each. With no median there are no
  projected bars and `held` reads its count alone.
  Under on deck, RECENT: the last 10 sittings live in production, newest first, one ledger row each: a green `●`,
  the sitting and its whole name where the pane is wide enough, then its time, a six-cell phase split (savor
  lavender, cycles green with simplify and the xhigh review, ship blue, with a legend in the card head), the cost in
  whole dollars, the plan cost, and how long ago it ended (`14m`, `5h`, `3d`). The split is the record's
  `phase_split` rounded to six cells by largest remainder, so a relaunch's wait counts nowhere; a record with no
  split draws the grey `⣀` baseline, and the phase medians read its `phase_ms`. The plan cost is dim, `+$6`, what
  `scripts/plan-costs.mjs` prints for the sitting, `+—` when it prints none, bright when it passes the build's cost,
  and absent when the script cannot be read. A run over twice the median draws its time in peach. Under a rule, a totals row reads `10 live in 12h ·
  median 1h04m`: the count of every listed run and the oldest one's age, then the median time, the total time under
  the time column, the total cost, bold, under the cost column, and `+ $81 plan`. The median and the time read only
  runs with minutes; the cost sums the unrounded costs, then rounds,
  so it can differ from the rows' sum. A stop and a `shipped; deploy failed` run are left
  out: they belong to BLOCKED, unless the sitting's claim in `docs/briefs/sittings.json` records an `archived` day: a run
  finished by hand after it stopped reads `rescued`, with the stopped run's time and cost. RECENT comes from each sitting's record,
  `<sources.log_dir>/<name>.run.json`, whose `end` is its latest outcome, so it survives a dispatcher restart, which
  empties status.json's finished list. A run with no record the board can read draws what `--print` prints for it,
  and a record with no `end` draws in neither RECENT nor BLOCKED. A record older than its progress file
  missed its last write, so the run draws through `--print`. A run whose record is a version the board does not
  know draws no row, and one line under the header names it: `S761: the record is newer than the board`. ON DECK, between the queue and RECENT, lists each brief on
  `origin/main` in `docs/briefs/` that no run holds and the queue does not list, drawn as a tree under three
  group headings, each with its count: green `ready` (marked `**Mode: autopilot.**`, so it can be queued), yellow
  `enrich` (no Mode line yet: it needs a pass before autopilot), and red `needs you` (marked
  `**Mode: interactive.**`, a run with Todd in the session). Inside its group a brief hangs on a solid joint under
  the brief its `After:` line names that sits deepest in the group, and otherwise dashed under the heading. Its note
  names one wait, the nearest: of the named sittings still on deck, queued or running, the one that sits deepest
  across the queue and on deck, a tie going to the brief's tree parent. A brief under that parent names no wait, and
  a queued wait's sitting reads in blue. Then the epic: `└╌◇ S436 retire-held-path  after S434`.
  `/board` again closes it.
- **BLOCKED.** A red-bordered card above the timeline and the running cards, drawn only when something is stuck: one block per root cause,
  the one that holds the most first. A sitting is stuck when its last `finished:` line is not live, nothing runs or
  queues it, and its brief is still on `origin/main`, or it is a red deploy (`shipped; deploy failed`) with no live
  run after it, whose run's latest attempt did not pass. Each block shows a kind tag by who acts (`? you` a decision, `÷ plan` a split, `✗ code` a red
  deploy, `! run` anything else), a headline (a decision quotes the handoff's `**Question:**` or `**Question for Todd:**` line, read from
  `handoff/<name>.md` in the run's worktree), one line of why, a pipeline strip (savor, cycles, push, staging,
  prod) marking where it broke, one line naming the chain it holds (`holds 8 ‖ S685 → S686 → S698 +5, drawn in
  the queue ↓`: the first three in the queue's order), and one `next` line. The why-line states the handoff's
  `**Stop:**` number in words from the stop table in `hooks/board.ts`, which copies `docs/briefs/rules/autopilot.md`
  § "Stop only for these" (`savor found a failed premise · nothing pushed · 19m · $13.12`); two numbers join with
  `and`, a number off the table reads `stop N` after the stop words, or after the stage where it broke when the line
  names no known number, and a handoff with no stop line keeps that stage. After the cost come the plan cost and
  which launch stopped, where each exists: `$13.12 +$11.36 plan · 1st launch`, the launch count the
  record's `launches`. A split leaves out stop 7, which its
  headline says; a broken run with no stop line reads the launcher's outcome sentence. The kind is
  status.json's `finished[].kind` when it is not null, else the record's `end.kind`, and a red deploy's run is the
  record's `end.deploy_run`. A queued
  entry is held by status.json's `queued[].cause`; a dispatcher that writes no `cause` key is read through the
  `After:` lines instead. A brief held upstream is a line under its cause, never a block of its own, and never
  appears on deck. A red deploy's strip reads its latest attempt with `gh run view`: once for a run older than the
  newest live run, and again each minute for one that still blocks, so a re-run that passes clears its block.
- **Folding.** The headers of blocked, epics, queued, on deck, timeline and recent are Buttons on `b`, `e`, `q`, `d`, `t`
  and `r` (with the pane focused). The epics and the timeline start open and never fold themselves; folded, epics
  keeps `design system 1/3 · nav 0/7`. A folded card keeps a one-line summary. A fold set by hand is kept in `$.store` across sessions;
  otherwise recent and on deck fold themselves while BLOCKED shows.
- **Colours.** The pane paints in Catppuccin Macchiato, from the `F` table in `hooks/register.tsx`: the pane
  on base, each section in a card on mantle (the timeline, the lanes, the epics, the queue, on deck, recent), green done, peach in flight, surface grey to come, lavender headings,
  blue queued (an on-deck wait that is queued included), mauve on deck, yellow for a block's chain in the queue, on deck's groups in green, yellow and red, and peach
  for a recent run over twice the median. The colours are fixed hex values and do not follow the terminal theme; the
  pane's ground is set when it opens, so a change shows after `/board` closes and opens again. The hint
  line is plain text and takes none.
- **Toast.** A run that finishes while the session is open raises a toast with its outcome.

Every 5 seconds it reads `~/Library/Logs/shootsfilm-autopilot/status.json` (written by
`scripts/dispatch.sh` in the shoots.film repo), each running sitting's record, and runs `ps`
to check that the dispatcher and each run are alive. A run whose process is gone without a finished
line shows as `launcher gone`. Every other path comes from status.json's `sources`: `main`, the shoots.film
checkout, and `archloop_log_dir`, the loop's log directory. A status.json that is missing, or whose `sources` is
missing or malformed, draws only `status.json names no sources`, and one of a version the board does not know draws
only `status.json is newer than the board`.

For ON DECK, the cycle squares and EPICS it runs `git ls-tree -r origin/main docs/briefs/ docs/plans/` in
the main checkout and reads `sittings.json` and each plan with `git cat-file`, once per blob. A brief's mode,
`Epic:`, `After:`, `Split from:` and cycle count are what the main checkout's `scripts/run-status.mjs` prints for
it: its blobs, `README.md`'s first, piped into `node scripts/run-status.mjs --print /dev/null /dev/stdin` under
`set -o pipefail`, once per blob shas and owner mtime. A read that fails draws the brief as one with no mode yet,
under `enrich`, with no count, and a blob that fails to read gives no title; each is read again on the next poll.
Each sitting's plan cost is what `node scripts/plan-costs.mjs ~/.claude/token-ledger.jsonl` prints, run in the
main checkout once per ledger size and `origin/main` sha; when it fails, RECENT draws no plan cell and no plan
total, and the spend line still draws. It never fetches: a push from any worktree of the checkout
moves `origin/main`, and a brief pushed from another machine shows after the next fetch.

For the loop it reads `<archloop_log_dir>/.lock/pid`, and lists the newest run directory
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
