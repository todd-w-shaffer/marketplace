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
  isShipped: boolean
  isSuperseded: boolean
  text: string
}

export type Board = {
  checkedAt: number
  isDispatcherLive: boolean
  running: Run[]
  queued: Waiting[]
  finished: Done[]
}

declare module 'claude-code' {
  interface PluginState {
    'run-board': { board: Shaped<Board | null> }
  }
}
