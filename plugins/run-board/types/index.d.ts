export type Run = {
  entry: number
  sitting: string
  slug: string
  lane: string
  startedMs: number
  cost: number
  stage: string
  note: string
  isAlive: boolean
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
  isSuperseded: boolean
  /** The outcome, then its time as `2h38m`, cost, peak context and run, as one line. */
  detail: string
}

/** The architecture loop while its lock names a live process. */
export type Loop = {
  name: string
  stage: string
  startedMs: number
  cost: number
}

export type Board = {
  checkedAt: number
  isDispatcherLive: boolean
  loop: Loop | null
  running: Run[]
  queued: Waiting[]
  finished: Done[]
}

declare module 'claude-code' {
  interface PluginState {
    'run-board': { board: Shaped<Board | null> }
  }
}
