import type { Board, Done, Run, Waiting } from '../types'

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

export function buildBoard(
  raw: RawStatus,
  progress: Readonly<Record<string, string>>,
  alive: ReadonlySet<number>,
  now: number,
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

/** One line for the status bar, or undefined when nothing runs or waits. */
export function statusLine(b: Board): string | undefined {
  if (b.running.length === 0 && b.queued.length === 0) return undefined
  const parts = b.running.map(r =>
    r.isAlive
      ? `● ${r.sitting} ${r.stage} ${elapsed(r.startedMs, b.checkedAt).replace(' ', '')}`
      : `✗ ${r.sitting} launcher gone`,
  )
  if (b.queued.length > 0) parts.push(`○ ${b.queued.length} queued`)
  const cost = b.running.reduce((sum, r) => sum + r.cost, 0)
  if (cost > 0) parts.push(`${money(cost)} in flight`)
  return parts.join('  ')
}

/** The toast for a run that finished since the last look. */
export function finishedToast(d: Done): string {
  return `${d.isShipped ? '✓' : '✗'} ${d.sitting} ${d.text}`
}
