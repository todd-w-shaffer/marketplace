import { expect, test } from 'claude-code/testing'

import {
  ago,
  briefFiles,
  briefHeader,
  briefKey,
  cycleBlobs,
  cycleCount,
  dotDigits,
  buildBoard,
  buildLoop,
  deckDetail,
  finishedToast,
  laneTag,
  lanesOf,
  lastToolOf,
  ledgerSpends,
  inFlight,
  localClock,
  loopCostOf,
  loopStageOf,
  newestRunDir,
  onDeckOf,
  outcomeDetail,
  phaseGlyphs,
  phaseLine,
  phasesOf,
  parseStatus,
  recentCandidates,
  recentOf,
  segmentWidth,
  sparkCells,
  spendBuckets,
  spendColor,
  weekSpend,
  runStartedMs,
  stageOf,
  statusLine,
} from '../hooks/board'

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
    { entry: 4, brief: 'docs/briefs/kickoff-sitting-s298-tool-paths-by-default.md', lane: 'fix', status: 0, outcome: 'autopilot: kickoff-sitting-s298-tool-paths-by-default shipped; production is live (run 41212658012). ($27.53, 158 min)' },
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
  // An entry the dispatcher wrote without a lane carries no tag.
  expect(b.finished.map(d => `${d.entry}:${laneTag(d)}`)).toEqual(['4: (fix)', '2:'])
  const first = b.finished[0]
  if (first === undefined) throw new Error('no finished entry')
  expect(finishedToast(first)).toBe(
    '✓ S298 tool-paths-by-default (fix) · shipped · 2h38m · $27.53 · run 41212658012',
  )
  expect(statusLine(b)).toBe('✗ S299 launcher gone │ ● S300 ⣿⣿⣿⣤⣀⡇ ship 1h37m │ ○ 1 │ $17.72')
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
  expect(statusLine(b)).toBe('● S299 ⣤⣀⣀⣀⣀⡇ c1 1h06m │ fix idle │ $7.65')
  expect(lanesOf(b).map(l => `${l.lane}:${l.runs.length}`)).toEqual(['epic:1', 'fix:0'])
})

const toolUse = (name: string, input: Record<string, unknown>): string =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }, { type: 'tool_use', name, input }] } })

test('the newest tool call in a log tail names the tool and what it acts on', async () => {
  const tail = [
    '"partial line cut by tail -c"}]}}',
    toolUse('Read', { file_path: '/w/src/components/dashboard/ImagesPanel.tsx' }),
    toolUse('Bash', { command: 'npm run check:cycle > /tmp/x.log 2>&1', description: 'Run the focused check' }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
    '',
  ].join('\n')
  expect(lastToolOf(tail)).toBe('Bash: Run the focused check')
  expect(lastToolOf(toolUse('Bash', { command: 'git   status\n --short' }))).toBe('Bash: git status --short')
  expect(lastToolOf(toolUse('Edit', { file_path: '/w/test/a/b.test.ts', old_string: 'a', new_string: 'b' }))).toBe('Edit: b.test.ts')
  expect(lastToolOf(toolUse('Skill', { skill: 'commit-skill:commit', args: 'S393 cycle 1' }))).toBe('Skill: commit-skill:commit')
  expect(lastToolOf(toolUse('Grep', { pattern: 'FeedbackLines' }))).toBe('Grep: FeedbackLines')
  expect(lastToolOf(toolUse('TaskStop', { task_id: 'x' }))).toBe('TaskStop')
  expect(lastToolOf(toolUse('Bash', { description: 'x'.repeat(80) })).length).toBe(48)
  expect(lastToolOf('not json\n')).toBe('')
})

// S395's progress up to its xhigh review, and S393's in cycle 2, as their runs wrote them.
const S395 = [
  'skill: commit-skill:commit S395 cycle 1: test/migrations/username-keys.test.ts (new)',
  'commit: (no subject in the command)',
  'skill: code-review low git diff 99c79e1c 0970cf2c',
  'turn ended: success, 112 turns, $5.27 so far: Cycle 2 is building.',
  'skill: commit-skill:commit S395 cycle 2. Scope: test/sweeps/step-up-door.test.ts (new)',
  'commit: (no subject in the command)',
  'skill: code-review low git diff 0970cf2c 3fc618dc',
  "woke for a background task: success, 14 turns, $6.06 so far: Waiting for cycle 3's build.",
  'skill: commit-skill:commit S395 cycle 3: the auth edges, tests only',
  'commit: (no subject in the command)',
  'skill: code-review low git diff 3fc618dc 8370c5b4',
  'cut: session 1 handed over in /x.cut; session 2 starts at /simplify in /w',
  'skill: simplify Changed paths over 99c79e1c..HEAD: docs/auth.md',
  'skill: commit-skill:commit The /simplify pass for S395 over the changed test paths',
  'commit: (no subject in the command)',
  'skill: code-review xhigh git diff 99c79e1c f8420e3a',
].join('\n')
const S393 = [
  "turn ended: success, 96 turns, $6.07 so far: Rebuild is still running.",
  'skill: commit-skill:commit S393 cycle 1: the Images panel draws the arrangement',
  'commit: (no subject in the command)',
  'skill: code-review low 99c79e1c..250176e4',
  'skill: code-review low git diff 99c79e1c 250176e4',
  "woke for a background task: success, 65 turns, $10.62 so far: Cycle 2's build is running.",
].join('\n')

const states = (progress: string, cycles?: number): string =>
  phasesOf(progress, cycles)
    .map(p => `${p.short}:${p.state}`)
    .join(' ')

test('phases follow the chain: each cycle closes on its low review, then simplify, xhigh, ship, archive', async () => {
  expect(states(S393, 2)).toBe('c1:done c2:live simpl:todo xhigh:todo ship:todo arch:todo')
  expect(states(S395, 3)).toBe('c1:done c2:done c3:done simpl:done xhigh:live ship:todo arch:todo')
  // A /commit inside /ship comes before its push, so the run is still shipping.
  const shipping = `${S395}\nskill: commit-skill:ship\nskill: commit-skill:commit uncommitted docs`
  expect(states(shipping, 3)).toBe('c1:done c2:done c3:done simpl:done xhigh:done ship:live arch:todo')
  // The archive's /commit comes after the ship's push.
  const archiving = `${shipping}\nbash: npm run push:checked -- origin HEAD:main 2>&1 | tail\nskill: commit-skill:commit archive S395`
  expect(states(archiving, 3)).toBe('c1:done c2:done c3:done simpl:done xhigh:done ship:done arch:live')
  expect(states(`${archiving}\npushes: 1a2b\nfinished: shipped; production is live (run 1).`, 3)).toBe(
    'c1:done c2:done c3:done simpl:done xhigh:done ship:done arch:done',
  )
})

test('bar blocks fit the pane, between 3 and 7 columns', async () => {
  expect(segmentWidth(60, 7)).toBe(7)
  expect(segmentWidth(40, 7)).toBe(4)
  expect(segmentWidth(12, 9)).toBe(3)
  expect(segmentWidth(200, 5)).toBe(7)
})

test('phases fall back when the cycle count or the cycle number is missing', async () => {
  expect(states('')).toBe('c1:live simpl:todo xhigh:todo ship:todo arch:todo')
  expect(states('skill: commit-skill:commit the panel draws\nskill: code-review low a b', 2)).toBe(
    'c1:done c2:live simpl:todo xhigh:todo ship:todo arch:todo',
  )
  // A fix to cycle 1 after its low review names cycle 1, so cycle 2 is still in flight.
  const fix = 'skill: commit-skill:commit S1 cycle 1\nskill: code-review low a b\nskill: commit-skill:commit S1 cycle 1 review fixes\nskill: code-review low b c'
  expect(states(fix, 2)).toBe('c1:done c2:live simpl:todo xhigh:todo ship:todo arch:todo')
  // A later step implies the earlier ones, whatever the count says.
  expect(states('skill: code-review xhigh a b')).toBe('c1:done simpl:done xhigh:live ship:todo arch:todo')
  // Session 1 ended its cycles: the run waits on the cut, headed for simplify.
  expect(states(S393 + '\nskill: commit-skill:commit S393 cycle 2\nskill: code-review low c d', 2)).toBe(
    'c1:done c2:done simpl:live xhigh:todo ship:todo arch:todo',
  )
})

test('a brief counts its cycles by heading or bold line, and a directory brief reads every file', async () => {
  expect(cycleCount('### Cycle 1: a\ntext\n### Cycle 2: b\n### Cycles in general')).toBe(2)
  expect(cycleCount('**Cycle 1.** a\n**Cycle 2.** b\n**Cycle 3.** c\n### Cycle 1: x')).toBe(3)
  expect(cycleCount('no cycles')).toBe(0)
  const ls = [
    '100644 blob aaa\tdocs/briefs/kickoff-sitting-s393-images-panel.md',
    '100644 blob bbb\tdocs/briefs/s410-big/README.md',
    '100644 blob ccc\tdocs/briefs/s410-big/cycles.md',
    '100644 blob ddd\tdocs/briefs/s410-big/notes/deep.md',
    '100644 blob eee\tdocs/briefs/s410-big/data.json',
  ].join('\n')
  expect(cycleBlobs(ls, 'docs/briefs/kickoff-sitting-s393-images-panel.md')).toEqual(['aaa'])
  expect(cycleBlobs(ls, 'docs/briefs/s410-big')).toEqual(['bbb', 'ccc'])
  expect(cycleBlobs(ls, 'docs/briefs/gone.md')).toEqual([])
})

test('a running card and the hint line show the phase, the stage and the newest tool call', async () => {
  const raw = parseStatus(STATUS)
  if (raw === null) throw new Error('status did not parse')
  const s393 = 'docs/briefs/kickoff-sitting-s393-images-panel.md'
  const s395 = 'docs/briefs/kickoff-sitting-s395-test-guards.md'
  const b = buildBoard(
    {
      ...raw,
      queued: [],
      running: [
        { entry: 1, brief: s393, lane: 'epic', pid: 79762, started: '2026-10-31T15:43:24Z', cost: 0 },
        { entry: 5, brief: s395, lane: 'fix', pid: 21491, started: '2026-10-31T15:11:36Z', cost: 0 },
      ],
    },
    { [s393]: S393, [s395]: S395 },
    new Set([5147, 79762, 21491]),
    NOW,
    { tools: { [s393]: 'Bash: Run the focused check' }, cycles: { [s393]: 2, [s395]: 3 } },
  )
  const [epic, fix] = b.running
  if (epic === undefined || fix === undefined) throw new Error('runs missing')
  expect(phaseLine(epic)).toBe('cycle 2 of 2 · Bash: Run the focused check')
  expect(phaseLine(fix)).toBe('review xhigh')
  expect(phaseLine({ ...epic, stage: 'committing', tool: '' })).toBe('cycle 2 of 2 · committing')
  expect(phaseLine({ ...epic, stage: 'review low', tool: '' })).toBe('cycle 2 of 2')
  expect(statusLine(b)).toBe('● S393 ⣿⣤⣀⣀⣀⣀⡇ c2 1h06m │ ● S395 ⣿⣿⣿⣿⣤⣀⣀⡇ xhigh 1h37m │ $16.68')
})

test('the clock reads in the local offset, to the minute, on a 12-hour face', async () => {
  const t = Date.parse('2026-11-07T00:41:07Z')
  expect(localClock(t, '-0500')).toBe('7:41 PM')
  expect(localClock(t, '+0000')).toBe('12:41 AM')
  expect(localClock(t, '+0530')).toBe('6:11 AM')
  expect(localClock(Date.parse('2026-11-07T17:05:00Z'), '-0500')).toBe('12:05 PM')
  // An offset that does not parse reads as UTC, and says so.
  expect(localClock(t, '')).toBe('12:41 AM UTC')
})

test('the cost in flight adds every run and the loop', async () => {
  const raw = parseStatus(STATUS)
  if (raw === null) throw new Error('status did not parse')
  const b = buildBoard(raw, { 'docs/briefs/kickoff-sitting-s300-loop-run-record.md': S300 }, new Set([5147]), NOW, { utcOffset: '-0500' })
  expect(inFlight(b)).toBe(17.72)
  expect(b.clock).toBe('11:49 AM')
})

test('figures draw as 3-by-5 dot numerals, two braille rows tall', async () => {
  expect(dotDigits('10')).toEqual(['⢴⠀⡖⡆', '⠚⠂⠓⠃'])
  expect(dotDigits('3.5')).toEqual(['⣒⡆⠀⣖⡂', '⠒⠃⠂⠒⠃'])
  expect(dotDigits('0')).toEqual(['⡖⡆', '⠓⠃'])
  // A character the font lacks draws as a blank cell, never a wrong glyph.
  expect(dotDigits('7x')).toEqual([dotDigits('7')[0] + '⠀', dotDigits('7')[1] + '⠀'])
})

test('a phase block fills with braille: full when done, tapering in flight, a baseline to come', async () => {
  expect(phaseGlyphs('done', 4)).toBe('⣿⣿⣿⣿')
  expect(phaseGlyphs('live', 6)).toBe('⣿⣿⣷⣦⣤⣀')
  expect(phaseGlyphs('live', 3)).toBe('⣿⣷⣤')
  expect(phaseGlyphs('live', 2)).toBe('⣿⣤')
  expect(phaseGlyphs('todo', 3)).toBe('⣀⣀⣀')
})

const LEDGER = [
  JSON.stringify({ kind: 'commit', ts: '2026-11-06T12:00:00Z', window: { start: '2026-11-06T11:00:00Z' }, cost: { usd: 6 } }),
  JSON.stringify({ kind: 'ship', ts: '2026-11-06T12:30:00Z', window: { start: '2026-11-06T12:20:00Z' }, overhead: { usd: 1.5 } }),
  JSON.stringify({ kind: 'commit', ts: '2026-11-06T12:40:00Z', cost: { usd: null } }),
  JSON.stringify({ kind: 'commit', ts: '2026-10-20T12:00:00Z', window: { start: '2026-10-20T11:00:00Z' }, cost: { usd: 9 } }),
  '{"kind":"commit","ts":"2026-11-06T13:0',
].join('\n')

test('the ledger reads as spends over each commit and ship window', async () => {
  const spends = ledgerSpends(LEDGER)
  expect(spends.length).toBe(3)
  expect(spends[0]).toEqual({ startMs: Date.parse('2026-11-06T11:00:00Z'), endMs: Date.parse('2026-11-06T12:00:00Z'), usd: 6 })
  const now = Date.parse('2026-11-06T13:00:00Z')
  // Four half-hour buckets ending now: the commit spreads over 11:00-12:00, the ship lands in 12:00-12:30.
  expect(spendBuckets(spends, now, 4, 1800000)).toEqual([3, 3, 1.5, 0])
  expect(weekSpend(spends, now)).toBe(7.5)
})

test('spark cells take two samples each over two rows, and a spend colours by its hourly rate', async () => {
  const { top, bottom } = sparkCells([0, 8, 4, 2], 8)
  expect(top.map(c => c.ch).join('')).toBe('⢸⠀')
  expect(bottom.map(c => c.ch).join('')).toBe('⢸⣧')
  expect(bottom.map(c => c.value)).toEqual([8, 4])
  expect(spendColor(0)).toBe('#7dc4e4')
  expect(spendColor(20)).toBe('#eed49f')
  expect(spendColor(40)).toBe('#ed8796')
  expect(spendColor(99)).toBe('#ed8796')
  expect(spendColor(10)).toBe('#b6ccc2')
})

// A loop run's progress, copied from run 2026-10-28-0730 up to its first landing.
const LOOP_PROGRESS = [
  'turn ended: success, 9 turns, $7.49 so far',
  'stage: p1/review exited 0 ($7.49)',
  'stage: p1/verify-01 exited 0 ($0.51)',
  'stage: p1/plan-01 exited 0 ($2.28)',
  'autopilot: docs/briefs/kickoff-sitting-s276-app-code-length.md exited 0 ($8.91)',
  'turn ended: success, 2 turns, $0.30 so far',
].join('\n')

const file = (path: string, mtimeMs: number) => ({ path, mtimeMs })

test('the newest loop run directory is picked by name, and canary and residue dirs are skipped', async () => {
  expect(
    newestRunDir(['canary-2026-10-31-1509', '2026-10-28-0415-residues', '2026-10-28-0730', 's297', '2026-11-01-1417', '2026-11-01-1417-2']),
  ).toBe('2026-11-01-1417-2')
  expect(newestRunDir(['canary-2026-10-31-1509', 's297'])).toBe(null)
  expect(runStartedMs('2026-11-01-1417')).toBe(Date.parse('2026-11-01T14:17:00Z'))
})

test('the loop stage is the newest session log or landing output', async () => {
  expect(loopStageOf([], '')).toBe('starting')
  expect(loopStageOf([file('p1/review.log', 1), file('p1/review.log.err', 9)], '')).toBe('review p1')
  expect(loopStageOf([file('p1/review.log', 1), file('p1/verify-01.log', 2), file('p1/card-01.json', 9)], '')).toBe('verify 01')
  expect(loopStageOf([file('p1/verify-01.log', 2), file('p1/plan-01.log', 3)], '')).toBe('plan 01')
  expect(loopStageOf([file('p1/plan-01.log', 3), file('p1/plan-01.autopilot', 4)], '')).toBe('landing 01')
  expect(loopStageOf([file('p1/plan-residues.log', 3), file('p1/plan-residues.autopilot', 4)], '')).toBe('landing residues')
  expect(loopStageOf([file('p2/review.log', 5), file('p1/plan-01.autopilot', 4)], '')).toBe('review p2')
  expect(loopStageOf([file('p1/review.log', 1)], 'finished: ended: the cap ($54.44, 200 min)')).toBe('finishing')
})

test('the loop cost adds finished stages and landings, and the session in flight', async () => {
  expect(loopCostOf(LOOP_PROGRESS).toFixed(2)).toBe('19.49')
  // A finished stage carries its session's spend, so the so-far line before it is not counted twice.
  expect(loopCostOf('turn ended: success, 9 turns, $7.49 so far\nstage: p1/review exited 0 ($7.49)').toFixed(2)).toBe('7.49')
  expect(loopCostOf('')).toBe(0)
})

test('a live loop replaces fix lane idle, and tags a landing of its own', async () => {
  const at = Date.parse('2026-11-01T14:31:00Z')
  const idle = buildBoard(
    { dispatcher: null, running: [], queued: [], finished: [] },
    {},
    new Set(),
    at,
    { loop: buildLoop('2026-11-01-1417', [file('p1/review.log', 1)], 'turn ended: success, 3 turns, $3.20 so far', at) },
  )
  expect(statusLine(idle)).toBe('epic idle │ ◐ loop review p1 14m │ $3.20')

  const landing = buildBoard(
    {
      dispatcher: 1,
      running: [{ entry: 20, brief: 'docs/briefs/kickoff-sitting-s316-x.md', lane: 'fix', pid: 7, started: '2026-11-01T14:21:00Z', cost: 2 }],
      queued: [],
      finished: [],
    },
    {},
    new Set([1, 7]),
    at,
    { loop: buildLoop('2026-11-01-1417', [file('p1/plan-01.autopilot', 4)], LOOP_PROGRESS, at) },
  )
  expect(statusLine(landing)).toBe('epic idle │ ● S316 ⣤⣀⣀⣀⣀⡇ c1 10m (loop) │ $21.49')
})

test('an outcome reads as one detail line, outcome then time then cost', async () => {
  expect(outcomeDetail('shipped; production is live (run 41303865474). ($26.11, 223 min, peak 385k context)')).toBe(
    'shipped · 3h43m · $26.11 · peak 385k · run 41303865474',
  )
  expect(
    outcomeDetail(
      'shipped; production is live (run 41751690490); Migrate Production applied migrations/0050_gallery-skip-not-copied.sql (run 41751863985). ($13.98, 63 min, peak 194k context)',
    ),
  ).toBe('shipped · 1h03m · $13.98 · peak 194k · run 41751690490 · migrated 0050')
  expect(outcomeDetail('stopped at review. ($4.10, 7 min)')).toBe('stopped at review. · 7m · $4.10')
  expect(outcomeDetail('main has commits origin/main does not. Push or drop them first.')).toBe(
    'main has commits origin/main does not. Push or drop them first.',
  )
})

test('recent reads the last finished line of each sitting, newest first, and skips what runs', async () => {
  const files = [
    { name: 'README.progress', mtimeMs: 99 },
    { name: 'kickoff-sitting-s340-e8-help-pages.progress', mtimeMs: 50 },
    { name: 'kickoff-sitting-s337-gallery-arrange-page.progress', mtimeMs: 40 },
    { name: 'kickoff-sitting-s339-background-suite.progress', mtimeMs: 30 },
    { name: 'kickoff-sitting-s336-no-outcome.progress', mtimeMs: 20 },
    { name: 'kickoff-sitting-s340-e8-help-pages.log', mtimeMs: 60 },
  ]
  const picked = recentCandidates(files, ['docs/briefs/kickoff-sitting-s340-e8-help-pages.md'])
  expect(picked.map(f => f.name)).toEqual([
    'kickoff-sitting-s337-gallery-arrange-page.progress',
    'kickoff-sitting-s339-background-suite.progress',
    'kickoff-sitting-s336-no-outcome.progress',
  ])
  const text: Record<string, string> = {
    'kickoff-sitting-s337-gallery-arrange-page.progress':
      'commit: x\nfinished: shipped; production is live (run 41585826609). ($32.71, 108 min, peak 360k context)',
    // A refusal appended after an earlier ship is the sitting's last outcome.
    'kickoff-sitting-s339-background-suite.progress':
      'finished: shipped; production is live (run 1). ($1.00, 5 min)\nfinished: stopped: the brief is still in docs/briefs. Read the handoff.',
    'kickoff-sitting-s336-no-outcome.progress': 'skill: simplify x',
  }
  const recent = recentOf(
    picked.map(f => ({ ...f, text: text[f.name] ?? '' })),
    [{ entry: 51, brief: 'docs/briefs/kickoff-sitting-s337-gallery-arrange-page.md', lane: 'epic', status: 0, outcome: '' }],
  )
  expect(recent.map(d => `${d.sitting}:${d.isShipped}${laneTag(d)}:${d.endedMs}`)).toEqual(['S337:true (epic):40', 'S339:false:30'])
  expect(recent[0]?.detail).toBe('shipped · 1h48m · $32.71 · peak 360k · run 41585826609')
  expect(recent[1]?.detail).toBe('stopped: the brief is still in docs/briefs. Read the handoff.')
})

test('ago reads in hours and minutes for two days, then in days', async () => {
  const m = 60000
  expect(ago(0, 24 * m)).toBe('24m ago')
  expect(ago(0, 312 * m)).toBe('5h12m ago')
  expect(ago(0, 3 * 24 * 60 * m)).toBe('3d ago')
})

const LS_TREE = [
  '100644 blob aaa111\tdocs/briefs/README.md',
  '100644 blob bbb222\tdocs/briefs/kickoff-sitting-s342-gallery-pass-keeps-stars.md',
  '100644 blob ccc333\tdocs/briefs/kickoff-sitting-s340-e8-help-pages.md',
  '100644 blob ddd444\tdocs/briefs/rules/README.md',
  '100644 blob eee555\tdocs/briefs/rules/autopilot.md',
  '100644 blob fff666\tdocs/briefs/s350-split-work/README.md',
  '100644 blob 000777\tdocs/briefs/s350-split-work/session-1.md',
  '100644 blob 111888\tdocs/briefs/sittings.json',
  '100644 blob 222999\tdocs/briefs/kickoff-527-gallery-race.md',
].join('\n')

const S342 = [
  '# S342: a sync pass never undoes a star',
  '',
  '**Mode: autopilot.** `docs/briefs/rules/autopilot.md` governs this run.',
  '',
  'Epic: minisite/E4',
  'Finishes: issue 527',
  'After: S340, S341',
  'Touches: src/utils/gallery-pass.ts',
  '',
  '## What this delivers',
  'Epic: not/this',
].join('\n')

test('brief files are top-level kickoffs and directory READMEs, not rules or the index', async () => {
  expect(briefFiles(LS_TREE).map(f => f.path)).toEqual([
    'docs/briefs/kickoff-sitting-s342-gallery-pass-keeps-stars.md',
    'docs/briefs/kickoff-sitting-s340-e8-help-pages.md',
    'docs/briefs/s350-split-work/README.md',
    'docs/briefs/kickoff-527-gallery-race.md',
  ])
  expect(briefFiles(LS_TREE)[0]?.sha).toBe('bbb222')
})

test('a brief key is the queue path, and a directory brief is its directory', async () => {
  expect(briefKey('docs/briefs/s350-split-work/README.md')).toBe('docs/briefs/s350-split-work')
  expect(briefKey('/Users/x/repo/docs/briefs/s350-split-work/')).toBe('docs/briefs/s350-split-work')
  expect(briefKey('docs/briefs/kickoff-sitting-s342-x.md')).toBe('docs/briefs/kickoff-sitting-s342-x.md')
})

test('the header stops at the first heading', async () => {
  expect(briefHeader(S342)).toEqual({ epic: 'minisite/E4', after: 'S340, S341', isAutopilot: true })
  expect(briefHeader('# x\n\nFinishes: issue 1\n\n## y')).toEqual({ epic: '', after: '', isAutopilot: false })
})

test('on deck lists unheld briefs by sitting, epic lane from the Epic line', async () => {
  const texts: Record<string, string> = { bbb222: S342, ccc333: '**Mode: autopilot.**\nEpic: account-basics/E8\n## a', fff666: '**Mode: autopilot.**\n## a', '222999': '# issue\n## a' }
  const briefs = briefFiles(LS_TREE).map(f => ({ ...f, text: texts[f.sha] ?? '' }))
  const deck = onDeckOf(briefs, ['docs/briefs/kickoff-sitting-s340-e8-help-pages.md'])
  expect(deck.map(d => `${d.sitting} ${d.slug} ${deckDetail(d)}`)).toEqual([
    'S342 gallery-pass-keeps-stars epic · minisite/E4 · after S340, S341',
    'S350 split-work fix',
    '#527 gallery-race fix · interactive',
  ])
  expect(onDeckOf(briefs, ['docs/briefs/s350-split-work/README.md']).some(d => d.sitting === 'S350')).toBe(false)
})
