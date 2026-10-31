# run-board

A Claude Code mod that shows the shoots.film autopilot runs beside the chat. It reads the files the
dispatcher writes and never starts a model turn, so it costs no tokens.

- **Hint line.** The end of the dim line under the prompt shows each lane's running sitting with its stage
  and how long it has run, or that the lane is idle, then how many briefs wait and the cost so far:
  `● S301 review low 46m · fix lane idle · $8.58 in flight`. It is empty when nothing runs or waits.
- **`/autopilot`** opens a pane with a section per lane (`epic`, `fix`): its run's stage, time, cost and last
  sentence, or `idle`. Below them come the queue with what each
  entry waits for, and recent outcomes. A refusal that a later run of the same sitting shipped past is
  dimmed. `/autopilot` again closes it.
- **Toast.** A run that finishes while the session is open raises a toast with its outcome.

Every 5 seconds it reads `~/Library/Logs/shootsfilm-autopilot/status.json` (written by
`scripts/dispatch.sh` in the shoots.film repo) and each running sitting's `.progress` file, and runs `ps`
to check that the dispatcher and each run are alive. A run whose process is gone without a finished
line shows as `launcher gone`.

## Install

```bash
claude plugin install run-board@todd-w-shaffer
```

## Develop

```bash
claude plugin validate plugins/run-board
claude plugin test plugins/run-board
```
