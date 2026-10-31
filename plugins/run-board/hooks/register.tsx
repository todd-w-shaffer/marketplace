import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board } from '../types'
import {
  baseName,
  buildBoard,
  elapsed,
  finishedToast,
  money,
  parseStatus,
  statusLine,
} from './board'

const PANE = 'run-board'
const TITLE = 'Autopilot runs'
const POLL_MS = 5000
// scripts/dispatch.sh's default LOG_DIR, under $HOME.
const LOG_DIR = 'Library/Logs/shootsfilm-autopilot'

// Change the tag when Board's fields change: it declines what an earlier
// version stored, which outlives a reload.
const board = atom({ plugin: 'run-board', key: 'board' } as const, null, { shape: 'board-2' })

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

// Finished entries already seen; null until the first read, which only
// seeds it, so loading the mod raises no toast for old runs.
let seen: Set<number> | null = null

async function poll($: EngineInterface): Promise<void> {
  const home = await $.env.get('HOME')
  if (!home) return
  const dir = `${home}/${LOG_DIR}`
  const text = await $.fs.read(`${dir}/status.json`).catch(() => undefined)
  const raw = text === undefined ? null : parseStatus(text)
  if (raw === null) {
    await update($, board, () => null)
    return
  }

  const progress: Record<string, string> = {}
  for (const run of raw.running) {
    progress[run.brief] = await $.fs.read(`${dir}/${baseName(run.brief)}.progress`).catch(() => '')
  }
  const pids = [raw.dispatcher, ...raw.running.map(r => r.pid)].filter((n): n is number => n !== null)
  const alive = await alivePids($, pids).catch(() => new Set<number>())
  const next = buildBoard(raw, progress, alive, await $.clock.now())

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
      name: 'runs',
      description: 'Open or close the autopilot run board',
    })
    void poll($).catch(() => undefined)
    $.clock.every(POLL_MS, () => poll($).catch(() => undefined))

    return next(e)
  })

  on('command.run', { command: 'runs' }, async $ => {
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      return { text: 'Run board closed.' }
    }
    await poll($).catch(() => undefined)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Run board opened. /runs again closes it.' }
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

        {b.running.length === 0 && (
          <Text dimColor>{'\n'}Nothing running.</Text>
        )}
        {b.running.map(r => (
          <Box flexDirection="column" marginTop={1}>
            <Text>
              <Text color={r.isAlive ? 'warning' : 'error'}>{r.isAlive ? '●' : '✗'} </Text>
              <Text bold>{r.sitting}</Text> {r.slug}
              <Text dimColor>  {r.lane}</Text>
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
