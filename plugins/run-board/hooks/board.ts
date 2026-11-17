import type { Block, BlockKind, Board, Deck, DeckMode, Done, Ended, FoldCard, Folds, Held, Loop, Phase, PhaseState, Run, Stage, StripCell, Waiting } from '../types'

// The shape `scripts/dispatch.sh` writes to status.json. Every field is
// checked on read, since the file is another program's output.
export type RawStatus = {
  dispatcher: number | null
  running: { entry: number; brief: string; lane: string; pid: number | null; started: string; cost: number }[]
  queued: { entry: number; brief: string; lane: string; reason: string; cause?: Cause | null }[]
  finished: { entry: number; brief: string; lane: string; status: number; outcome: string; kind: string | null }[]
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
      cause: parseCause(q),
    })),
    finished: list(d.finished).map(f => ({
      entry: num(f.entry) ?? 0,
      brief: str(f.brief),
      lane: str(f.lane),
      status: num(f.status) ?? 1,
      outcome: str(f.outcome),
      kind: typeof f.kind === 'string' && f.kind !== '' ? f.kind : null,
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
 * The blobs that hold a brief's cycles in an `ls-tree -r` listing: a file
 * brief's own blob, or every `.md` file directly in a directory brief, the
 * files scripts/autopilot.sh reads.
 */
export function cycleBlobs(lsTree: string, key: string): string[] {
  const out: string[] = []
  for (const line of lsTree.split('\n')) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line)
    if (!m) continue
    const path = m[2] ?? ''
    const inDir = path.startsWith(`${key}/`) && /^[^/]+\.md$/.test(path.slice(key.length + 1))
    if (path === key || inDir) out.push(m[1] ?? '')
  }
  return out
}

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
    const commit = /^skill: commit-skill:commit\b(.*)$/.exec(line)
    if (commit) {
      if (savor === 'live') savor = 'done'
      else if (shipPushed) archive = true
      else if (!simplify && !ship) {
        const k = /\bcycle (\d+)/i.exec(commit[1] ?? '')
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

// Stages the phase line leaves out: those that say no more than the phase,
// and `review low`, which stays the last step line through the next
// cycle's build, so it reads as the cycle before the one in flight.
const QUIET_STAGES = new Set(['savor', 'starting', 'working', 'review low', 'simplify', 'review xhigh', 'shipping'])

/**
 * A running card's phase line: the phase in flight, `cycle 2 of 2` for a
 * cycle, then the stage when it adds to the phase, then the newest tool call.
 */
export function phaseLine(r: Run): string {
  const cycles = r.phases.filter(p => p.label.startsWith('cycle ')).length
  const live = r.phases.find(p => p.state === 'live')
  const phase = live === undefined ? 'finishing' : live.label.startsWith('cycle ') ? `${live.label} of ${cycles}` : live.label
  const parts = [phase]
  if (!QUIET_STAGES.has(r.stage)) parts.push(r.stage)
  if (r.tool !== '') parts.push(r.tool)
  return parts.join(' · ')
}

/** One braille cell per phase for the hint line, `⣿` done, `⣤` in flight, `⣀` to come, then a `⡇` cap. */
export const miniBar = (phases: readonly Phase[]): string =>
  `${phases.map(p => (p.state === 'done' ? '⣿' : p.state === 'live' ? '⣤' : '⣀')).join('')}⡇`

// A block in flight tapers from full to the baseline, so it reads as filling.
const LIVE_TAPER = '⣿⣿⣷⣦⣤⣀'

/**
 * A phase's block in the pane's bar, `width` cells of braille: full when
 * done, tapering when in flight, the `⣀` baseline when still to come.
 */
export function phaseGlyphs(state: PhaseState, width: number): string {
  if (state === 'done') return '⣿'.repeat(width)
  if (state === 'todo') return '⣀'.repeat(width)
  if (width >= LIVE_TAPER.length) return LIVE_TAPER + '⣀'.repeat(width - LIVE_TAPER.length)
  // A narrow block samples the taper without its baseline end, so it never
  // ends on the dot a phase still to come draws.
  const core = LIVE_TAPER.slice(0, -1)
  const step = (core.length - 1) / Math.max(1, width - 1)
  return Array.from({ length: width }, (_, i) => core[Math.round(i * step)] ?? '⣤').join('')
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
  extra: {
    loop?: Loop | null
    recent?: Ended[]
    onDeck?: Deck[]
    /** Each running brief's newest tool call, read from its log. */
    tools?: Readonly<Record<string, string>>
    /** Each brief's cycle count, read from `origin/main`. */
    cycles?: Readonly<Record<string, number>>
    /** The machine's UTC offset as `date +%z` prints it, `-0500`. */
    utcOffset?: string
    /** Spend totals from token-ledger, or null when it could not be read. */
    spend?: Board['spend']
    /** Each brief's `After:` sittings, read from `origin/main`. */
    afters?: Readonly<Record<string, string[]>>
    /** The progress files read for RECENT and BLOCKED. */
    endings?: readonly Ending[]
    /** Each stopped run's handoff text, by run name. */
    handoffs?: Readonly<Record<string, string>>
    /** Each red deploy's failed strip stage, by run. */
    deployStages?: Readonly<Record<string, string>>
  } = {},
): Board {
  const { loop = null, recent = [], tools = {}, cycles = {}, utcOffset = '', spend = null, afters = {} } = extra
  const { blocks, drawn } = blockedOf({ raw, endings: extra.endings ?? [], afters, handoffs: extra.handoffs, deployStages: extra.deployStages })
  // A held brief, and a stopped one, sits under BLOCKED and never on deck.
  const onDeck = (extra.onDeck ?? []).filter(d => !drawn.has(d.sitting))
  const running: Run[] = raw.running.map(r => {
    const text = progress[r.brief] ?? ''
    const { note, cost } = noteOf(text)
    const started = Date.parse(r.started)
    const stage = stageOf(text)
    return {
      entry: r.entry,
      ...sittingOf(r.brief),
      lane: r.lane,
      startedMs: Number.isFinite(started) ? started : now,
      cost: Math.max(r.cost, cost ?? 0),
      stage,
      tool: tools[r.brief] ?? '',
      phases: phasesOf(text, cycles[briefKey(r.brief)]),
      note,
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
  const finished: Done[] = [...raw.finished]
    .sort((a, b) => b.entry - a.entry)
    .map(f => {
      const base = baseName(f.brief)
      const detail = outcomeDetail(f.outcome.replace(/^autopilot: /, '').replace(`${base} `, ''))
      return { entry: f.entry, ...sittingOf(f.brief), lane: f.lane, isShipped: f.status === 0, detail }
    })
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
  }
}

/** A brief file in `git ls-tree -r origin/main docs/briefs/`: its path and blob. */
export type BriefFile = { path: string; sha: string }

// A brief at the top of docs/briefs/, or a directory brief's entry file. The
// README, `rules/` and `sittings.json` are not briefs.
const FILE_BRIEF = /^docs\/briefs\/(kickoff-[^/]+)\.md$/
const DIR_BRIEF = /^docs\/briefs\/([^/]+)\/README\.md$/

/** The briefs in an `ls-tree -r` listing: top-level `kickoff-*.md` files and directory briefs' READMEs. */
export function briefFiles(lsTree: string): BriefFile[] {
  const out: BriefFile[] = []
  for (const line of lsTree.split('\n')) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line)
    if (!m) continue
    const path = m[2] ?? ''
    const dir = DIR_BRIEF.exec(path)
    if (FILE_BRIEF.test(path) || (dir && dir[1] !== 'rules')) out.push({ path, sha: m[1] ?? '' })
  }
  return out
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
 * for one marked `**Mode: interactive.**`, whose `why` is the text after the
 * marker, and `enrich` for a brief that carries neither yet.
 */
export function briefHeader(text: string): { epic: string; after: string; mode: DeckMode; why: string } {
  let epic = ''
  let after = ''
  let mode: DeckMode = 'enrich'
  let why = ''
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) break
    const e = /^Epic: (.+)$/.exec(line)
    if (e) epic = (e[1] ?? '').trim()
    const a = /^After: (.+)$/.exec(line)
    if (a) after = (a[1] ?? '').trim()
    if (line.includes('**Mode: autopilot.**')) mode = 'ready'
    const i = line.indexOf(INTERACTIVE)
    if (i !== -1) {
      mode = 'interactive'
      why = line.slice(i + INTERACTIVE.length).trim()
    }
  }
  return { epic, after, mode, why }
}

const INTERACTIVE = '**Mode: interactive.**'

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
export function onDeckOf(briefs: readonly (BriefFile & { text: string })[], held: readonly string[]): Deck[] {
  const taken = new Set(held.map(briefKey))
  return briefs
    .filter(b => !taken.has(briefKey(b.path)))
    .map(b => {
      const { epic, after, mode, why } = briefHeader(b.text)
      const key = briefKey(b.path)
      const issue = /^kickoff-(\d+)-(.+)$/.exec(baseName(key))
      const name = issue ? { sitting: `#${issue[1] ?? ''}`, slug: issue[2] ?? '' } : sittingOf(key)
      return { ...name, lane: epic === '' ? 'fix' : 'epic', epic, after, mode, why }
    })
    .sort((a, b) => sittingNumber(a.sitting) - sittingNumber(b.sitting))
}

/** A brief's lane and epic as one detail line: `epic · minisite/E4`. */
export function deckDetail(d: Deck): string {
  return d.epic === '' ? d.lane : `${d.lane} · ${d.epic}`
}

/** The sittings an `After:` line names, such as `S390, S393`, in capitals. */
export const afterSittings = (after: string): string[] => [...after.matchAll(/\bs(\d+)\b/gi)].map(m => `S${m[1] ?? ''}`)

/**
 * `held · S518 shares CLAUDE.md` for a dispatcher reason that holds an entry
 * off a run touching the same paths, or null for any other reason. If
 * dispatch.sh changes its `<brief> <where>: both touch <paths>` reason, update
 * this pattern.
 */
export function heldNote(reason: string): string | null {
  const m = /\bs(\d+)-[\w-]*.*?: both touch (.+)$/i.exec(reason)
  return m === null ? null : `held · S${m[1] ?? ''} shares ${m[2] ?? ''}`
}

/** One row of the queue drawn as a tree. */
export type TreeRow = {
  /** A rail for each level above whose branch goes on below this row, two cells per level. */
  rails: string
  /** `├─` or `└─` under the entry it needs, empty at a root. */
  joint: string
  /**
   * `run`: a running root. `after`: an entry that needs its parent shipped.
   * `free`: a root that waits on neither.
   * `held`: a root that waits for a run to leave paths both briefs touch. The
   * hold orders nothing, so it draws as a tag, not an edge.
   */
  kind: 'run' | 'after' | 'free' | 'held'
  sitting: string
  slug: string
  lane: string
  /** `after S396, S401`, the dispatcher's reason at a free root, the held tag at a held root, or empty at a running root. */
  note: string
}

/**
 * The queue as a tree of who waits on whom. Each running run is a root, drawn
 * only when something waits on it. An entry hangs under the running or queued
 * sitting on its `After:` line that sits deepest in the tree, which is the one
 * to ship last, and its note names every such sitting; a sitting that is
 * neither running nor queued has shipped and draws no edge. An entry that
 * needs nothing in the tree is a root of its own under the dispatcher's reason;
 * a running run it does not name is not its parent, since slots order nothing. Siblings
 * go in queue order.
 */
export function queueTree(running: readonly Pick<Run, 'sitting' | 'slug' | 'lane'>[], queued: readonly Waiting[]): TreeRow[] {
  const runs = new Set(running.map(r => r.sitting))
  const byEntry = [...queued].sort((a, b) => a.entry - b.entry)
  const waiting = new Map(byEntry.map(q => [q.sitting, q]))
  // A board stored by an older version of the mod has no `after`.
  const needs = (q: Waiting): string[] => (q.after ?? []).filter(s => s !== q.sitting && (runs.has(s) || waiting.has(s)))

  const parent = new Map<string, string | null>()
  const depth = new Map<string, number>()
  const depthOf = (s: string, seen: Set<string>): number => {
    if (runs.has(s)) return 0
    const known = depth.get(s)
    if (known !== undefined) return known
    const q = waiting.get(s)
    if (q === undefined || seen.has(s)) return 0
    seen.add(s)
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
    const after = needs(q)
    rows.push({
      rails,
      joint: `${isLast ? '└' : '├'}─`,
      kind: 'after',
      sitting: q.sitting,
      slug: q.slug,
      lane: q.lane,
      note: `after ${after.join(', ')}`,
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
    const held = heldNote(q.reason)
    rows.push({ rails: '', joint: '', kind: held === null ? 'free' : 'held', sitting: q.sitting, slug: q.slug, lane: q.lane, note: held ?? q.reason })
    branch(q.sitting, '')
  }
  return rows
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
  /**
   * At a group, how many briefs it holds. At a brief, its lane and epic, then
   * `after` and the sittings it still waits on, then why it needs a person.
   */
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
 */
export function deckTree(deck: readonly Deck[], live: readonly string[]): DeckRow[] {
  const waitable = new Set([...deck.map(d => d.sitting), ...live])
  const waits = (d: Deck): string[] => afterSittings(d.after).filter(s => s !== d.sitting && waitable.has(s))
  const note = (d: Deck): string => {
    const parts = [deckDetail(d)]
    const w = waits(d)
    if (w.length > 0) parts.push(`after ${w.join(', ')}`)
    if (d.why !== '') parts.push(d.why)
    return parts.join(' · ')
  }

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

    rows.push({ rails: '', joint: '', kind: 'group', mode: g.mode, sitting: '', slug: g.label, note: String(members.length) })
    const walk = (d: Deck, rails: string, isLast: boolean) => {
      const isAfter = parent.get(d.sitting) != null
      rows.push({
        rails,
        joint: `${isLast ? '└' : '├'}${isAfter ? '─' : '╌'}`,
        kind: isAfter ? 'after' : 'free',
        mode: g.mode,
        sitting: d.sitting,
        slug: d.slug,
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
 * belong to BLOCKED. These files outlive the dispatcher, whose finished list
 * starts empty each time one starts. The lane comes from that list while it
 * still holds the run.
 */
export function recentOf(
  files: readonly (ProgressFile & { text: string })[],
  finished: RawStatus['finished'],
): Ended[] {
  const laneOf = new Map<string, string>()
  for (const f of [...finished].sort((a, b) => a.entry - b.entry)) laneOf.set(baseName(f.brief), f.lane)
  const out: Ended[] = []
  for (const f of [...files].sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    const end = lastEnd(f.text)
    if (end === null || !end.isLive) continue
    const base = f.name.replace(/\.progress$/, '')
    const totals = TOTALS.exec(end.outcome)
    out.push({
      ...sittingOf(base),
      lane: laneOf.get(base) ?? '',
      detail: outcomeDetail(end.outcome),
      minutes: totals === null ? null : Number(totals[2]),
      usd: totals === null ? null : Number(totals[1]),
      endedMs: f.mtimeMs,
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
  const commitsAfter = lines.slice(savorAt + 1).filter(l => /^skill: commit-skill:commit\b/.test(l)).length
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

/** The question a stop handoff asks on its `**Question: …**` line, or empty. */
export const handoffQuestion = (handoff: string): string => /\*\*Question: (.+?)\*\*/.exec(handoff)?.[1]?.trim() ?? ''

/** The stop a handoff names on its last `**Stop:**` line, or empty. */
export const handoffStop = (handoff: string): string => [...handoff.matchAll(/\*\*Stop:\*\* (\d+)/g)].pop()?.[1] ?? ''

/**
 * The BLOCKED card: one block per root cause, most held first, and every
 * sitting the card draws, none of which ON DECK lists.
 *
 * A sitting is stuck when its last end is not live, nothing runs or queues
 * it, and either its brief is still on `origin/main`, or it is a red deploy
 * with no live run after it. A queued entry is held by the cause the
 * dispatcher names; a record without the `cause` key, from a dispatcher older
 * than the field, is held when an `After:` sitting is stuck or held. A brief
 * on main that nothing runs or queues is held the same way. A stuck sitting
 * that is held is a hold under its cause, never a root of its own. Each hold
 * names the nearest sitting it waits on, and the holds go in chain order.
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
}): { blocks: Block[]; drawn: Set<string> } {
  const { raw, endings, afters, handoffs = {}, deployStages = {} } = input
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
    if (i.kind === 'deploy-red' ? i.mtimeMs > newestLive : onMain.has(s)) stuck.set(s, i)
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
    const group = new Set([root, ...members])
    const parentOf = (s: string): string => afterOf(s).find(a => a !== s && group.has(a)) ?? ''
    const depthOf = (s: string, seen: Set<string>): number => {
      const p = parentOf(s)
      if (p === '' || p === root || seen.has(p)) return 1
      seen.add(s)
      return depthOf(p, seen) + 1
    }
    const info = stuck.get(root)
    const kind: BlockKind = info?.kind ?? 'deploy-red'
    const holds: Held[] = members
      .map(s => {
        const p = parentOf(s)
        const why = p !== '' ? `after ${p}` : kind === 'deploy-red' ? 'waits for a green deploy' : `after ${root}`
        return { sitting: s, slug: slugOf.get(s) ?? stuck.get(s)?.slug ?? '', why, depth: depthOf(s, new Set()) }
      })
      .sort((a, b) => a.depth - b.depth || sittingNumber(a.sitting) - sittingNumber(b.sitting))
      .map(h => ({ sitting: h.sitting, slug: h.slug, why: h.why }))
    blocks.push(blockFace(root, info, kind, holds, handoffs, deployStages))
  }
  blocks.sort((a, b) => b.holds.length - a.holds.length || b.endedMs - a.endedMs)
  const drawn = new Set<string>()
  for (const b of blocks) for (const s of [b.sitting, ...b.holds.map(h => h.sitting)]) drawn.add(s)
  return { blocks, drawn }
}

/** A block's words by kind: its headline, the line of why, the strip and the next line. */
function blockFace(
  root: string,
  info: { slug: string; base: string; text: string; mtimeMs: number; end: RunEnd } | undefined,
  kind: BlockKind,
  holds: Held[],
  handoffs: Readonly<Record<string, string>>,
  deployStages: Readonly<Record<string, string>>,
): Block {
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
  const stop = handoffStop(handoff)
  const why = [broke === 'savor' ? 'step 0 savor' : (broke ?? ''), stop === '' ? '' : `stop ${stop}`, pushed ? 'pushed' : 'nothing pushed', ...spent]
    .filter(p => p !== '')
    .join(' · ')
  if (kind === 'decision') {
    const q = handoffQuestion(handoff)
    return { ...base, headline: q === '' ? `${root} needs a decision` : `${root} asks: ${q}`, why, next: `answer in the handoff, then relaunch ${root}` }
  }
  if (kind === 'split') return { ...base, headline: `${root} is over its size ceiling`, why, next: `split the brief, then relaunch ${root}` }
  return { ...base, headline: `${root}: the run broke`, why: sentence, next: `read the log, then relaunch ${root}` }
}

/** How long ago an instant was: `24m ago`, `5h12m ago`, `3d ago` past two days. */
export function ago(fromMs: number, toMs: number): string {
  const minutes = Math.max(0, Math.floor((toMs - fromMs) / 60000))
  return minutes < 48 * 60 ? `${hoursMinutes(minutes)} ago` : `${Math.floor(minutes / (24 * 60))}d ago`
}

// The totals `scripts/autopilot.sh` ends an outcome with:
// ` ($27.53, 158 min)`, or ` ($27.53, 158 min, peak 385k context)`.
const TOTALS = /\s*\(\$([0-9]+(?:\.[0-9]+)?), ([0-9]+) min(?:, peak ([0-9]+k) context)?\)$/
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

// The braille bit for the dot at column x (0-1) and row y (0-3) of a cell.
const DOT_BIT = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
] as const

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

/** Spend over a span: a commit's cost over its window, or a ship's overhead over its own. */
export type Spend = { startMs: number; endMs: number; usd: number }

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
    const r = rec as { kind?: unknown; ts?: unknown; window?: { start?: unknown }; cost?: { usd?: unknown }; overhead?: { usd?: unknown } }
    const usd = r.kind === 'commit' ? r.cost?.usd : r.kind === 'ship' ? r.overhead?.usd : undefined
    const endMs = typeof r.ts === 'string' ? Date.parse(r.ts) : NaN
    if (typeof usd !== 'number' || !Number.isFinite(usd) || !Number.isFinite(endMs)) continue
    const start = typeof r.window?.start === 'string' ? Date.parse(r.window.start) : NaN
    out.push({ startMs: Number.isFinite(start) && start < endMs ? start : endMs, endMs, usd })
  }
  return out
}

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

/** Spend by window: the last 24 hours, 7 days and 30 days before `now`, and every record. */
export type SpendTotals = { day: number; week: number; month: number; all: number }

const DAY_MS = 86400000

/** What the spends came to over the last day, week and month before `now`, and in all. */
export function spendTotals(spends: readonly Spend[], now: number): SpendTotals {
  const sum = (sinceMs: number): number =>
    Math.round(spends.filter(s => s.endMs > sinceMs && s.endMs <= now).reduce((t, s) => t + s.usd, 0) * 100) / 100
  return {
    day: sum(now - DAY_MS),
    week: sum(now - 7 * DAY_MS),
    month: sum(now - 30 * DAY_MS),
    all: sum(Number.NEGATIVE_INFINITY),
  }
}

/**
 * An instant as a 12-hour clock in the offset `date +%z` prints: `7:41 PM`
 * at `-0500`. The engine gives a mod no time zone, so the poll reads the
 * offset. An offset that does not parse reads as UTC, and the clock says so.
 */
export function localClock(ms: number, utcOffset: string): string {
  const m = /^([+-])(\d{2})(\d{2})$/.exec(utcOffset.trim())
  const shift = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0
  const d = new Date(ms + shift * 60000)
  const h = d.getUTCHours()
  const face = `${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
  return m ? face : `${face} UTC`
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

// The part cells a cost meter steps through between full ones, emptiest first.
const METER_PARTS = '⡀⣀⣄⣤⣦⣶⣷'

/**
 * A cost as a braille meter `width` cells wide, scaled to `max`: full `⣿`
 * cells, one part cell for the remainder, then the `⣀` baseline. Any cost
 * above zero shows at least the emptiest part cell.
 */
export function costMeter(usd: number, max: number, width: number): { fill: string; rest: string } {
  if (max <= 0 || usd <= 0) return { fill: '', rest: '⣀'.repeat(width) }
  const cells = Math.min(width, (usd / max) * width)
  const full = Math.floor(cells + 1e-9)
  const rem = cells - full
  const part = full < width && rem > 1e-9 ? (METER_PARTS[Math.floor(rem * METER_PARTS.length)] ?? '') : ''
  const fill = '⣿'.repeat(full) + part
  return { fill, rest: '⣀'.repeat(width - fill.length) }
}

/** The time between two instants: `2h38m`, or `24m` under an hour. */
export const elapsed = (fromMs: number, toMs: number): string =>
  hoursMinutes(Math.max(0, Math.floor((toMs - fromMs) / 60000)))

export const money = (n: number): string => `$${n.toFixed(2)}`

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
export const FOLD_KEY: Record<FoldCard, string> = { recent: 'r', deck: 'd', queued: 'q', blocked: 'b' }

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
  if (card === 'queued') return plural(b.queued.length, 'waiting', 'waiting')
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
