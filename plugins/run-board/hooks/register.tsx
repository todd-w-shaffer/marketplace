import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BlockKind, Board, BriefCost, Deck, DeckMode, Ended, EpicCell, EpicRow, FoldCard, Folds, Loop, Phase, PhaseSplit, Run, StripCell } from '../types'
import {
  FOLD_KEY,
  KIND_TAG,
  DEPLOY_LIVE,
  deployRunOf,
  deployStateOf,
  foldSummary,
  isFolded,
  lastEnd,
  LOG_TAIL_BYTES,
  LOOP_LANE,
  agoShort,
  baseName,
  buildBoard,
  chainLine,
  briefFiles,
  buildLoop,
  afterSittings,
  briefHeader,
  briefKey,
  cycleBlobs,
  cycleCount,
  daySums,
  deckTree,
  elapsed,
  hoursMinutes,
  historyTag,
  addPlanCosts,
  launchCount,
  RECENT_SPLIT_CELLS,
  sittingsBlob,
  splitCounts,
  finishedToast,
  isLoopLanding,
  lastToolOf,
  ledgerChunk,
  liveDepths,
  phaseGlyphs,
  phaseLine,
  phaseName,
  planBlobs,
  planHeadings,
  recordedEpics,
  segmentWidth,
  shortDollars,
  sparkGlyphs,
  spendTotals,
  dollars,
  money,
  newestRunDir,
  onDeckOf,
  queueTree,
  parseStatus,
  lanesOf,
  recentCandidates,
  recentOf,
  recentTotals,
  statusLine,
  tileFace,
  axisCells,
  heldCells,
  laneCells,
  nowCell,
} from './board'
import type { CellTone, Ending, LoopFile, RawStatus, Spend, SpendTotals, TimelineCell } from './board'

// Catppuccin Macchiato (catppuccin.com/palette). Every colour the board
// paints comes from here, the pane's own ground included, so the pane reads
// the same whatever the terminal theme.
const F = {
  text: '#cad3f5',
  subtext0: '#a5adcb',
  overlay2: '#939ab7',
  overlay1: '#8087a2',
  overlay0: '#6e738d',
  surface2: '#5b6078',
  surface1: '#494d64',
  surface0: '#363a4f',
  teal: '#8bd5ca',
  pink: '#f5bde6',
  sapphire: '#7dc4e4',
  base: '#24273a',
  mantle: '#1e2030',
  lavender: '#b7bdf8',
  blue: '#8aadf4',
  mauve: '#c6a0f6',
  green: '#a6da95',
  yellow: '#eed49f',
  peach: '#f5a97f',
  red: '#ed8796',
} as const

// Every section of the pane sits in one of these: a lane, the queue, on deck, recent.
const CARD = {
  flexDirection: 'column',
  marginTop: 1,
  borderStyle: 'round',
  borderColor: F.surface2,
  backgroundColor: F.mantle,
  paddingX: 1,
} as const

// Each lane's colour, on its card's pill.
const LANE_COLOR: Record<string, string> = { epic: F.pink, fix: F.teal }
// Each on-deck group's colour: green can queue now, yellow needs a pass to
// reach autopilot, red needs a person in the session.
const DECK_COLOR: Record<DeckMode, string> = { ready: F.green, enrich: F.yellow, interactive: F.red }
// Each timeline cell's colour: green for a run live or in flight, peach for
// its projection and the now-line, red for a stop, blue queued, mauve on
// deck, yellow held, and the idle track faint.
const TONE_COLOR: Record<CellTone, string> = {
  live: F.green,
  running: F.green,
  ahead: F.peach,
  stopped: F.red,
  queued: F.blue,
  deck: F.mauve,
  idle: F.surface1,
  now: F.peach,
  held: F.yellow,
  blank: F.surface1,
}
// The timeline's lane labels take the widest label and one space, `slot 1 `
// or `slot 12 `; the card's border and padding take 4 more, and the track the rest.
const labelCells = (slots: readonly { slot: number }[]): number =>
  1 + Math.max('held'.length, ...slots.map(l => `slot ${l.slot}`.length))
// The least widths of a recent row's time, cost and age columns, the cost and
// age with a leading gap: `14h52m`, ` $1,238`, ` 12h`. A wider figure widens its column.
const RECENT_TIME_CELLS = 6
const RECENT_COST_CELLS = 7
const RECENT_AGE_CELLS = 4
// How much faster a queue or deck row's note shrinks than its name, so the
// note gives way first on a narrow pane.
const NOTE_SHRINK = 1000
// Each epic cell's glyph and colour: green shipped, peach running, a faint
// hollow square to come.
const EPIC_CELL: Record<EpicCell, { glyph: string; color: string }> = {
  shipped: { glyph: '■', color: F.green },
  running: { glyph: '■', color: F.peach },
  todo: { glyph: '□', color: F.surface2 },
}

const PANE = 'run-board'
// A name Claude Code does not reserve: `claude plugin validate` warns on one it does.
const COMMAND = 'board'
const TITLE = 'Autopilot runs'
const POLL_MS = 5000
// scripts/dispatch.sh's default LOG_DIR, under $HOME.
const LOG_DIR = 'Library/Logs/shootsfilm-autopilot'
// scripts/archloop.sh's default ARCHLOOP_LOG_DIR, under $HOME.
const LOOP_DIR = 'Library/Logs/shootsfilm-archloop'

// The shoots.film checkout, under $HOME. Its `origin/main` holds the briefs;
// every worktree's push moves that ref, so the board reads it without a fetch.
const REPO = 'Desktop/apps/shootsfilm'

// Change the tag when Board's fields change: it declines what an earlier
// version stored, which outlives a reload.
const board = atom({ plugin: 'run-board', key: 'board' } as const, null, { shape: 'board-14' })

// The folds set by hand, mirrored to `$.store` under FOLDS_KEY so they outlast
// the session; seeded from it at session start.
const folds = atom({ plugin: 'run-board', key: 'folds' } as const, {} as Folds, { shape: 'folds-1' })
const FOLDS_KEY = 'folds'

/** The folds `$.store` holds, each field checked, since the file outlives this code. */
function parseFolds(v: unknown): Folds {
  if (typeof v !== 'object' || v === null) return {}
  const out: Folds = {}
  for (const card of Object.keys(FOLD_KEY) as FoldCard[]) {
    const f = (v as Record<string, unknown>)[card]
    if (typeof f === 'boolean') out[card] = f
  }
  return out
}

// Each kind's tag colour: yellow you, mauve the plan, red the code, peach the run.
const KIND_COLOR: Record<BlockKind, string> = { decision: '#eed49f', split: '#c6a0f6', 'deploy-red': '#ed8796', 'run-broke': '#f5a97f' }

async function alivePids($: EngineInterface, pids: number[]): Promise<Set<number>> {
  if (pids.length === 0) return new Set()
  const { stdout } = await $.process.run(['ps', '-o', 'pid=', '-p', pids.join(',')], { timeoutMs: 5000 })
  return new Set(
    stdout
      .split('\n')
      .map(s => Number(s.trim()))
      .filter(n => Number.isInteger(n) && n > 0),
  )
}

/**
 * The loop while its lock names a live process, else null. The stage in
 * flight is read from the newest file in the run directory and its pass
 * directories, by listing alone: a session log can pass the 4 MiB read cap.
 */
async function readLoop($: EngineInterface, home: string): Promise<Loop | null> {
  const dir = `${home}/${LOOP_DIR}`
  const pid = Number((await $.fs.read(`${dir}/.lock/pid`).catch(() => '')).trim())
  if (!Number.isInteger(pid) || pid <= 0) return null
  if (!(await alivePids($, [pid]).catch(() => new Set<number>())).has(pid)) return null
  const name = newestRunDir((await $.fs.list(dir).catch(() => [])).filter(e => e.kind === 'dir').map(e => e.name))
  if (name === null) return null
  const run = `${dir}/${name}`
  const files: LoopFile[] = []
  for (const pass of (await $.fs.list(run).catch(() => [])).filter(e => e.kind === 'dir' && /^p\d+$/.test(e.name))) {
    for (const f of await $.fs.list(`${run}/${pass.name}`).catch(() => [])) {
      if (f.kind === 'file') files.push({ path: `${pass.name}/${f.name}`, mtimeMs: f.mtimeMs })
    }
  }
  const progress = await $.fs.read(`${run}/progress`).catch(() => '')
  return buildLoop(name, files, progress, await $.clock.now())
}

/**
 * A run's newest tool call, from the end of its stream-json log. The log can
 * pass the 4 MiB read cap, and `$.fs.read` reads a whole file, so `tail -c`
 * reads its last LOG_TAIL_BYTES.
 */
async function readLastTool($: EngineInterface, log: string): Promise<string> {
  const tail = await $.process
    .run(['tail', '-c', String(LOG_TAIL_BYTES), log], { timeoutMs: 5000 })
    .catch(() => ({ exitCode: 1, stdout: '' }))
  return tail.exitCode === 0 ? lastToolOf(tail.stdout) : ''
}

// token-ledger's record of what each /commit and /ship cost, under $HOME.
const LEDGER = '.claude/token-ledger.jsonl'
// How much of the ledger one read takes: `$.process.run` keeps 4 MiB of
// output, and the whole file passes that, so the first read takes it in
// chunks.
const LEDGER_CHUNK_BYTES = 3 * 1024 * 1024

// The ledger as read so far, and each sitting's plan cost over the spends
// read. It only grows, by a line per /commit and /ship, so each poll reads
// only the bytes past `offset`; a file shorter than `offset` was replaced,
// and is read again from the start.
type Ledger = { offset: number; partial: string; spends: Spend[]; plans: Record<string, number> }
const emptyLedger = (): Ledger => ({ offset: 0, partial: '', spends: [], plans: {} })
let ledger: Ledger = emptyLedger()

// The ledger read in flight. A poll that starts while another reads awaits
// that read, so two never advance `ledger` from the same offset.
let ledgerRead: Promise<boolean> | null = null

/** Reads the ledger past `ledger.offset`; false when it could not be read. */
async function readLedger($: EngineInterface, path: string): Promise<boolean> {
  const stat = await $.process.run(['stat', '-f', '%z', path], { timeoutMs: 5000 })
  const size = Number(stat.stdout.trim())
  if (stat.exitCode !== 0 || !Number.isFinite(size)) return false
  if (size < ledger.offset) ledger = emptyLedger()
  while (ledger.offset < size) {
    const count = Math.min(LEDGER_CHUNK_BYTES, size - ledger.offset)
    const chunk = await $.process.run(
      ['sh', '-c', 'tail -c +"$1" "$2" | head -c "$3"', 'sh', String(ledger.offset + 1), path, String(count)],
      { timeoutMs: 5000 },
    )
    if (chunk.exitCode !== 0) return false
    const read = ledgerChunk(ledger.partial, chunk.stdout)
    ledger = {
      offset: ledger.offset + count,
      partial: read.partial,
      spends: [...ledger.spends, ...read.spends],
      plans: addPlanCosts({ ...ledger.plans }, read.spends),
    }
  }
  return true
}

/**
 * Spend over the last 24 hours, 7 days and 30 days, and in all, every spend
 * read, and each sitting's plan cost, from one read of token-ledger; null when
 * it could not be read.
 */
async function readSpend(
  $: EngineInterface,
  home: string,
  now: number,
): Promise<{ spend: SpendTotals; spends: readonly Spend[]; plans: Record<string, number> } | null> {
  if (ledgerRead === null) ledgerRead = readLedger($, `${home}/${LEDGER}`).finally(() => (ledgerRead = null))
  if (!(await ledgerRead)) return null
  return { spend: spendTotals(ledger.spends, now), spends: ledger.spends, plans: { ...ledger.plans } }
}

// Launch counts read from `.launches` files, by name, kept while their mtime holds.
const launchCache = new Map<string, { mtimeMs: number; count: number }>()

/**
 * Each stopped run's launch count, by run name, from its `.launches` file,
 * which the launcher appends a line to at each launch and no launch empties.
 * `mtimes` is the log directory's listing; a run whose file it lacks, or
 * whose file cannot be read, is absent.
 */
async function readLaunchCounts(
  $: EngineInterface,
  dir: string,
  endings: readonly Ending[],
  mtimes: ReadonlyMap<string, number>,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const misses: { base: string; name: string; mtimeMs: number }[] = []
  for (const e of endings) {
    if (lastEnd(e.text)?.isLive !== false) continue
    const name = `${e.base}.launches`
    const mtimeMs = mtimes.get(name)
    if (mtimeMs === undefined) continue
    const hit = launchCache.get(name)
    if (hit !== undefined && hit.mtimeMs === mtimeMs) out[e.base] = hit.count
    else misses.push({ base: e.base, name, mtimeMs })
  }
  await Promise.all(
    misses.map(async m => {
      const text = await $.fs.read(`${dir}/${m.name}`).catch(() => undefined)
      if (text === undefined) return
      const count = launchCount(text)
      launchCache.set(m.name, { mtimeMs: m.mtimeMs, count })
      out[m.base] = count
    }),
  )
  return out
}

// Progress files read for RECENT and BLOCKED, by name, kept while their mtime holds.
const progressCache = new Map<string, { mtimeMs: number; text: string }>()

/**
 * The progress files RECENT and BLOCKED read: the newest sittings', and each
 * brief's on `origin/main`, since a stop that waits for a person can be older
 * than every recent run. None that runs: a run truncates its file at start.
 */
async function readEndings(
  $: EngineInterface,
  dir: string,
  raw: RawStatus,
  onMain: readonly string[],
): Promise<{ recent: Ended[]; endings: Ending[]; mtimes: Map<string, number> }> {
  const files = (await $.fs.list(dir).catch(() => []))
    .filter(e => e.kind === 'file')
    .map(e => ({ name: e.name, mtimeMs: e.mtimeMs }))
  const running = new Set(raw.running.map(r => `${baseName(r.brief)}.progress`))
  const wanted = new Set(onMain.map(k => `${baseName(k)}.progress`))
  const picked = new Map(recentCandidates(files, raw.running.map(r => r.brief)).map(f => [f.name, f]))
  for (const f of files) if (wanted.has(f.name) && !running.has(f.name)) picked.set(f.name, f)
  const texts: { name: string; mtimeMs: number; text: string }[] = []
  for (const f of picked.values()) {
    let hit = progressCache.get(f.name)
    if (hit === undefined || hit.mtimeMs !== f.mtimeMs) {
      hit = { mtimeMs: f.mtimeMs, text: await $.fs.read(`${dir}/${f.name}`).catch(() => '') }
      progressCache.set(f.name, hit)
    }
    texts.push({ ...f, text: hit.text })
  }
  return {
    recent: recentOf(texts, raw.finished),
    endings: texts.map(t => ({ base: t.name.replace(/\.progress$/, ''), text: t.text, mtimeMs: t.mtimeMs })),
    mtimes: new Map(files.map(f => [f.name, f.mtimeMs])),
  }
}

/**
 * The handoff of each run that stopped for a person or a split: scripts/autopilot.sh
 * reads `handoff/<name>.md` in the run's worktree, `.claude/worktrees/<name
 * without kickoff-sitting->`. If the launcher moves the handoff, update this.
 */
async function readHandoffs($: EngineInterface, home: string, endings: readonly Ending[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const e of endings) {
    const kind = lastEnd(e.text)?.kind
    if (kind !== 'decision' && kind !== 'split') continue
    const tree = `${home}/${REPO}/.claude/worktrees/${e.base.replace(/^kickoff-sitting-/, '')}`
    const text = await $.fs.read(`${tree}/handoff/${e.base}.md`).catch(() => '')
    if (text !== '') out[e.base] = text
  }
  return out
}

// Each red deploy run's state through `gh`, and when it was asked. A re-run
// of the same run can turn it green, so a red run that could still block is
// asked again after DEPLOY_REASK_MS; a run once live is asked no more.
const deployCache = new Map<string, { state: string; askedMs: number }>()
const DEPLOY_REASK_MS = 60_000

/**
 * Each red deploy's state by run: where its latest attempt broke, or
 * `DEPLOY_LIVE` once an attempt passed. A run older than the newest live run
 * blocks nothing, so it is asked once.
 */
async function readDeployStages($: EngineInterface, home: string, endings: readonly Ending[], now: number): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  let newestLive = Number.NEGATIVE_INFINITY
  for (const e of endings) if (lastEnd(e.text)?.isLive) newestLive = Math.max(newestLive, e.mtimeMs)
  for (const e of endings) {
    const run = deployRunOf(lastEnd(e.text)?.outcome ?? '')
    if (run === '') continue
    const known = deployCache.get(run)
    const reask = known !== undefined && known.state !== DEPLOY_LIVE && e.mtimeMs > newestLive && now - known.askedMs >= DEPLOY_REASK_MS
    if (known === undefined || reask) {
      const r = await $.process
        .run(['gh', 'run', 'view', run, '--json', 'status,conclusion,jobs', '--jq', '(.status + "\\t" + .conclusion), (.jobs[] | select(.conclusion == "failure") | .name)'], {
          cwd: `${home}/${REPO}`,
          timeoutMs: 10000,
        })
        .catch(() => ({ exitCode: 1, stdout: '' }))
      if (r.exitCode === 0) {
        const [head = '', ...failed] = r.stdout.split('\n').filter(l => l.trim() !== '')
        const [status = '', conclusion = ''] = head.split('\t')
        // An attempt in progress keeps the last finished state until it ends.
        const state = status === 'completed' ? deployStateOf(conclusion, failed) : (known?.state ?? '')
        deployCache.set(run, { state, askedMs: now })
      }
    }
    const state = deployCache.get(run)?.state
    if (state !== undefined) out[run] = state
  }
  return out
}

// Brief texts by blob id; a blob's text never changes. Pruned each poll to
// the blobs the listing still names.
let blobCache = new Map<string, string>()

/** The text of `sha` in the checkout at `cwd`, read once per blob; null when it could not be read. */
async function blobText($: EngineInterface, cwd: string, sha: string, next: Map<string, string>): Promise<string | null> {
  const known = blobCache.get(sha) ?? next.get(sha)
  if (known !== undefined) {
    next.set(sha, known)
    return known
  }
  // A failed read is not kept, so the next poll asks for the blob again.
  const blob = await $.process.run(['git', 'cat-file', 'blob', sha], { cwd, timeoutMs: 5000 })
  if (blob.exitCode !== 0) return null
  next.set(sha, blob.stdout)
  return blob.stdout
}

// Each running brief's cycle count and `Epic:` value by its key, kept after
// the archive moves the brief off docs/briefs/, so the bar keeps its length
// and the epics card its sitting to the end.
const cyclesCache = new Map<string, number>()
const epicCache = new Map<string, string>()

// Each plan's epic titles by its blob id; a blob's text never changes. Pruned
// each poll to the plan blobs the listing still names.
let planCache = new Map<string, Record<string, string>>()

/** What `readBriefs` reads from `origin/main`. */
type BriefsRead = {
  onDeck: Deck[]
  /** Each brief's cycle count by its key; a brief whose blobs could not be read is absent. */
  cycles: Record<string, number>
  afters: Record<string, string[]>
  splits: Record<string, number>
  /** Each brief's `Epic:` value by its key, a running brief's kept after its archive. */
  epics: Record<string, string>
  recordedEpics: Record<string, string>
  planTitles: Record<string, Record<string, string>>
}

/**
 * The briefs on deck, each brief's cycle count and epic, the epics
 * `sittings.json` records, and each plan's epic titles, from one
 * `git ls-tree -r origin/main docs/briefs/ docs/plans/` in the checkout.
 */
async function readBriefs($: EngineInterface, home: string, raw: RawStatus): Promise<BriefsRead> {
  const cwd = `${home}/${REPO}`
  const cycles: Record<string, number> = {}
  const epics: Record<string, string> = {}
  const keys = raw.running.map(r => briefKey(r.brief))
  const ls = await $.process.run(['git', 'ls-tree', '-r', 'origin/main', 'docs/briefs/', 'docs/plans/'], { cwd, timeoutMs: 5000 })
  if (ls.exitCode !== 0) {
    for (const k of keys) {
      if (cyclesCache.has(k)) cycles[k] = cyclesCache.get(k) ?? 0
      if (epicCache.has(k)) epics[k] = epicCache.get(k) ?? ''
    }
    return { onDeck: [], cycles, afters: {}, splits: {}, epics, recordedEpics: {}, planTitles: {} }
  }
  const next = new Map<string, string>()
  const briefs: { path: string; sha: string; text: string | null }[] = []
  for (const f of briefFiles(ls.stdout)) briefs.push({ ...f, text: await blobText($, cwd, f.sha, next) })
  for (const f of briefs) {
    const epic = f.text === null ? '' : briefHeader(f.text).epic
    if (epic !== '') epics[briefKey(f.path)] = epic
  }
  // Every brief's cycles, and each running one's from the cache once its brief has left.
  for (const k of new Set([...briefs.map(f => briefKey(f.path)), ...keys])) {
    const isRunning = keys.includes(k)
    const shas = cycleBlobs(ls.stdout, k)
    if (shas.length > 0) {
      const texts = await Promise.all(shas.map(sha => blobText($, cwd, sha, next)))
      const count = texts.some(t => t === null) ? null : cycleCount(texts.join('\n'))
      if (count !== null) cycles[k] = count
      // A failed blob read keeps no entry, so the next poll reads the blob again.
      if (isRunning && count !== null) cyclesCache.set(k, count)
      else if (isRunning) cyclesCache.delete(k)
    } else if (isRunning && cyclesCache.has(k)) cycles[k] = cyclesCache.get(k) ?? 0
    if (!isRunning) continue
    if (Object.hasOwn(epics, k)) epicCache.set(k, epics[k] ?? '')
    else if (epicCache.has(k)) epics[k] = epicCache.get(k) ?? ''
  }
  for (const cache of [cyclesCache, epicCache]) for (const k of [...cache.keys()]) if (!keys.includes(k)) cache.delete(k)
  const planTitles: Record<string, Record<string, string>> = {}
  const plans = new Map<string, Record<string, string>>()
  for (const p of planBlobs(ls.stdout)) {
    let titles = planCache.get(p.sha) ?? plans.get(p.sha)
    if (titles === undefined) {
      const text = await blobText($, cwd, p.sha, next)
      // A failed blob read keeps no entry, so the next poll reads the blob again.
      if (text === null) continue
      titles = planHeadings(text)
    }
    plans.set(p.sha, titles)
    planTitles[p.plan] = titles
  }
  planCache = plans
  const registry = sittingsBlob(ls.stdout)
  const sittingsJson = (registry === null ? null : await blobText($, cwd, registry, next)) ?? ''
  blobCache = next
  const read = briefs.map(f => ({ ...f, text: f.text ?? '' }))
  const afters = Object.fromEntries(read.map(f => [briefKey(f.path), afterSittings(briefHeader(f.text).after)]))
  return {
    onDeck: onDeckOf(read, [...raw.running, ...raw.queued].map(r => r.brief)),
    cycles,
    afters,
    splits: splitCounts(read, sittingsJson),
    epics,
    recordedEpics: recordedEpics(sittingsJson),
    planTitles,
  }
}

// Finished entries already seen; null until the first read, which only
// seeds it, so loading the mod raises no toast for old runs.
let seen: Set<number> | null = null

async function poll($: EngineInterface): Promise<void> {
  const home = await $.env.get('HOME')
  if (!home) return
  const dir = `${home}/${LOG_DIR}`
  const text = await $.fs.read(`${dir}/status.json`).catch(() => undefined)
  const status = text === undefined ? null : parseStatus(text)
  const loop = await readLoop($, home).catch(() => null)
  const raw = status ?? { dispatcher: null, running: [], queued: [], finished: [] }
  const { onDeck, cycles, afters, splits, epics, recordedEpics, planTitles } = await readBriefs($, home, raw).catch(
    (): BriefsRead => ({ onDeck: [], cycles: {}, afters: {}, splits: {}, epics: {}, recordedEpics: {}, planTitles: {} }),
  )
  if (status === null && loop === null && onDeck.length === 0) {
    await update($, board, () => null)
    return
  }

  const progress: Record<string, string> = {}
  const tools: Record<string, string> = {}
  for (const run of raw.running) {
    progress[run.brief] = await $.fs.read(`${dir}/${baseName(run.brief)}.progress`).catch(() => '')
    tools[run.brief] = await readLastTool($, `${dir}/${baseName(run.brief)}.log`)
  }
  const pids = [raw.dispatcher, ...raw.running.map(r => r.pid)].filter((n): n is number => n !== null)
  const alive = await alivePids($, pids).catch(() => new Set<number>())
  const { recent, endings, mtimes } = await readEndings($, dir, raw, Object.keys(afters)).catch(() => ({
    recent: [] as Ended[],
    endings: [] as Ending[],
    mtimes: new Map<string, number>(),
  }))
  const now = await $.clock.now()
  const [handoffs, launches, deployStages, offset, read] = await Promise.all([
    readHandoffs($, home, endings).catch(() => ({})),
    readLaunchCounts($, dir, endings, mtimes).catch(() => ({})),
    readDeployStages($, home, endings, now).catch(() => ({})),
    $.process.run(['date', '+%z'], { timeoutMs: 5000 }).catch(() => ({ exitCode: 1, stdout: '' })),
    readSpend($, home, now).catch(() => null),
  ])
  const utcOffset = offset.exitCode === 0 ? offset.stdout.trim() : ''
  const next = buildBoard(raw, progress, alive, now, {
    loop,
    recent,
    onDeck,
    tools,
    cycles,
    utcOffset,
    spend: read === null ? null : { ...read.spend, days: daySums(read.spends, now, utcOffset) },
    plans: read?.plans ?? null,
    afters,
    endings,
    handoffs,
    deployStages,
    launches,
    splits,
    epics,
    recordedEpics,
    planTitles,
  })

  await update($, board, () => next)

  if (seen === null) {
    seen = new Set(next.finished.map(d => d.entry))
    return
  }
  for (const done of next.finished) {
    if (seen.has(done.entry)) continue
    seen.add(done.entry)
    $.ui.toast(finishedToast(done))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // The summary rides on the prompt hint line; clear any status pinned by
    // an earlier version, which the engine marks with a warning sign.
    $.ui.status(undefined)
    const stored = parseFolds(await $.store.get(FOLDS_KEY).catch(() => undefined))
    await update($, folds, () => stored)
    // The poll starts before the command registers: a refused command name
    // costs only the slash command, and the hint line keeps updating.
    void poll($).catch(() => undefined)
    $.clock.every(POLL_MS, () => poll($).catch(() => undefined))
    await $.command
      .register({ name: COMMAND, description: 'Open or close the autopilot run board' })
      .catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      return { text: 'Run board closed.' }
    }
    await poll($).catch(() => undefined)
    await $.ui.open({ id: PANE, title: TITLE, backgroundColor: F.base })
    return { text: `Run board opened. /${COMMAND} again closes it.` }
  })

  // The one-line summary, drawn dim at the end of the hint line under the
  // prompt. Reading the board here redraws the line on every poll.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const b = await read($, board)
    const line = b === null ? undefined : statusLine(b)
    if (line === undefined) return next(e)
    const tail = e.props.tail === undefined ? `  ${line}` : `${e.props.tail}  ${line}`
    return next({ ...e, props: { ...e.props, tail } })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const b: Board | null = await read($, board)
    const setByHand: Folds = await read($, folds)

    // A lane's name as a pill on the raised surface.
    const pill = (name: string) => (
      <Text backgroundColor={F.surface0} color={LANE_COLOR[name] ?? F.lavender}>
        {` ${name} `}
      </Text>
    )
    const heading = (name: string) => (
      <Text bold color={F.lavender}>
        {name}
      </Text>
    )

    // The bar and its labels: one braille block per phase, green when done,
    // peach and tapering in flight, a grey baseline to come; `⋮` where
    // session 2 takes over and a `⡇` cap at the end.
    const phaseRows = (r: Run, width: number) => {
      const cut = r.phases.findIndex(p => p.label === 'simplify')
      const last = r.phases.length - 1
      const color = (p: Phase): string => (p.state === 'done' ? F.green : p.state === 'live' ? F.peach : F.surface2)
      const labelColor = (p: Phase): string => (p.state === 'done' ? F.overlay2 : p.state === 'live' ? F.peach : F.surface2)
      return [
        <Text>
          {r.phases.map((p, i) => (
            <Text>
              {i === cut && <Text color={F.overlay0}>⋮ </Text>}
              <Text color={color(p)}>{phaseGlyphs(p.state, width - 1)}</Text>
              {i === last ? <Text color={F.overlay0}>⡇</Text> : ' '}
            </Text>
          ))}
        </Text>,
        <Text>
          {r.phases.map((p, i) => (
            <Text>
              {i === cut && '  '}
              <Text color={labelColor(p)} bold={p.state === 'live'}>
                {phaseName(p, width - 1).padEnd(width)}
              </Text>
            </Text>
          ))}
        </Text>,
      ]
    }

    if (b === null) {
      return (
        <Box flexDirection="column">
          <Text color={F.overlay2}>no autopilot status yet</Text>
          <Text color={F.overlay0}>looking for ~/{LOG_DIR}/status.json</Text>
        </Box>
      )
    }

    // The header's three figures as dot numerals, each in the colour its
    // section uses below; a zero fades to the to-come grey.
    const tiles: { value: string; label: string; color: string; isZero: boolean }[] = [
      { value: String(b.running.length), label: 'running', color: F.peach, isZero: b.running.length === 0 },
      { value: String(b.queued.length), label: 'queued', color: F.blue, isZero: b.queued.length === 0 },
      { value: String(b.onDeck.length), label: 'on deck', color: F.mauve, isZero: b.onDeck.length === 0 },
    ]
    const queueRows = queueTree(b.running, b.queued, b.blocked)
    // A rule across the card, inside its border and padding.
    const rule = (color: string) => <Text color={color}>{'─'.repeat(Math.max(1, e.props.bodyColumns - 4))}</Text>
    const totals = recentTotals(b.recent, b.checkedAt)
    const widest = (xs: (string | null)[]): number => Math.max(0, ...xs.map(x => x?.length ?? 0))
    const timeCells = Math.max(RECENT_TIME_CELLS, widest([...b.recent.map(d => (d.minutes === null ? null : hoursMinutes(d.minutes))), totals.minutes === null ? null : hoursMinutes(totals.minutes)]))
    const costCells = Math.max(RECENT_COST_CELLS, 1 + widest([...b.recent.map(d => (d.usd === null ? null : dollars(d.usd))), totals.usd === null ? null : dollars(totals.usd)]))
    // A recent row's plan cost after its cost, `+$6`, or `+—` when the ledger
    // holds none; no cell while the ledger could not be read.
    const planText = (d: Ended): string | null => (d.plan === 'unread' ? null : d.plan === 'none' ? '+—' : `+${dollars(d.plan)}`)
    // The totals row writes ` + $46 plan` where a row has its plan and age
    // cells, so the plan column widens until the totals' text fits beside the
    // age column, and the times and costs above stay in one column.
    const planWidth = widest(b.recent.map(planText))
    const planTotal = b.recent.reduce((n, d) => n + (typeof d.plan === 'number' ? d.plan : 0), 0)
    const planTotalText = ` + ${dollars(planTotal)} plan`
    const planCells = planWidth === 0 ? 0 : Math.max(1 + planWidth, planTotalText.length - RECENT_AGE_CELLS)
    // The columns a recent row's figures take, and the room left for its slug
    // beside them, after the card's border and padding, the gap, `● `, the
    // sitting and its space.
    const figureCells = timeCells + 2 + RECENT_SPLIT_CELLS + costCells + planCells + RECENT_AGE_CELLS
    const slugRoom = (d: Ended): number => e.props.bodyColumns - 4 - 2 - figureCells - 2 - d.sitting.length - 1
    const fit = (text: string, room: number): string => (text.length <= room ? text : room <= 1 ? '' : `${text.slice(0, room - 1)}…`)
    // A run's time as savor lavender, cycles green and ship blue, or the grey
    // baseline when its progress file holds no times.
    const splitCells = (s: PhaseSplit | null) =>
      s === null ? (
        <Text color={F.surface1}>{phaseGlyphs('todo', RECENT_SPLIT_CELLS)}</Text>
      ) : (
        <Text>
          {s.savor > 0 && <Text color={F.lavender}>{phaseGlyphs('done', s.savor)}</Text>}
          {s.cycles > 0 && <Text color={F.green}>{phaseGlyphs('done', s.cycles)}</Text>}
          {s.ship > 0 && <Text color={F.blue}>{phaseGlyphs('done', s.ship)}</Text>}
        </Text>
      )
    // A figure right-aligned in a column `width` cells wide: the pad, then the figure in its own span.
    const cell = (value: string, width: number, color: string, bold = false, dim = false) => (
      <Text>
        {' '.repeat(Math.max(0, width - value.length))}
        <Text bold={bold} color={color} dimColor={dim}>
          {value}
        </Text>
      </Text>
    )

    // On deck as a tree, and the box at the right edge of each queue and deck
    // row: a square per cycle in a slot as wide as the most cycles, then the
    // projected cost right-aligned to the widest cost. One width serves both
    // cards, so every cost ends in one column whatever a row's indent.
    const deckRows = deckTree(b.onDeck, liveDepths(b, queueRows), new Set(b.queued.map(q => q.sitting)))
    const boxed = [...queueRows.map(r => r.sitting), ...deckRows.filter(r => r.kind !== 'group').map(r => r.sitting)]
    const projected = (c: BriefCost): string => (c.usd === null ? '~$?' : `~${dollars(c.usd)}`)
    const slotCells = Math.max(1, ...boxed.map(s => b.costs[s]?.cycles ?? 0))
    const projectedCells = Math.max(0, ...boxed.map(s => (b.costs[s] === undefined ? 0 : projected(b.costs[s]).length)))
    // `color` paints the squares; a running row's `lit` squares, the cycles done
    // or under way, are peach and the rest grey. A held row's cost is dim yellow.
    const costBox = (sitting: string, color: string, isHeld: boolean, lit: number | null = null) => {
      const c = b.costs[sitting]
      const n = c?.cycles ?? null
      const squares =
        n === null ? null : n === 0 ? (
          <Text color={F.surface2}>·</Text>
        ) : lit === null ? (
          <Text color={color}>{'■'.repeat(n)}</Text>
        ) : (
          [
            lit > 0 && <Text color={F.peach}>{'■'.repeat(Math.min(lit, n))}</Text>,
            lit < n && <Text color={F.surface2}>{'■'.repeat(n - Math.max(0, lit))}</Text>,
          ]
        )
      return (
        <Box flexShrink={0}>
          <Text>
            {squares}
            {' '.repeat(slotCells - (n === null ? 0 : Math.max(1, n)) + 1)}
            {c === undefined ? ' '.repeat(projectedCells) : cell(projected(c), projectedCells, isHeld ? F.yellow : F.peach, false, isHeld)}
          </Text>
        </Box>
      )
    }

    // The epics card's columns: the label padded to the widest label, the
    // cells to the widest epic, cut with `…` past the room the label, the
    // count and the widest state leave, then `shipped/total` and the state.
    const stateText = (x: EpicRow): string =>
      x.next === null
        ? ''
        : { running: `● ${x.next.sitting} running`, blocked: `blocked at ${x.next.sitting}`, held: '‖ held', queued: 'queued', deck: 'on deck' }[x.next.kind]
    const countText = (x: EpicRow): string => `${x.shipped}/${x.cells.length}`
    const epicLabelCells = widest(b.epics.map(e => e.label))
    const epicCountCells = widest(b.epics.map(countText))
    const epicCellRoom = Math.max(2, e.props.bodyColumns - 4 - epicLabelCells - 2 - 2 - epicCountCells - 2 - widest(b.epics.map(stateText)))
    const epicCells = Math.min(epicCellRoom, Math.max(0, ...b.epics.map(x => x.cells.length)))
    const epicRow = (x: EpicRow) => {
      const shown = x.cells.length > epicCells ? x.cells.slice(0, epicCells - 1) : x.cells
      const runs: { cell: EpicCell; count: number }[] = []
      for (const c of shown) {
        const last = runs[runs.length - 1]
        if (last !== undefined && last.cell === c) last.count++
        else runs.push({ cell: c, count: 1 })
      }
      const next = x.next
      return (
        <Text wrap="truncate-end">
          <Text color={F.text}>{x.label.padEnd(epicLabelCells)}</Text>
          {'  '}
          {runs.map(r => (
            <Text color={EPIC_CELL[r.cell].color}>{EPIC_CELL[r.cell].glyph.repeat(r.count)}</Text>
          ))}
          {shown.length < x.cells.length && <Text color={F.overlay0}>…</Text>}
          {' '.repeat(Math.max(0, epicCells - x.cells.length))}
          {'  '}
          <Text color={F.overlay2}>{countText(x).padStart(epicCountCells)}</Text>
          {'  '}
          {next?.kind === 'running' && (
            <Text color={F.peach}>
              ● <Text bold>{next.sitting}</Text> running
            </Text>
          )}
          {next?.kind === 'blocked' && (
            <Text color={F.red}>
              blocked at <Text bold>{next.sitting}</Text>
            </Text>
          )}
          {next?.kind === 'held' && <Text color={F.yellow}>‖ held</Text>}
          {next?.kind === 'queued' && <Text color={F.blue}>queued</Text>}
          {next?.kind === 'deck' && <Text color={F.mauve}>on deck</Text>}
        </Text>
      )
    }

    // A foldable card's header: a Button on the card's hotkey that flips its
    // fold and keeps the choice, with the one-line summary while folded.
    const hasBlocked = b.blocked.length > 0
    const folded = (card: FoldCard): boolean => isFolded(card, setByHand, hasBlocked)
    const cardHead = (card: FoldCard, label: string, color: string) => {
      const isClosed = folded(card)
      const flip = async () => {
        const next = { ...setByHand, [card]: !isClosed }
        await update($, folds, () => next)
        await $.store.set(FOLDS_KEY, next)
      }
      return (
        <Button key={`fold-${card}`} hotkey={FOLD_KEY[card]} plain onPress={flip}>
          <Text bold color={color}>
            {isClosed ? '▸ ' : '▾ '}
            {label}
          </Text>
          {isClosed && <Text color={F.overlay2}>{`  ${foldSummary(card, b)}`}</Text>}
        </Button>
      )
    }

    // The timeline's track, and one lane drawn as runs of cells that share a
    // tone: a name on its bar is mantle on the bar's colour, every other cell
    // its tone's colour.
    const labelWidth = labelCells(b.timeline.slots)
    const track = Math.max(1, e.props.bodyColumns - 4 - labelWidth)
    const laneRow = (name: string, cells: readonly TimelineCell[]) => {
      const runs: { text: string; tone: CellTone; isLabel: boolean }[] = []
      for (const c of cells) {
        const last = runs[runs.length - 1]
        if (last !== undefined && last.tone === c.tone && last.isLabel === c.isLabel) last.text += c.ch
        else runs.push({ text: c.ch, tone: c.tone, isLabel: c.isLabel })
      }
      return (
        <Text wrap="truncate-end">
          <Text color={F.overlay2}>{name.padEnd(labelWidth).slice(0, labelWidth)}</Text>
          {runs.map(r => (
            <Text color={r.isLabel ? F.mantle : TONE_COLOR[r.tone]} backgroundColor={r.isLabel ? TONE_COLOR[r.tone] : undefined}>
              {r.text}
            </Text>
          ))}
        </Text>
      )
    }
    const timelineRows = () => {
      const t = b.timeline
      const now = nowCell(t, track)
      return [
        <Text color={F.overlay0}>{`${' '.repeat(labelWidth)}${axisCells(t, track)}`}</Text>,
        ...t.slots.map(l => laneRow(`slot ${l.slot}`, laneCells(t, l.bars, track, true))),
        laneRow('you', laneCells(t, t.you === null ? [] : [t.you], track, false)),
        laneRow('held', heldCells(t, track)),
        <Text color={F.peach}>{`${' '.repeat(labelWidth + Math.max(0, Math.min(now - 1, track - 3)))}now`}</Text>,
      ]
    }

    // A block's pipeline strip: green done, red where it broke, grey to come.
    const stripCell = (c: StripCell) => (
      <Text
        backgroundColor={c.state === 'done' ? F.green : c.state === 'broke' ? F.red : F.surface0}
        color={c.state === 'todo' || c.state === 'skip' ? F.overlay0 : F.mantle}
        bold={c.state === 'broke'}
      >
        {` ${c.stage}${c.state === 'broke' ? ' ✗' : c.state === 'skip' ? ' –' : ''} `}
      </Text>
    )

    // Spend over the last 14 local days from token-ledger: a bar per day,
    // today's peach, a day with spend grey and an empty day faint, then what
    // today and the 14 days came to. The figures keep their width; the bars
    // give way first.
    const sparkline = (days: readonly number[]) => (
      <Box marginTop={1} columnGap={1}>
        <Box flexShrink={1} minWidth={0}>
          <Text wrap="truncate-end" color={F.overlay2}>
            {'spend '}
            {[...sparkGlyphs(days)].map((bar, i) => (
              <Text color={i === days.length - 1 ? F.peach : (days[i] ?? 0) > 0 ? F.overlay1 : F.surface2}>{bar}</Text>
            ))}
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Text color={F.overlay2}>
            <Text color={F.peach}>{shortDollars(days[days.length - 1] ?? 0)}</Text> today ·{' '}
            <Text color={F.subtext0}>{shortDollars(days.reduce((a, d) => a + d, 0))}</Text> 14d
          </Text>
        </Box>
      </Box>
    )
    const tileRow = (row: typeof tiles) => (
      <Box marginTop={1} justifyContent="space-between" columnGap={2}>
        {row.map(t => {
          const face = tileFace(t.value, t.label)
          const tone = t.isZero ? F.surface2 : t.color
          return (
            <Box flexDirection="column">
              <Text color={tone}>{face.top}</Text>
              <Text color={tone}>{face.bottom}</Text>
              <Text color={F.surface1}>{face.rule}</Text>
              <Text size="caption" color={t.isZero ? F.surface2 : F.overlay2}>
                {face.label}
              </Text>
            </Box>
          )
        })}
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box {...CARD} marginTop={0}>
          <Box justifyContent="space-between" columnGap={2}>
            {heading('autopilot')}
            <Text color={b.isDispatcherLive ? F.green : F.yellow}>
              ● {b.isDispatcherLive ? 'live' : 'no dispatcher'}
              <Text color={F.overlay0}> │ </Text>
              <Text color={F.overlay2}>{b.clock}</Text>
            </Text>
          </Box>
          {tileRow(tiles)}
          {b.spend !== null && sparkline(b.spend.days)}
        </Box>

        {hasBlocked && (
          <Box {...CARD} borderColor={F.red}>
            {cardHead('blocked', 'blocked', F.red)}
            {!folded('blocked') &&
              b.blocked.map((k, i) => {
                const chain = chainLine(k)
                const history = historyTag(k)
                return (
                <Box flexDirection="column" marginTop={1}>
                  {i > 0 && rule(F.surface1)}
                  <Text wrap="wrap">
                    <Text backgroundColor={KIND_COLOR[k.kind]} color={F.mantle} bold>
                      {` ${KIND_TAG[k.kind]} `}
                    </Text>
                    <Text bold color={F.text}>{`  ${k.headline}`}</Text>
                  </Text>
                  {(k.why !== '' || history !== '') && (
                    // The plan cost and the launch dim after the cost, a space between when both show.
                    <Text color={F.subtext0} wrap="wrap">
                      {k.why}
                      <Text color={F.overlay0}>{k.why !== '' && history !== '' ? ` ${history}` : history}</Text>
                    </Text>
                  )}
                  {k.strip.length > 0 && (
                    <Text wrap="truncate-end">
                      <Text color={F.overlay2}>{`${k.sitting} ${k.slug}  `}</Text>
                      {k.strip.map(c => (
                        <Text>
                          {stripCell(c)}
                          {' '}
                        </Text>
                      ))}
                    </Text>
                  )}
                  {chain !== null && (
                    // The chain once, by its first holds; the queue card draws the tree.
                    <Text wrap="truncate-end" color={F.overlay2}>
                      {chain.count}
                      <Text color={F.yellow}>{chain.chain}</Text>
                      {chain.more}
                    </Text>
                  )}
                  <Text wrap="wrap">
                    <Text bold color={F.red}>
                      next{'  '}
                    </Text>
                    <Text color={F.text}>{k.next}</Text>
                  </Text>
                </Box>
                )
              })}
          </Box>
        )}

        {lanesOf(b).map(({ lane, runs }) => (
          <Box {...CARD}>
            {lane === LOOP_LANE && b.loop !== null && (
              <Box justifyContent="space-between" columnGap={2}>
                <Text wrap="truncate-end">
                  {pill(lane)}
                  <Text color={F.mauve}>{'  '}◐ </Text>
                  <Text bold color={F.text}>loop</Text>
                  <Text color={F.subtext0}> {b.loop.name}</Text>
                  <Text color={F.overlay2}> · {b.loop.stage}</Text>
                </Text>
                <Text color={F.overlay2}>
                  {elapsed(b.loop.startedMs, b.checkedAt)}
                  <Text color={F.overlay0}> │ </Text>
                  <Text color={F.text}>{money(b.loop.cost)}</Text>
                </Text>
              </Box>
            )}
            {runs.length === 0 && (lane !== LOOP_LANE || b.loop === null) && (
              <Text>
                {pill(lane)}
                <Text color={F.overlay0}>{'  '}idle</Text>
              </Text>
            )}
            {runs.map(r => (
              <Box flexDirection="column">
                <Box justifyContent="space-between" columnGap={2}>
                  <Text wrap="truncate-end">
                    {pill(lane)}
                    {'  '}
                    {!r.isAlive && <Text color={F.red}>✗ </Text>}
                    <Text bold color={F.text}>{r.sitting}</Text>
                    <Text color={F.subtext0}> {r.slug}</Text>
                    {isLoopLanding(b, r) && <Text color={F.overlay2}> (loop landing)</Text>}
                  </Text>
                  <Text color={F.overlay2}>
                    {elapsed(r.startedMs, b.checkedAt)}
                    <Text color={F.overlay0}> │ </Text>
                    <Text color={F.text}>{money(r.cost)}</Text>
                  </Text>
                </Box>
                {r.isAlive ? (
                  <Box flexDirection="column" marginTop={1}>
                    {phaseRows(r, segmentWidth(e.props.bodyColumns, r.phases.length))}
                    <Text wrap="truncate-end">
                      <Text color={F.peach}>{phaseLine(r).split(' · ')[0]}</Text>
                      <Text color={F.overlay2}>
                        {phaseLine(r).includes(' · ') ? ` · ${phaseLine(r).split(' · ').slice(1).join(' · ')}` : ''}
                      </Text>
                    </Text>
                  </Box>
                ) : (
                  <Text color={F.red}>launcher gone, no finished line</Text>
                )}
              </Box>
            ))}
          </Box>
        ))}

        {b.epics.length > 0 && (
          <Box {...CARD}>
            {cardHead('epics', 'epics', F.lavender)}
            {!folded('epics') && b.epics.map(epicRow)}
          </Box>
        )}

        {(b.queued.length > 0 || b.blocked.some(k => k.holds.length > 0)) && (
          <Box {...CARD}>
            {cardHead('queued', 'queued', F.lavender)}
            {!folded('queued') &&
              queueRows.map((r, i) => {
                const isHeld = r.kind === 'held' || r.kind === 'block' || r.kind === 'hold'
                const lit = r.kind === 'run' ? (b.running.find(x => x.sitting === r.sitting)?.phases.filter(p => p.label.startsWith('cycle ') && p.state !== 'todo').length ?? 0) : null
                return (
                  // A joint means the entry needs its parent shipped; a yellow `‖` that a block holds it.
                  // The note sits between the name and the box, and gives way first.
                  <Box columnGap={2} marginTop={r.kind === 'block' && i > 0 ? 1 : 0}>
                    <Box flexShrink={1} minWidth={0}>
                      <Text wrap="truncate-end">
                        <Text color={r.kind === 'hold' ? F.yellow : F.overlay0}>{r.rails}</Text>
                        <Text color={r.kind === 'hold' ? F.yellow : r.kind === 'after' ? F.blue : F.surface2}>{r.joint}</Text>
                        <Text color={r.kind === 'run' ? F.peach : r.kind === 'block' || r.kind === 'hold' ? F.yellow : F.blue}>
                          {r.kind === 'run' ? '●' : r.kind === 'block' || r.kind === 'hold' ? '‖' : '○'}{' '}
                        </Text>
                        <Text bold color={r.kind === 'block' ? F.yellow : F.text}>{r.sitting}</Text>
                        {r.slug !== '' && <Text color={r.kind === 'block' ? F.yellow : F.subtext0}> {r.slug}</Text>}
                        {(b.splits[r.sitting] ?? 0) > 0 && <Text color={F.overlay0}>{` split ×${b.splits[r.sitting] ?? 0}`}</Text>}
                      </Text>
                    </Box>
                    <Box flexGrow={1} flexShrink={NOTE_SHRINK} minWidth={0} justifyContent="flex-end">
                      {r.kind === 'run' ? (
                        <Text wrap="truncate-end">
                          <Text color={LANE_COLOR[r.lane] ?? F.surface2}>{r.lane}</Text>
                          <Text color={F.overlay2}> · running</Text>
                        </Text>
                      ) : (
                        <Text wrap="truncate-end" color={r.kind === 'held' || r.kind === 'block' ? F.yellow : F.overlay2}>
                          {r.note}
                        </Text>
                      )}
                    </Box>
                    {costBox(r.sitting, isHeld ? F.yellow : F.blue, isHeld, lit)}
                  </Box>
                )
              })}
          </Box>
        )}

        {b.onDeck.length > 0 && (
          <Box {...CARD}>
            {cardHead('deck', 'on deck', F.lavender)}
            {!folded('deck') &&
              deckRows.map(r =>
                r.kind === 'group' ? (
                  <Text>
                    <Text bold color={DECK_COLOR[r.mode]}>{r.slug}</Text>
                    <Text color={F.overlay0}> {r.note}</Text>
                  </Text>
                ) : (
                  // A solid joint waits on the brief above it; a dashed one hangs under its group.
                  <Box columnGap={2}>
                    <Box flexShrink={1} minWidth={0}>
                      <Text wrap="truncate-end">
                        <Text color={F.overlay0}>{r.rails}</Text>
                        <Text color={r.kind === 'after' ? DECK_COLOR[r.mode] : F.surface2}>{r.joint}</Text>
                        <Text color={DECK_COLOR[r.mode]}>◇ </Text>
                        <Text bold color={F.text}>{r.sitting}</Text>
                        <Text color={F.subtext0}> {r.slug}</Text>
                      </Text>
                    </Box>
                    <Box flexGrow={1} flexShrink={NOTE_SHRINK} minWidth={0} justifyContent="flex-end">
                      <Text wrap="truncate-end" color={F.overlay2}>
                        {r.wait !== '' && (
                          // The nearest wait, its sitting blue when it is queued.
                          <Text>
                            after <Text color={r.isWaitQueued ? F.blue : F.overlay2}>{r.wait}</Text>
                          </Text>
                        )}
                        {r.wait !== '' && r.note !== '' ? ' · ' : ''}
                        {r.note}
                      </Text>
                    </Box>
                    {costBox(r.sitting, DECK_COLOR[r.mode], false)}
                  </Box>
                ),
              )}
          </Box>
        )}

        <Box {...CARD}>
          {cardHead('timeline', 'timeline', F.lavender)}
          {!folded('timeline') && <Box flexDirection="column">{timelineRows()}</Box>}
        </Box>

        {b.recent.length > 0 && (
          <Box {...CARD}>
            <Box justifyContent="space-between" columnGap={2}>
              {cardHead('recent', 'recent', F.lavender)}
              {!folded('recent') && (
                // The phase split's legend.
                <Text color={F.overlay1}>
                  <Text color={F.lavender}>▪</Text> savor <Text color={F.green}>▪</Text> cycles <Text color={F.blue}>▪</Text> ship
                </Text>
              )}
            </Box>
            {!folded('recent') && b.recent.map(d => {
              // One row per run: outcome, sitting, then time, the phase split,
              // the cost, the plan cost and the age. A run over twice the
              // median draws its time in peach, and a plan cost past the
              // build's draws bright.
              const isSlow = d.minutes !== null && totals.slowOver !== null && d.minutes > totals.slowOver
              const plan = planText(d)
              const planColor = d.plan === 'none' ? F.surface2 : typeof d.plan === 'number' && d.usd !== null && d.plan > d.usd ? F.text : F.overlay1
              return (
                <Box columnGap={2}>
                  {/* The slug fits the room the figures leave, so the figures keep one line and one column. */}
                  <Box flexGrow={1} flexShrink={1} minWidth={0}>
                    <Text wrap="truncate-end">
                      <Text color={F.green}>● </Text>
                      <Text bold color={F.text}>{d.sitting}</Text>
                      <Text color={F.subtext0}> {fit(d.slug, slugRoom(d))}</Text>
                    </Text>
                  </Box>
                  <Box flexShrink={0}>
                    <Text wrap="truncate-end">
                      {cell(d.minutes === null ? '—' : hoursMinutes(d.minutes), timeCells, isSlow ? F.peach : F.overlay2)}
                      {'  '}
                      {splitCells(d.split)}
                      {cell(d.usd === null ? '—' : dollars(d.usd), costCells, F.text)}
                      {planCells > 0 && (
                        <Text>
                          {' '}
                          <Text color={planColor}>{plan ?? ''}</Text>
                          {' '.repeat(Math.max(0, planCells - 1 - (plan ?? '').length))}
                        </Text>
                      )}
                      {cell(agoShort(d.endedMs, b.checkedAt), RECENT_AGE_CELLS, F.overlay0)}
                    </Text>
                  </Box>
                </Box>
              )
            })}
            {!folded('recent') && (
              // The totals under a rule, each figure under its column; the
              // split cells stay blank so the figures line up, and the plan
              // total follows the cost.
              <Box flexDirection="column">
                {rule(F.surface0)}
                <Box columnGap={2}>
                  <Box flexGrow={1} flexShrink={1} minWidth={0}>
                    <Text wrap="truncate-end" color={F.overlay2}>
                      {totals.words}
                    </Text>
                  </Box>
                  <Box flexShrink={0}>
                    <Text wrap="truncate-end">
                      {cell(totals.minutes === null ? '' : hoursMinutes(totals.minutes), timeCells, F.overlay2)}
                      {' '.repeat(2 + RECENT_SPLIT_CELLS)}
                      {cell(totals.usd === null ? '' : dollars(totals.usd), costCells, F.text, true)}
                      {planCells > 0 ? (
                        <Text color={F.overlay1}>{planTotalText.padEnd(planCells + RECENT_AGE_CELLS)}</Text>
                      ) : (
                        ' '.repeat(planCells + RECENT_AGE_CELLS)
                      )}
                    </Text>
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        )}
      </Box>
    )
  })
}
