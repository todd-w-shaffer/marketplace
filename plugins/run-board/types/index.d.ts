export type Run = {
  entry: number
  sitting: string
  slug: string
  lane: string
  startedMs: number
  cost: number
  stage: string
  /** The newest tool call in the run's log, or empty. */
  tool: string
  /** The chain's phases in order, each done, in flight or still to come. */
  phases: Phase[]
  note: string
  isAlive: boolean
}

export type PhaseState = 'done' | 'live' | 'todo'

/** One step of the fixed autopilot chain: a cycle, simplify, the xhigh review, the ship or the archive. */
export type Phase = {
  /** `cycle 2`, `simplify`, `review xhigh`, `shipping`, `archiving`. */
  label: string
  /** The bar's label: `c2`, `simpl`, `xhigh`, `ship`, `arch`. */
  short: string
  state: PhaseState
}

export type Waiting = {
  entry: number
  sitting: string
  slug: string
  lane: string
  reason: string
}

export type Done = {
  entry: number
  sitting: string
  slug: string
  /** The lane the run held, or empty when the dispatcher wrote none. */
  lane: string
  isShipped: boolean
  /** The outcome, then its time as `2h38m`, cost, peak context and run, as one line. */
  detail: string
}

/** A sitting's last outcome, read from its progress file. */
export type Ended = {
  sitting: string
  slug: string
  /** The lane from the dispatcher's finished list, or empty when it no longer lists the run. */
  lane: string
  isShipped: boolean
  detail: string
  /** When the progress file was last written. */
  endedMs: number
}

/** The architecture loop while its lock names a live process. */
export type Loop = {
  name: string
  stage: string
  startedMs: number
  cost: number
}

/** A brief on `origin/main` in `docs/briefs/` that no run holds and the queue does not list. */
export type Deck = {
  sitting: string
  slug: string
  /** `epic` when the brief has an `Epic:` header line, else `fix`. */
  lane: string
  /** The `Epic:` line's value, such as `minisite/E4`, or empty. */
  epic: string
  /** The `After:` line's value, such as `S340, S341`, or empty. */
  after: string
  /** Whether the brief is marked `**Mode: autopilot.**`. */
  isAutopilot: boolean
}

export type Board = {
  checkedAt: number
  /** `checkedAt` on a 12-hour clock in the machine's offset, `7:41 PM`. */
  clock: string
  /** The last 24 hours of spend in half-hour buckets, oldest first, and the week's total, from token-ledger; null when it could not be read. */
  spend: { buckets: number[]; week: number } | null
  isDispatcherLive: boolean
  loop: Loop | null
  running: Run[]
  queued: Waiting[]
  finished: Done[]
  recent: Ended[]
  onDeck: Deck[]
}

declare module 'claude-code' {
  interface PluginState {
    'run-board': { board: Shaped<Board | null> }
  }
}
