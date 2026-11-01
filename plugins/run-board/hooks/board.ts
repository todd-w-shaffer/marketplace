import type { Board, Done, Loop, Run, Waiting } from '../types'

// The shape `scripts/dispatch.sh` writes to status.json. Every field is
// checked on read, since the file is another program's output.
export type RawStatus = {
  dispatcher: number | null
  running: { entry: number; brief: string; lane: string; pid: number | null; started: string; cost: number }[]
  queued: { entry: number; brief: string; lane: string; reason: string }[]
  finished: { entry: number; brief: string; status: number; outcome: string }[]
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : []

export function parseStatus(text: string): RawStatus | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const d = data as Record<string, unknown>
  return {
    dispatcher: num(d.dispatcher),
    running: list(d.running).map(r => ({
      entry: num(r.entry) ?? 0,
      brief: str(r.brief),
      lane: str(r.lane),
      pid: num(r.pid),
      started: str(r.started),
      cost: num(r.session_cost) ?? 0,
    })),
    queued: list(d.queued).map(q => ({
      entry: num(q.entry) ?? 0,
      brief: str(q.brief),
      lane: str(q.lane),
      reason: str(q.reason),
    })),
    finished: list(d.finished).map(f => ({
      entry: num(f.entry) ?? 0,
      brief: str(f.brief),
      status: num(f.status) ?? 1,
      outcome: str(f.outcome),
    })),
  }
}

/** `docs/briefs/kickoff-sitting-s299-one-full-check.md` → `kickoff-sitting-s299-one-full-check`. */
export function baseName(brief: string): string {
  return brief.replace(/^.*\//, '').replace(/\.md$/, '')
}

/** Splits a brief path into its sitting label and slug: `S299`, `one-full-check`. */
export function sittingOf(brief: string): { sitting: string; slug: string } {
  const base = baseName(brief)
  const m = /s(\d+)-(.+)$/.exec(base)
  return m ? { sitting: `S${m[1] ?? ''}`, slug: m[2] ?? '' } : { sitting: base, slug: '' }
}

const SKILL_STAGES: Record<string, string> = {
  'commit-skill:commit': 'committing',
  'commit-skill:ship': 'shipping',
  simplify: 'simplify',
  'sittings:savor': 'savor',
  'sittings:observations': 'observations',
}
const REVIEW_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

/**
 * Names what a run is doing from its progress file: the last line that marks a
 * step. A `commit:` line ends a skill's work, so the run is between steps.
 */
export function stageOf(progress: string): string {
  for (const line of progress.split('\n').reverse()) {
    if (line.startsWith('finished: ')) return 'finished'
    if (line.startsWith('pushes: ')) return 'recording'
    if (line.startsWith('bash: ') && line.includes('push:checked')) return 'pushing'
    if (line.startsWith('commit: ')) return 'working'
    const skill = /^skill: (\S+)(?: (\S+))?/.exec(line)
    if (skill) {
      const name = skill[1] ?? ''
      const level = skill[2] ?? ''
      if (name === 'code-review') return REVIEW_LEVELS.has(level) ? `review ${level}` : 'review'
      return SKILL_STAGES[name] ?? name.replace(/^.*:/, '')
    }
  }
  return 'starting'
}

/** The run's own last sentence and cost, from its newest `… $N so far: text` line. */
export function noteOf(progress: string): { note: string; cost: number | null } {
  for (const line of progress.split('\n').reverse()) {
    const m = /\$(\d+(?:\.\d+)?) so far: (.*)$/.exec(line)
    if (m) return { note: (m[2] ?? '').trim(), cost: Number(m[1]) }
  }
  return { note: '', cost: null }
}

// A loop's run directory: `<UTC date>-<HHMM>`, and `-2`, `-3` for a later
// launch in the same minute (scripts/archloop.sh). `canary-…` and `s297` are
// not loop runs.
const RUN_DIR = /^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})(?:-(\d+))?$/

/** The newest loop run directory among `names`, or null. */
export function newestRunDir(names: readonly string[]): string | null {
  const key = (n: string): string => {
    const m = RUN_DIR.exec(n)
    return m ? `${m[1]}${m[2]}${m[3]}-${(m[4] ?? '1').padStart(4, '0')}` : ''
  }
  const runs = names.filter(n => RUN_DIR.test(n)).sort((a, b) => (key(a) < key(b) ? 1 : -1))
  return runs[0] ?? null
}

/** When the run named `name` launched, from its UTC date and minute. */
export function runStartedMs(name: string): number | null {
  const m = RUN_DIR.exec(name)
  if (!m) return null
  const t = Date.parse(`${m[1] ?? ''}T${m[2] ?? ''}:${m[3] ?? ''}:00Z`)
  return Number.isFinite(t) ? t : null
}

/** A session log or a landing's output in a run directory, its path relative to it. */
export type LoopFile = { path: string; mtimeMs: number }

/**
 * Names what the loop is doing. Its progress file has a line for each stage
 * only once that stage exits, so the stage in flight is the newest session log
 * (`p1/review.log`, `p1/verify-01.log`, `p1/plan-01.log`) or landing output
 * (`p1/plan-01.autopilot`) in its run directory.
 */
export function loopStageOf(files: readonly LoopFile[], progress: string): string {
  if (progress.split('\n').some(line => line.startsWith('finished: '))) return 'finishing'
  const newest = [...files]
    .filter(f => f.path.endsWith('.log') || f.path.endsWith('.autopilot'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  if (newest === undefined) return 'starting'
  const m = /^p(\d+)\/(.+)\.(log|autopilot)$/.exec(newest.path)
  if (!m) return 'starting'
  const pass = m[1] ?? ''
  const base = m[2] ?? ''
  const card = /^(verify|plan)-(.+)$/.exec(base)
  if (m[3] === 'autopilot') return `landing ${card?.[2] ?? base}`
  if (base === 'review') return `review p${pass}`
  if (card) return `${card[1] ?? ''} ${card[2] ?? ''}`
  return base
}

/**
 * The loop's spend so far: each finished stage's and landing's `($N)`, plus
 * the newest `$N so far` of the session in flight. A landing's spend in
 * flight is its fix run's, which the board counts already.
 */
export function loopCostOf(progress: string): number {
  let done = 0
  let live = 0
  for (const line of progress.split('\n')) {
    const end = /^(?:stage|autopilot): .*\(\$(\d+(?:\.\d+)?)\)$/.exec(line)
    if (end) {
      done += Number(end[1])
      live = 0
      continue
    }
    const so = /\$(\d+(?:\.\d+)?) so far/.exec(line)
    if (so) live = Number(so[1])
  }
  return done + live
}

/** The loop's board entry, from its run directory's name, files and progress. */
export function buildLoop(name: string, files: readonly LoopFile[], progress: string, now: number): Loop {
  return {
    name,
    stage: loopStageOf(files, progress),
    startedMs: runStartedMs(name) ?? now,
    cost: loopCostOf(progress),
  }
}

export function buildBoard(
  raw: RawStatus,
  progress: Readonly<Record<string, string>>,
  alive: ReadonlySet<number>,
  now: number,
  loop: Loop | null = null,
): Board {
  const running: Run[] = raw.running.map(r => {
    const text = progress[r.brief] ?? ''
    const { note, cost } = noteOf(text)
    const started = Date.parse(r.started)
    return {
      entry: r.entry,
      ...sittingOf(r.brief),
      lane: r.lane,
      startedMs: Number.isFinite(started) ? started : now,
      cost: Math.max(r.cost, cost ?? 0),
      stage: stageOf(text),
      note,
      isAlive: r.pid !== null && alive.has(r.pid),
    }
  })
  const queued: Waiting[] = raw.queued.map(q => ({
    entry: q.entry,
    ...sittingOf(q.brief),
    lane: q.lane,
    reason: q.reason,
  }))
  // A refusal is superseded once a later entry of the same brief shipped.
  const shippedAt = new Map<string, number>()
  for (const f of raw.finished) {
    if (f.status === 0) shippedAt.set(f.brief, Math.max(shippedAt.get(f.brief) ?? 0, f.entry))
  }
  const finished: Done[] = [...raw.finished]
    .sort((a, b) => b.entry - a.entry)
    .map(f => {
      const base = baseName(f.brief)
      const text = f.outcome.replace(/^autopilot: /, '').replace(`${base} `, '')
      const isShipped = f.status === 0
      const isSuperseded = !isShipped && (shippedAt.get(f.brief) ?? 0) > f.entry
      return { entry: f.entry, sitting: sittingOf(f.brief).sitting, isShipped, isSuperseded, text }
    })
  return {
    checkedAt: now,
    isDispatcherLive: raw.dispatcher !== null && alive.has(raw.dispatcher),
    loop,
    running,
    queued,
    finished,
  }
}

export function elapsed(fromMs: number, toMs: number): string {
  const minutes = Math.max(0, Math.floor((toMs - fromMs) / 60000))
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export const money = (n: number): string => `$${n.toFixed(2)}`

// The dispatcher's lanes, one run each (scripts/dispatch.sh § lanes).
export const LANES: readonly string[] = ['epic', 'fix']

/** Every lane in order, the dispatcher's two first, each with its runs. */
export function lanesOf(b: Board): { lane: string; runs: Run[] }[] {
  const names = [...LANES, ...b.running.map(r => r.lane).filter(l => !LANES.includes(l))]
  return [...new Set(names)].map(lane => ({ lane, runs: b.running.filter(r => r.lane === lane) }))
}

// The lane the architecture loop runs its landings on (scripts/archloop.sh).
export const LOOP_LANE = 'fix'

/** Whether the fix run in flight is one of the loop's landings. */
export const isLoopLanding = (b: Board, r: Run): boolean =>
  b.loop !== null && r.lane === LOOP_LANE && b.loop.stage.startsWith('landing ')

/** The loop's hint-line part while no landing runs: `◐ loop review p1 14m`. */
export const loopPart = (loop: Loop, now: number): string =>
  `◐ loop ${loop.stage} ${elapsed(loop.startedMs, now).replace(' ', '')}`

/**
 * One line for the hint line: each lane's run, or that the lane is idle, then
 * the queue and the cost in flight. The loop's lane shows the loop's stage in
 * place of idle, and tags a landing of the loop's. Undefined when nothing
 * runs or waits.
 */
export function statusLine(b: Board): string | undefined {
  if (b.running.length === 0 && b.queued.length === 0 && b.loop === null) return undefined
  const parts = lanesOf(b).flatMap(({ lane, runs }) =>
    runs.length === 0
      ? [lane === LOOP_LANE && b.loop !== null ? loopPart(b.loop, b.checkedAt) : `${lane} lane idle`]
      : runs.map(r =>
          r.isAlive
            ? `● ${r.sitting} ${r.stage} ${elapsed(r.startedMs, b.checkedAt).replace(' ', '')}${isLoopLanding(b, r) ? ' (loop)' : ''}`
            : `✗ ${r.sitting} launcher gone`,
        ),
  )
  if (b.queued.length > 0) parts.push(`○ ${b.queued.length} queued`)
  const cost = b.running.reduce((sum, r) => sum + r.cost, 0) + (b.loop?.cost ?? 0)
  if (cost > 0) parts.push(`${money(cost)} in flight`)
  return parts.join(' · ')
}

/** The toast for a run that finished since the last look. */
export function finishedToast(d: Done): string {
  return `${d.isShipped ? '✓' : '✗'} ${d.sitting} ${d.text}`
}
