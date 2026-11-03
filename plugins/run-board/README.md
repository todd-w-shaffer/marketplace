# run-board

A Claude Code mod that shows the shoots.film autopilot runs beside the chat. It reads the files the
dispatcher writes and never starts a model turn, so it costs no tokens.

- **Hint line.** The end of the dim line under the prompt shows each lane's running sitting with its stage
  and how long it has run, or that the lane is idle, then how many briefs wait and the cost so far:
  `● S301 review low 46m · fix lane idle · $8.58 in flight`. It is empty when nothing runs or waits.
- **The architecture loop.** While `scripts/archloop.sh` holds its lock, the fix lane shows the loop's stage
  in place of idle, `◐ loop review p1 14m`, and a fix run that is one of the loop's landings is tagged
  `(loop)`. The loop's spend counts toward the cost in flight.
- **`/autopilot`** opens a pane with a section per lane (`epic`, `fix`): its run's stage, time, cost and last
  sentence, or `idle`. Below them come the queue with what each
  entry waits for, and RECENT: the last 10 sittings that finished, newest first, one row each. A row reads like
  a lane's run: the sitting, its name, its lane (`(fix)`) while the dispatcher still lists it, and how long ago
  it ended, then `shipped · 3h43m · $26.11 · peak 385k · run 41303865474`. RECENT comes from each sitting's
  `.progress` file, whose last `finished:` line is its latest outcome, so it survives a dispatcher restart,
  which empties status.json's finished list. `/autopilot` again closes it.
- **Toast.** A run that finishes while the session is open raises a toast with its outcome.

Every 5 seconds it reads `~/Library/Logs/shootsfilm-autopilot/status.json` (written by
`scripts/dispatch.sh` in the shoots.film repo) and each running sitting's `.progress` file, and runs `ps`
to check that the dispatcher and each run are alive. A run whose process is gone without a finished
line shows as `launcher gone`.

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
