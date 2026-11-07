import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Deck, Ended, Loop, Phase, Run } from '../types'
import {
  LOG_TAIL_BYTES,
  LOOP_LANE,
  ago,
  baseName,
  buildBoard,
  briefFiles,
  buildLoop,
  briefKey,
  cycleBlobs,
  cycleCount,
  deckDetail,
  elapsed,
  finishedToast,
  laneTag,
  isLoopLanding,
  lastToolOf,
  livePhase,
  miniBar,
  phaseLine,
  segmentWidth,
  money,
  newestRunDir,
  onDeckOf,
  parseStatus,
  lanesOf,
  recentCandidates,
  recentOf,
  statusLine,
} from './board'
import type { LoopFile, RawStatus } from './board'

// Catppuccin Frappé (catppuccin.com/palette). Every colour the board paints
// comes from here, so the pane reads the same whatever the terminal theme.
const F = {
  text: '#c6d0f5',
  subtext0: '#a5adce',
  overlay2: '#949cbb',
  overlay0: '#737994',
  surface2: '#626880',
  surface1: '#51576d',
  lavender: '#babbf1',
  blue: '#8caaee',
  mauve: '#ca9ee6',
  green: '#a6d189',
  yellow: '#e5c890',
  peach: '#ef9f76',
  red: '#e78284',
} as const

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
const board = atom({ plugin: 'run-board', key: 'board' } as const, null, { shape: 'board-7' })

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

// Progress files read for RECENT, by name, kept while their mtime holds.
const recentCache = new Map<string, { mtimeMs: number; text: string }>()

/** The newest finished sittings, from the progress files in `dir`. */
async function readRecent($: EngineInterface, dir: string, raw: RawStatus): Promise<Ended[]> {
  const files = (await $.fs.list(dir).catch(() => []))
    .filter(e => e.kind === 'file')
    .map(e => ({ name: e.name, mtimeMs: e.mtimeMs }))
  const texts: { name: string; mtimeMs: number; text: string }[] = []
  for (const f of recentCandidates(files, raw.running.map(r => r.brief))) {
    let hit = recentCache.get(f.name)
    if (hit === undefined || hit.mtimeMs !== f.mtimeMs) {
      hit = { mtimeMs: f.mtimeMs, text: await $.fs.read(`${dir}/${f.name}`).catch(() => '') }
      recentCache.set(f.name, hit)
    }
    texts.push({ ...f, text: hit.text })
  }
  return recentOf(texts, raw.finished)
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
): Promise<{ onDeck: Deck[]; cycles: Record<string, number> }> {
  const cwd = `${home}/${REPO}`
  const cycles: Record<string, number> = {}
  const keys = raw.running.map(r => briefKey(r.brief))
  const ls = await $.process.run(['git', 'ls-tree', '-r', 'origin/main', 'docs/briefs/'], { cwd, timeoutMs: 5000 })
  if (ls.exitCode !== 0) {
    for (const k of keys) if (cyclesCache.has(k)) cycles[k] = cyclesCache.get(k) ?? 0
    return { onDeck: [], cycles }
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
  return { onDeck: onDeckOf(briefs, [...raw.running, ...raw.queued].map(r => r.brief)), cycles }
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
  const { onDeck, cycles } = await readBriefs($, home, raw).catch(() => ({ onDeck: [] as Deck[], cycles: {} }))
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
  const recent = await readRecent($, dir, raw).catch(() => [])
  const next = buildBoard(raw, progress, alive, await $.clock.now(), { loop, recent, onDeck, tools, cycles })

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
    await $.ui.open({ id: PANE, title: TITLE })
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
    const { Box, Text } = $.ui.resolve(e)
    const b: Board | null = await read($, board)

    // The bar and its labels: one block per phase, green when done, amber in
    // flight, dim to come, with `┊` where session 2 takes over.
    const phaseRows = (r: Run, width: number) => {
      const cut = r.phases.findIndex(p => p.label === 'simplify')
      const color = (p: Phase): string => (p.state === 'done' ? F.green : p.state === 'live' ? F.peach : F.surface1)
      const labelColor = (p: Phase): string => (p.state === 'done' ? F.subtext0 : p.state === 'live' ? F.peach : F.surface2)
      const glyph = (p: Phase): string => (p.state === 'done' ? '█' : p.state === 'live' ? '▓' : '░')
      return [
        <Text>
          {r.phases.map((p, i) => (
            <Text>
              {i === cut && <Text color={F.overlay0}>┊ </Text>}
              <Text color={color(p)}>{glyph(p).repeat(width - 1)}</Text>{' '}
            </Text>
          ))}
        </Text>,
        <Text>
          {r.phases.map((p, i) => (
            <Text>
              {i === cut && '  '}
              <Text color={labelColor(p)} bold={p.state === 'live'}>
                {p.short.slice(0, width - 1).padEnd(width)}
              </Text>
            </Text>
          ))}
        </Text>,
      ]
    }

    if (b === null) {
      return (
        <Box flexDirection="column">
          <Text color={F.overlay2}>No autopilot status yet.</Text>
          <Text color={F.overlay2}>Looking for ~/{LOG_DIR}/status.json</Text>
        </Box>
      )
    }

    const at = new Date(b.checkedAt).toISOString().slice(11, 19)

    return (
      <Box flexDirection="column">
        <Text>
          <Text bold color={F.lavender}>AUTOPILOT</Text>
          <Text color={F.overlay2}> · checked {at} UTC</Text>
        </Text>
        <Text color={b.isDispatcherLive ? F.green : F.yellow}>
          {b.isDispatcherLive ? 'dispatcher live' : 'no dispatcher running'}
          <Text color={F.overlay2}>
            {' '}· {b.running.length} running · {b.queued.length} queued · {b.onDeck.length} on deck
          </Text>
        </Text>

        {lanesOf(b).map(({ lane, runs }) => (
          <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={F.surface2} paddingX={1}>
            <Text bold color={F.lavender}>
              {lane.toUpperCase()}
            </Text>
            {lane === LOOP_LANE && b.loop !== null && (
              <Box flexDirection="column">
                <Text>
                  <Text color={F.mauve}>◐ </Text>
                  <Text bold color={F.text}>loop</Text> {b.loop.name}
                </Text>
                <Text>
                  {'  '}
                  {b.loop.stage}
                  <Text color={F.overlay2}>
                    {' '}· {elapsed(b.loop.startedMs, b.checkedAt)} · {money(b.loop.cost)}
                  </Text>
                </Text>
              </Box>
            )}
            {runs.length === 0 && (lane !== LOOP_LANE || b.loop === null) && <Text color={F.overlay2}>idle</Text>}
            {runs.map(r => (
              <Box flexDirection="column">
                <Box justifyContent="space-between" columnGap={2}>
                  <Text wrap="truncate-end">
                    <Text color={r.isAlive ? F.peach : F.red}>{r.isAlive ? '●' : '✗'} </Text>
                    <Text bold color={F.text}>{r.sitting}</Text> {r.slug}
                    {isLoopLanding(b, r) && <Text color={F.overlay2}> (loop landing)</Text>}
                  </Text>
                  <Text color={F.overlay2}>
                    {elapsed(r.startedMs, b.checkedAt)} · {money(r.cost)}
                  </Text>
                </Box>
                {r.isAlive ? (
                  <Box flexDirection="column" marginTop={1}>
                    {phaseRows(r, segmentWidth(e.props.bodyColumns, r.phases.length))}
                    <Text color={F.peach} wrap="truncate-end">
                      {phaseLine(r)}
                    </Text>
                  </Box>
                ) : (
                  <Text color={F.red}>launcher gone, no finished line</Text>
                )}
                {r.note !== '' && <Text color={F.overlay2}>{r.note}</Text>}
              </Box>
            ))}
          </Box>
        ))}

        {b.queued.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color={F.lavender}>QUEUED</Text>
            {b.queued.map(q => (
              <Text>
                <Text color={F.blue}>○ </Text>
                <Text bold color={F.text}>{q.sitting}</Text> {q.slug}
                <Text color={F.overlay2}>
                  {'  '}{q.lane}{q.reason !== '' ? ` · waits for ${q.reason}` : ''}
                </Text>
              </Text>
            ))}
          </Box>
        )}

        {b.onDeck.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color={F.lavender}>ON DECK</Text>
            {b.onDeck.map(d => (
              <Text>
                <Text color={F.mauve}>◇ </Text>
                <Text bold color={F.text}>{d.sitting}</Text> {d.slug}
                <Text color={F.overlay2}>
                  {'  '}{deckDetail(d)}
                </Text>
              </Text>
            ))}
          </Box>
        )}

        {b.recent.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color={F.lavender}>RECENT</Text>
            {b.recent.map(d => (
              <Box flexDirection="column">
                <Text>
                  <Text color={d.isShipped ? F.green : F.red}>{d.isShipped ? '✓' : '✗'} </Text>
                  <Text bold color={F.text}>{d.sitting}</Text> {d.slug}
                  <Text color={F.overlay2}>
                    {laneTag(d)} · {ago(d.endedMs, b.checkedAt)}
                  </Text>
                </Text>
                <Box paddingLeft={2}>
                  <Text color={F.overlay2} wrap="truncate-end">{d.detail}</Text>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
