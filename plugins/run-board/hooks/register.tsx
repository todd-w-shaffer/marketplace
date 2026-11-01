import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Loop } from '../types'
import {
  LOOP_LANE,
  baseName,
  buildBoard,
  buildLoop,
  elapsed,
  finishedToast,
  isLoopLanding,
  money,
  newestRunDir,
  parseStatus,
  lanesOf,
  statusLine,
} from './board'
import type { LoopFile } from './board'

const PANE = 'run-board'
const TITLE = 'Autopilot runs'
const POLL_MS = 5000
// scripts/dispatch.sh's default LOG_DIR, under $HOME.
const LOG_DIR = 'Library/Logs/shootsfilm-autopilot'
// scripts/archloop.sh's default ARCHLOOP_LOG_DIR, under $HOME.
const LOOP_DIR = 'Library/Logs/shootsfilm-archloop'

// Change the tag when Board's fields change: it declines what an earlier
// version stored, which outlives a reload.
const board = atom({ plugin: 'run-board', key: 'board' } as const, null, { shape: 'board-3' })

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
  if (status === null && loop === null) {
    await update($, board, () => null)
    return
  }
  const raw = status ?? { dispatcher: null, running: [], queued: [], finished: [] }

  const progress: Record<string, string> = {}
  for (const run of raw.running) {
    progress[run.brief] = await $.fs.read(`${dir}/${baseName(run.brief)}.progress`).catch(() => '')
  }
  const pids = [raw.dispatcher, ...raw.running.map(r => r.pid)].filter((n): n is number => n !== null)
  const alive = await alivePids($, pids).catch(() => new Set<number>())
  const next = buildBoard(raw, progress, alive, await $.clock.now(), loop)

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
    await $.command.register({
      name: 'autopilot',
      description: 'Open or close the autopilot run board',
    })
    void poll($).catch(() => undefined)
    $.clock.every(POLL_MS, () => poll($).catch(() => undefined))

    return next(e)
  })

  on('command.run', { command: 'autopilot' }, async $ => {
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      return { text: 'Run board closed.' }
    }
    await poll($).catch(() => undefined)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Run board opened. /autopilot again closes it.' }
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

    if (b === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No autopilot status yet.</Text>
          <Text dimColor>Looking for ~/{LOG_DIR}/status.json</Text>
        </Box>
      )
    }

    const at = new Date(b.checkedAt).toISOString().slice(11, 19)

    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>AUTOPILOT</Text>
          <Text dimColor> · checked {at} UTC</Text>
        </Text>
        <Text color={b.isDispatcherLive ? 'success' : 'warning'}>
          {b.isDispatcherLive ? 'dispatcher live' : 'no dispatcher running'}
          <Text dimColor>
            {' '}· {b.running.length} running · {b.queued.length} queued
          </Text>
        </Text>

        {lanesOf(b).map(({ lane, runs }) => (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>{lane.toUpperCase()}</Text>
            {lane === LOOP_LANE && b.loop !== null && (
              <Box flexDirection="column">
                <Text>
                  <Text color="suggestion">◐ </Text>
                  <Text bold>loop</Text> {b.loop.name}
                </Text>
                <Text>
                  {'  '}
                  {b.loop.stage}
                  <Text dimColor>
                    {' '}· {elapsed(b.loop.startedMs, b.checkedAt)} · {money(b.loop.cost)}
                  </Text>
                </Text>
              </Box>
            )}
            {runs.length === 0 && (lane !== LOOP_LANE || b.loop === null) && <Text dimColor>  idle</Text>}
            {runs.map(r => (
              <Box flexDirection="column">
                <Text>
                  <Text color={r.isAlive ? 'warning' : 'error'}>{r.isAlive ? '●' : '✗'} </Text>
                  <Text bold>{r.sitting}</Text> {r.slug}
                  {isLoopLanding(b, r) && <Text dimColor> (loop landing)</Text>}
                </Text>
                <Text>
                  {'  '}
                  {r.isAlive ? r.stage : 'launcher gone, no finished line'}
                  <Text dimColor>
                    {' '}· {elapsed(r.startedMs, b.checkedAt)} · {money(r.cost)}
                  </Text>
                </Text>
                {r.note !== '' && (
                  <Box paddingLeft={2}>
                    <Text dimColor>{r.note}</Text>
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        ))}

        {b.queued.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>QUEUED</Text>
            {b.queued.map(q => (
              <Text>
                <Text color="suggestion">○ </Text>
                <Text bold>{q.sitting}</Text> {q.slug}
                <Text dimColor>
                  {'  '}{q.lane}{q.reason !== '' ? ` · waits for ${q.reason}` : ''}
                </Text>
              </Text>
            ))}
          </Box>
        )}

        {b.finished.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>RECENT</Text>
            {b.finished.map(d =>
              d.isSuperseded ? (
                <Text dimColor wrap="truncate-end">
                  ✗ {d.sitting} {d.text}
                </Text>
              ) : (
                <Box flexDirection="row">
                  <Box flexShrink={0}>
                    <Text>
                      <Text color={d.isShipped ? 'success' : 'error'}>{d.isShipped ? '✓' : '✗'} </Text>
                      <Text bold>{d.sitting}</Text>{' '}
                    </Text>
                  </Box>
                  <Box flexShrink={1}>
                    <Text dimColor>{d.text}</Text>
                  </Box>
                </Box>
              ),
            )}
          </Box>
        )}
      </Box>
    )
  })
}
