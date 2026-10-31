import { expect, test } from 'claude-code/testing'

import { buildBoard, finishedToast, lanesOf, parseStatus, stageOf, statusLine } from '../hooks/board'

const STATUS = JSON.stringify({
  written: '2026-10-31T16:49:25Z',
  dispatcher: 5147,
  running: [
    { entry: 5, brief: 'docs/briefs/kickoff-sitting-s299-one-full-check.md', lane: 'epic', pid: 79762, started: '2026-10-31T15:43:24Z', progress: 'x', session_cost: 7.65 },
    { entry: 6, brief: 'docs/briefs/kickoff-sitting-s300-loop-run-record.md', lane: 'fix', pid: 21491, started: '2026-10-31T15:11:36Z', progress: 'x', session_cost: 8 },
  ],
  queued: [{ entry: 7, brief: 'docs/briefs/kickoff-sitting-s301-time-limit-record.md', lane: 'epic', reason: 'S299' }],
  finished: [
    { entry: 2, brief: 'docs/briefs/kickoff-sitting-s298-tool-paths-by-default.md', status: 1, outcome: 'autopilot: main has commits origin/main does not. Push or drop them first.' },
    { entry: 4, brief: 'docs/briefs/kickoff-sitting-s298-tool-paths-by-default.md', status: 0, outcome: 'autopilot: kickoff-sitting-s298-tool-paths-by-default shipped; production is live (run 41212658012). ($27.53, 158 min)' },
  ],
})

const S300 = [
  'skill: commit-skill:commit S300 cycle 1: ...',
  'commit: feat(x): y',
  'skill: code-review xhigh /usr/bin/git diff a b -- c',
  'woke for a background task: success, 6 turns, $10.07 so far: The archive commit is pushing.',
  'bash: set -o pipefail; npm run push:checked -- origin HEAD:main 2>&1 | tail',
].join('\n')

const NOW = Date.parse('2026-10-31T16:49:25Z')

test('stages come from the last step line', async () => {
  expect(stageOf(S300)).toBe('pushing')
  expect(stageOf('skill: code-review xhigh /usr/bin/git diff a b')).toBe('review xhigh')
  expect(stageOf('skill: commit-skill:commit x\ncommit: y')).toBe('working')
  expect(stageOf('skill: simplify Paths in scope')).toBe('simplify')
  expect(stageOf('')).toBe('starting')
})

test('a board reads runs, queue, outcomes and liveness', async () => {
  const raw = parseStatus(STATUS)
  expect(raw === null).toBe(false)
  if (raw === null) return
  const b = buildBoard(
    raw,
    { 'docs/briefs/kickoff-sitting-s300-loop-run-record.md': S300 },
    new Set([5147, 21491]),
    NOW,
  )
  expect(b.isDispatcherLive).toBe(true)
  expect(b.running.map(r => `${r.sitting}:${r.stage}:${r.isAlive}`)).toEqual([
    'S299:starting:false',
    'S300:pushing:true',
  ])
  expect(b.running[1]?.cost).toBe(10.07)
  expect(b.running[1]?.note).toBe('The archive commit is pushing.')
  expect(b.finished.map(d => `${d.entry}:${d.isSuperseded}`)).toEqual(['4:false', '2:true'])
  const first = b.finished[0]
  if (first === undefined) throw new Error('no finished entry')
  expect(finishedToast(first)).toBe(
    '✓ S298 shipped; production is live (run 41212658012). ($27.53, 158 min)',
  )
  expect(statusLine(b)).toBe('✗ S299 launcher gone · ● S300 pushing 1h37m · ○ 1 queued · $17.72 in flight')
})

test('nothing running or queued clears the status line', async () => {
  const b = buildBoard({ dispatcher: null, running: [], queued: [], finished: [] }, {}, new Set(), NOW)
  expect(statusLine(b)).toBe(undefined)
})

test('a file that is not the status shape reads as none', async () => {
  expect(parseStatus('not json')).toBe(null)
  expect(parseStatus('[]')).toBe(null)
})

test('an empty lane reads as idle on the hint line and in the lane list', async () => {
  const raw = parseStatus(STATUS)
  if (raw === null) throw new Error('status did not parse')
  const oneRun = { ...raw, running: raw.running.filter(r => r.lane === 'epic'), queued: [] }
  const b = buildBoard(oneRun, {}, new Set([5147, 79762]), NOW)
  expect(statusLine(b)).toBe('● S299 starting 1h06m · fix lane idle · $7.65 in flight')
  expect(lanesOf(b).map(l => `${l.lane}:${l.runs.length}`)).toEqual(['epic:1', 'fix:0'])
})
