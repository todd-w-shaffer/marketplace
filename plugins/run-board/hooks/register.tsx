import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BlockKind, Board, BriefCost, DeckMode, Ended, EpicCell, EpicRow, EpicState, FoldCard, Folds, Loop, Phase, PhaseSplit, Run, StripCell } from '../types'
import {
  FOLD_KEY,
  KIND_TAG,
  DEPLOY_LIVE,
  deployRunOf,
  deployStateOf,
  supersededBy,
  foldSummary,
  isFolded,
  LOG_MARK_LINES,
  LOG_MARKS,
  LOG_TAIL_BYTES,
  LOOP_LANE,
  agoShort,
  baseName,
  buildBoard,
  chainLine,
  buildLoop,
  briefFiles,
  briefKey,
  briefsBlobs,
  briefsRead,
  cycleBlobMap,
  daySums,
  lsTreeBlobs,
  shippedCount,
  deckTree,
  elapsed,
  hoursMinutes,
  historyTag,
  addPlanCosts,
  RECENT_SPLIT_CELLS,
  finishedToast,
  isLoopLanding,
  lastToolOf,
  ledgerChunk,
  liveDepths,
  phaseGlyphs,
  phaseLine,
  phaseName,
  segmentWidth,
  shortDollars,
  sparkGlyphs,
  dollars,
  money,
  newestRunDir,
  queueTree,
  noticeBoard,
  NO_SOURCES,
  RECORD_NEWER,
  recordRead,
  STATUS_NEWER,
  statusRead,
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
import type { BriefsRead, CellTone, Ending, LoopFile, RawStatus, RecordRead, Sources, Spend, TimelineCell } from './board'

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
// Each state an epic's next sitting can be in: its colour, and its words with
// the sitting bold. The epics card draws these words and measures its state
// column from them.
const EPIC_STATE: Record<EpicState['kind'], { color: string; parts: (sitting: string) => { text: string; bold?: boolean }[] }> = {
  running: { color: F.peach, parts: s => [{ text: '● ' }, { text: s, bold: true }, { text: ' running' }] },
  blocked: { color: F.red, parts: s => [{ text: 'blocked at ' }, { text: s, bold: true }] },
  held: { color: F.yellow, parts: () => [{ text: '‖ held' }] },
  queued: { color: F.blue, parts: () => [{ text: 'queued' }] },
  deck: { color: F.mauve, parts: () => [{ text: 'on deck' }] },
}

const PANE = 'run-board'
// A name Claude Code does not reserve: `claude plugin validate` warns on one it does.
const COMMAND = 'board'
const TITLE = 'Autopilot runs'
const POLL_MS = 5000
// scripts/dispatch.sh's default LOG_DIR, under $HOME, where the board finds
// status.json. The main checkout and the archloop's log directory come from
// its `sources`. The main checkout's `origin/main` holds the briefs; every
// worktree's push moves that ref, so the board reads it without a fetch.
const LOG_DIR = 'Library/Logs/shootsfilm-autopilot'

// Change the tag when Board's fields change: it declines what an earlier
// version stored, which outlives a reload.
const board = atom({ plugin: 'run-board', key: 'board' } as const, null, { shape: 'board-16' })

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
async function readLoop($: EngineInterface, dir: string): Promise<Loop | null> {
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

/**
 * A run's phase-fill marks: `grep -noE LOG_MARKS` over its whole stream-json
 * log, the newest LOG_MARK_LINES of them. The marks are a few short fields an
 * event, so the output stays small where the log does not. Undefined when the
 * read fails, so the card draws no fill rather than an empty one.
 */
async function readLogMarks($: EngineInterface, log: string): Promise<string | undefined> {
  const run = await $.process
    .run(['sh', '-c', 'grep -noE "$1" "$2" | tail -n "$3"', 'sh', LOG_MARKS, log, String(LOG_MARK_LINES)], { timeoutMs: 5000 })
    .catch(() => ({ exitCode: 1, stdout: '' }))
  return run.exitCode === 0 ? run.stdout : undefined
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
 * What the spends came to on each of the last 14 local days in the offset
 * `utcOffset` answers, and each sitting's plan cost, from one read of
 * token-ledger; null when it could not be read.
 */
async function readSpend(
  $: EngineInterface,
  home: string,
  now: number,
  utcOffset: Promise<string>,
): Promise<{ days: number[]; plans: Record<string, number> } | null> {
  if (ledgerRead === null) ledgerRead = readLedger($, `${home}/${LEDGER}`).finally(() => (ledgerRead = null))
  const [isRead, offset] = await Promise.all([ledgerRead, utcOffset])
  if (!isRead) return null
  return { days: daySums(ledger.spends, now, offset), plans: { ...ledger.plans } }
}

// Progress files read for RECENT and BLOCKED, by name, kept while their mtime holds.
const progressCache = new Map<string, { mtimeMs: number; text: string }>()
// Records read for RECENT and BLOCKED, by run name, kept while their file's mtime holds.
const recordCache = new Map<string, { mtimeMs: number; read: RecordRead }>()

/**
 * The finished runs RECENT and BLOCKED read: the newest sittings', and each
 * brief's on `origin/main`, since a stop that waits for a person can be older
 * than every recent run. None that runs: a run truncates its file at start.
 * Each run's record is `<sources.log_dir>/<name>.run.json`, else what
 * `--print` prints for it; a run with neither, or with a newer record, is
 * not an ending.
 */
async function readEndings(
  $: EngineInterface,
  dir: string,
  sources: Sources,
  raw: RawStatus,
  onMain: readonly string[],
  archived: readonly string[],
): Promise<{ recent: Ended[]; endings: Ending[] }> {
  const files = (await $.fs.list(dir).catch(() => []))
    .filter(e => e.kind === 'file')
    .map(e => ({ name: e.name, mtimeMs: e.mtimeMs }))
  const recordMtimes = new Map(
    (await $.fs.list(sources.logDir).catch(() => [])).filter(e => e.kind === 'file').map(e => [e.name, e.mtimeMs] as const),
  )
  const running = new Set(raw.running.map(r => `${baseName(r.brief)}.progress`))
  const wanted = new Set(onMain.map(k => `${baseName(k)}.progress`))
  const picked = new Map(recentCandidates(files, raw.running.map(r => r.brief)).map(f => [f.name, f]))
  for (const f of files) if (wanted.has(f.name) && !running.has(f.name)) picked.set(f.name, f)
  const endings: Ending[] = []
  let ownerMs: number | null | undefined
  for (const f of picked.values()) {
    const base = f.name.replace(/\.progress$/, '')
    let hit = progressCache.get(f.name)
    if (hit === undefined || hit.mtimeMs !== f.mtimeMs) {
      hit = { mtimeMs: f.mtimeMs, text: await $.fs.read(`${dir}/${f.name}`).catch(() => '') }
      progressCache.set(f.name, hit)
    }
    let read: RecordRead | null = null
    const recordMs = recordMtimes.get(`${base}.run.json`)
    if (recordMs !== undefined) {
      const known = recordCache.get(base)
      if (known !== undefined && known.mtimeMs === recordMs) read = known.read
      else {
        const text = await $.fs.read(`${sources.logDir}/${base}.run.json`).catch(() => undefined)
        read = text === undefined ? null : recordRead(text)
        if (read !== null) recordCache.set(base, { mtimeMs: recordMs, read })
      }
    }
    if (read === null || read.kind === 'none') {
      ownerMs ??= await mtimeOf($, `${sources.main}/scripts`, 'run-status.mjs')
      read = await printedRecord($, sources.main, dir, base, f.mtimeMs, ownerMs)
    }
    if (read?.kind !== 'record') continue
    endings.push({ base, text: hit.text, mtimeMs: f.mtimeMs, record: read.record })
  }
  return { recent: recentOf(endings, raw.finished, new Set(archived)), endings }
}

/**
 * The handoff of each run that stopped for a person or a split: scripts/autopilot.sh
 * reads `handoff/<name>.md` in the run's worktree, `.claude/worktrees/<name
 * without kickoff-sitting->`. If the launcher moves the handoff, update this.
 */
async function readHandoffs($: EngineInterface, main: string, endings: readonly Ending[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const e of endings) {
    const kind = e.record.end?.kind
    if (kind !== 'decision' && kind !== 'split') continue
    const tree = `${main}/.claude/worktrees/${e.base.replace(/^kickoff-sitting-/, '')}`
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

// The newest deploy.yml run on main that went live, and when it was asked. A
// deploy shipped by hand goes live with no autopilot end, so `gh` is asked.
let liveDeployCache = { run: '', askedMs: Number.NEGATIVE_INFINITY }

/**
 * The newest deploy.yml run on main whose latest attempt passed, every job
 * through production, or the last answer when `gh` fails. If deploy.yml is
 * renamed, update the workflow name here.
 */
async function readLiveDeploy($: EngineInterface, main: string, now: number): Promise<string> {
  if (now - liveDeployCache.askedMs < DEPLOY_REASK_MS) return liveDeployCache.run
  const r = await $.process
    .run(['gh', 'run', 'list', '--workflow', 'deploy.yml', '--branch', 'main', '--status', 'success', '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId // empty'], {
      cwd: main,
      timeoutMs: 10000,
    })
    .catch(() => ({ exitCode: 1, stdout: '' }))
  const run = r.stdout.trim()
  if (r.exitCode === 0 && /^\d*$/.test(run)) liveDeployCache = { run: run || liveDeployCache.run, askedMs: now }
  return liveDeployCache.run
}

/**
 * Each red deploy's state by run, and the newest live deploy run on main. A
 * run's state is where its latest attempt broke, or `DEPLOY_LIVE` once an
 * attempt passed. A run older than the newest live autopilot end, or than
 * the newest live deploy on main, blocks nothing, so it is asked once.
 * Nothing asks for the live deploy while no red run can block.
 */
async function readDeployStages(
  $: EngineInterface,
  main: string,
  endings: readonly Ending[],
  now: number,
): Promise<{ stages: Record<string, string>; live: string }> {
  const out: Record<string, string> = {}
  let newestLive = Number.NEGATIVE_INFINITY
  for (const e of endings) if (e.record.end?.live === true) newestLive = Math.max(newestLive, e.mtimeMs)
  const reds = endings.filter(e => e.mtimeMs > newestLive && e.record.end !== null && deployRunOf(e.record.end) !== '')
  const live = reds.length === 0 ? liveDeployCache.run : await readLiveDeploy($, main, now)
  for (const e of endings) {
    const run = e.record.end === null ? '' : deployRunOf(e.record.end)
    if (run === '') continue
    const known = deployCache.get(run)
    const reask =
      known !== undefined && known.state !== DEPLOY_LIVE && e.mtimeMs > newestLive && !supersededBy(run, live) && now - known.askedMs >= DEPLOY_REASK_MS
    if (known === undefined || reask) {
      const r = await $.process
        .run(['gh', 'run', 'view', run, '--json', 'status,conclusion,jobs', '--jq', '(.status + "\\t" + .conclusion), (.jobs[] | select(.conclusion == "failure") | .name)'], {
          cwd: main,
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
  return { stages: out, live }
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
  // A failed read is not kept, so the next poll asks for the blob again. A run
  // that throws is a failed read, so one blob does not cost the poll the rest.
  const blob = await $.process.run(['git', 'cat-file', 'blob', sha], { cwd, timeoutMs: 5000 }).catch(() => ({ exitCode: 1, stdout: '' }))
  if (blob.exitCode !== 0) return null
  next.set(sha, blob.stdout)
  return blob.stdout
}

// Each running brief's cycle count and `Epic:` value by its key, kept after
// the archive moves the brief off docs/briefs/, so the bar keeps its length
// and the epics card its sitting to the end.
const cyclesCache = new Map<string, { cycles?: number; epic?: string }>()

// The last listing's cycles, epics, recorded epics, archived sittings and plan titles, which a
// poll whose listing fails draws again.
let lastRead: Pick<BriefsRead, 'cycles' | 'epics' | 'recordedEpics' | 'archived' | 'planTitles'> = {
  cycles: {},
  epics: {},
  recordedEpics: {},
  archived: [],
  planTitles: {},
}

/**
 * The briefs on deck, each brief's cycle count and epic, the epics
 * `sittings.json` records, and each plan's epic titles, from one
 * `git ls-tree -r origin/main docs/briefs/ docs/plans/` in the checkout.
 * Each blob the listing names is read at once, and a running brief that has
 * left the listing, or whose brief blob could not be read, reads its cycles
 * and epic from `cyclesCache`. A failed listing reads no deck and gives the
 * last listing's cycles, epics, recorded epics, archived sittings and plan titles.
 */
async function readBriefs($: EngineInterface, cwd: string, raw: RawStatus): Promise<BriefsRead> {
  const running = raw.running.map(r => r.brief)
  const keys = running.map(briefKey)
  const ls = await $.process.run(['git', 'ls-tree', '-r', 'origin/main', 'docs/briefs/', 'docs/plans/'], { cwd, timeoutMs: 5000 })
  if (ls.exitCode !== 0) {
    const read: BriefsRead = {
      onDeck: [],
      cycles: { ...lastRead.cycles },
      afters: {},
      splits: {},
      epics: { ...lastRead.epics },
      recordedEpics: lastRead.recordedEpics,
      archived: lastRead.archived,
      planTitles: lastRead.planTitles,
    }
    for (const k of keys) {
      const kept = cyclesCache.get(k)
      if (kept?.cycles !== undefined) read.cycles[k] = kept.cycles
      if (kept?.epic !== undefined) read.epics[k] = kept.epic
    }
    return read
  }
  const blobs = lsTreeBlobs(ls.stdout)
  const next = new Map<string, string>()
  const texts = new Map(await Promise.all(briefsBlobs(blobs, running).map(async sha => [sha, await blobText($, cwd, sha, next)] as const)))
  blobCache = next
  const read = briefsRead(blobs, sha => texts.get(sha) ?? null, running, raw.queued.map(r => r.brief))
  const listed = cycleBlobMap(blobs)
  const briefShas = new Map(briefFiles(blobs).map(f => [briefKey(f.path), f.sha]))
  for (const k of [...cyclesCache.keys()]) if (!keys.includes(k)) cyclesCache.delete(k)
  for (const k of keys) {
    const kept = { ...cyclesCache.get(k) }
    if (Object.hasOwn(read.cycles, k)) kept.cycles = read.cycles[k]
    // A failed blob read keeps no entry, so the next poll reads the blob again.
    else if (listed.has(k)) delete kept.cycles
    else if (kept.cycles !== undefined) read.cycles[k] = kept.cycles
    const sha = briefShas.get(k)
    if (Object.hasOwn(read.epics, k)) kept.epic = read.epics[k]
    // A listed brief that reads cleanly with no `Epic:` line names no epic.
    else if (sha !== undefined && (texts.get(sha) ?? null) !== null) delete kept.epic
    else if (kept.epic !== undefined) read.epics[k] = kept.epic
    cyclesCache.set(k, kept)
  }
  lastRead = { cycles: read.cycles, epics: read.epics, recordedEpics: read.recordedEpics, archived: read.archived, planTitles: read.planTitles }
  return read
}

// Finished entries already seen; null until the first read, which only
// seeds it, so loading the mod raises no toast for old runs.
let seen: Set<number> | null = null

// Records `--print` printed, by run name, each with the key it was printed
// under: the progress file's mtime, the brief's path and mtime, and the
// owner's mtime. A failed `--print` keeps no entry.
const printCache = new Map<string, { key: string; read: RecordRead }>()
// The `--print` in flight for each key, so an overlapping poll awaits it.
const printInFlight = new Map<string, Promise<RecordRead | null>>()

/** A file's mtime from the listing of its directory, or null when the listing does not hold it. */
async function mtimeOf($: EngineInterface, dir: string, name: string): Promise<number | null> {
  const hit = (await $.fs.list(dir).catch(() => [])).find(e => e.kind === 'file' && e.name === name)
  return hit === undefined ? null : hit.mtimeMs
}

/**
 * The brief `--print` reads for the run named `base`: `docs/briefs/<file>`
 * while it exists, else the archive's `docs/archive/<name>/<file>`, where the
 * archive keeps each brief under its name without `kickoff-sitting-`. Its
 * mtime is null when neither path holds it, and `--print` then reads no brief.
 */
async function briefOnDisk($: EngineInterface, main: string, base: string): Promise<{ path: string; mtimeMs: number | null }> {
  const file = `${base}.md`
  const live = await mtimeOf($, `${main}/docs/briefs`, file)
  if (live !== null) return { path: `${main}/docs/briefs/${file}`, mtimeMs: live }
  const archive = `${main}/docs/archive/${base.replace(/^kickoff-sitting-/, '')}`
  const archived = await mtimeOf($, archive, file)
  return archived === null ? { path: `${main}/docs/briefs/${file}`, mtimeMs: null } : { path: `${archive}/${file}`, mtimeMs: archived }
}

/**
 * The record of a run with no record the board can read, from
 * `node <main>/scripts/run-status.mjs --print <progress> <brief>`, once per
 * key. A `--print` that exits non-zero, rejects, or prints no record of a
 * version the board knows or a newer one has failed, whatever its stdout
 * holds: null, and nothing is kept, so the next poll asks again.
 */
async function printedRecord(
  $: EngineInterface,
  main: string,
  dir: string,
  base: string,
  progressMs: number | null,
  ownerMs: number | null,
): Promise<RecordRead | null> {
  const brief = await briefOnDisk($, main, base)
  const key = JSON.stringify([progressMs, brief.path, brief.mtimeMs, ownerMs])
  const hit = printCache.get(base)
  if (hit !== undefined && hit.key === key) return hit.read
  const running = printInFlight.get(key)
  if (running !== undefined) return running
  const read = $.process
    .run(['node', `${main}/scripts/run-status.mjs`, '--print', `${dir}/${base}.progress`, brief.path], { cwd: main, timeoutMs: 10000 })
    .then(r => {
      const printed = r.exitCode === 0 ? recordRead(r.stdout) : null
      if (printed === null || printed.kind === 'none') return null
      printCache.set(base, { key, read: printed })
      return printed
    })
    .catch(() => null)
    .finally(() => printInFlight.delete(key))
  printInFlight.set(key, read)
  return read
}

/**
 * Each running run's record, by brief: the file at its `run_record`, else
 * what `--print` prints for it, one run after another. A run whose record
 * has a version the board does not know reads `newer` and is not printed. A
 * run with neither is absent, and draws from status.json alone.
 */
async function readRunningRecords($: EngineInterface, main: string, dir: string, raw: RawStatus): Promise<Record<string, RecordRead>> {
  const out: Record<string, RecordRead> = {}
  let ownerMs: number | null | undefined
  for (const run of raw.running) {
    const text = run.runRecord === undefined ? undefined : await $.fs.read(run.runRecord).catch(() => undefined)
    const read = text === undefined ? null : recordRead(text)
    if (read !== null && read.kind !== 'none') {
      out[run.brief] = read
      continue
    }
    const base = baseName(run.brief)
    ownerMs ??= await mtimeOf($, `${main}/scripts`, 'run-status.mjs')
    const printed = await printedRecord($, main, dir, base, await mtimeOf($, dir, `${base}.progress`), ownerMs)
    if (printed !== null) out[run.brief] = printed
  }
  return out
}

/**
 * The status.json the board draws from, or the notice it draws alone: the
 * file is newer than the board, or it, or its `sources`, is missing or
 * malformed.
 */
async function readStatus($: EngineInterface, dir: string): Promise<{ raw: RawStatus; sources: Sources } | { notice: string }> {
  const text = await $.fs.read(`${dir}/status.json`).catch(() => undefined)
  const read = text === undefined ? null : statusRead(text)
  if (read?.kind === 'newer') return { notice: STATUS_NEWER }
  if (read === null || read.sources === null) return { notice: NO_SOURCES }
  return { raw: read.raw, sources: read.sources }
}

async function poll($: EngineInterface): Promise<void> {
  const home = await $.env.get('HOME')
  if (!home) return
  const dir = `${home}/${LOG_DIR}`
  const status = await readStatus($, dir)
  if ('notice' in status) {
    const notice = noticeBoard(status.notice, await $.clock.now())
    await update($, board, () => notice)
    return
  }
  const { raw, sources } = status
  const loop = await readLoop($, sources.archloopLogDir).catch(() => null)
  const { onDeck, cycles, afters, splits, epics, recordedEpics, archived, planTitles } = await readBriefs($, sources.main, raw).catch(
    (): BriefsRead => ({ onDeck: [], cycles: {}, afters: {}, splits: {}, epics: {}, recordedEpics: {}, archived: [], planTitles: {} }),
  )

  const records = await readRunningRecords($, sources.main, dir, raw).catch(() => ({}))
  const tools: Record<string, string> = {}
  const marks: Record<string, string> = {}
  for (const run of raw.running) {
    tools[run.brief] = await readLastTool($, `${dir}/${baseName(run.brief)}.log`)
    const read = await readLogMarks($, `${dir}/${baseName(run.brief)}.log`)
    if (read !== undefined) marks[run.brief] = read
  }
  const pids = [raw.dispatcher, ...raw.running.map(r => r.pid)].filter((n): n is number => n !== null)
  const alive = await alivePids($, pids).catch(() => new Set<number>())
  const { recent, endings } = await readEndings($, dir, sources, raw, Object.keys(afters), archived).catch(() => ({
    recent: [] as Ended[],
    endings: [] as Ending[],
  }))
  const now = await $.clock.now()
  const offset = $.process
    .run(['date', '+%z'], { timeoutMs: 5000 })
    .then(r => (r.exitCode === 0 ? r.stdout.trim() : ''))
    .catch(() => '')
  const [handoffs, deploys, utcOffset, read] = await Promise.all([
    readHandoffs($, sources.main, endings).catch(() => ({})),
    readDeployStages($, sources.main, endings, now).catch(() => ({ stages: {}, live: '' })),
    offset,
    readSpend($, home, now, offset).catch(() => null),
  ])
  const next = buildBoard(raw, alive, now, {
    loop,
    records,
    recent,
    onDeck,
    tools,
    marks,
    cycles,
    utcOffset,
    spend: read === null ? null : { days: read.days },
    plans: read?.plans ?? null,
    afters,
    endings,
    handoffs,
    deployStages: deploys.stages,
    liveDeploy: deploys.live,
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
    // peach and filled to the run's fill in flight, a grey baseline to come; `⋮` where
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
              <Text color={color(p)}>{phaseGlyphs(p.state, width - 1, r.fill ?? 0)}</Text>
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
    if (b.notice !== null) return <Text color={F.yellow}>{b.notice}</Text>

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
    // A queue or deck row: the name, then the note, which sits between the
    // name and the box and gives way first, then the box.
    const boxedRow = (name: JSX.Element, note: JSX.Element, box: JSX.Element, marginTop = 0) => (
      <Box columnGap={2} marginTop={marginTop}>
        <Box flexShrink={1} minWidth={0}>
          {name}
        </Box>
        <Box flexGrow={1} flexShrink={NOTE_SHRINK} minWidth={0} justifyContent="flex-end">
          {note}
        </Box>
        {box}
      </Box>
    )

    // The epics card's columns: the label padded to the widest label, the
    // cells to the widest epic, cut with `…` past the room the label, the
    // count and the widest state leave, then `shipped/total` and the state.
    const stateParts = (x: EpicRow) => (x.next === null ? [] : EPIC_STATE[x.next.kind].parts(x.next.sitting))
    const stateText = (x: EpicRow): string => stateParts(x).map(p => p.text).join('')
    const countText = (x: EpicRow): string => `${shippedCount(x)}/${x.cells.length}`
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
          {x.next !== null && <Text color={EPIC_STATE[x.next.kind].color}>{stateParts(x).map(p => (p.bold === true ? <Text bold>{p.text}</Text> : p.text))}</Text>}
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

        <Box {...CARD}>
          {cardHead('timeline', 'timeline', F.lavender)}
          {!folded('timeline') && <Box flexDirection="column">{timelineRows()}</Box>}
        </Box>

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
            {runs.map((r, i) => (
              // A run after the first in its lane opens on a blank line, as its bar does under its header.
              <Box flexDirection="column" marginTop={i === 0 ? 0 : 1}>
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
                    {r.isAlive && r.phaseSinceMs !== null && (
                      <Text>
                        <Text color={r.phaseMedianMs !== null && b.checkedAt - r.phaseSinceMs > r.phaseMedianMs ? F.red : F.peach}>
                          {elapsed(r.phaseSinceMs, b.checkedAt)}
                        </Text>
                        <Text color={F.overlay0}> · </Text>
                      </Text>
                    )}
                    <Text color={F.text}>{elapsed(r.startedMs, b.checkedAt)}</Text>
                    <Text color={F.overlay0}> · </Text>
                    <Text color={F.text}>{money(r.cost)}</Text>
                  </Text>
                </Box>
                {r.isNewer ? (
                  <Text color={F.yellow}>{RECORD_NEWER}</Text>
                ) : r.isAlive ? (
                  <Box flexDirection="column" marginTop={1}>
                    {phaseRows(r, segmentWidth(e.props.bodyColumns, r.phases.length))}
                    <Text wrap="truncate-end" color={F.overlay2}>
                      {phaseLine(r)}
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
                const lit = r.kind === 'run' ? (b.costs[r.sitting]?.lit ?? 0) : null
                // A solid joint means the entry needs its parent shipped, a yellow dashed one that the run holds its paths, and a yellow `‖` that a block holds it.
                return boxedRow(
                  <Text wrap="truncate-end">
                    <Text color={r.kind === 'hold' ? F.yellow : F.overlay0}>{r.rails}</Text>
                    <Text color={r.kind === 'hold' || r.kind === 'held' ? F.yellow : r.kind === 'after' ? F.blue : F.surface2}>{r.joint}</Text>
                    <Text color={r.kind === 'run' ? F.peach : r.kind === 'block' || r.kind === 'hold' ? F.yellow : F.blue}>
                      {r.kind === 'run' ? '●' : r.kind === 'block' || r.kind === 'hold' ? '‖' : '○'}{' '}
                    </Text>
                    <Text bold color={r.kind === 'block' ? F.yellow : F.text}>{r.sitting}</Text>
                    {r.slug !== '' && <Text color={r.kind === 'block' ? F.yellow : F.subtext0}> {r.slug}</Text>}
                    {(b.splits[r.sitting] ?? 0) > 0 && <Text color={F.overlay0}>{` split ×${b.splits[r.sitting] ?? 0}`}</Text>}
                  </Text>,
                  r.kind === 'run' ? (
                    <Text wrap="truncate-end">
                      <Text color={LANE_COLOR[r.lane] ?? F.surface2}>{r.lane}</Text>
                      <Text color={F.overlay2}> · running</Text>
                    </Text>
                  ) : (
                    <Text wrap="truncate-end" color={(r.kind === 'held' && r.joint === '') || r.kind === 'block' ? F.yellow : F.overlay2}>
                      {r.note}
                    </Text>
                  ),
                  costBox(r.sitting, isHeld ? F.yellow : F.blue, isHeld, lit),
                  r.kind === 'block' && i > 0 ? 1 : 0,
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
                  boxedRow(
                    <Text wrap="truncate-end">
                      <Text color={F.overlay0}>{r.rails}</Text>
                      <Text color={r.kind === 'after' ? DECK_COLOR[r.mode] : F.surface2}>{r.joint}</Text>
                      <Text color={DECK_COLOR[r.mode]}>◇ </Text>
                      <Text bold color={F.text}>{r.sitting}</Text>
                      <Text color={F.subtext0}> {r.slug}</Text>
                    </Text>,
                    <Text wrap="truncate-end" color={F.overlay2}>
                      {r.wait !== '' && (
                        // The nearest wait, its sitting blue when it is queued.
                        <Text>
                          after <Text color={r.isWaitQueued ? F.blue : F.overlay2}>{r.wait}</Text>
                        </Text>
                      )}
                      {r.wait !== '' && r.note !== '' ? ' · ' : ''}
                      {r.note}
                    </Text>,
                    costBox(r.sitting, DECK_COLOR[r.mode], false),
                  )
                ),
              )}
          </Box>
        )}

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
