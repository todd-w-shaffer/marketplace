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
  /** The sittings on the brief's `After:` line on `origin/main`, shipped or not. */
  after: string[]
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
  detail: string
  /** The run's minutes and cost from its outcome's totals, or null when the outcome has none. */
  minutes: number | null
  usd: number | null
  /** When the progress file was last written. */
  endedMs: number
  /** The run's time as savor, cycles and ship cells, or null when its progress file holds no times. */
  split: PhaseSplit | null
  plan: PlanCost
}

/** A run's time in RECENT_SPLIT_CELLS cells: savor, then the cycles with simplify and the xhigh review, then the ship. */
export type PhaseSplit = { savor: number; cycles: number; ship: number }

/**
 * What a sitting's planning commits cost in dollars: `none` when the ledger holds none for it, `unread` when
 * the ledger could not be read.
 */
export type PlanCost = number | 'none' | 'unread'

/** Who acts on a stuck run: `decision` you, `split` the plan, `deploy-red` the code, `run-broke` the run. */
export type BlockKind = 'decision' | 'split' | 'deploy-red' | 'run-broke'

export type Stage = 'savor' | 'cycles' | 'push' | 'staging' | 'prod'

/** A stage on a block's pipeline strip: done, where the run broke, still to come, or skipped (no step 0). */
export type StripCell = { stage: Stage; state: 'done' | 'broke' | 'todo' | 'skip' }

/**
 * A brief a root cause holds. `parent` is the sitting it hangs under: the root, or another hold.
 * `after` is every sitting on its `After:` line.
 */
export type Held = { sitting: string; slug: string; parent: string; after: string[] }

/** One root cause on the BLOCKED card. */
export type Block = {
  kind: BlockKind
  /** The stuck sitting, or `run N` for a red deploy no stuck sitting names. */
  sitting: string
  slug: string
  headline: string
  why: string
  /** Empty when no progress file names the root. */
  strip: StripCell[]
  /** The chain it holds as a tree in preorder, siblings by sitting. */
  holds: Held[]
  next: string
  endedMs: number
  plan: PlanCost
  /** How many times the sitting launched, from its `.launches` file, or null without one. */
  launches: number | null
}

/** Each foldable card, by the hotkey its header answers. */
export type FoldCard = 'recent' | 'deck' | 'queued' | 'blocked' | 'timeline'

/** The folds set by hand: true folded, false unfolded. A card absent follows its default. */
export type Folds = Partial<Record<FoldCard, boolean>>

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
  /** `ready`: marked `**Mode: autopilot.**`. `interactive`: marked `**Mode: interactive.**`. `enrich`: neither yet. */
  mode: DeckMode
  /** The text after `**Mode: interactive.**`: why the brief needs a person. Empty otherwise. */
  why: string
}

export type DeckMode = 'ready' | 'enrich' | 'interactive'

/**
 * What a timeline bar stands for: a past run that went live or stopped, the
 * run in flight, a queued entry, or a ready brief on deck.
 */
export type BarTone = 'live' | 'stopped' | 'running' | 'queued' | 'deck'

/** One bar on a timeline lane, its times in milliseconds. */
export type TimelineBar = {
  sitting: string
  tone: BarTone
  startMs: number
  endMs: number
  /** Where a running bar turns from green to peach: now, or its slot's release. `endMs` for any other bar. */
  liveEndMs: number
  /** A running run past the median: its projection ends one cell past now. */
  isOverMedian: boolean
}

/** The timeline card: every slot's runs over a window from TIMELINE_BACK_MS before now to TIMELINE_AHEAD_MS after. */
export type Timeline = {
  startMs: number
  endMs: number
  nowMs: number
  /** Each even local hour in the window, labelled `2p`, `12a`. */
  hours: { ms: number; label: string }[]
  /** Slot 1 to the highest slot the board sees, at least one. */
  slots: { slot: number; bars: TimelineBar[] }[]
  /** The oldest decision stop, from its finish to now, or null when none waits. */
  you: { label: string; sinceMs: number } | null
  /** The held work from now: `count` briefs, `ms` long at the median, or null without one. */
  held: { label: string; count: number; ms: number | null }
}

export type Board = {
  checkedAt: number
  /** `checkedAt` on a 12-hour clock in the machine's offset, `7:41 PM`. */
  clock: string
  /** Spend over the last day, week and month, and in all, from token-ledger; null when it could not be read. */
  spend: { day: number; week: number; month: number; all: number } | null
  isDispatcherLive: boolean
  loop: Loop | null
  running: Run[]
  queued: Waiting[]
  finished: Done[]
  recent: Ended[]
  onDeck: Deck[]
  /** Root causes of stuck runs, most held first; empty when nothing is stuck. */
  blocked: Block[]
  /** How many briefs were split from each sitting, by sitting; a sitting split from none is absent. */
  splits: Record<string, number>
  timeline: Timeline
}

declare module 'claude-code' {
  interface PluginState {
    'run-board': { board: Shaped<Board | null>; folds: Shaped<Folds> }
  }
}
