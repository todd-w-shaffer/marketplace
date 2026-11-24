export type Run = {
  entry: number
  sitting: string
  slug: string
  lane: string
  startedMs: number
  cost: number
  stage: string
  /** Where the run is drawn from: its record; `newer`, a record of a version this board does not know, which draws no run; or `status`, status.json alone. */
  source: 'record' | 'newer' | 'status'
  /** The newest tool call in the run's log, or empty. */
  tool: string
  /** The chain's phases in order, each done, in flight or still to come. */
  phases: Phase[]
  /** When the live phase started, or null when none is live or its opening line has no stamp. */
  phaseSinceMs: number | null
  /** The live phase's median over RECENT in milliseconds, or null when no recent run timed it. */
  phaseMedianMs: number | null
  /** How far the live phase has come, 0 to 1, from the run's log, or null when no phase is live or the log was not read. */
  fill: number | null
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
  /** Who moves the entry next, as the dispatcher writes it: `machine`, `waiting`, `soon`, `you`, or a value the board does not know. */
  next: string
  /** `autopilot` or `interactive`, as the dispatcher read the brief's header, or empty. */
  mode: string
  /** The kind a stopped node stopped with, or null on any other entry. */
  stop: string | null
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
  /** The run's milliseconds in each phase, by phase label; empty when its progress file holds no times. */
  phaseMs: Record<string, number>
  plan: PlanCost
  /** The highest `cycle k` a `/commit` line in its progress file names, or 0 when none names one. */
  cycles: number
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
export type Held = {
  sitting: string
  slug: string
  parent: string
  after: string[]
  /** Its queued record's `next`, or `machine`. */
  next: string
  /** Whether nothing queues it and it is not stuck: a brief on `origin/main` that Todd has yet to queue. */
  isUnqueued: boolean
  /** An unqueued hold's mode, from its brief's header; absent on any other hold. */
  mode?: DeckMode
}

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
  /** The stopped node's `next` when the root is one, else null. */
  nodeNext: string | null
}

/** Each foldable card, by the hotkey its header answers. */
export type FoldCard = 'recent' | 'queued' | 'blocked' | 'timeline' | 'epics'

/** The folds set by hand: true folded, false unfolded. A card absent follows its default. */
export type Folds = Partial<Record<FoldCard, boolean>>

/** The architecture loop while its lock names a live process. */
export type Loop = {
  name: string
  stage: string
  startedMs: number
  cost: number
}

/** A brief on `origin/main` in `docs/briefs/` that no run holds and the queue does not list: an unqueued node in the queue tree. */
export type Deck = {
  sitting: string
  slug: string
  /** `epic` when the brief has an `Epic:` header line, else `fix`. */
  lane: string
  /** The `After:` line's value, such as `S340, S341`, or empty. */
  after: string
  /** `ready`: marked `**Mode: autopilot.**`. `interactive`: marked `**Mode: interactive.**`. `enrich`: neither yet. */
  mode: DeckMode
}

export type DeckMode = 'ready' | 'enrich' | 'interactive'

/**
 * What a timeline bar stands for: a past run that went live or stopped, the
 * run in flight, a queued entry, or an unqueued `ready` brief.
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
  /**
   * The oldest decision stop as a `stopped` bar from its finish to now, its `sitting` the lane's label,
   * `S684 ? 19m`; null when none waits.
   */
  you: TimelineBar | null
  /** The held work from now: `count` briefs, `ms` long at the median, or null without one. */
  held: { label: string; count: number; ms: number | null }
}

/** A sitting's cell on an epic's row: shipped, running, or still to come. */
export type EpicCell = 'shipped' | 'running' | 'todo'

/** Where an epic's next sitting stands: running, the root of a block, held by one, queued, or on deck. */
export type EpicState = { kind: 'running' | 'blocked' | 'held' | 'queued' | 'deck'; sitting: string }

/** One row of the epics card: an epic that a live brief's `Epic:` line names. */
export type EpicRow = {
  /** The `Epic:` value, such as `dashboard/E2`. */
  epic: string
  /** The plan epic's title, such as `design system`, or the `Epic:` value when the plan names none. */
  label: string
  /** A cell per sitting: the shipped ones, then the running ones, then the rest, each by sitting. */
  cells: EpicCell[]
  /** The epic's next sitting: a running one, else the lowest sitting still to come; null once every one has shipped. */
  next: EpicState | null
}

/**
 * A brief's planned cycles and projected build cost. `cycles` is null when its brief could not be read;
 * `usd` is null when the cycles are 0 or unknown, or RECENT gives no cost per cycle. `lit` is a running
 * brief's cycles done or under way, and absent for a brief that is not running.
 */
export type BriefCost = { cycles: number | null; usd: number | null; lit?: number }

export type Board = {
  /** A line the board draws alone in place of every card, or null: status.json is newer than the board, or names no sources. */
  notice: string | null
  /** The runs that are not running whose record has a version this board does not know, by sitting; each draws no row. */
  newer: string[]
  checkedAt: number
  /** `checkedAt` on a 12-hour clock in the machine's offset, `7:41 PM`. */
  clock: string
  /** `days`, the spend of the last 14 local days, oldest first, today last, from token-ledger; null when it could not be read. */
  spend: { days: number[] } | null
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
  /** One row per epic a live brief names, lowest sitting still to come first. */
  epics: EpicRow[]
  /** Each brief's cycles and projected cost, by sitting: every running, queued and on-main brief. */
  costs: Record<string, BriefCost>
}

declare module 'claude-code' {
  interface PluginState {
    'run-board': { board: Shaped<Board | null>; folds: Shaped<Folds> }
  }
}
