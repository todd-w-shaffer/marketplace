import type { BarTone, Block, BlockKind, Board, BriefCost, Deck, DeckMode, Done, Ended, EpicCell, EpicRow, EpicState, FoldCard, Folds, Held, Loop, Phase, PhaseSplit, PhaseState, PlanCost, Run, Stage, StripCell, Timeline, TimelineBar, Waiting } from '../types'

// The shape `scripts/dispatch.sh` writes to status.json. Every field is
// checked on read, since the file is another program's output.
export type RawStatus = {
  dispatcher: number | null
  running: ({ entry: number; brief: string; lane: string; pid: number | null; started: string; cost: number } & SlotFields)[]
  queued: { entry: number; brief: string; lane: string; reason: string; cause?: Cause | null }[]
  finished: ({ entry: number; brief: string; lane: string; status: number; outcome: string; kind: string | null } & SlotFields)[]
}

/**
 * The slot a running or finished record held: its number, and when the run
 * took and released it in milliseconds. Each is absent from a record an older
 * dispatcher wrote, and null when the record says none.
 */
type SlotFields = { slot?: number | null; slotTakenMs?: number | null; slotReleasedMs?: number | null }

// The highest slot the board draws a lane for. The dispatcher runs a handful
// of slots, so a number past this one is a corrupt line, and the timeline
// builds one lane per slot up to the highest it sees.
const MAX_SLOT = 16

/** A slot number: a whole number from 1 to MAX_SLOT, else null. */
const slotNumber = (v: number | null): number | null =>
  v !== null && Number.isInteger(v) && v >= 1 && v <= MAX_SLOT ? v : null

/** A record's slot fields, each checked: a slot is a slot number, a time parses. */
function parseSlot(r: Record<string, unknown>): SlotFields {
  return {
    slot: slotNumber(num(r.slot)),
    slotTakenMs: parseMs(r.slot_taken),
    slotReleasedMs: parseMs(r.slot_released),
  }
}

/**
 * The root cause the dispatcher says holds a queued entry back: a red deploy
 * by its run, or a sitting that stopped, with that stop's kind. `sitting` is
 * `S625` for an `After:` sitting and the run name for an `--after` brief.
 */
export type Cause = { kind: 'deploy-red'; run: number } | { kind: string; sitting: string }

/**
 * A queued entry's `cause`: undefined when the record has no such key, as a
 * dispatcher older than the field writes it, and null when the dispatcher
 * says nothing holds the entry.
 */
function parseCause(q: Record<string, unknown>): Cause | null | undefined {
  if (!('cause' in q)) return undefined
  const c = q.cause
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return null
  const r = c as Record<string, unknown>
  const run = num(r.run)
  if (r.kind === 'deploy-red' && run !== null) return { kind: 'deploy-red', run }
  if (typeof r.kind === 'string' && typeof r.sitting === 'string' && r.sitting !== '') return { kind: r.kind, sitting: r.sitting }
  return null
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : []
/** A value as an object to read fields from, an array included, else null. */
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null)
/** A time string in milliseconds, or null when it is no string or `Date.parse` cannot read it. */
const parseMs = (v: unknown): number | null => {
  const ms = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(ms) ? ms : null
}

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
      ...parseSlot(r),
    })),
    queued: list(d.queued).map(q => ({
      entry: num(q.entry) ?? 0,
      brief: str(q.brief),
      lane: str(q.lane),
      reason: str(q.reason),
      cause: parseCause(q),
    })),
    finished: list(d.finished).map(f => ({
      entry: num(f.entry) ?? 0,
      brief: str(f.brief),
      lane: str(f.lane),
      status: num(f.status) ?? 1,
      outcome: str(f.outcome),
      kind: typeof f.kind === 'string' && f.kind !== '' ? f.kind : null,
      ...parseSlot(f),
    })),
  }
}

/** `docs/briefs/kickoff-sitting-s299-one-full-check.md` → `kickoff-sitting-s299-one-full-check`. */
export function baseName(brief: string): string {
  return brief.replace(/^.*\//, '').replace(/\.md$/, '')
}

/** A finished record's outcome without the launcher's `autopilot: ` prefix and the run name before the sentence. */
const outcomeOf = (f: { brief: string; outcome: string }): string =>
  f.outcome.replace(/^autopilot: /, '').replace(`${baseName(f.brief)} `, '')

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

// How much of a run's stream-json log the board reads for its newest tool
// call. A log passes the 4 MiB read cap within hours, so the board reads its
// end with `tail -c`; one event line rarely passes 256 KiB.
export const LOG_TAIL_BYTES = 262144

// The longest tool summary the board draws, ellipsis included.
const TOOL_SUMMARY_MAX = 48

/** What a tool call acts on, in a few words: a Bash call's description, an edit's file name. */
function toolDetail(name: string, input: Record<string, unknown>): string {
  const field = (k: string): string => (typeof input[k] === 'string' ? (input[k] as string) : '')
  if (name === 'Bash') return field('description') || field('command')
  if (name === 'Skill') return field('skill')
  if (name === 'Agent' || name === 'Task') return field('description')
  if (name === 'Grep' || name === 'Glob') return field('pattern')
  return field('file_path').replace(/^.*\//, '') || field('notebook_path').replace(/^.*\//, '')
}

/**
 * The newest tool call in the tail of a run's stream-json log, as
 * `Bash: Run the focused check`, or empty when the tail holds none. The
 * tail's first line is cut by `tail -c` and fails to parse, so it is skipped.
 */
export function lastToolOf(tail: string): string {
  const lines = tail.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? ''
    if (!line.includes('"tool_use"')) continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const e = event as { type?: unknown; message?: { content?: unknown } }
    if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue
    const uses = list(e.message.content).filter(c => c.type === 'tool_use' && typeof c.name === 'string')
    const use = uses[uses.length - 1]
    if (use === undefined) continue
    const name = use.name as string
    const input = typeof use.input === 'object' && use.input !== null ? (use.input as Record<string, unknown>) : {}
    const detail = toolDetail(name, input).replace(/\s+/g, ' ').trim()
    const text = detail === '' ? name : `${name}: ${detail}`
    return text.length > TOOL_SUMMARY_MAX ? `${text.slice(0, TOOL_SUMMARY_MAX - 1)}…` : text
  }
  return ''
}

/**
 * How many cycles a brief plans: its `### Cycle N` headings or its
 * `**Cycle N` lines, whichever there are more of, as scripts/autopilot.sh
 * counts them.
 */
export function cycleCount(text: string): number {
  const lines = text.split('\n')
  const headings = lines.filter(l => /^### Cycle [0-9]/.test(l)).length
  const bold = lines.filter(l => /^\*\*Cycle [0-9]/.test(l)).length
  return Math.max(headings, bold)
}

/**
 * The blobs that hold each brief's cycles, by brief key, from an `ls-tree -r`
 * listing's blobs, in listing order: a file brief's own blob, or every `.md`
 * file directly in a directory brief, the files scripts/autopilot.sh reads.
 */
export function cycleBlobMap(blobs: readonly TreeBlob[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const add = (key: string, sha: string) => {
    const shas = out.get(key)
    if (shas === undefined) out.set(key, [sha])
    else shas.push(sha)
  }
  for (const { path, sha } of blobs) {
    add(path, sha)
    const dir = /^(.+)\/[^/]+\.md$/.exec(path)?.[1]
    if (dir !== undefined) add(dir, sha)
  }
  return out
}

// A `/commit` line in a progress file, and the text after the skill's name.
const COMMIT_LINE = /^skill: commit-skill:commit\b(.*)$/
// The `cycle k` that a `/commit` line's text names.
const CYCLE_NAMED = /\bcycle (\d+)/i

/**
 * Where a run is in the fixed chain, from its progress file: step 0's savor
 * when the run has one, each cycle, then simplify, the xhigh review, the ship
 * and the archive.
 *
 * The savor runs from a `sittings:savor launch` line to the next `/commit`,
 * which holds its edits and counts toward no cycle, or to the launcher's
 * `savored:` line, which a savor that made no edits ends on.
 * Cycle k is done when a `/commit` naming `cycle k` (or, naming none, the
 * next cycle) is followed by a `code-review low` line. The ship starts at
 * `/ship` or a push, and the archive at the first `/commit` after the ship's
 * push. A later step marks every earlier one done. `cycles` is the brief's
 * count; without it the count is the highest cycle the progress file names.
 */
export function phasesOf(progress: string, cycles?: number): Phase[] {
  let savor: 'none' | 'live' | 'done' = 'none'
  let done = 0
  let pending: number | null = null
  let named = 0
  let cut = false
  let simplify = false
  let xhigh = false
  let ship = false
  let shipPushed = false
  let archive = false
  let finished = false
  for (const line of progress.split('\n')) {
    const commit = COMMIT_LINE.exec(line)
    if (commit) {
      if (savor === 'live') savor = 'done'
      else if (shipPushed) archive = true
      else if (!simplify && !ship) {
        const k = CYCLE_NAMED.exec(commit[1] ?? '')
        pending = k ? Number(k[1]) : done + 1
        named = Math.max(named, pending)
      }
    } else if (/^skill: code-review low\b/.test(line)) {
      if (pending !== null) done = Math.max(done, pending)
      pending = null
    } else if (/^skill: sittings:savor launch\b/.test(line)) {
      if (savor === 'none') savor = 'live'
    } else if (line.startsWith('savored: ')) {
      if (savor === 'live') savor = 'done'
    } else if (line.startsWith('cut: ')) cut = true
    else if (/^skill: simplify\b/.test(line)) simplify = true
    else if (/^skill: code-review xhigh\b/.test(line)) xhigh = true
    else if (/^skill: commit-skill:ship\b/.test(line)) ship = true
    else if (line.startsWith('bash: ') && line.includes('push:checked')) {
      if (ship) shipPushed = true
      ship = true
    } else if (line.startsWith('finished: shipped')) finished = true
  }
  const n = cycles !== undefined && cycles > 0 ? cycles : Math.max(named, done + 1, 1)
  const live = finished
    ? n + 4
    : archive
      ? n + 3
      : ship
        ? n + 2
        : xhigh
          ? n + 1
          : simplify || cut || done >= n
            ? n
            : done
  const names: [string, string][] = [
    ...Array.from({ length: n }, (_, i): [string, string] => [`cycle ${i + 1}`, `c${i + 1}`]),
    ['simplify', 'simpl'],
    ['review xhigh', 'xhigh'],
    ['shipping', 'ship'],
    ['archiving', 'arch'],
  ]
  const phases = names.map(([label, short], i): Phase => {
    const state: PhaseState = savor === 'live' ? 'todo' : i < live ? 'done' : i === live ? 'live' : 'todo'
    return { label, short, state }
  })
  if (savor === 'none') return phases
  return [{ label: 'savor', short: 'savor', state: savor }, ...phases]
}

/**
 * The highest `cycle k` that a cycle commit in a progress file names, or 0
 * when none names one. A cycle commit is a `/commit` that `phasesOf` counts
 * toward a cycle: after the savor closes, and before `/simplify`, `/ship` or
 * a push. A cycle commit that names no cycle adds nothing, so this is not
 * `phasesOf`'s count.
 */
export function namedCycles(progress: string): number {
  let most = 0
  let savor: 'none' | 'live' | 'done' = 'none'
  let after = false
  for (const line of progress.split('\n')) {
    const commit = COMMIT_LINE.exec(line)
    if (commit) {
      if (savor === 'live') savor = 'done'
      else if (!after) {
        const k = CYCLE_NAMED.exec(commit[1] ?? '')
        if (k) most = Math.max(most, Number(k[1]))
      }
    } else if (/^skill: sittings:savor launch\b/.test(line)) {
      if (savor === 'none') savor = 'live'
    } else if (line.startsWith('savored: ')) {
      if (savor === 'live') savor = 'done'
    } else if (/^skill: (simplify|commit-skill:ship)\b/.test(line) || (line.startsWith('bash: ') && line.includes('push:checked'))) after = true
  }
  return most
}

// The stamp the launcher writes above each progress write: `at: 2026-11-21T09:39:39Z`.
const STAMP = /^at: (.*)$/

/**
 * Each line's time: the time on the nearest `at:` line above it, an `at:`
 * line's own for itself. An `at:` line whose time does not parse, an empty
 * one included, is no stamp, so it and the lines under it keep the stamp
 * above it.
 */
export function lineTimes(progress: string): (number | null)[] {
  let at: number | null = null
  return progress.split('\n').map(line => {
    const m = STAMP.exec(line)
    if (m) at = parseMs((m[1] ?? '').trim()) ?? at
    return at
  })
}

// How many cells RECENT's phase split takes.
export const RECENT_SPLIT_CELLS = 6

type SplitPhase = keyof PhaseSplit | 'none'

/**
 * The phase a run is in after `line`, by the lines `phasesOf` reads. A `slot:`
 * line starts a launch and a `finished:` line ends one, and between them and
 * the launch's first step the run is in no phase. The savor runs from its
 * `sittings:savor launch` line to its own `/commit` or the `savored:` line.
 * The ship starts at `/ship` or a push. Every other step, simplify and the
 * xhigh review included, is the cycles.
 */
function nextSplitPhase(phase: SplitPhase, line: string): SplitPhase {
  if (line.startsWith('slot: ') || line.startsWith('finished: ')) return 'none'
  if (line === '' || line.startsWith('kind: ')) return phase
  if (/^skill: sittings:savor launch\b/.test(line)) return phase === 'none' ? 'savor' : phase
  if (phase === 'savor') return line.startsWith('savored: ') || COMMIT_LINE.test(line) ? 'cycles' : 'savor'
  if (/^skill: commit-skill:ship\b/.test(line) || (line.startsWith('bash: ') && line.includes('push:checked'))) return 'ship'
  return phase === 'none' ? 'cycles' : phase
}

/**
 * A run's time as RECENT_SPLIT_CELLS cells of savor, cycles and ship. The
 * time from one stamp to the next belongs to the phase the lines under the
 * first one leave the run in, so time in no phase, such as a relaunch's wait,
 * counts nowhere. Cells round by largest remainder, ties to the earlier phase.
 * Null when the file holds no time in any phase, as a file with no `at:`
 * lines does.
 */
export function phaseSplit(progress: string): PhaseSplit | null {
  const lines = progress.split('\n')
  const times = lineTimes(progress)
  const ms: PhaseSplit = { savor: 0, cycles: 0, ship: 0 }
  let phase: SplitPhase = 'none'
  let from: number | null = null
  lines.forEach((line, i) => {
    if (!STAMP.test(line)) {
      phase = nextSplitPhase(phase, line)
      return
    }
    const at = times[i] ?? null
    if (from !== null && at !== null && phase !== 'none') ms[phase] += Math.max(0, at - from)
    from = at
  })
  const keys = ['savor', 'cycles', 'ship'] as const
  const total = ms.savor + ms.cycles + ms.ship
  if (total <= 0) return null
  const quota = keys.map(k => (ms[k] / total) * RECENT_SPLIT_CELLS)
  const cells = quota.map(Math.floor)
  let left = RECENT_SPLIT_CELLS - cells.reduce((a, b) => a + b, 0)
  for (const i of [0, 1, 2].sort((a, b) => (quota[b] ?? 0) - (cells[b] ?? 0) - ((quota[a] ?? 0) - (cells[a] ?? 0)) || a - b)) {
    if (left <= 0) break
    cells[i] = (cells[i] ?? 0) + 1
    left--
  }
  return { savor: cells[0] ?? 0, cycles: cells[1] ?? 0, ship: cells[2] ?? 0 }
}

/**
 * Each line's live phase label, by `phasesOf` over the lines up to it, or null
 * when no phase is live. Progress files run to tens of lines, so reading each
 * prefix costs nothing that matters, and `phasesOf` stays the one reader of
 * what a phase is.
 */
function liveLabels(lines: readonly string[], cycles?: number): (string | null)[] {
  return lines.map((_, i) => phasesOf(lines.slice(0, i + 1).join('\n'), cycles).find(p => p.state === 'live')?.label ?? null)
}

/**
 * When the live phase started: the stamp on the first line of the run of
 * lines that leave the same phase live, or the stamp on the latest `slot:`
 * line when that is later, so a relaunched run's clock counts from its
 * relaunch. Null when no phase is live or the opening line has no stamp.
 */
export function phaseSince(progress: string, cycles?: number): number | null {
  const lines = progress.split('\n')
  const times = lineTimes(progress)
  const labels = liveLabels(lines, cycles)
  const last = labels.length - 1
  const live = labels[last] ?? null
  if (live === null) return null
  let first = last
  while (first > 0 && labels[first - 1] === live) first--
  const opened = times[first] ?? null
  if (opened === null) return null
  const launch = lines.findLastIndex(line => line.startsWith('slot: '))
  const launchedAt = launch === -1 ? null : (times[launch] ?? null)
  return launchedAt === null ? opened : Math.max(opened, launchedAt)
}

/**
 * A run's milliseconds in each phase, by phase label. The time from one stamp
 * to the next belongs to the phase the lines under the first one leave live.
 * Time after a `finished:` line and before the next `slot:` line, a
 * relaunch's wait, counts in no phase. A file with no `at:` lines gives no
 * phases.
 */
export function phaseDurations(progress: string): Record<string, number> {
  const lines = progress.split('\n')
  const times = lineTimes(progress)
  const labels = liveLabels(lines)
  const out: Record<string, number> = {}
  let from: number | null = null
  let label: string | null = null
  let paused = false
  lines.forEach((line, i) => {
    if (STAMP.test(line)) {
      const at = times[i] ?? null
      if (from !== null && at !== null && label !== null && !paused) out[label] = (out[label] ?? 0) + Math.max(0, at - from)
      from = at
      return
    }
    if (line.startsWith('finished: ')) paused = true
    else if (line.startsWith('slot: ')) paused = false
    label = labels[i] ?? null
  })
  return out
}

/** The key a phase's median pools under: every cycle is one sample of `cycle`. */
const phaseKey = (label: string): string => (label.startsWith('cycle ') ? 'cycle' : label)

/** The median milliseconds of each phase over RECENT, by `phaseKey`, among runs that spent time in it. */
export function phaseMedians(recent: readonly Ended[]): Record<string, number> {
  const samples: Record<string, number[]> = {}
  for (const d of recent) for (const [label, ms] of Object.entries(d.phaseMs)) if (ms > 0) (samples[phaseKey(label)] ??= []).push(ms)
  const out: Record<string, number> = {}
  for (const [key, xs] of Object.entries(samples)) {
    const m = medianOf(xs)
    if (m !== null) out[key] = m
  }
  return out
}

// Stages the phase line leaves out: those that say no more than the phase,
// and `review low`, which stays the last step line through the next
// cycle's build, so it reads as the cycle before the one in flight.
const QUIET_STAGES = new Set(['savor', 'starting', 'working', 'review low', 'simplify', 'review xhigh', 'shipping'])

/**
 * A running card's phase line: the stage when it adds to the phase, then the
 * newest tool call. The bar's lit label names the phase, and the bar's `⋮`
 * marks where each session starts, so the line names neither. A run with no
 * phase in flight reads `finishing`.
 */
export function phaseLine(r: Run): string {
  if (!r.phases.some(p => p.state === 'live')) return 'finishing'
  const parts: string[] = []
  if (!QUIET_STAGES.has(r.stage)) parts.push(r.stage)
  if (r.tool !== '') parts.push(r.tool)
  return parts.join(' · ')
}

/** One braille cell per phase for the hint line, `⣿` done, `⣤` in flight, `⣀` to come, then a `⡇` cap. */
export const miniBar = (phases: readonly Phase[]): string =>
  `${phases.map(p => (p.state === 'done' ? '⣿' : p.state === 'live' ? '⣤' : '⣀')).join('')}⡇`

// The steps a cell climbs from the baseline to full.
const FILL_LEVELS = ['⣀', '⣤', '⣶', '⣿']
const FILL_STEPS = FILL_LEVELS.length - 1

/**
 * A phase's block in the pane's bar, `width` cells of braille: full when
 * done, the `⣀` baseline when still to come. A block in flight fills from
 * the left to `fill`, a fraction of 0 to 1, in FILL_STEPS steps a cell. It
 * shows at least one step and stops one step short of full, so a live block
 * never reads as not started or as done.
 */
export function phaseGlyphs(state: PhaseState, width: number, fill = 0): string {
  if (state === 'done') return '⣿'.repeat(width)
  if (state === 'todo') return '⣀'.repeat(width)
  const steps = width * FILL_STEPS
  const lit = Math.min(steps - 1, Math.max(1, Math.round(fill * steps)))
  return Array.from({ length: width }, (_, i) => FILL_LEVELS[Math.min(FILL_STEPS, Math.max(0, lit - i * FILL_STEPS))]).join('')
}

// The marks the phase fill reads from a run's stream-json log, one `grep -oE`
// alternative each: a tool call's id and name; the first field of its input;
// a Skill call's name and the start of its args; a task's start, progress or
// end, with the tool call it belongs to; a task's type; a tool result; and
// the agent a nested event belongs to. Each match stops at a quote, so a mark
// never runs into the large fields that follow.
export const LOG_MARKS = [
  '"type":"tool_use","id":"[^"]+","name":"[^"]+"',
  '"input":\\{"(command|description|file_path|skill)":"[^"]{0,80}',
  '"skill":"[^"]+","args":"[^"]{0,24}',
  '"subtype":"task_(started|progress|notification)","task_id":"[^"]+",("run_id":"[^"]+",)?"tool_use_id":"[^"]+"',
  '"task_type":"[a-z_]+"',
  '"tool_use_id":"[^"]+","type":"tool_result"',
  '"parent_tool_use_id":"[^"]+"',
].join('|')

// How many of the newest marks the board reads. A phase's opener sits within
// a few thousand marks of the end, and the output stays under the 4 MiB cap.
export const LOG_MARK_LINES = 8000

/** One event of a run's log that the phase fill reads, in log order. */
export type LogEvent =
  | { kind: 'use'; id: string; name: string; detail: string; skill: string; args: string; nested: boolean }
  | { kind: 'task'; step: 'started' | 'progress' | 'notification'; id: string; agent: boolean }
  | { kind: 'result'; id: string }

/**
 * The events in `grep -noE LOG_MARKS` output, in log order. The marks of one
 * log line describe one event, so they are read together: an input or a
 * Skill's args belongs to the tool call before it on the line, a task type
 * to the task, and a parent id nests every tool call on the line. A line
 * that is no mark, such as one `tail` cut, is skipped.
 */
export function logEventsOf(marks: string): LogEvent[] {
  const lines = new Map<string, string[]>()
  for (const line of marks.split('\n')) {
    const m = /^(\d+):(.*)$/.exec(line)
    if (m) (lines.get(m[1] ?? '') ?? lines.set(m[1] ?? '', []).get(m[1] ?? ''))?.push(m[2] ?? '')
  }
  const out: LogEvent[] = []
  for (const group of lines.values()) {
    const nested = group.some(g => g.startsWith('"parent_tool_use_id":'))
    const agent = group.some(g => g === '"task_type":"local_agent"')
    let use: Extract<LogEvent, { kind: 'use' }> | null = null
    for (const g of group) {
      const call = /^"type":"tool_use","id":"([^"]+)","name":"([^"]+)"$/.exec(g)
      const input = /^"input":\{"([a-z_]+)":"(.*)$/.exec(g)
      const skill = /^"skill":"([^"]+)","args":"(.*)$/.exec(g)
      const task = /^"subtype":"task_(started|progress|notification)",.*"tool_use_id":"([^"]+)"$/.exec(g)
      const result = /^"tool_use_id":"([^"]+)","type":"tool_result"$/.exec(g)
      if (call) {
        use = { kind: 'use', id: call[1] ?? '', name: call[2] ?? '', detail: '', skill: '', args: '', nested }
        out.push(use)
      } else if (input && use !== null) {
        use.detail = input[2] ?? ''
        if (input[1] === 'skill') use.skill = use.detail
      } else if (skill && use !== null) {
        use.skill = skill[1] ?? ''
        use.args = skill[2] ?? ''
      } else if (task) {
        const step = task[1] as 'started' | 'progress' | 'notification'
        out.push({ kind: 'task', step, id: task[2] ?? '', agent: step === 'started' && agent })
      } else if (result) out.push({ kind: 'result', id: result[1] ?? '' })
    }
  }
  return out
}

// How many tool calls close about two thirds of the gap to the next checkpoint.
const CREEP_CALLS = 20
// The most a live phase fills.
const FILL_CAP = 0.95

type FillContext = { opener: string; last: string }
type Checkpoint = { at: number; hit: (e: LogEvent, c: FillContext) => boolean }
type FillSpec = {
  /** The index of the event that opens the phase, or -1 for the log's start. */
  opener: (events: readonly LogEvent[]) => number
  /** The span the phase's agents fill, by how many of them are back, before any checkpoint. */
  fanOut?: [number, number]
  checkpoints: Checkpoint[]
}

const topUse = (e: LogEvent, name?: string): e is Extract<LogEvent, { kind: 'use' }> =>
  e.kind === 'use' && !e.nested && (name === undefined || e.name === name)
const skillUse = (e: LogEvent, skill: string, args = ''): boolean => topUse(e, 'Skill') && e.skill === skill && e.args.startsWith(args)
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const edited = (e: LogEvent): boolean => topUse(e) && EDITS.has(e.name)
// A Bash call that runs a build or a suite, by the start of its command.
const BUILD = /\b(check|test|tests|vitest|vt\.sh|door\.sh|build|lint|typecheck)\b/i
const built = (e: LogEvent): boolean => topUse(e, 'Bash') && BUILD.test(e.detail)
const committed = (e: LogEvent): boolean => skillUse(e, 'commit-skill:commit')
const shipped = (e: LogEvent): boolean => skillUse(e, 'commit-skill:ship')
/** Whether `e` ends the tool call `id`: its result, or its task's end. */
const ends = (e: LogEvent, id: string): boolean =>
  id !== '' && e.id === id && (e.kind === 'result' || (e.kind === 'task' && e.step === 'notification'))

const reviewLow = (e: LogEvent): boolean => skillUse(e, 'code-review', 'low')
const reviewXhigh = (e: LogEvent): boolean => skillUse(e, 'code-review', 'xhigh')

/** The first event after `from` that `f` matches, or -1. */
const firstAfter = (events: readonly LogEvent[], from: number, f: (e: LogEvent) => boolean): number => {
  const i = events.findIndex((e, k) => k > from && f(e))
  return i
}

/**
 * Where each phase opens in the log and what it passes on the way. A cycle
 * opens at the last `code-review low`, or at the savor's commit before the
 * first review, and passes its first edit, a build and its commit. The
 * savor and simplify fill by their agents first. The xhigh review is one
 * forked task, so its own tool calls carry it to its end. The ship ends when
 * its forked `/ship` does, and the archive passes its commit and its push.
 */
function fillSpec(label: string): FillSpec {
  if (label === 'savor')
    return { opener: es => es.findIndex(e => skillUse(e, 'sittings:savor')), fanOut: [0.05, 0.75], checkpoints: [{ at: 0.9, hit: committed }] }
  if (label.startsWith('cycle '))
    return {
      opener: es => {
        const review = es.findLastIndex(reviewLow)
        if (review !== -1) return review
        const savor = es.findIndex(e => skillUse(e, 'sittings:savor'))
        return savor === -1 ? -1 : firstAfter(es, savor, committed)
      },
      checkpoints: [
        { at: 0.2, hit: edited },
        { at: 0.5, hit: built },
        { at: 0.8, hit: committed },
      ],
    }
  if (label === 'simplify')
    return {
      opener: es => {
        const at = es.findLastIndex(e => skillUse(e, 'simplify'))
        return at !== -1 ? at : es.findLastIndex(reviewLow)
      },
      fanOut: [0.05, 0.55],
      checkpoints: [
        { at: 0.65, hit: edited },
        { at: 0.75, hit: built },
        { at: 0.9, hit: committed },
      ],
    }
  if (label === 'review xhigh')
    return {
      opener: es => es.findLastIndex(reviewXhigh),
      checkpoints: [
        { at: 0.7, hit: (e, c) => ends(e, c.opener) },
        { at: 0.8, hit: edited },
        { at: 0.9, hit: committed },
      ],
    }
  if (label === 'shipping')
    return {
      opener: es => firstAfter(es, es.findLastIndex(reviewXhigh), shipped),
      checkpoints: [{ at: 0.8, hit: (e, c) => ends(e, c.opener) }],
    }
  if (label === 'archiving')
    return {
      opener: es => es.findLastIndex(committed),
      checkpoints: [
        { at: 0.4, hit: (e, c) => ends(e, c.opener) },
        { at: 0.6, hit: shipped },
        { at: 0.9, hit: (e, c) => ends(e, c.last) },
      ],
    }
  return { opener: () => -1, checkpoints: [] }
}

/**
 * How far the live phase `label` has come, 0 to FILL_CAP, from its log
 * events. The phase sits at the last checkpoint it passed, or, before any,
 * at the share of its agents that are back. From there it creeps toward the
 * next checkpoint with each tool call, its agents' included, and never
 * reaches it: a long wait inside one step still moves, but claims no step it
 * has not passed. The fill never falls below its highest point.
 */
export function phaseFill(label: string, events: readonly LogEvent[]): number {
  const spec = fillSpec(label)
  const from = spec.opener(events)
  const head = from === -1 ? undefined : events[from]
  const context: FillContext = { opener: head?.kind === 'use' ? head.id : '', last: '' }
  const agents = new Set<string>()
  const back = new Set<string>()
  const first = spec.checkpoints[0]?.at ?? FILL_CAP
  let reached = -1
  let calls = 0
  const now = (): number => {
    let base = 0
    let next = first
    if (reached !== -1) {
      base = spec.checkpoints[reached]?.at ?? 0
      next = spec.checkpoints[reached + 1]?.at ?? FILL_CAP
    } else if (spec.fanOut !== undefined) {
      const [lo, hi] = spec.fanOut
      const share = (n: number) => lo + ((hi - lo) * n) / agents.size
      if (agents.size === 0) next = lo
      else {
        base = share(back.size)
        next = back.size === agents.size ? first : share(back.size + 1)
      }
    }
    return Math.min(FILL_CAP, base + (next - base) * (1 - Math.exp(-calls / CREEP_CALLS)))
  }
  // A later wave of agents lowers the share that are back, so the fill keeps
  // its highest point and never draws a step backwards.
  let peak = 0
  for (const e of events.slice(from + 1)) {
    const k = spec.checkpoints.findIndex((c, i) => i > reached && c.hit(e, context))
    if (k !== -1) {
      reached = k
      if (e.kind === 'use') context.last = e.id
      calls = 0
    } else if (spec.fanOut !== undefined && reached === -1 && e.kind === 'task' && e.agent) {
      agents.add(e.id)
      calls = 0
    } else if (e.kind === 'task' && e.step === 'notification' && agents.has(e.id) && !back.has(e.id)) {
      back.add(e.id)
      calls = 0
    } else if (e.kind === 'use') calls++
    peak = Math.max(peak, now())
  }
  return Math.max(peak, now())
}

/**
 * Columns per bar block in a pane `bodyColumns` wide: the card's border and
 * padding take four, the session marker two, and each block keeps a gap.
 * Between 3 and 9, so a short label still fits, `simplify` fits on a wide
 * pane, and a wider pane stays calm.
 */
export const segmentWidth = (bodyColumns: number, phases: number): number =>
  Math.max(3, Math.min(9, Math.floor((bodyColumns - 6) / Math.max(1, phases))))

// Each phase's names under the bar, longest first.
const PHASE_NAMES: Record<string, readonly string[]> = {
  savor: ['savor', 'sav'],
  simplify: ['simplify', 'simpl', 'simp'],
  'review xhigh': ['xhigh', 'xhi'],
  shipping: ['ship'],
  archiving: ['archive', 'arch'],
}

/**
 * A phase's label under its bar block: the longest of its names that fits in
 * `room` columns. A cycle reads `cycle 2`, then `c2`. When no name fits, the
 * shortest name is cut to `room`.
 */
export function phaseName(p: Phase, room: number): string {
  const k = /^cycle (\d+)$/.exec(p.label)
  const names = k ? [p.label, `c${k[1] ?? ''}`] : (PHASE_NAMES[p.label] ?? [p.short])
  return names.find(n => n.length <= room) ?? (names[names.length - 1] ?? '').slice(0, room)
}

/** `n` dollars in whole dollars with thousands separators: `$4,629`. */
export const dollars = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`

/**
 * `n` dollars as `dollars` gives them, or as `$N.Nk` when they come to $1,000
 * or more after rounding to a tenth of a thousand: 999.6 gives `$1.0k`.
 */
export function shortDollars(n: number): string {
  const k = Math.round(n / 100) / 10
  return k >= 1 ? `$${k.toFixed(1)}k` : dollars(n)
}

/** The phase in flight's short name, or `done` once every phase is. */
export const livePhase = (phases: readonly Phase[]): string => phases.find(p => p.state === 'live')?.short ?? 'done'

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
  return parseMs(`${m[1] ?? ''}T${m[2] ?? ''}:${m[3] ?? ''}:00Z`)
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
  extra: {
    loop?: Loop | null
    recent?: Ended[]
    onDeck?: Deck[]
    /** Each running brief's newest tool call, read from its log. */
    tools?: Readonly<Record<string, string>>
    /** Each running brief's log marks, as `grep -noE LOG_MARKS` prints them; a brief whose log was not read is absent. */
    marks?: Readonly<Record<string, string>>
    /** Each brief's cycle count by its key, read from `origin/main`; a brief whose blobs could not be read is absent. */
    cycles?: Readonly<Record<string, number>>
    /** The machine's UTC offset as `date +%z` prints it, `-0500`. */
    utcOffset?: string
    /** The day sums from token-ledger, or null when it could not be read. */
    spend?: Board['spend']
    /** Each brief's `After:` sittings, read from `origin/main`. */
    afters?: Readonly<Record<string, string[]>>
    /** The progress files read for RECENT and BLOCKED. */
    endings?: readonly Ending[]
    /** Each stopped run's handoff text, by run name. */
    handoffs?: Readonly<Record<string, string>>
    /** Each red deploy's failed strip stage, by run. */
    deployStages?: Readonly<Record<string, string>>
    /** The newest deploy.yml run on main that went live, or empty when it could not be read. */
    liveDeploy?: string
    /** Each sitting's plan cost by sitting, from token-ledger, or null when it could not be read. */
    plans?: Readonly<Record<string, number>> | null
    /** Each run's launch count from its `.launches` file, by run name. */
    launches?: Readonly<Record<string, number>>
    /** How many briefs were split from each sitting, by sitting. */
    splits?: Readonly<Record<string, number>>
    /** Each brief's `Epic:` value by its key: every brief on `origin/main`, and each running one after its archive. */
    epics?: Readonly<Record<string, string>>
    /** The epic each archived claim in `sittings.json` shipped on, by sitting. */
    recordedEpics?: Readonly<Record<string, string>>
    /** Each plan's epic titles by id, by plan: `dashboard` gives `{ E2: 'design system' }`. */
    planTitles?: Readonly<Record<string, Readonly<Record<string, string>>>>
  } = {},
): Board {
  const { loop = null, tools = {}, cycles = {}, utcOffset = '', spend = null, afters = {}, plans = null } = extra
  const { blocks, drawn } = blockedOf({
    raw,
    endings: extra.endings ?? [],
    afters,
    handoffs: extra.handoffs,
    deployStages: extra.deployStages,
    liveDeploy: extra.liveDeploy,
    plans,
    launches: extra.launches,
  })
  const recent = (extra.recent ?? []).map(d => ({ ...d, plan: planOf(plans, d.sitting) }))
  // A held brief, and a stopped one, sits under BLOCKED and never on deck.
  const onDeck = (extra.onDeck ?? []).filter(d => !drawn.has(d.sitting))
  const medians = phaseMedians(recent)
  const running: Run[] = raw.running.map(r => {
    const text = progress[r.brief] ?? ''
    const { cost } = noteOf(text)
    const stage = stageOf(text)
    const phases = phasesOf(text, cycles[briefKey(r.brief)])
    const live = phases.find(p => p.state === 'live')
    return {
      entry: r.entry,
      ...sittingOf(r.brief),
      lane: r.lane,
      startedMs: parseMs(r.started) ?? now,
      cost: Math.max(r.cost, cost ?? 0),
      stage,
      tool: tools[r.brief] ?? '',
      phases,
      phaseSinceMs: phaseSince(text, cycles[briefKey(r.brief)]),
      phaseMedianMs: live === undefined ? null : (medians[phaseKey(live.label)] ?? null),
      fill: live === undefined || extra.marks?.[r.brief] === undefined ? null : phaseFill(live.label, logEventsOf(extra.marks[r.brief] ?? '')),
      isAlive: r.pid !== null && alive.has(r.pid),
    }
  })
  const queued: Waiting[] = raw.queued.map(q => ({
    entry: q.entry,
    ...sittingOf(q.brief),
    lane: q.lane,
    reason: q.reason,
    after: afters[briefKey(q.brief)] ?? [],
  }))
  // Each brief's cycles and cost: a brief on main, and each running or queued one.
  const perCycle = costPerCycle(recent)
  const costs: Record<string, BriefCost> = {}
  const costOf = (key: string): BriefCost => {
    const n = cycles[key] ?? null
    return { cycles: n, usd: n !== null && n > 0 && perCycle !== null ? perCycle * n : null }
  }
  for (const k of Object.keys(afters)) costs[briefName(k).sitting] = costOf(k)
  // A running sitting's cycles done or under way.
  const lit = new Map(running.map(r => [r.sitting, r.phases.filter(p => p.label.startsWith('cycle ') && p.state !== 'todo').length]))
  for (const r of [...raw.running, ...raw.queued]) {
    const { sitting } = sittingOf(r.brief)
    const n = lit.get(sitting)
    costs[sitting] = n === undefined ? costOf(briefKey(r.brief)) : { ...costOf(briefKey(r.brief)), lit: n }
  }
  // Each live sitting's state for the epics card; a later line outranks an earlier one.
  const states = new Map<string, EpicState['kind']>()
  for (const d of onDeck) states.set(d.sitting, 'deck')
  for (const q of raw.queued) states.set(briefName(q.brief).sitting, 'queued')
  for (const k of blocks) for (const h of k.holds) states.set(h.sitting, 'held')
  for (const k of blocks) states.set(k.sitting, 'blocked')
  for (const r of raw.running) states.set(briefName(r.brief).sitting, 'running')
  const live = Object.entries(extra.epics ?? {}).map(([key, epic]) => {
    const { sitting } = briefName(key)
    return { sitting, epic, state: states.get(sitting) ?? 'deck' }
  })
  const finished: Done[] = [...raw.finished]
    .sort((a, b) => b.entry - a.entry)
    .map(f => ({ entry: f.entry, ...sittingOf(f.brief), lane: f.lane, isShipped: f.status === 0, detail: outcomeDetail(outcomeOf(f)) }))
  return {
    checkedAt: now,
    clock: localClock(now, utcOffset),
    spend,
    isDispatcherLive: raw.dispatcher !== null && alive.has(raw.dispatcher),
    loop,
    running,
    queued,
    finished,
    recent,
    onDeck,
    blocked: blocks,
    splits: { ...extra.splits },
    epics: epicRows(live, extra.recordedEpics ?? {}, extra.planTitles ?? {}),
    costs,
    timeline: timelineOf({
      raw,
      running,
      progress,
      endings: extra.endings ?? [],
      blocks,
      onDeck,
      afters,
      median: medianMinutes(recent),
      now,
      utcOffset,
    }),
  }
}

const HOUR_MS = 3600000
const MINUTE_MS = 60000

// The timeline's window: this far before now, and this far after.
export const TIMELINE_BACK_MS = 8 * HOUR_MS
export const TIMELINE_AHEAD_MS = 6 * HOUR_MS

// How far a record's `slot_taken` may sit from the stamp above its run's
// `slot:` line and still be the same launch: the launcher stamps the line a
// few seconds after the dispatcher takes the slot.
const SLOT_MATCH_MS = 5 * MINUTE_MS

/** One launch in a progress file: its slot, or null for `slot: none`, and its span. */
type SlotSpan = { slot: number | null; startMs: number; endMs: number | null; isLive: boolean }

/**
 * Each launch a progress file records: a stamped `slot: <k>` line, to the
 * stamp of the launch's first `landed:` or `finished:` line, or to nothing
 * while the launch has neither. A launch is live unless its `finished:` line
 * says the run never went live. A `slot:` line with no stamp above it opens
 * no launch.
 *
 * A launch with neither line ends, stopped, at the next `slot:` line's stamp.
 * With `mtimeMs`, for a file whose run has ended, the last such launch ends,
 * stopped, at the file's last stamp, or at `mtimeMs` when no stamp follows its
 * own; without it, the last launch stays open.
 */
function slotSpans(progress: string, mtimeMs: number | null = null): SlotSpan[] {
  const times = lineTimes(progress)
  const out: SlotSpan[] = []
  let open: SlotSpan | null = null
  const close = (span: SlotSpan, at: number | null) => {
    if (span.endMs !== null || at === null || at <= span.startMs) return
    span.endMs = at
    span.isLive = false
  }
  progress.split('\n').forEach((line, i) => {
    const at = times[i] ?? null
    const slot = /^slot: (\S+)/.exec(line)
    if (slot) {
      if (open !== null) {
        close(open, at)
        out.push(open)
      }
      open = at === null ? null : { slot: slotNumber(Number(slot[1])), startMs: at, endMs: null, isLive: true }
      return
    }
    if (open === null) return
    const isFinished = line.startsWith('finished: ')
    if (!isFinished && !line.startsWith('landed: ')) return
    if (open.endMs === null) open.endMs = at
    if (isFinished) open.isLive = LIVE.test(line.slice('finished: '.length))
  })
  // The callback assigns `open`, which the compiler does not follow.
  const tail = open as SlotSpan | null
  if (tail !== null) {
    if (mtimeMs !== null) {
      const last = times[times.length - 1] ?? null
      close(tail, last !== null && last > tail.startMs ? last : mtimeMs)
    }
    out.push(tail)
  }
  return out
}

/** The stamp of a progress file's last `finished:` line, or null when it has none or no stamp. */
function finishedAt(progress: string): number | null {
  const lines = progress.split('\n')
  const times = lineTimes(progress)
  for (let i = lines.length - 1; i >= 0; i--) if ((lines[i] ?? '').startsWith('finished: ')) return times[i] ?? null
  return null
}

/**
 * The span of a finished run that names no slot: its first stamp to its last
 * `finished:` line's, or, in a file with no stamps, its outcome's minutes
 * back from the file's mtime. Null when neither gives a span.
 */
function unslottedSpan(progress: string, mtimeMs: number): { startMs: number; endMs: number; isLive: boolean } | null {
  const end = lastEnd(progress)
  if (end === null) return null
  const stamps = lineTimes(progress).filter((t): t is number => t !== null)
  const first = stamps[0]
  if (first !== undefined) {
    const last = finishedAt(progress) ?? stamps[stamps.length - 1] ?? first
    return last > first ? { startMs: first, endMs: last, isLive: end.isLive } : null
  }
  const totals = TOTALS.exec(end.outcome)
  if (totals === null) return null
  return { startMs: mtimeMs - Number(totals[2]) * MINUTE_MS, endMs: mtimeMs, isLive: end.isLive }
}

const overlaps = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }): boolean =>
  a.startMs < b.endMs && b.startMs < a.endMs

/** A local instant's hour on a 12-hour face, 1 to 12, and whether it is past noon. */
function hour12(localMs: number): { hour: number; isPm: boolean } {
  const h = new Date(localMs).getUTCHours()
  return { hour: h % 12 === 0 ? 12 : h % 12, isPm: h >= 12 }
}

/** `12a`, `2p`: an instant's local hour on a 12-hour face, in the offset `date +%z` prints. */
function hourLabel(localMs: number): string {
  const { hour, isPm } = hour12(localMs)
  return `${hour}${isPm ? 'p' : 'a'}`
}

/** The offset `date +%z` prints, in minutes; null when it does not parse. */
function offsetMinutes(utcOffset: string): number | null {
  const m = /^([+-])(\d{2})(\d{2})$/.exec(utcOffset.trim())
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null
}

/**
 * The timeline card: a lane per slot from 1 to the highest slot the board
 * sees, then `you` and `held`, from TIMELINE_BACK_MS before now to
 * TIMELINE_AHEAD_MS after.
 *
 * A running or finished record with slot fields spans `slot_taken` to
 * `slot_released`, or to now while a running record holds its slot. A
 * finished record with no `slot_released` ends where the span its
 * `slot_taken` matches ends, else at its progress file's mtime. A running
 * record whose `slot_taken` does not parse starts at the run's start. A run's
 * progress file adds a span for each stamped `slot: <k>` line that no record's
 * `slot_taken` matches, so a run the finished list dropped keeps its slot and a
 * relaunched run keeps its earlier launches. A finished run that names no slot
 * anywhere goes on the lowest slot free over its span, and is not drawn when
 * none is free.
 *
 * With a median, the running run is projected to its start plus the median,
 * or to now once it is over. Then each queued entry that nothing holds, in
 * entry order, and each ready brief on deck, by sitting, takes the slot where
 * it can start soonest, the lower slot on a tie, no earlier than the
 * projected end of each `After:` sitting. An `After:` sitting that is not
 * running, queued or on `origin/main` waits on nothing; one that is but has
 * no bar leaves the brief undrawn. Every queued entry whose `cause` names a
 * hold, and every brief BLOCKED holds, counts once toward `held`.
 */
export function timelineOf(input: {
  raw: RawStatus
  /** `raw.running` as buildBoard read it, in the same order. */
  running: readonly Pick<Run, 'startedMs'>[]
  progress: Readonly<Record<string, string>>
  endings: readonly Ending[]
  blocks: readonly Block[]
  onDeck: readonly Deck[]
  afters: Readonly<Record<string, string[]>>
  /** RECENT's median run time in minutes, or null when no run is timed. */
  median: number | null
  now: number
  utcOffset: string
}): Timeline {
  const { raw, progress, endings, blocks, onDeck, afters, median, now } = input
  const startMs = now - TIMELINE_BACK_MS
  const endMs = now + TIMELINE_AHEAD_MS
  const medianMs = median === null ? null : median * MINUTE_MS
  const placed: { slot: number; bar: TimelineBar }[] = []
  const bar = (sitting: string, tone: BarTone, from: number, to: number, liveEndMs = to, isOverMedian = false): TimelineBar => ({
    sitting,
    tone,
    startMs: from,
    endMs: to,
    liveEndMs,
    isOverMedian,
  })
  type Unslotted = { sitting: string; tone: BarTone; startMs: number; endMs: number }
  const unslotted: Unslotted[] = []
  const ends = new Map<string, number>()
  let highest = 1

  // The launch stamps each record's slot fields account for, by run name.
  const recorded = new Map<string, number[]>()
  for (const r of [...raw.running, ...raw.finished]) {
    if (r.slot == null || r.slotTakenMs == null) continue
    const base = baseName(r.brief)
    recorded.set(base, [...(recorded.get(base) ?? []), r.slotTakenMs])
    highest = Math.max(highest, r.slot)
  }

  const isSameLaunch = (takenMs: number, span: SlotSpan): boolean => Math.abs(takenMs - span.startMs) <= SLOT_MATCH_MS

  raw.running.forEach((r, i) => {
    const { sitting } = sittingOf(r.brief)
    const spans = slotSpans(progress[r.brief] ?? '').filter(s => s.slot !== null)
    const last = spans[spans.length - 1]
    // A run whose start does not parse starts at now, so it draws no bar.
    const started = input.running[i]?.startedMs ?? now
    const startedMs = started < now ? started : null
    // The launches before this one: each closed span that no record takes.
    // Without a record's slot, the file's last span is this launch.
    const taken = recorded.get(baseName(r.brief)) ?? []
    for (const s of spans) {
      if (s.slot === null || s.endMs === null || s.endMs <= s.startMs || (r.slot == null && s === last)) continue
      if (taken.some(t => isSameLaunch(t, s))) continue
      highest = Math.max(highest, s.slot)
      placed.push({ slot: s.slot, bar: bar(sitting, s.isLive ? 'live' : 'stopped', s.startMs, s.endMs) })
    }
    const slot = r.slot ?? last?.slot ?? null
    const from = r.slot != null ? (r.slotTakenMs ?? startedMs) : (last?.startMs ?? null)
    if (slot === null || from === null) {
      if (startedMs !== null) unslotted.push({ sitting, tone: 'running', startMs: startedMs, endMs: now })
      return
    }
    highest = Math.max(highest, slot)
    const released = r.slot != null ? (r.slotReleasedMs ?? null) : null
    const liveEnd = Math.max(from, released ?? now)
    const projected = medianMs === null || released !== null ? liveEnd : from + medianMs
    const isOver = projected <= now && medianMs !== null && released === null
    const end = isOver ? now : Math.max(liveEnd, projected)
    placed.push({ slot, bar: bar(sitting, 'running', from, end, liveEnd, isOver) })
    ends.set(sitting, end)
  })
  // A finished record whose slot was never released, by run name: its progress file ends it.
  const unreleased = new Map<string, { slot: number; takenMs: number; tone: BarTone }[]>()
  for (const f of raw.finished) {
    if (f.slot == null || f.slotTakenMs == null) continue
    const tone: BarTone = LIVE.test(outcomeOf(f)) ? 'live' : 'stopped'
    if (f.slotReleasedMs == null) {
      const base = baseName(f.brief)
      unreleased.set(base, [...(unreleased.get(base) ?? []), { slot: f.slot, takenMs: f.slotTakenMs, tone }])
      continue
    }
    const to = Math.max(f.slotTakenMs, f.slotReleasedMs)
    placed.push({ slot: f.slot, bar: bar(sittingOf(f.brief).sitting, tone, f.slotTakenMs, to) })
  }
  for (const e of endings) {
    const { sitting } = sittingOf(e.base)
    const spans = slotSpans(e.text, e.mtimeMs).filter(s => s.slot !== null)
    for (const s of spans) highest = Math.max(highest, s.slot ?? 1)
    const taken = recorded.get(e.base) ?? []
    for (const s of spans) {
      if (s.slot === null || s.endMs === null || s.endMs <= s.startMs) continue
      if (taken.some(t => isSameLaunch(t, s))) continue
      placed.push({ slot: s.slot, bar: bar(sitting, s.isLive ? 'live' : 'stopped', s.startMs, s.endMs) })
    }
    // An unreleased record ends where the span it takes ends, else at the file's mtime.
    for (const u of unreleased.get(e.base) ?? []) {
      const to = spans.find(s => isSameLaunch(u.takenMs, s))?.endMs ?? e.mtimeMs
      if (to > u.takenMs) placed.push({ slot: u.slot, bar: bar(sitting, u.tone, u.takenMs, to) })
    }
    unreleased.delete(e.base)
    if (spans.length > 0 || recorded.has(e.base)) continue
    const span = unslottedSpan(e.text, e.mtimeMs)
    if (span !== null) unslotted.push({ sitting, tone: span.isLive ? 'live' : 'stopped', startMs: span.startMs, endMs: span.endMs })
  }
  const slots = Array.from({ length: highest }, (_, i) => i + 1)
  for (const u of [...unslotted].sort((a, b) => a.startMs - b.startMs)) {
    const slot = slots.find(k => !placed.some(p => p.slot === k && overlaps(p.bar, u)))
    if (slot === undefined) continue
    placed.push({ slot, bar: bar(u.sitting, u.tone, u.startMs, u.endMs) })
    if (u.tone === 'running') ends.set(u.sitting, u.endMs)
  }

  // What BLOCKED holds and what a cause holds, each once.
  const held = new Set<string>(blocks.flatMap(k => k.holds.map(h => h.sitting)))
  for (const q of raw.queued) if (q.cause != null) held.add(sittingOf(q.brief).sitting)

  if (medianMs !== null) {
    const free = new Map(slots.map(k => [k, now]))
    for (const p of placed) if (p.bar.tone === 'running') free.set(p.slot, Math.max(free.get(p.slot) ?? now, p.bar.endMs))
    const live = new Set([
      ...raw.running.map(r => sittingOf(r.brief).sitting),
      ...raw.queued.map(q => sittingOf(q.brief).sitting),
      ...Object.keys(afters).map(k => sittingOf(k).sitting),
      ...onDeck.map(d => d.sitting),
    ])
    const project = (sitting: string, after: readonly string[], tone: BarTone) => {
      let ready = now
      for (const a of after) {
        if (a === sitting) continue
        const end = ends.get(a)
        if (end !== undefined) ready = Math.max(ready, end)
        else if (live.has(a)) return
      }
      let best: { slot: number; at: number } | null = null
      for (const k of slots) {
        const at = Math.max(free.get(k) ?? now, ready)
        if (best === null || at < best.at) best = { slot: k, at }
      }
      if (best === null) return
      const end = best.at + medianMs
      placed.push({ slot: best.slot, bar: bar(sitting, tone, best.at, end) })
      free.set(best.slot, end)
      ends.set(sitting, end)
    }
    for (const q of [...raw.queued].sort((a, b) => a.entry - b.entry)) {
      const { sitting } = sittingOf(q.brief)
      if (!held.has(sitting)) project(sitting, afters[briefKey(q.brief)] ?? [], 'queued')
    }
    for (const d of onDeck) if (d.mode === 'ready') project(d.sitting, afterSittings(d.after), 'deck')
  }

  // The oldest decision stop, from its finish to now. A sitting's ending is
  // the one blockedOf reads: its newest by mtime that did not go live.
  const endingOf = new Map<string, Ending>()
  for (const e of endings) {
    const end = lastEnd(e.text)
    if (end === null || end.isLive) continue
    const { sitting } = sittingOf(e.base)
    const known = endingOf.get(sitting)
    if (known === undefined || known.mtimeMs < e.mtimeMs) endingOf.set(sitting, e)
  }
  const stops = blocks
    .filter(k => k.kind === 'decision')
    .map(k => {
      const e = endingOf.get(k.sitting)
      return { sitting: k.sitting, sinceMs: (e === undefined ? null : finishedAt(e.text)) ?? k.endedMs }
    })
    .sort((a, b) => a.sinceMs - b.sinceMs)
  const oldest = stops[0]
  const you =
    oldest === undefined
      ? null
      : bar(`${oldest.sitting} ? ${elapsed(oldest.sinceMs, now)}${stops.length > 1 ? ` +${stops.length - 1}` : ''}`, 'stopped', oldest.sinceMs, now)

  const heldMs = medianMs === null ? null : held.size * medianMs
  const heldLabel = held.size === 0 ? '' : `${held.size} held${heldMs === null ? '' : ` · ~${hoursMinutes(heldMs / MINUTE_MS)}`}`

  const shift = (offsetMinutes(input.utcOffset) ?? 0) * MINUTE_MS
  const hours: Timeline['hours'] = []
  for (let local = Math.ceil((startMs + shift) / (2 * HOUR_MS)) * 2 * HOUR_MS; local - shift <= endMs; local += 2 * HOUR_MS) {
    hours.push({ ms: local - shift, label: hourLabel(local) })
  }

  const inWindow = (b: TimelineBar): boolean => b.endMs > startMs && b.startMs < endMs
  return {
    startMs,
    endMs,
    nowMs: now,
    hours,
    slots: slots.map(slot => ({
      slot,
      bars: placed
        .filter(p => p.slot === slot && inWindow(p.bar))
        .map(p => p.bar)
        .sort((a, b) => a.startMs - b.startMs),
    })),
    you,
    held: { label: heldLabel, count: held.size, ms: heldMs },
  }
}

/** One cell of a drawn timeline row: its glyph, what it stands for, and whether it is a name drawn on its bar. */
export type TimelineCell = { ch: string; tone: CellTone; isLabel: boolean }

/** A bar's tone, `ahead` for a running bar's projection, then the idle track, the now-line, `held` and an empty cell. */
export type CellTone = BarTone | 'ahead' | 'idle' | 'now' | 'held' | 'blank'

// The braille bit for the dot at column x (0-1) and row y (0-3) of a cell.
const DOT_BIT = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
] as const

// The braille bits of a cell's left and right dot columns, all four dots each.
const LEFT_DOTS = DOT_BIT[0].reduce((a: number, b) => a | b, 0)
const RIGHT_DOTS = DOT_BIT[1].reduce((a: number, b) => a | b, 0)

/** Draws the now-line at cell `at` of `out` when the cell is on the track and `isFree`. */
function withNowLine(out: TimelineCell[], at: number, isFree = true): TimelineCell[] {
  if (at >= 0 && at < out.length && isFree) out[at] = { ch: '│', tone: 'now', isLabel: false }
  return out
}

/** The cell an instant falls in on a track `cells` wide, unclamped. */
const cellOf = (t: Timeline, ms: number, cells: number): number => Math.floor(((ms - t.startMs) / (t.endMs - t.startMs)) * cells)

/**
 * A lane's bars as `cells` braille cells, 2 dots each. A bar fills its dots
 * with `⣿` but its last, so neighbours stay apart; a running bar past the
 * median ends one cell past now. A name replaces a bar's cells where it fits,
 * else follows the bar, else leads it, each with a cell between; a bar
 * clipped at the window start reads `◂ S677`. A slot's empty cells are the
 * idle track; the now-line takes the empty cell at now.
 */
export function laneCells(t: Timeline, bars: readonly TimelineBar[], cells: number, isSlot: boolean): TimelineCell[] {
  const width = Math.max(0, Math.floor(cells))
  const dots = width * 2
  const span = Math.max(1, t.endMs - t.startMs)
  const dotOf = (ms: number): number => Math.floor(((ms - t.startMs) / span) * dots)
  const owner = new Array<number>(dots).fill(-1)
  const toneOf = new Array<CellTone>(dots).fill('blank')
  bars.forEach((b, i) => {
    const first = dotOf(b.startMs)
    const end = Math.max(first + 2, b.isOverMedian ? dotOf(t.nowMs) + 2 : dotOf(b.endMs))
    const liveEnd = dotOf(b.liveEndMs)
    for (let d = Math.max(0, first); d < Math.min(dots, end - 1); d++) {
      if (owner[d] !== -1) continue
      owner[d] = i
      toneOf[d] = b.tone === 'running' && d >= liveEnd ? 'ahead' : b.tone
    }
  })
  const cellOwner = new Array<number>(width).fill(-1)
  const out: TimelineCell[] = Array.from({ length: width }, (_, c) => {
    const left = owner[2 * c] ?? -1
    const right = owner[2 * c + 1] ?? -1
    const o = left !== -1 ? left : right
    if (o === -1) return isSlot ? { ch: '⣀', tone: 'idle', isLabel: false } : { ch: ' ', tone: 'blank', isLabel: false }
    cellOwner[c] = o
    const bits = (left === o ? LEFT_DOTS : 0) | (right === o ? RIGHT_DOTS : 0)
    return { ch: String.fromCodePoint(0x2800 | bits), tone: toneOf[left === o ? 2 * c : 2 * c + 1] ?? 'blank', isLabel: false }
  })
  const isFree = (c: number): boolean => c >= 0 && c < width && cellOwner[c] === -1 && !(out[c]?.isLabel ?? true) && out[c]?.tone !== 'now'
  const written = new Set<number>()
  bars.forEach((b, i) => {
    const mine = cellOwner.flatMap((o, c) => (o === i ? [c] : []))
    const first = mine[0]
    const last = mine[mine.length - 1]
    if (first === undefined || last === undefined) return
    const label = `${b.startMs < t.startMs ? '◂ ' : ''}${b.sitting}`
    const room = last - first + 1
    if (label.length <= room) {
      const at = first + Math.floor((room - label.length) / 2)
      const tone = out[at]?.tone ?? b.tone
      for (let j = 0; j < label.length; j++) out[at + j] = { ch: label[j] ?? ' ', tone, isLabel: true }
      return
    }
    const tone = out[first]?.tone ?? b.tone
    const fits = (at: number): boolean => Array.from({ length: label.length }, (_, j) => at + j).every(c => isFree(c) && !written.has(c))
    const at = fits(last + 2) ? last + 2 : fits(first - 1 - label.length) ? first - 1 - label.length : null
    if (at === null) return
    for (let j = 0; j < label.length; j++) {
      out[at + j] = { ch: label[j] ?? ' ', tone, isLabel: false }
      written.add(at + j)
    }
  })
  const now = cellOf(t, t.nowMs, width)
  return withNowLine(out, now, cellOwner[now] === -1 && !written.has(now))
}

/** The `held` lane: its label from now, then a dashed strip as long as the held work. */
export function heldCells(t: Timeline, cells: number): TimelineCell[] {
  const width = Math.max(0, Math.floor(cells))
  const out: TimelineCell[] = Array.from({ length: width }, () => ({ ch: ' ', tone: 'blank', isLabel: false }))
  const now = Math.max(0, cellOf(t, t.nowMs, width))
  const { label, ms } = t.held
  if (label === '') return withNowLine(out, now)
  const end = ms === null ? now : cellOf(t, t.nowMs + ms, width)
  for (let c = now; c < width && c <= end; c++) out[c] = { ch: '⠤', tone: 'held', isLabel: false }
  for (let j = 0; j < label.length && now + j < width; j++) out[now + j] = { ch: label[j] ?? ' ', tone: 'held', isLabel: false }
  return out
}

/** The axis: each hour's label from its cell, where it fits whole after the label before it. */
export function axisCells(t: Timeline, cells: number): string {
  const width = Math.max(0, Math.floor(cells))
  const out = new Array<string>(width).fill(' ')
  let next = 0
  for (const h of t.hours) {
    const at = cellOf(t, h.ms, width)
    if (at < next || at + h.label.length > width) continue
    for (let j = 0; j < h.label.length; j++) out[at + j] = h.label[j] ?? ' '
    next = at + h.label.length + 1
  }
  return out.join('')
}

/** Where the now-line falls on a track `cells` wide, clamped to the track. */
export const nowCell = (t: Timeline, cells: number): number => Math.min(Math.max(0, cellOf(t, t.nowMs, cells)), Math.max(0, cells - 1))

/** A sitting's plan cost from `plans`: `unread` when the ledger could not be read, `none` when it holds none. */
const planOf = (plans: Readonly<Record<string, number>> | null, sitting: string): PlanCost =>
  plans === null ? 'unread' : (plans[sitting] ?? 'none')

/** A blob in `git ls-tree -r origin/main docs/briefs/ docs/plans/`: its path and id. */
export type TreeBlob = { path: string; sha: string }

/** The blobs an `ls-tree -r` listing names, in listing order. */
export function lsTreeBlobs(lsTree: string): TreeBlob[] {
  const out: TreeBlob[] = []
  for (const line of lsTree.split('\n')) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line)
    if (m) out.push({ path: m[2] ?? '', sha: m[1] ?? '' })
  }
  return out
}

// A brief at the top of docs/briefs/, or a directory brief's entry file. The
// README, `rules/` and `sittings.json` are not briefs.
const FILE_BRIEF = /^docs\/briefs\/(kickoff-[^/]+)\.md$/
const DIR_BRIEF = /^docs\/briefs\/([^/]+)\/README\.md$/

/** The briefs among a listing's blobs: top-level `kickoff-*.md` files and directory briefs' READMEs. */
export function briefFiles(blobs: readonly TreeBlob[]): TreeBlob[] {
  return blobs.filter(({ path }) => {
    const dir = DIR_BRIEF.exec(path)
    return FILE_BRIEF.test(path) || (dir !== null && dir[1] !== 'rules')
  })
}

/**
 * A brief path as the queue would name it, from `docs/briefs/` on: a file
 * brief keeps its path, a directory brief is its directory.
 */
export function briefKey(path: string): string {
  const at = path.indexOf('docs/briefs/')
  const rel = at === -1 ? path : path.slice(at)
  return rel.replace(/\/README\.md$/, '').replace(/\/$/, '')
}

/**
 * The header lines above a brief's first `## ` heading that the board reads.
 * The mode is `ready` for a brief marked `**Mode: autopilot.**`, `interactive`
 * for one marked `**Mode: interactive.**`, and `enrich` for a brief that carries neither yet. `splitFrom` is
 * the sittings its `Split from:` line names.
 */
export function briefHeader(text: string): BriefHeader {
  let epic = ''
  let after = ''
  let mode: DeckMode = 'enrich'
  let splitFrom: string[] = []
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) break
    const e = /^Epic: (.+)$/.exec(line)
    if (e) epic = (e[1] ?? '').trim()
    const a = /^After: (.+)$/.exec(line)
    if (a) after = (a[1] ?? '').trim()
    const s = /^Split from: (.+)$/.exec(line)
    if (s) splitFrom = afterSittings(s[1] ?? '')
    if (line.includes('**Mode: autopilot.**')) mode = 'ready'
    if (line.includes(INTERACTIVE)) mode = 'interactive'
  }
  return { epic, after, mode, splitFrom }
}

const INTERACTIVE = '**Mode: interactive.**'

/** A brief's header lines as `briefHeader` reads them. */
export type BriefHeader = { epic: string; after: string; mode: DeckMode; splitFrom: string[] }

/** A brief on `origin/main`: its path and its header, read once. */
export type HeadedBrief = { path: string; header: BriefHeader }

/**
 * The claims in a `sittings.json`, by claim id; none when it does not parse
 * or holds no claims.
 */
export function sittingsClaims(sittingsJson: string): Record<string, unknown> {
  let data: unknown = null
  try {
    data = JSON.parse(sittingsJson)
  } catch {
    data = null
  }
  return obj(obj(data)?.claims) ?? {}
}

/**
 * How many briefs were split from each sitting, by sitting: each brief on
 * `origin/main` whose `Split from:` line names it, and each claim in
 * `sittings.json` whose record's `split_from` list does. A child counts once
 * however many places name it. `claims` is `sittingsClaims`' answer.
 */
export function splitCounts(briefs: readonly HeadedBrief[], claims: Readonly<Record<string, unknown>>): Record<string, number> {
  const children = new Map<string, Set<string>>()
  const add = (parent: string, child: string) => children.set(parent, (children.get(parent) ?? new Set()).add(child))
  for (const b of briefs) for (const p of b.header.splitFrom) add(p, sittingOf(briefKey(b.path)).sitting)
  for (const [id, claim] of Object.entries(claims)) {
    const from = obj(obj(claim)?.record)?.split_from
    if (!Array.isArray(from)) continue
    for (const p of from) if (typeof p === 'string') for (const parent of afterSittings(p)) add(parent, afterSittings(id)[0] ?? id)
  }
  return Object.fromEntries([...children].map(([parent, kids]) => [parent, kids.size]))
}

/**
 * The blob of the claims registry, `docs/briefs/sittings.json`, among a
 * listing's blobs, or null when it lists none. Each archived claim's record
 * holds its `split_from` list and its `epic`.
 */
export const sittingsBlob = (blobs: readonly TreeBlob[]): string | null => blobs.find(b => b.path === 'docs/briefs/sittings.json')?.sha ?? null

/** A sitting's number for ordering, or none for an issue brief. */
const sittingNumber = (sitting: string): number => {
  const m = /^S(\d+)$/.exec(sitting)
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY
}

/**
 * The briefs on deck, lowest sitting first: every brief on `origin/main` that
 * no run holds and the queue does not list. A brief with an `Epic:` line runs
 * on the epic lane; one without runs on fix.
 */
export function onDeckOf(briefs: readonly HeadedBrief[], held: readonly string[]): Deck[] {
  const taken = new Set(held.map(briefKey))
  return briefs
    .filter(b => !taken.has(briefKey(b.path)))
    .map(b => {
      const { epic, after, mode } = b.header
      return { ...briefName(briefKey(b.path)), lane: epic === '' ? 'fix' : 'epic', epic, after, mode }
    })
    .sort((a, b) => sittingNumber(a.sitting) - sittingNumber(b.sitting))
}

/** A brief's sitting and slug as on deck names them: `S342`, or `#527` for an issue brief. */
function briefName(key: string): { sitting: string; slug: string } {
  const issue = /^kickoff-(\d+)-(.+)$/.exec(baseName(key))
  return issue ? { sitting: `#${issue[1] ?? ''}`, slug: issue[2] ?? '' } : sittingOf(key)
}

/**
 * The epic each archived claim in `sittings.json` shipped on, by sitting: its
 * record's `epic`, trimmed. A claim with no record or no epic is absent.
 * `claims` is `sittingsClaims`' answer.
 */
export function recordedEpics(claims: Readonly<Record<string, unknown>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [id, claim] of Object.entries(claims)) {
    const epic = obj(obj(claim)?.record)?.epic
    if (typeof epic === 'string' && epic.trim() !== '') out[afterSittings(id)[0] ?? id] = epic.trim()
  }
  return out
}

/**
 * The sittings whose claim in `sittings.json` holds a record with an
 * `archived` day: scripts/record-sitting.sh writes it once the archive is on
 * `origin/main`. A run that stopped and was finished by hand has one, though
 * its progress file still ends on the stop. `claims` is `sittingsClaims`' answer.
 */
export function archivedSittings(claims: Readonly<Record<string, unknown>>): string[] {
  return Object.entries(claims).flatMap(([id, claim]) =>
    typeof obj(obj(claim)?.record)?.archived === 'string' ? [afterSittings(id)[0] ?? id] : [],
  )
}

/** The plan files among a listing's blobs: `docs/plans/dashboard.md` is the plan `dashboard`. */
export function planBlobs(blobs: readonly TreeBlob[]): { plan: string; sha: string }[] {
  return blobs.flatMap(({ path, sha }) => {
    const plan = /^docs\/plans\/(.+)\.md$/.exec(path)?.[1]
    return plan === undefined ? [] : [{ plan, sha }]
  })
}

/** Each epic's title in a plan, by its id, from its `### E2: design system` heading; the first heading of an id wins. */
export function planHeadings(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of text.matchAll(/^### (E\d+[a-z]?): (.+)$/gm)) {
    const id = m[1] ?? ''
    if (!Object.hasOwn(out, id)) out[id] = (m[2] ?? '').trim()
  }
  return out
}

/**
 * An epic's label: its plan epic's title, read from the plan named by the
 * part before the last `/` and the heading whose id is the part after it.
 * A value with no `/`, a plan the board has no headings for, and an id the
 * plan has no heading for each give the value itself.
 */
export function epicLabel(epic: string, planTitles: Readonly<Record<string, Readonly<Record<string, string>>>>): string {
  const cut = epic.lastIndexOf('/')
  if (cut === -1) return epic
  const titles = planTitles[epic.slice(0, cut)]
  const id = epic.slice(cut + 1)
  return titles !== undefined && Object.hasOwn(titles, id) ? (titles[id] ?? epic) : epic
}

/**
 * The epics card's rows: one per epic that a live sitting names, the one
 * whose lowest sitting still to come is lowest first. An epic's shipped
 * sittings come from `recorded`; its live ones from `live`, each running,
 * queued, on deck, blocked or held, and a sitting in both counts once, as
 * shipped. The next sitting is the lowest running one, else the lowest still
 * to come, and none once every sitting has shipped.
 */
export function epicRows(
  live: readonly { sitting: string; epic: string; state: EpicState['kind'] }[],
  recorded: Readonly<Record<string, string>>,
  planTitles: Readonly<Record<string, Readonly<Record<string, string>>>>,
): EpicRow[] {
  const bySitting = (a: string, b: string): number => sittingNumber(a) - sittingNumber(b) || a.localeCompare(b)
  const epics = [...new Set(live.filter(l => l.epic !== '').map(l => l.epic))].map(epic => ({
    epic,
    label: epicLabel(epic, planTitles),
    rest: live.filter(l => l.epic === epic && !Object.hasOwn(recorded, l.sitting)).sort((a, b) => bySitting(a.sitting, b.sitting)),
  }))
  epics.sort((a, b) => bySitting(a.rest[0]?.sitting ?? '', b.rest[0]?.sitting ?? '') || a.label.localeCompare(b.label))
  return epics.map(({ epic, label, rest }) => {
    const shipped = Object.keys(recorded).filter(s => recorded[s] === epic)
    const running = rest.filter(l => l.state === 'running')
    const next = running[0] ?? rest[0]
    const cells: EpicCell[] = [...shipped.map((): EpicCell => 'shipped'), ...running.map((): EpicCell => 'running'), ...rest.filter(l => l.state !== 'running').map((): EpicCell => 'todo')]
    return { epic, label, cells, next: next === undefined ? null : { kind: next.state, sitting: next.sitting } }
  })
}

/** How many of an epic's sittings have shipped. */
export const shippedCount = (row: EpicRow): number => row.cells.filter(c => c === 'shipped').length

/** What the board reads from the briefs, the plans and the claims registry on `origin/main`. */
export type BriefsRead = {
  onDeck: Deck[]
  /** Each brief's cycle count by its key; a brief whose blobs could not be read is absent. */
  cycles: Record<string, number>
  /** Each brief's `After:` sittings by its key. */
  afters: Record<string, string[]>
  splits: Record<string, number>
  /** Each brief's `Epic:` value by its key; a brief that names none is absent. */
  epics: Record<string, string>
  recordedEpics: Record<string, string>
  /** `archivedSittings`' answer. */
  archived: string[]
  planTitles: Record<string, Record<string, string>>
}

/** The keys whose cycles the board counts: every brief's, and each running brief's. */
const cycleKeys = (briefs: readonly TreeBlob[], running: readonly string[]): Set<string> =>
  new Set([...briefs.map(f => briefKey(f.path)), ...running.map(briefKey)])

/**
 * The blob ids `briefsRead` reads from a listing's blobs: every brief, the
 * cycle blobs of every brief and of each running brief, every plan, and the
 * claims registry, each once.
 */
export function briefsBlobs(blobs: readonly TreeBlob[], running: readonly string[]): string[] {
  const briefs = briefFiles(blobs)
  const byKey = cycleBlobMap(blobs)
  const registry = sittingsBlob(blobs)
  return [
    ...new Set([
      ...briefs.map(f => f.sha),
      ...[...cycleKeys(briefs, running)].flatMap(k => byKey.get(k) ?? []),
      ...planBlobs(blobs).map(p => p.sha),
      ...(registry === null ? [] : [registry]),
    ]),
  ]
}

/**
 * What a listing's blobs and their texts give the board. `text` answers a
 * blob's text, or null when it could not be read; `running` and `queued` are
 * the briefs the dispatcher holds. A brief whose text could not be read reads
 * as a brief with no header. A key with a cycle blob that could not be read
 * has no count, a plan whose blob could not be read has no titles, and a
 * registry that could not be read holds no claims.
 */
export function briefsRead(
  blobs: readonly TreeBlob[],
  text: (sha: string) => string | null,
  running: readonly string[],
  queued: readonly string[],
): BriefsRead {
  const files = briefFiles(blobs)
  const briefs = files.map(f => ({ path: f.path, header: briefHeader(text(f.sha) ?? '') }))
  const byKey = cycleBlobMap(blobs)
  const cycles: Record<string, number> = {}
  for (const k of cycleKeys(files, running)) {
    const texts = (byKey.get(k) ?? []).map(text)
    if (texts.length > 0 && texts.every(t => t !== null)) cycles[k] = cycleCount(texts.join('\n'))
  }
  const epics: Record<string, string> = {}
  for (const b of briefs) if (b.header.epic !== '') epics[briefKey(b.path)] = b.header.epic
  const planTitles: Record<string, Record<string, string>> = {}
  for (const p of planBlobs(blobs)) {
    const plan = text(p.sha)
    if (plan !== null) planTitles[p.plan] = planHeadings(plan)
  }
  const registry = sittingsBlob(blobs)
  const claims = sittingsClaims((registry === null ? null : text(registry)) ?? '')
  return {
    onDeck: onDeckOf(briefs, [...running, ...queued]),
    cycles,
    afters: Object.fromEntries(briefs.map(b => [briefKey(b.path), afterSittings(b.header.after)])),
    splits: splitCounts(briefs, claims),
    epics,
    recordedEpics: recordedEpics(claims),
    archived: archivedSittings(claims),
    planTitles,
  }
}

/** The sittings an `After:` line names, such as `S390, S393`, in capitals. */
export const afterSittings = (after: string): string[] => [...after.matchAll(/\bs(\d+)\b/gi)].map(m => `S${m[1] ?? ''}`)

/**
 * `S518` for a dispatcher reason that holds an entry off a run touching the
 * same paths, or null for any other reason. If dispatch.sh changes its
 * `<brief> <where>: both touch <paths>` reason, update this pattern.
 */
export function heldPeer(reason: string): string | null {
  const m = /\bs(\d+)-[\w-]*.*?: both touch .+$/i.exec(reason)
  return m === null ? null : `S${m[1] ?? ''}`
}

/** `held · S518` for a reason `heldPeer` reads, or null for any other reason. */
export function heldNote(reason: string): string | null {
  const peer = heldPeer(reason)
  return peer === null ? null : `held · ${peer}`
}

/** One row of the queue drawn as a tree. */
export type TreeRow = {
  /** A rail for each level above whose branch goes on below this row, two cells per level. */
  rails: string
  /** `├─` or `└─` under the entry it needs, `├┄` or `└┄` under the run that holds it, empty at a root. */
  joint: string
  /**
   * `run`: a running root. `after`: an entry that needs its parent shipped.
   * `free`: a root that waits on neither.
   * `held`: an entry that waits for a run to leave paths both briefs touch.
   * It hangs under that run on a dashed joint, or is a root tagged with the
   * run when the board does not show that run running.
   * `block`: a stuck sitting that holds a chain. `hold`: a brief in that chain.
   */
  kind: 'run' | 'after' | 'free' | 'held' | 'block' | 'hold'
  sitting: string
  slug: string
  lane: string
  /**
   * At an `after` or `hold` row, `after S396`: the waits the tree does not draw. At a free root, the
   * dispatcher's reason; at a held root, the held tag; at a held entry under its run, as at `after`; at a block, `blocked ↑ · holds N`; at a running root, empty.
   */
  note: string
}

/**
 * The queue as a tree of who waits on whom. Each running run is a root, drawn
 * only when something waits on it. An entry hangs under the running or queued
 * sitting on its `After:` line that sits deepest in the tree, which is the one
 * to ship last; a sitting that is neither running nor queued draws no edge:
 * a held one sits under its block, and one that is neither has shipped. An entry that needs nothing in the tree is a root of its
 * own under the dispatcher's reason; a running run it does not name is not its
 * parent, since slots order nothing. Siblings go in queue order.
 *
 * An entry the dispatcher holds off a running run that touches the same paths
 * hangs under that run on a dashed joint. The dispatcher checks `After:` waits
 * before paths, so a held entry has no other wait to draw an edge for. The
 * hold orders nothing: it lifts when that run lands, and the run that holds an
 * entry can change from one pass to the next.
 *
 * Each block that holds something follows, its root first and its chain under
 * it in the order `Block.holds` gives, so a held entry is never a root of its
 * own as well. Roots go running first, then free and path-held, then the
 * blocks, so what can launch next leads the card.
 *
 * A row's note names only its waits that the tree does not draw: each
 * running, queued or held sitting on its `After:` line other than its parent.
 */
export function queueTree(
  running: readonly Pick<Run, 'sitting' | 'slug' | 'lane'>[],
  queued: readonly Waiting[],
  blocks: readonly Pick<Block, 'sitting' | 'slug' | 'holds'>[],
): TreeRow[] {
  const runs = new Set(running.map(r => r.sitting))
  const held = new Set(blocks.flatMap(k => k.holds.map(h => h.sitting)))
  const byEntry = [...queued].sort((a, b) => a.entry - b.entry).filter(q => !held.has(q.sitting))
  const waiting = new Map(byEntry.map(q => [q.sitting, q]))
  // A board stored by an older version of the mod has no `after`.
  const needs = (q: Waiting): string[] => (q.after ?? []).filter(s => s !== q.sitting && (runs.has(s) || waiting.has(s)))
  const others = (after: readonly string[], self: string, parent: string | null): string => {
    const w = after.filter(s => s !== self && s !== parent && (runs.has(s) || waiting.has(s) || held.has(s)))
    return w.length === 0 ? '' : `after ${w.join(', ')}`
  }

  const parent = new Map<string, string | null>()
  const depth = new Map<string, number>()
  const depthOf = (s: string, seen: Set<string>): number => {
    if (runs.has(s)) return 0
    const known = depth.get(s)
    if (known !== undefined) return known
    const q = waiting.get(s)
    if (q === undefined || seen.has(s)) return 0
    seen.add(s)
    const peer = heldPeer(q.reason)
    if (peer !== null && runs.has(peer)) {
      parent.set(s, peer)
      depth.set(s, 1)
      return 1
    }
    let best: string | null = null
    let d = 0
    for (const n of needs(q)) {
      const nd = depthOf(n, seen) + 1
      if (best === null || nd > d) [best, d] = [n, nd]
    }
    parent.set(s, best)
    depth.set(s, d)
    return d
  }
  for (const q of byEntry) depthOf(q.sitting, new Set())

  const rows: TreeRow[] = []
  const drawn = new Set<string>()
  const kids = (s: string) => byEntry.filter(q => parent.get(q.sitting) === s && !drawn.has(q.sitting))
  const branch = (s: string, rails: string) => {
    const ks = kids(s)
    ks.forEach((k, i) => walk(k, rails, i === ks.length - 1))
  }
  const walk = (q: Waiting, rails: string, isLast: boolean) => {
    if (drawn.has(q.sitting)) return
    drawn.add(q.sitting)
    const isHeld = heldPeer(q.reason) === parent.get(q.sitting)
    rows.push({
      rails,
      joint: `${isLast ? '└' : '├'}${isHeld ? '┄' : '─'}`,
      kind: isHeld ? 'held' : 'after',
      sitting: q.sitting,
      slug: q.slug,
      lane: q.lane,
      note: others(q.after ?? [], q.sitting, parent.get(q.sitting) ?? null),
    })
    branch(q.sitting, rails + (isLast ? '  ' : '│ '))
  }

  for (const r of running) {
    if (kids(r.sitting).length === 0) continue
    rows.push({ rails: '', joint: '', kind: 'run', sitting: r.sitting, slug: r.slug, lane: r.lane, note: '' })
    branch(r.sitting, '')
  }
  // What hangs under no run: an entry that names nothing running, or a ring of
  // entries that each name the next on their After lines.
  for (const q of byEntry) {
    if (drawn.has(q.sitting)) continue
    drawn.add(q.sitting)
    const tag = heldNote(q.reason)
    rows.push({ rails: '', joint: '', kind: tag === null ? 'free' : 'held', sitting: q.sitting, slug: q.slug, lane: q.lane, note: tag ?? q.reason })
    branch(q.sitting, '')
  }
  for (const k of blocks) {
    if (k.holds.length === 0) continue
    rows.push({ rails: '', joint: '', kind: 'block', sitting: k.sitting, slug: k.slug, lane: '', note: `blocked ↑ · holds ${k.holds.length}` })
    const holdBranch = (p: string, rails: string) => {
      const ks = k.holds.filter(h => h.parent === p)
      ks.forEach((h, i) => {
        const isLast = i === ks.length - 1
        rows.push({ rails, joint: `${isLast ? '└' : '├'}─`, kind: 'hold', sitting: h.sitting, slug: h.slug, lane: '', note: others(h.after, h.sitting, h.parent) })
        holdBranch(h.sitting, rails + (isLast ? '  ' : '│ '))
      })
    }
    holdBranch(k.sitting, '')
  }
  return rows
}

/**
 * How deep each running and queued sitting sits in the queue tree: a running
 * sitting is 0, and a queued one is its row's depth in `queueTree`. Pass
 * `rows` when the caller has the tree already.
 */
export function liveDepths(
  b: Pick<Board, 'running' | 'queued' | 'blocked'>,
  rows: readonly TreeRow[] = queueTree(b.running, b.queued, b.blocked),
): Map<string, number> {
  const queued = new Set(b.queued.map(q => q.sitting))
  const depths = new Map(b.running.map(r => [r.sitting, 0]))
  for (const r of rows) {
    if (queued.has(r.sitting)) depths.set(r.sitting, r.rails.length / 2 + (r.joint === '' ? 0 : 1))
  }
  return depths
}

/** On deck's three groups, in the order the pane draws them, and each one's heading. */
export const DECK_GROUPS: readonly { mode: DeckMode; label: string }[] = [
  { mode: 'ready', label: 'ready' },
  { mode: 'enrich', label: 'enrich' },
  { mode: 'interactive', label: 'needs you' },
]

/** One row of on deck drawn as a tree. */
export type DeckRow = {
  /** A rail for each level above whose branch goes on below this row, two cells per level. */
  rails: string
  /** `├─` or `└─` under the brief it waits on, `├╌` or `└╌` under its group, empty at a group. */
  joint: string
  /** `group`: a heading. `after`: a brief under one it waits on. `free`: a brief under its group. */
  kind: 'group' | 'after' | 'free'
  mode: DeckMode
  /** Empty at a group. */
  sitting: string
  /** The brief's slug, or the group's heading. */
  slug: string
  /** The one sitting the brief's note names after `after`, or empty. */
  wait: string
  /** Whether `wait` is queued. */
  isWaitQueued: boolean
  /** At a group, how many briefs it holds. At a brief, its epic. */
  note: string
}

/**
 * On deck as a tree in three groups: ready (autopilot), enrich (not yet
 * autopilot) and needs you (interactive). A brief waits on each sitting its
 * `After:` line names that is on deck, queued or running; one that has
 * shipped is gone from all three and draws nothing. Inside its group a brief
 * hangs under the brief it waits on that sits deepest in the group, the one to
 * ship last, and otherwise dashed under the group. A wait that crosses groups
 * shows in the note only. Siblings go by sitting.
 *
 * A brief's note names one wait, the nearest: the waited sitting that sits
 * deepest across the queue and on deck, and so ships last. A running or
 * queued sitting's depth comes from `live`; an on-deck brief sits one deeper
 * than its own nearest wait, and at 0 with none. A tie goes to the brief's
 * tree parent. The note never names the parent, since the tree draws it.
 */
export function deckTree(deck: readonly Deck[], live: ReadonlyMap<string, number>, queued: ReadonlySet<string>): DeckRow[] {
  const onDeck = new Map(deck.map(d => [d.sitting, d]))
  const waitsOf = new Map(deck.map(d => [d.sitting, afterSittings(d.after).filter(s => s !== d.sitting && (live.has(s) || onDeck.has(s)))]))
  const waits = (d: Deck): string[] => waitsOf.get(d.sitting) ?? []
  const reach = new Map<string, number>()
  const reachOf = (s: string, seen: Set<string>): number => {
    const known = live.get(s) ?? reach.get(s)
    if (known !== undefined) return known
    const d = onDeck.get(s)
    if (d === undefined || seen.has(s)) return 0
    seen.add(s)
    const n = Math.max(-1, ...waits(d).map(w => reachOf(w, seen))) + 1
    reach.set(s, n)
    return n
  }
  const nearest = (d: Deck, parent: string | null): string => {
    let best: string | null = null
    let depth = -1
    for (const w of waits(d)) {
      const wd = reachOf(w, new Set([d.sitting]))
      if (wd > depth || (wd === depth && w === parent)) [best, depth] = [w, wd]
    }
    return best === null || best === parent ? '' : best
  }
  const note = (d: Deck): string => d.epic

  const rows: DeckRow[] = []
  for (const g of DECK_GROUPS) {
    const members = deck.filter(d => d.mode === g.mode).sort((a, b) => sittingNumber(a.sitting) - sittingNumber(b.sitting))
    if (members.length === 0) continue
    const by = new Map(members.map(d => [d.sitting, d]))
    const parent = new Map<string, string | null>()
    const depth = new Map<string, number>()
    const depthOf = (s: string, seen: Set<string>): number => {
      const known = depth.get(s)
      if (known !== undefined) return known
      const d = by.get(s)
      if (d === undefined || seen.has(s)) return 0
      seen.add(s)
      let best: string | null = null
      let n = 0
      for (const w of waits(d)) {
        if (!by.has(w)) continue
        const wd = depthOf(w, seen) + 1
        if (best === null || wd > n) [best, n] = [w, wd]
      }
      parent.set(s, best)
      depth.set(s, n)
      return n
    }
    for (const d of members) depthOf(d.sitting, new Set())
    // A ring of briefs that each wait on the next hangs from nowhere: cut it
    // where it is found, so the cut brief hangs under its group.
    for (const d of members) {
      const seen = new Set<string>([d.sitting])
      let p = parent.get(d.sitting) ?? null
      while (p !== null && !seen.has(p)) {
        seen.add(p)
        p = parent.get(p) ?? null
      }
      if (p !== null) parent.set(d.sitting, null)
    }

    rows.push({ rails: '', joint: '', kind: 'group', mode: g.mode, sitting: '', slug: g.label, wait: '', isWaitQueued: false, note: String(members.length) })
    const walk = (d: Deck, rails: string, isLast: boolean) => {
      const isAfter = parent.get(d.sitting) != null
      const wait = nearest(d, parent.get(d.sitting) ?? null)
      rows.push({
        rails,
        joint: `${isLast ? '└' : '├'}${isAfter ? '─' : '╌'}`,
        kind: isAfter ? 'after' : 'free',
        mode: g.mode,
        sitting: d.sitting,
        slug: d.slug,
        wait,
        isWaitQueued: queued.has(wait),
        note: note(d),
      })
      branch(d.sitting, rails + (isLast ? '  ' : '│ '))
    }
    const branch = (s: string | null, rails: string) => {
      const ks = members.filter(d => (parent.get(d.sitting) ?? null) === s)
      ks.forEach((k, i) => walk(k, rails, i === ks.length - 1))
    }
    branch(null, '')
  }
  return rows
}

// How many finished sittings the pane lists under RECENT.
export const RECENT_LIMIT = 10

/** A progress file in the log directory: `<brief name>.progress`. */
export type ProgressFile = { name: string; mtimeMs: number }

// A sitting's progress file. `README.progress` and other strays are not.
const SITTING_PROGRESS = /^(.*s\d+-.+)\.progress$/

/**
 * The progress files to read for RECENT, newest first: sittings only, none
 * that is running. A run truncates its file when it starts, so a running
 * sitting's file holds no outcome yet. Twice the limit leaves room for files
 * that end on no `finished:` line.
 */
export function recentCandidates(files: readonly ProgressFile[], running: readonly string[]): ProgressFile[] {
  const live = new Set(running.map(baseName))
  return files
    .filter(f => {
      const m = SITTING_PROGRESS.exec(f.name)
      return m !== null && !live.has(m[1] ?? '')
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, RECENT_LIMIT * 2)
}

/**
 * The newest sittings live in production, one each, from their progress
 * files' last `finished:` line. A stop and a red deploy are left out: they
 * belong to BLOCKED. A run that did not go live but whose sitting is in
 * `archived` was finished by hand: it is listed as `rescued`, with the
 * totals of the run that stopped. These files outlive the dispatcher, whose finished list
 * starts empty each time one starts. The lane comes from that list while it
 * still holds the run, and the cycle count from `namedCycles`: an archived
 * brief has left docs/briefs/, so no brief is read.
 */
export function recentOf(
  files: readonly (ProgressFile & { text: string })[],
  finished: RawStatus['finished'],
  archived: ReadonlySet<string> = new Set(),
): Ended[] {
  const laneOf = new Map<string, string>()
  for (const f of [...finished].sort((a, b) => a.entry - b.entry)) laneOf.set(baseName(f.brief), f.lane)
  const out: Ended[] = []
  for (const f of [...files].sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    const end = lastEnd(f.text)
    if (end === null) continue
    const base = f.name.replace(/\.progress$/, '')
    const sitting = sittingOf(base)
    if (!end.isLive && !archived.has(sitting.sitting)) continue
    const totals = TOTALS.exec(end.outcome)
    out.push({
      ...sitting,
      lane: laneOf.get(base) ?? '',
      detail: outcomeDetail(end.isLive ? end.outcome : `rescued${totals?.[0] ?? ''}`),
      minutes: totals === null ? null : Number(totals[2]),
      usd: totals === null ? null : Number(totals[1]),
      endedMs: f.mtimeMs,
      split: phaseSplit(f.text),
      phaseMs: phaseDurations(f.text),
      plan: 'unread',
      cycles: namedCycles(f.text),
    })
    if (out.length === RECENT_LIMIT) break
  }
  return out
}

/** A run's last end in its progress file: the outcome, the kind written above it, and whether production is live. */
export type RunEnd = { outcome: string; kind: string; isLive: boolean }

// An outcome that put the run live in production. `shipped; deploy failed`
// pushed code that never went live.
const LIVE = /^shipped; production is live\b/

/**
 * The last `finished:` line of a progress file, or null when it has none.
 * The kind is the `kind:` line directly above it, as scripts/autopilot.sh
 * writes it. A file without that line reads `deploy-red` for a failed deploy
 * and `run-broke` for any other end that is not live.
 */
export function lastEnd(progress: string): RunEnd | null {
  const lines = progress.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? ''
    if (!line.startsWith('finished: ')) continue
    const outcome = line.slice('finished: '.length)
    const isLive = LIVE.test(outcome)
    const above = /^kind: (\S+)/.exec(lines[i - 1] ?? '')
    const kind = isLive ? '' : (above?.[1] ?? (outcome.startsWith('shipped;') ? 'deploy-red' : 'run-broke'))
    return { outcome, kind, isLive }
  }
  return null
}

/** The run a failed deploy names: `shipped; deploy failed (run 44071838536).` gives `44071838536`. */
export const deployRunOf = (outcome: string): string => /deploy failed \(run (\d+)\)/.exec(outcome)?.[1] ?? ''

/** A sitting's progress file as the poll read it: its run name, text and mtime. */
export type Ending = { base: string; text: string; mtimeMs: number }

/** Each kind's tag, by who acts. */
export const KIND_TAG: Record<BlockKind, string> = { decision: '? you', split: '÷ plan', 'deploy-red': '✗ code', 'run-broke': '! run' }

/** The pipeline strip's stages, in order. */
export const STAGES: readonly Stage[] = ['savor', 'cycles', 'push', 'staging', 'prod']

const blockKind = (k: string): BlockKind => (k === 'decision' || k === 'split' || k === 'deploy-red' ? k : 'run-broke')

/**
 * The pipeline strip of a run that stopped: each stage done, where it broke,
 * or still to come. A run without step 0 skips the savor. A red deploy broke
 * at `deployStage`, staging unless the production job failed. Any other end
 * broke at the savor when no commit followed the savor's own, at the push
 * when a broken run pushed, and in the cycles otherwise.
 */
export function stripOf(text: string, kind: BlockKind, deployStage = ''): StripCell[] {
  const lines = text.split('\n')
  const savorAt = lines.findIndex(l => /^skill: sittings:savor launch\b/.test(l))
  const commitsAfter = lines.slice(savorAt + 1).filter(l => COMMIT_LINE.test(l)).length
  const pushed = lines.some(l => l.startsWith('bash: ') && l.includes('push:checked'))
  const broke: Stage =
    kind === 'deploy-red'
      ? deployStage === 'prod'
        ? 'prod'
        : 'staging'
      : pushed && kind === 'run-broke'
        ? 'push'
        : savorAt !== -1 && commitsAfter <= 1
          ? 'savor'
          : 'cycles'
  const at = STAGES.indexOf(broke)
  return STAGES.map((stage, i) => ({
    stage,
    state: i === at ? 'broke' : i > at ? 'todo' : stage === 'savor' && savorAt === -1 ? 'skip' : 'done',
  }))
}

/**
 * The strip stage a deploy run's failed jobs stand for: `prod` when the
 * production deploy failed, else `staging`; empty when none failed. If
 * deploy.yml renames its jobs, update the pattern.
 */
export const deployStageOf = (failedJobs: readonly string[]): string =>
  failedJobs.some(j => /cloudflare workers|record the release/i.test(j)) ? 'prod' : failedJobs.length > 0 ? 'staging' : ''

/** The `deployStages` value of a red deploy run whose latest attempt passed, as a re-run of a flake does. */
export const DEPLOY_LIVE = 'live'

/**
 * True when deploy run `run` is older than `live`, the newest deploy.yml run
 * on main that went live: production then runs a later main, so `run` blocks
 * nothing. GitHub numbers runs in the order it creates them.
 */
export const supersededBy = (run: string, live: string): boolean =>
  /^\d+$/.test(run) && /^\d+$/.test(live) && BigInt(run) < BigInt(live)

/**
 * A finished deploy run's state from its latest attempt: `DEPLOY_LIVE` when
 * it concluded `success`, else the strip stage its failed jobs stand for.
 */
export const deployStateOf = (conclusion: string, failedJobs: readonly string[]): string =>
  conclusion === 'success' ? DEPLOY_LIVE : deployStageOf(failedJobs)

/**
 * The question a stop handoff asks, or empty. The label is bold and may name who answers:
 * `**Question: …**` holds the question inside the bold, `**Question for Todd:** …` after it, to the line's end.
 */
export const handoffQuestion = (handoff: string): string => {
  const m = /\*\*Question(?: [^:*\n]+)?:(\*\*)?[ \t]*(.+)$/m.exec(handoff)
  if (m === null) return ''
  const text = m[1] === undefined ? (m[2] ?? '').replace(/\*\*\s*$/, '') : (m[2] ?? '')
  return text.trim()
}

/**
 * Every stop number a handoff's last `**Stop:**` line names before its first period: `**Stop:** 5 and 6.` gives 5 and 6.
 * The line starts with the marker, as `scripts/autopilot.sh` reads it, so a marker quoted in prose is not a stop.
 */
export const handoffStops = (handoff: string): string[] => {
  const line = [...handoff.matchAll(/^\*\*Stop:\*\* ([^.\n]*)/gm)].pop()?.[1] ?? ''
  return [...line.matchAll(/\d+/g)].map(m => m[0])
}

/**
 * The BLOCKED card: one block per root cause, most held first, and every
 * sitting the card draws, none of which ON DECK lists.
 *
 * A sitting is stuck when its last end is not live, nothing runs or queues
 * it, and either its brief is still on `origin/main`, or it is a red deploy
 * with no live run after it, whose run's latest attempt did not pass, and
 * whose run is not older than the newest deploy.yml run on main that went live. A queued entry is held by the cause the
 * dispatcher names; a record without the `cause` key, from a dispatcher older
 * than the field, is held when an `After:` sitting is stuck or held. A brief
 * on main that nothing runs or queues is held the same way. A stuck sitting
 * that is held is a hold under its cause, never a root of its own. The holds
 * are `heldChain`'s tree, which the queue card draws.
 */
export function blockedOf(input: {
  raw: RawStatus
  endings: readonly Ending[]
  /** Every brief on `origin/main` by its key, with the sittings on its `After:` line. */
  afters: Readonly<Record<string, string[]>>
  /** Each stopped run's handoff text, by run name. */
  handoffs?: Readonly<Record<string, string>>
  /** Each red deploy's failed strip stage, by run. */
  deployStages?: Readonly<Record<string, string>>
  /** The newest deploy.yml run on main that went live, or empty. */
  liveDeploy?: string
  /** Each sitting's plan cost, or null when the ledger could not be read. */
  plans?: Readonly<Record<string, number>> | null
  /** Each run's launch count from its `.launches` file, by run name. */
  launches?: Readonly<Record<string, number>>
}): { blocks: Block[]; drawn: Set<string> } {
  const { raw, endings, afters, handoffs = {}, deployStages = {}, liveDeploy = '', plans = null, launches = {} } = input
  const running = new Set(raw.running.map(r => sittingOf(r.brief).sitting))
  const queued = new Map(raw.queued.map(q => [sittingOf(q.brief).sitting, q]))
  const onMain = new Map(Object.keys(afters).map(k => [sittingOf(k).sitting, k]))
  const slugOf = new Map<string, string>()
  for (const k of [...onMain.values(), ...raw.queued.map(q => q.brief)]) slugOf.set(sittingOf(k).sitting, sittingOf(k).slug)

  // The kind status.json gives a run, from its newest finished record.
  const statusKind = new Map<string, string | null>()
  for (const f of [...raw.finished].sort((a, b) => a.entry - b.entry)) statusKind.set(baseName(f.brief), f.kind)

  type Info = { slug: string; base: string; text: string; mtimeMs: number; end: RunEnd; kind: BlockKind }
  const ends = new Map<string, Info>()
  let newestLive = Number.NEGATIVE_INFINITY
  for (const e of endings) {
    const end = lastEnd(e.text)
    if (end === null) continue
    if (end.isLive) {
      newestLive = Math.max(newestLive, e.mtimeMs)
      continue
    }
    const { sitting, slug } = sittingOf(e.base)
    const known = ends.get(sitting)
    if (known !== undefined && known.mtimeMs >= e.mtimeMs) continue
    ends.set(sitting, { slug, base: e.base, text: e.text, mtimeMs: e.mtimeMs, end, kind: blockKind(statusKind.get(e.base) ?? end.kind) })
  }
  const stuck = new Map<string, Info>()
  for (const [s, i] of ends) {
    if (running.has(s) || queued.has(s)) continue
    const run = deployRunOf(i.end.outcome)
    const redDeploy = i.mtimeMs > newestLive && deployStages[run] !== DEPLOY_LIVE && !supersededBy(run, liveDeploy)
    if (i.kind === 'deploy-red' ? redDeploy : onMain.has(s)) stuck.set(s, i)
  }

  // A root is a stuck sitting, or `run N` for a red deploy no stuck sitting names.
  const rootOfCause = (c: Cause): string => {
    if ('run' in c) {
      for (const [s, i] of stuck) if (i.kind === 'deploy-red' && deployRunOf(i.end.outcome) === String(c.run)) return s
      return `run ${c.run}`
    }
    return sittingOf(c.sitting).sitting
  }
  const afterOf = (s: string): string[] => afters[onMain.get(s) ?? ''] ?? []
  const held = new Map<string, string | null>()
  const heldBy = (s: string, seen: Set<string>): string | null => {
    const known = held.get(s)
    if (known !== undefined) return known
    if (seen.has(s) || running.has(s)) return null
    seen.add(s)
    const q = queued.get(s)
    let root: string | null = null
    if (q?.cause !== undefined) root = q.cause === null ? null : rootOfCause(q.cause)
    else
      for (const a of afterOf(s)) {
        // A sitting off main that nothing queues has shipped and holds nothing.
        if (a === s || running.has(a) || !(onMain.has(a) || queued.has(a) || stuck.has(a))) continue
        root = heldBy(a, seen) ?? (stuck.has(a) ? a : null)
        if (root !== null) break
      }
    held.set(s, root)
    return root
  }

  const candidates = [...new Set([...queued.keys(), ...onMain.keys(), ...stuck.keys()])].filter(s => !running.has(s))
  for (const s of candidates) heldBy(s, new Set())
  const roots = new Map<string, string[]>()
  for (const s of stuck.keys()) if ((held.get(s) ?? null) === null) roots.set(s, [])
  for (const s of candidates) {
    const r = held.get(s) ?? null
    if (r === null || roots.has(s)) continue
    roots.set(r, [...(roots.get(r) ?? []), s])
  }

  const blocks: Block[] = []
  for (const [root, members] of roots) {
    const info = stuck.get(root)
    const kind: BlockKind = info?.kind ?? 'deploy-red'
    const holds: Held[] = heldChain(root, members, afterOf).map(h => ({
      ...h,
      slug: slugOf.get(h.sitting) ?? stuck.get(h.sitting)?.slug ?? '',
      after: afterOf(h.sitting),
    }))
    const history = { plan: planOf(plans, root), launches: info === undefined ? null : (launches[info.base] ?? null) }
    blocks.push({ ...blockFace(root, info, kind, holds, handoffs, deployStages), ...history })
  }
  blocks.sort((a, b) => b.holds.length - a.holds.length || b.endedMs - a.endedMs)
  const drawn = new Set<string>()
  for (const b of blocks) for (const s of [b.sitting, ...b.holds.map(h => h.sitting)]) drawn.add(s)
  return { blocks, drawn }
}

/**
 * The chain a block holds as a tree under its root, in preorder, siblings by
 * sitting. A hold hangs under the sitting on its `After:` line that sits
 * deepest in the block, the root at depth 0, which is the one to ship last;
 * a hold that names none of the block hangs under the root. A hold its own
 * ring reaches again is not a candidate, so every hold lands once.
 */
export function heldChain(root: string, members: readonly string[], afterOf: (s: string) => readonly string[]): { sitting: string; parent: string }[] {
  const group = new Set(members)
  const parent = new Map<string, string>()
  const depth = new Map<string, number>([[root, 0]])
  const depthOf = (s: string, seen: Set<string>): number | null => {
    const known = depth.get(s)
    if (known !== undefined) return known
    if (seen.has(s)) return null
    seen.add(s)
    let best = root
    let d = 0
    for (const a of afterOf(s)) {
      if (a === s || !(a === root || group.has(a))) continue
      const ad = depthOf(a, seen)
      if (ad !== null && ad > d) [best, d] = [a, ad]
    }
    seen.delete(s)
    parent.set(s, best)
    depth.set(s, d + 1)
    return d + 1
  }
  for (const s of members) depthOf(s, new Set())
  const out: { sitting: string; parent: string }[] = []
  const walk = (p: string) => {
    for (const s of members.filter(m => parent.get(m) === p).sort((a, b) => sittingNumber(a) - sittingNumber(b))) {
      out.push({ sitting: s, parent: p })
      walk(s)
    }
  }
  walk(root)
  return out
}

// What each stop of `docs/briefs/rules/autopilot.md` § "Stop only for these"
// means, by its number there. If that list changes, change this table.
const STOP_WORDS: Record<string, string> = {
  '1': 'the pre-push hook stayed red',
  '2': 'a facts set grew',
  '3': 'a rebase conflict in a held path',
  '4': 'a test that cannot fail',
  '5': 'a come-up-for-air finding',
  '6': 'savor found a failed premise',
  '7': 'the brief is over its size ceiling',
}

/**
 * The stop in words for a block's why-line: each number on the handoff's
 * stop line that the table knows, as its phrase, joined by `and`. With no
 * known number the broke stage leads; a number off the table reads `stop N`.
 */
function stopWords(stops: readonly string[], broke: string): string[] {
  const known = stops.filter(n => Object.hasOwn(STOP_WORDS, n))
  const unknown = stops.filter(n => !Object.hasOwn(STOP_WORDS, n))
  return [known.length > 0 ? known.map(n => STOP_WORDS[n]).join(' and ') : broke, unknown.length > 0 ? `stop ${unknown.join(' and ')}` : '']
}

/** The chain line a block draws in place of its holds: the count, the first three in order, and how many more. */
export function chainLine(k: Pick<Block, 'holds'>): { count: string; chain: string; more: string } | null {
  if (k.holds.length === 0) return null
  const more = k.holds.length - 3
  return {
    count: `holds ${k.holds.length} `,
    chain: `‖ ${k.holds.slice(0, 3).map(h => h.sitting).join(' → ')}`,
    more: `${more > 0 ? ` +${more}` : ''}, drawn in the queue ↓`,
  }
}

/** A block's words by kind: its headline, the line of why, the strip and the next line. */
function blockFace(
  root: string,
  info: { slug: string; base: string; text: string; mtimeMs: number; end: RunEnd } | undefined,
  kind: BlockKind,
  holds: Held[],
  handoffs: Readonly<Record<string, string>>,
  deployStages: Readonly<Record<string, string>>,
): Omit<Block, 'plan' | 'launches'> {
  const outcome = info?.end.outcome ?? ''
  const totals = TOTALS.exec(outcome)
  const sentence = totals === null ? outcome : outcome.slice(0, totals.index)
  const spent = totals === null ? [] : [hoursMinutes(Number(totals[2])), `$${totals[1] ?? ''}`]
  const run = deployRunOf(outcome) || (root.startsWith('run ') ? root.slice('run '.length) : '')
  const handoff = info === undefined ? '' : (handoffs[info.base] ?? '')
  const strip = info === undefined ? [] : stripOf(info.text, kind, deployStages[run] ?? '')
  const broke = strip.find(p => p.state === 'broke')?.stage
  const pushed = strip.some(p => p.stage === 'push' && p.state === 'done')
  const base = { kind, sitting: root, slug: info?.slug ?? '', strip, holds, endedMs: info?.mtimeMs ?? 0 }
  if (kind === 'deploy-red') {
    const releases = holds.length === 0 ? '' : holds.length === 1 ? ' and releases the one it holds' : ` and releases all ${holds.length}, in order`
    return {
      ...base,
      headline: info === undefined ? `Deploy red: run ${run}` : `Deploy red: ${root} never went live`,
      why: ['deploy failed', broke === 'prod' ? 'at production' : 'before production', run === '' ? '' : `run ${run}`, ...spent]
        .filter(p => p !== '')
        .join(' · '),
      next: `re-run it if it is a flake, else fix main; the next green deploy clears it${releases}`,
    }
  }
  const stops = handoffStops(handoff)
  // A split's headline already says stop 7.
  const said = kind === 'split' ? stops.filter(n => n !== '7') : stops
  const why = [...stopWords(said, broke === 'savor' ? 'step 0 savor' : (broke ?? '')), pushed ? 'pushed' : 'nothing pushed', ...spent]
    .filter(p => p !== '')
    .join(' · ')
  if (kind === 'decision') {
    const q = handoffQuestion(handoff)
    return { ...base, headline: q === '' ? `${root} needs a decision` : `${root} asks: ${q}`, why, next: `answer in the handoff, then relaunch ${root}` }
  }
  if (kind === 'split') return { ...base, headline: `${root} is over its size ceiling`, why, next: `split the brief, then relaunch ${root}` }
  // A broken run with no stop line reads the launcher's outcome sentence.
  return { ...base, headline: `${root}: the run broke`, why: stops.length > 0 ? why : sentence, next: `read the log, then relaunch ${root}` }
}

/** How many launches a `.launches` file records: one `launch: <n> <fresh|relaunch> slot <k> at <UTC time>` line each. */
export const launchCount = (text: string): number => text.split('\n').filter(l => /^launch: \d+ /.test(l)).length

const ORDINAL_SUFFIX: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' }

/** `1st`, `2nd`, `3rd`, `4th`, and `11th` to `13th`. */
const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (ORDINAL_SUFFIX[n % 10] ?? 'th')}`

/**
 * What a block's why-line adds after its cost: the plan cost and which launch
 * stopped, `+$11.36 plan · 1st launch`, each only where its data exists.
 * Empty when neither does.
 */
export function historyTag(k: Pick<Block, 'plan' | 'launches'>): string {
  const parts = [typeof k.plan === 'number' ? `+${money(k.plan)} plan` : '', k.launches !== null && k.launches > 0 ? `${ordinal(k.launches)} launch` : '']
  return parts.filter(p => p !== '').join(' · ')
}

/** How long ago an instant was: `24m ago`, `5h12m ago`, `3d ago` past two days. */
export function ago(fromMs: number, toMs: number): string {
  const minutes = Math.max(0, Math.floor((toMs - fromMs) / 60000))
  return minutes < 48 * 60 ? `${hoursMinutes(minutes)} ago` : `${Math.floor(minutes / (24 * 60))}d ago`
}

// The totals `scripts/autopilot.sh` ends an outcome with:
// ` ($27.53, 158 min)`, or ` ($27.53, 158 min, peak 385k context)`, then an
// optional effort clause: `, effort medium`, `, effort medium-high, agents
// low-xhigh`, or `, effort unknown` when no transcript named a level.
const TOTALS =
  /\s*\(\$([0-9]+(?:\.[0-9]+)?), ([0-9]+) min(?:, peak ([0-9]+k) context)?(?:, effort ([a-z]+(?:-[a-z]+)?)(?:, agents ([a-z]+(?:-[a-z]+)?))?)?\)$/
// A ship, and the launcher's migration clause when it applied a brief's one
// migration: `; Migrate Production applied migrations/0050_<slug>.sql (run N)`.
const SHIPPED =
  /^shipped; production is live \(run ([0-9]+)\)(?:; Migrate Production applied migrations\/([0-9]+)_[^ ]+\.sql \(run [0-9]+\))?\.$/

/** Minutes as hours and minutes: 158 reads as `2h38m`, 24 as `24m`. */
export const hoursMinutes = (minutes: number): string =>
  minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`

/**
 * An outcome as one detail line in the lanes' order, outcome then time then
 * cost: `shipped · 2h38m · $27.53 · peak 385k · run 41212658012`. An outcome
 * the dispatcher wrote without totals reads as its sentence alone.
 */
export function outcomeDetail(outcome: string): string {
  const m = TOTALS.exec(outcome)
  const sentence = m === null ? outcome : outcome.slice(0, m.index)
  const run = SHIPPED.exec(sentence)
  const parts = [run === null ? sentence : 'shipped']
  if (m !== null) {
    parts.push(hoursMinutes(Number(m[2])), `$${m[1]}`)
    if (m[3] !== undefined) parts.push(`peak ${m[3]}`)
    if (m[4] !== undefined) parts.push(`effort ${m[4]}`)
    if (m[5] !== undefined) parts.push(`agents ${m[5]}`)
  }
  if (run !== null) parts.push(`run ${run[1]}`)
  if (run?.[2] !== undefined) parts.push(`migrated ${run[2]}`)
  return parts.join(' · ')
}

// The dot font for the header's figures: each glyph 3 dots wide and 7 tall,
// drawn on braille cells 2 dots wide and 4 tall, so a digit and its gap take
// two cells, and a figure fills two rows with one blank dot row under it.
const DOT_FONT: Record<string, readonly string[]> = {
  '0': ['111', '101', '101', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '010', '010', '111'],
  '2': ['111', '001', '001', '111', '100', '100', '111'],
  '3': ['111', '001', '001', '111', '001', '001', '111'],
  '4': ['101', '101', '101', '111', '001', '001', '001'],
  '5': ['111', '100', '100', '111', '001', '001', '111'],
  '6': ['111', '100', '100', '111', '101', '101', '111'],
  '7': ['111', '001', '001', '001', '001', '001', '001'],
  '8': ['111', '101', '101', '111', '101', '101', '111'],
  '9': ['111', '101', '101', '111', '001', '001', '111'],
  '.': ['0', '0', '0', '0', '0', '0', '1'],
}
const DOT_HEIGHT = 7

/**
 * A figure as dot-matrix numerals, two rows of braille: each glyph of
 * DOT_FONT with one blank dot column after it, from the top dot row down.
 * A character the font lacks draws as one blank cell.
 */
export function dotDigits(text: string): [string, string] {
  const columns: boolean[][] = []
  for (const ch of text) {
    const glyph = DOT_FONT[ch] ?? new Array<string>(DOT_HEIGHT).fill('0')
    for (let x = 0; x < (glyph[0] ?? '').length; x++) columns.push(glyph.map(row => row[x] === '1'))
    columns.push(new Array<boolean>(DOT_HEIGHT).fill(false))
  }
  if (columns.length % 2 === 1) columns.push(new Array<boolean>(DOT_HEIGHT).fill(false))
  const lit = (x: number, y: number): boolean => y < DOT_HEIGHT && (columns[x]?.[y] ?? false)
  const rows: [string, string] = ['', '']
  for (let cell = 0; cell < columns.length / 2; cell++) {
    for (const band of [0, 1] as const) {
      let bits = 0
      for (const dx of [0, 1] as const)
        for (let dy = 0; dy < 4; dy++) if (lit(cell * 2 + dx, band * 4 + dy)) bits |= DOT_BIT[dx][dy] ?? 0
      rows[band] += String.fromCodePoint(0x2800 | bits)
    }
  }
  return rows
}

/** A header tile's rows, each padded to the tile's width: two rows of figure, a rule, a label. */
export type TileFace = { top: string; bottom: string; rule: string; label: string }

/**
 * A header tile: the figure's dot numerals right-aligned over a thin rule,
 * then the label as it is, in plain lowercase, since the terminal font has
 * every letter it needs. The tile is as wide as its figure or its label,
 * whichever is wider.
 */
export function tileFace(value: string, label: string): TileFace {
  const [top, bottom] = dotDigits(value)
  const width = Math.max(top.length, label.length)
  return { top: top.padStart(width), bottom: bottom.padStart(width), rule: '─'.repeat(width), label: label.padEnd(width) }
}

/**
 * Spend over a span: a commit's cost over its window, or a ship's overhead over its own. `phase` and
 * `sitting` are the record's, or null when it has none or `sitting` is not a whole number.
 */
export type Spend = { startMs: number; endMs: number; usd: number; kind: 'commit' | 'ship'; phase: string | null; sitting: number | null }

/**
 * The spends in token-ledger's JSON lines: each commit's `cost.usd` and each
 * ship's `overhead.usd`, over the record's window, or at its instant when it
 * has none. A line that does not parse, or has no cost, is skipped.
 */
export function ledgerSpends(text: string): Spend[] {
  const out: Spend[] = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue
    let rec: unknown
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof rec !== 'object' || rec === null) continue
    const r = rec as {
      kind?: unknown
      ts?: unknown
      phase?: unknown
      sitting?: unknown
      window?: { start?: unknown }
      cost?: { usd?: unknown }
      overhead?: { usd?: unknown }
    }
    const usd = r.kind === 'commit' ? r.cost?.usd : r.kind === 'ship' ? r.overhead?.usd : undefined
    const endMs = parseMs(r.ts)
    if (typeof usd !== 'number' || !Number.isFinite(usd) || endMs === null) continue
    const start = parseMs(r.window?.start)
    out.push({
      startMs: start !== null && start < endMs ? start : endMs,
      endMs,
      usd,
      kind: r.kind === 'commit' ? 'commit' : 'ship',
      phase: typeof r.phase === 'string' ? r.phase : null,
      sitting: typeof r.sitting === 'number' && Number.isInteger(r.sitting) ? r.sitting : null,
    })
  }
  return out
}

/**
 * Adds `spends` to `into`, each sitting's plan cost by sitting, and returns
 * it: the commits with `phase: "plan"` that carry that `sitting`, in order. A
 * plan ship carries no sitting of its own, and a session is no commit, so
 * neither counts. Adding a ledger chunk by chunk gives what one pass over the
 * whole ledger gives. The sums stay unrounded: `dollars` rounds once, where a
 * cost or a total is drawn.
 */
export function addPlanCosts(into: Record<string, number>, spends: readonly Spend[]): Record<string, number> {
  for (const s of spends) {
    if (s.kind !== 'commit' || s.phase !== 'plan' || s.sitting === null) continue
    const key = `S${s.sitting}`
    into[key] = (into[key] ?? 0) + s.usd
  }
  return into
}

/** Each sitting's plan cost, by sitting, from `spends` alone. */
export const planCosts = (spends: readonly Spend[]): Record<string, number> => addPlanCosts({}, spends)

/**
 * Spends from one chunk of the ledger, read from where the last chunk
 * stopped: `partial` is the cut line the last chunk ended on. Returns the
 * spends of every line the two complete, and the line this chunk leaves cut.
 */
export function ledgerChunk(partial: string, chunk: string): { spends: Spend[]; partial: string } {
  const text = partial + chunk
  const end = text.lastIndexOf('\n')
  if (end === -1) return { spends: [], partial: text }
  return { spends: ledgerSpends(text.slice(0, end)), partial: text.slice(end + 1) }
}

const DAY_MS = 86400000

// How many local days the header's sparkline sums.
export const SPARK_DAYS = 14

/**
 * What the spends came to on each of the last SPARK_DAYS local days, oldest
 * first and today last. A spend falls in the local day of its `endMs`, in the
 * offset `date +%z` prints; an offset that does not parse sums by UTC day.
 * One offset serves every day, so a DST change moves one day's edge by an
 * hour. A spend after `now` falls in no day.
 */
export function daySums(spends: readonly Spend[], now: number, utcOffset: string): number[] {
  const shift = (offsetMinutes(utcOffset) ?? 0) * MINUTE_MS
  const dayOf = (ms: number): number => Math.floor((ms + shift) / DAY_MS)
  const today = dayOf(now)
  const sums = new Array<number>(SPARK_DAYS).fill(0)
  for (const s of spends) {
    const back = today - dayOf(s.endMs)
    if (s.endMs > now || back < 0 || back >= SPARK_DAYS) continue
    const at = SPARK_DAYS - 1 - back
    sums[at] = (sums[at] ?? 0) + s.usd
  }
  return sums
}

// The sparkline's bars, lowest first.
const SPARK_BARS = '▁▂▃▄▅▆▇█'

/**
 * A bar per day sum, scaled to the 90th-percentile day: by nearest rank over
 * 14 days, the 13th of the sums in ascending order, zeros included, so one
 * runaway day tops out and the rest keep their shape. With under two days of
 * spend, the cap is the highest day. A bar is `ceil(r × 8) − 1` of `▁`–`█`,
 * clamped to 0..7, where `r` is the day's sum over the cap, capped at 1. A day
 * with no spend, and every day while the cap is 0, draws `▁`.
 */
export function sparkGlyphs(days: readonly number[]): string {
  const sorted = [...days].sort((a, b) => a - b)
  const spent = days.filter(d => d > 0).length
  const cap = sorted[sorted.length - (spent < 2 ? 1 : 2)] ?? 0
  return days
    .map(d => {
      const r = cap > 0 ? Math.min(1, d / cap) : 0
      return SPARK_BARS[Math.min(7, Math.max(0, Math.ceil(r * 8) - 1))] ?? '▁'
    })
    .join('')
}

/**
 * An instant as a 12-hour clock in the offset `date +%z` prints: `7:41 PM`
 * at `-0500`. The engine gives a mod no time zone, so the poll reads the
 * offset. An offset that does not parse reads as UTC, and the clock says so.
 */
export function localClock(ms: number, utcOffset: string): string {
  const shift = offsetMinutes(utcOffset)
  const local = ms + (shift ?? 0) * MINUTE_MS
  const { hour, isPm } = hour12(local)
  const face = `${hour}:${String(new Date(local).getUTCMinutes()).padStart(2, '0')} ${isPm ? 'PM' : 'AM'}`
  return shift === null ? `${face} UTC` : face
}

/** What the runs and the loop have spent so far. */
export const inFlight = (b: Board): number =>
  Math.round((b.running.reduce((sum, r) => sum + r.cost, 0) + (b.loop?.cost ?? 0)) * 100) / 100

/** How long ago, in one unit: `14m` under an hour, `5h` under two days, then `3d`. */
export function agoShort(fromMs: number, toMs: number): string {
  const minutes = Math.max(0, Math.floor((toMs - fromMs) / 60000))
  if (minutes < 60) return `${minutes}m`
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / (24 * 60))}d`
}

/** The time between two instants: `2h38m`, or `24m` under an hour. */
export const elapsed = (fromMs: number, toMs: number): string =>
  hoursMinutes(Math.max(0, Math.floor((toMs - fromMs) / 60000)))

export const money = (n: number): string => `$${n.toFixed(2)}`

/** RECENT's totals row: what it says, and the figures under the time and cost columns. */
export type RecentTotals = {
  /** `10 live in 12h · median 1h04m`: every listed run, and the oldest one's age. */
  words: string
  /** The listed runs' minutes added up, or null when none has minutes. */
  minutes: number | null
  /** The listed runs' costs added up unrounded, or null when none has a cost. */
  usd: number | null
  /**
   * A run over this many minutes draws its time in peach; null when no run is timed. Under two timed runs no
   * time can pass twice the median, so nothing draws peach.
   */
  slowOver: number | null
}

/** The median of `xs`: an even count's is the unrounded mean of the two middle values. Null when `xs` is empty. */
function medianOf(xs: readonly number[]): number | null {
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length === 0) return null
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

/**
 * The median of the listed runs' minutes, among runs with minutes: an even
 * count's is the mean of the two middle times, rounded. Null when no run has
 * minutes.
 */
function medianMinutes(recent: readonly Ended[]): number | null {
  const m = medianOf(recent.flatMap(d => (d.minutes === null ? [] : [d.minutes])))
  return m === null ? null : Math.round(m)
}

/**
 * The median build cost per cycle over RECENT: each run's cost over its cycle
 * count, among runs with a cost and a count above 0. An even count's median is
 * the unrounded mean of the two middle values. Null when no run has both.
 */
const costPerCycle = (recent: readonly Ended[]): number | null =>
  medianOf(recent.flatMap(d => (d.usd === null || d.cycles <= 0 ? [] : [d.usd / d.cycles])))

/**
 * RECENT's totals. The count takes every listed run; the median, the time and
 * the slow line read only runs with minutes, and the spend only runs with a
 * cost. An even count's median is the mean of the two middle times, rounded.
 */
export function recentTotals(recent: readonly Ended[], now: number): RecentTotals {
  const timed = recent.flatMap(d => (d.minutes === null ? [] : [d.minutes]))
  const costs = recent.flatMap(d => (d.usd === null ? [] : [d.usd]))
  const median = medianMinutes(recent)
  const span = agoShort(Math.min(...recent.map(d => d.endedMs)), now)
  const sum = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0))
  return {
    words: `${recent.length} live in ${span}${median === null ? '' : ` · median ${hoursMinutes(median)}`}`,
    minutes: sum(timed),
    usd: sum(costs),
    slowOver: median === null ? null : 2 * median,
  }
}

/**
 * Each slot that holds a run, in slot order, with its runs, then the loop's
 * lane while the loop is live and no run holds it. A free slot has no card.
 */
export function lanesOf(b: Board): { lane: string; runs: Run[] }[] {
  const names = [...new Set(b.running.map(r => r.lane))].sort((x, y) => x.localeCompare(y, 'en', { numeric: true }))
  if (b.loop !== null && !names.includes(LOOP_LANE)) names.push(LOOP_LANE)
  return names.map(lane => ({ lane, runs: b.running.filter(r => r.lane === lane) }))
}

// The lane the architecture loop runs its landings on (scripts/archloop.sh).
export const LOOP_LANE = 'fix'

/** Whether the fix run in flight is one of the loop's landings. */
export const isLoopLanding = (b: Board, r: Run): boolean =>
  b.loop !== null && r.lane === LOOP_LANE && b.loop.stage.startsWith('landing ')

/** The loop's hint-line part while no landing runs: `◐ loop review p1 14m`. */
export const loopPart = (loop: Loop, now: number): string =>
  `◐ loop ${loop.stage} ${elapsed(loop.startedMs, now)}`

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
      ? [lane === LOOP_LANE && b.loop !== null ? loopPart(b.loop, b.checkedAt) : `${lane} idle`]
      : runs.map(r =>
          r.isAlive
            ? `● ${r.sitting} ${miniBar(r.phases)} ${livePhase(r.phases)} ${elapsed(r.startedMs, b.checkedAt)}${isLoopLanding(b, r) ? ' (loop)' : ''}`
            : `✗ ${r.sitting} launcher gone`,
        ),
  )
  if (b.queued.length > 0) parts.push(`○ ${b.queued.length}`)
  const cost = inFlight(b)
  if (cost > 0) parts.push(money(cost))
  return parts.join(' │ ')
}

/** Each foldable card's header hotkey. */
export const FOLD_KEY: Record<FoldCard, string> = { recent: 'r', deck: 'd', queued: 'q', blocked: 'b', timeline: 't', epics: 'e' }

/**
 * Whether a card is folded: as set by hand, else folded for recent and on
 * deck while BLOCKED shows, so the stuck work leads the pane.
 */
export const isFolded = (card: FoldCard, folds: Folds, hasBlocked: boolean): boolean =>
  folds[card] ?? (hasBlocked && (card === 'recent' || card === 'deck'))

/** The one line a folded card keeps. */
export function foldSummary(card: FoldCard, b: Board): string {
  const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`
  if (card === 'blocked') {
    const held = b.blocked.reduce((n, k) => n + k.holds.length, 0)
    const first = b.blocked[0]
    return [plural(b.blocked.length, 'cause', 'causes'), `holds ${held}`, first === undefined ? '' : `${KIND_TAG[first.kind]} ${first.sitting}`]
      .filter(p => p !== '')
      .join(' · ')
  }
  if (card === 'queued') {
    const held = b.blocked.reduce((n, k) => n + k.holds.length, 0)
    return [b.queued.length > 0 ? `${b.queued.length} waiting` : '', held > 0 ? `holds ${held}` : ''].filter(p => p !== '').join(' · ')
  }
  if (card === 'timeline') {
    // What holds each slot at now: a run, or idle.
    const now = b.timeline.nowMs
    // A running bar holds its slot through its end, which is now while it has no projection.
    const holds = (x: TimelineBar): boolean =>
      x.tone === 'running' ? x.startMs <= now && now <= x.endMs : (x.tone === 'live' || x.tone === 'stopped') && x.startMs <= now && now < x.endMs
    const atNow = (bars: readonly TimelineBar[]): string => bars.find(holds)?.sitting ?? 'idle'
    return [...b.timeline.slots.map(l => `slot ${l.slot} ${atNow(l.bars)}`), b.timeline.held.count > 0 ? `${b.timeline.held.count} held` : '']
      .filter(p => p !== '')
      .join(' · ')
  }
  if (card === 'epics') return b.epics.map(e => `${e.label} ${shippedCount(e)}/${e.cells.length}`).join(' · ')
  if (card === 'deck')
    return DECK_GROUPS.map(g => [g.label, b.onDeck.filter(d => d.mode === g.mode).length] as const)
      .filter(([, n]) => n > 0)
      .map(([label, n]) => `${label} ${n}`)
      .join(' · ')
  const last = b.recent[0]
  return last === undefined ? 'none live' : `${b.recent.length} live · last ${last.sitting} ${agoShort(last.endedMs, b.checkedAt)} ago`
}

/** A finished run's lane as a tag, ` (fix)`, or nothing when the dispatcher wrote none. */
export const laneTag = (d: Done | Ended): string => (d.lane === '' ? '' : ` (${d.lane})`)

/** The toast for a run that finished since the last look. */
export function finishedToast(d: Done): string {
  return `${d.isShipped ? '✓' : '✗'} ${d.sitting} ${d.slug}${laneTag(d)} · ${d.detail}`
}
