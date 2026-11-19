import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BlockKind, Board, Deck, DeckMode, Ended, FoldCard, Folds, Loop, Phase, Run, StripCell } from '../types'
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
  costMeter,
  baseName,
  buildBoard,
  briefFiles,
  buildLoop,
  afterSittings,
  briefHeader,
  briefKey,
  cycleBlobs,
  cycleCount,
  deckTree,
  elapsed,
  hoursMinutes,
  finishedToast,
  isLoopLanding,
  lastToolOf,
  ledgerChunk,
  livePhase,
  miniBar,
  phaseGlyphs,
  phaseLine,
  phaseName,
  segmentWidth,
  spendTotals,
  inFlight,
  money,
  newestRunDir,
  onDeckOf,
  queueTree,
  parseStatus,
  lanesOf,
  recentCandidates,
  recentOf,
  statusLine,
  tileFace,
} from './board'
import type { Ending, LoopFile, RawStatus, Spend } from './board'

// Catppuccin Macchiato (catppuccin.com/palette). Every colour the board
// paints comes from here, the pane's own ground included, so the pane reads
// the same whatever the terminal theme.
const F = {
  text: '#cad3f5',
  subtext0: '#a5adcb',
  overlay2: '#939ab7',
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
// How many braille cells a recent row's cost meter takes.
const RECENT_METER_CELLS = 6

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
const board = atom({ plugin: 'run-board', key: 'board' } as const, null, { shape: 'board-10' })

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

// The ledger as read so far. It only grows, by a line per /commit and /ship,
// so each poll reads only the bytes past `offset`; a file shorter than
// `offset` was replaced, and is read again from the start.
let ledger: { offset: number; partial: string; spends: Spend[] } = { offset: 0, partial: '', spends: [] }

/** Spend over the last 24 hours, 7 days and 30 days, and in all, from token-ledger. */
async function readSpend($: EngineInterface, home: string, now: number): Promise<Board['spend']> {
  const path = `${home}/${LEDGER}`
  const stat = await $.process.run(['stat', '-f', '%z', path], { timeoutMs: 5000 })
  const size = Number(stat.stdout.trim())
  if (stat.exitCode !== 0 || !Number.isFinite(size)) return null
  if (size < ledger.offset) ledger = { offset: 0, partial: '', spends: [] }
  while (ledger.offset < size) {
    const count = Math.min(LEDGER_CHUNK_BYTES, size - ledger.offset)
    const chunk = await $.process.run(
      ['sh', '-c', 'tail -c +"$1" "$2" | head -c "$3"', 'sh', String(ledger.offset + 1), path, String(count)],
      { timeoutMs: 5000 },
    )
    if (chunk.exitCode !== 0) return null
    const read = ledgerChunk(ledger.partial, chunk.stdout)
    ledger = { offset: ledger.offset + count, partial: read.partial, spends: [...ledger.spends, ...read.spends] }
  }
  return spendTotals(ledger.spends, now)
}

// Progress files read for RECENT and BLOCKED, by name, kept while their mtime holds.
const progressCache = new Map<string, { mtimeMs: number; text: string }>()

/**
 * The progress files RECENT and BLOCKED read: the newest sittings', and each
 * brief's on `origin/main`, since a stop that waits for a person can be older
 * than every recent run. None that runs: a run truncates its file at start.
 */
async function readEndings($: EngineInterface, dir: string, raw: RawStatus, onMain: readonly string[]): Promise<{ recent: Ended[]; endings: Ending[] }> {
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

/** The text of `sha` in the checkout at `cwd`, read once per blob. */
async function blobText($: EngineInterface, cwd: string, sha: string, next: Map<string, string>): Promise<string> {
  let text = blobCache.get(sha) ?? next.get(sha)
  if (text === undefined) {
    const blob = await $.process.run(['git', 'cat-file', 'blob', sha], { cwd, timeoutMs: 5000 })
    text = blob.exitCode === 0 ? blob.stdout : ''
  }
  next.set(sha, text)
  return text
}

// Each running brief's cycle count by its key, kept after the archive moves
// the brief off docs/briefs/ so the bar keeps its length to the end.
const cyclesCache = new Map<string, number>()

/**
 * The briefs on deck, and each running brief's cycle count, from one
 * `git ls-tree -r origin/main docs/briefs/` in the checkout.
 */
async function readBriefs(
  $: EngineInterface,
  home: string,
  raw: RawStatus,
): Promise<{ onDeck: Deck[]; cycles: Record<string, number>; afters: Record<string, string[]> }> {
  const cwd = `${home}/${REPO}`
  const cycles: Record<string, number> = {}
  const keys = raw.running.map(r => briefKey(r.brief))
  const ls = await $.process.run(['git', 'ls-tree', '-r', 'origin/main', 'docs/briefs/'], { cwd, timeoutMs: 5000 })
  if (ls.exitCode !== 0) {
    for (const k of keys) if (cyclesCache.has(k)) cycles[k] = cyclesCache.get(k) ?? 0
    return { onDeck: [], cycles, afters: {} }
  }
  const next = new Map<string, string>()
  const briefs: { path: string; sha: string; text: string }[] = []
  for (const f of briefFiles(ls.stdout)) briefs.push({ ...f, text: await blobText($, cwd, f.sha, next) })
  for (const k of keys) {
    const shas = cycleBlobs(ls.stdout, k)
    if (shas.length > 0) {
      const texts = await Promise.all(shas.map(sha => blobText($, cwd, sha, next)))
      cyclesCache.set(k, cycleCount(texts.join('\n')))
    }
    if (cyclesCache.has(k)) cycles[k] = cyclesCache.get(k) ?? 0
  }
  for (const k of [...cyclesCache.keys()]) if (!keys.includes(k)) cyclesCache.delete(k)
  blobCache = next
  const afters = Object.fromEntries(briefs.map(f => [briefKey(f.path), afterSittings(briefHeader(f.text).after)]))
  return { onDeck: onDeckOf(briefs, [...raw.running, ...raw.queued].map(r => r.brief)), cycles, afters }
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
  const { onDeck, cycles, afters } = await readBriefs($, home, raw).catch(() => ({ onDeck: [] as Deck[], cycles: {}, afters: {} }))
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
  const { recent, endings } = await readEndings($, dir, raw, Object.keys(afters)).catch(() => ({ recent: [] as Ended[], endings: [] as Ending[] }))
  const handoffs = await readHandoffs($, home, endings).catch(() => ({}))
  const now = await $.clock.now()
  const deployStages = await readDeployStages($, home, endings, now).catch(() => ({}))
  const offset = await $.process.run(['date', '+%z'], { timeoutMs: 5000 }).catch(() => ({ exitCode: 1, stdout: '' }))
  const utcOffset = offset.exitCode === 0 ? offset.stdout.trim() : ''
  const spend = await readSpend($, home, now).catch(() => null)
  const next = buildBoard(raw, progress, alive, now, {
    loop,
    recent,
    onDeck,
    tools,
    cycles,
    utcOffset,
    spend,
    afters,
    endings,
    handoffs,
    deployStages,
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

    // The header's four figures as dot numerals, each in the colour its
    // section uses below; a zero fades to the to-come grey.
    const cost = inFlight(b)
    const tiles: { value: string; label: string; color: string; isZero: boolean }[] = [
      { value: String(b.running.length), label: 'running', color: F.peach, isZero: b.running.length === 0 },
      { value: String(b.queued.length), label: 'queued', color: F.blue, isZero: b.queued.length === 0 },
      { value: String(b.onDeck.length), label: 'on deck', color: F.mauve, isZero: b.onDeck.length === 0 },
      { value: cost.toFixed(2), label: '$ in flight', color: F.text, isZero: cost === 0 },
    ]
    const recentMax = Math.max(0, ...b.recent.map(d => d.usd ?? 0))

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

    // The second row: spend in whole dollars over the last 24 hours, 7 days
    // and 30 days, and in all, from token-ledger. The windows roll, so the
    // labels name the span, not a calendar day, week or month.
    const spendTiles: typeof tiles =
      b.spend === null
        ? []
        : [
            { value: String(Math.round(b.spend.day)), label: '$ 24h', color: F.teal, isZero: b.spend.day === 0 },
            { value: String(Math.round(b.spend.week)), label: '$ 7 days', color: F.sapphire, isZero: b.spend.week === 0 },
            { value: String(Math.round(b.spend.month)), label: '$ 30 days', color: F.lavender, isZero: b.spend.month === 0 },
            { value: String(Math.round(b.spend.all)), label: '$ all time', color: F.text, isZero: b.spend.all === 0 },
          ]
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
          {spendTiles.length > 0 && tileRow(spendTiles)}
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
                {r.note !== '' && <Text color={F.overlay0}>{r.note}</Text>}
              </Box>
            ))}
          </Box>
        ))}

        {hasBlocked && (
          <Box {...CARD} borderColor={F.red}>
            {cardHead('blocked', 'blocked', F.red)}
            {!folded('blocked') &&
              b.blocked.map((k, i) => (
                <Box flexDirection="column" marginTop={1}>
                  {i > 0 && <Text color={F.surface1}>{'─'.repeat(Math.max(1, e.props.bodyColumns - 4))}</Text>}
                  <Text wrap="wrap">
                    <Text backgroundColor={KIND_COLOR[k.kind]} color={F.mantle} bold>
                      {` ${KIND_TAG[k.kind]} `}
                    </Text>
                    <Text bold color={F.text}>{`  ${k.headline}`}</Text>
                  </Text>
                  {k.why !== '' && (
                    <Text color={F.subtext0} wrap="wrap">
                      {k.why}
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
                  {k.holds.length > 0 && <Text color={F.overlay2}>{`holds ${k.holds.length}, in order`}</Text>}
                  {k.holds.map(w => (
                    <Box justifyContent="space-between" columnGap={2}>
                      <Text wrap="truncate-end">
                        <Text color={F.yellow}>{'  ⏸ '}</Text>
                        <Text bold color={F.text}>{w.sitting}</Text>
                        <Text color={F.subtext0}> {w.slug}</Text>
                      </Text>
                      <Text wrap="truncate-end" color={w.why.startsWith('after ') ? F.overlay0 : F.yellow}>
                        {w.why}
                      </Text>
                    </Box>
                  ))}
                  <Text wrap="wrap">
                    <Text bold color={F.red}>
                      next{'  '}
                    </Text>
                    <Text color={F.text}>{k.next}</Text>
                  </Text>
                </Box>
              ))}
          </Box>
        )}

        {b.queued.length > 0 && (
          <Box {...CARD}>
            {cardHead('queued', 'queued', F.lavender)}
            {!folded('queued') && queueTree(b.running, b.queued).map(r => (
              // A joint means the entry needs its parent shipped.
              <Box justifyContent="space-between" columnGap={2}>
                <Text wrap="truncate-end">
                  <Text color={F.overlay0}>{r.rails}</Text>
                  <Text color={r.kind === 'after' ? F.blue : F.surface2}>{r.joint}</Text>
                  <Text color={r.kind === 'run' ? F.peach : F.blue}>{r.kind === 'run' ? '●' : '○'} </Text>
                  <Text bold color={F.text}>{r.sitting}</Text>
                  <Text color={F.subtext0}> {r.slug}</Text>
                </Text>
                {r.kind === 'run' ? (
                  <Text>
                    <Text color={LANE_COLOR[r.lane] ?? F.surface2}>{r.lane}</Text>
                    <Text color={F.overlay2}> · running</Text>
                  </Text>
                ) : (
                  <Text wrap="truncate-end" color={r.kind === 'held' ? F.yellow : F.overlay2}>
                    {r.note}
                  </Text>
                )}
              </Box>
            ))}
          </Box>
        )}

        {b.onDeck.length > 0 && (
          <Box {...CARD}>
            {cardHead('deck', 'on deck', F.lavender)}
            {!folded('deck') && deckTree(b.onDeck, [...b.running, ...b.queued].map(r => r.sitting)).map(r =>
              r.kind === 'group' ? (
                <Text>
                  <Text bold color={DECK_COLOR[r.mode]}>{r.slug}</Text>
                  <Text color={F.overlay0}> {r.note}</Text>
                </Text>
              ) : (
                // A solid joint waits on the brief above it; a dashed one hangs under its group.
                <Box justifyContent="space-between" columnGap={2}>
                  <Text wrap="truncate-end">
                    <Text color={F.overlay0}>{r.rails}</Text>
                    <Text color={r.kind === 'after' ? DECK_COLOR[r.mode] : F.surface2}>{r.joint}</Text>
                    <Text color={DECK_COLOR[r.mode]}>◇ </Text>
                    <Text bold color={F.text}>{r.sitting}</Text>
                    <Text color={F.subtext0}> {r.slug}</Text>
                  </Text>
                  <Text wrap="truncate-end" color={F.overlay2}>
                    {r.note}
                  </Text>
                </Box>
              ),
            )}
          </Box>
        )}

        {b.recent.length > 0 && (
          <Box {...CARD}>
            {cardHead('recent', 'recent', F.lavender)}
            {!folded('recent') && b.recent.map(d => {
              // One row per run: outcome, sitting, then time, a cost meter
              // scaled to the costliest run listed, the cost and the age.
              const meter = costMeter(d.usd ?? 0, recentMax, RECENT_METER_CELLS)
              return (
                <Box flexDirection="column">
                  <Box columnGap={2}>
                    {/* The slug gives way first, so the figures keep one line and one column. */}
                    <Box flexGrow={1} flexShrink={1} minWidth={0}>
                      <Text wrap="truncate-end">
                        <Text color={F.green}>● </Text>
                        <Text bold color={F.text}>{d.sitting}</Text>
                        <Text color={F.subtext0}> {d.slug}</Text>
                      </Text>
                    </Box>
                    <Box flexShrink={0}>
                      <Text wrap="truncate-end">
                        <Text color={F.overlay2}>{(d.minutes === null ? '—' : hoursMinutes(d.minutes)).padStart(5)}  </Text>
                        <Text color={F.peach}>{meter.fill}</Text>
                        <Text color={F.surface1}>{meter.rest}</Text>
                        <Text color={F.text}> {(d.usd === null ? '—' : money(d.usd)).padStart(7)}</Text>
                        <Text color={F.overlay0}> {agoShort(d.endedMs, b.checkedAt).padStart(3)}</Text>
                      </Text>
                    </Box>
                  </Box>
                </Box>
              )
            })}
          </Box>
        )}
      </Box>
    )
  })
}
