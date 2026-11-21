import { expect, test } from 'claude-code/testing'

import {
  afterSittings,
  ago,
  agoShort,
  costMeter,
  briefFiles,
  briefHeader,
  briefKey,
  cycleBlobs,
  cycleCount,
  dotDigits,
  handoffQuestion,
  buildBoard,
  buildLoop,
  deckDetail,
  deckTree,
  finishedToast,
  laneTag,
  lanesOf,
  lastToolOf,
  ledgerChunk,
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
  phaseName,
  phasesOf,
  queueTree,
  parseStatus,
  recentCandidates,
  recentOf,
  segmentWidth,
  spendTotals,
  runStartedMs,
  stageOf,
  statusLine,
  tileFace,
  KIND_TAG,
  deployStageOf,
  deployStateOf,
  DEPLOY_LIVE,
  foldSummary,
  isFolded,
  lastEnd,
} from '../hooks/board'
import type { Deck, Run } from '../types'

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

test('a free slot has no card and no idle part on the hint line', async () => {
  const raw = parseStatus(STATUS)
  if (raw === null) throw new Error('status did not parse')
  const oneRun = { ...raw, running: raw.running.filter(r => r.lane === 'epic'), queued: [] }
  const b = buildBoard(oneRun, {}, new Set([5147, 79762]), NOW)
  expect(statusLine(b)).toBe('● S299 ⣤⣀⣀⣀⣀⡇ c1 1h06m │ $7.65')
  expect(lanesOf(b).map(l => `${l.lane}:${l.runs.length}`)).toEqual(['epic:1'])
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

test('a run with step 0 opens on a savor phase that its own commit closes', async () => {
  const savoring = 'skill: sittings:savor launch docs/briefs/kickoff-sitting-s608-gallery-id.md'
  expect(states(savoring, 2)).toBe('savor:live c1:todo c2:todo simpl:todo xhigh:todo ship:todo arch:todo')
  // The step-0 commit names no cycle and gets no low review: it closes the savor, not cycle 1.
  const saved = `${savoring}\nskill: commit-skill:commit S608 step 0: savor at launch edits\ncommit: docs(briefs): tighten S608`
  expect(states(saved, 2)).toBe('savor:done c1:live c2:todo simpl:todo xhigh:todo ship:todo arch:todo')
  const cycle1 = `${saved}\nskill: commit-skill:commit S608 cycle 1: the id\nskill: code-review low a b`
  expect(states(cycle1, 2)).toBe('savor:done c1:done c2:live simpl:todo xhigh:todo ship:todo arch:todo')
  // Session 2 re-reads the same progress file, so its stages still follow the savor.
  expect(states(`${cycle1}\nskill: code-review xhigh a b`, 2)).toBe(
    'savor:done c1:done c2:done simpl:done xhigh:live ship:todo arch:todo',
  )
  expect(phaseLine({ phases: phasesOf(savoring, 2), stage: 'savor', tool: 'Agent: systems' } as Run)).toBe(
    'session 0 · Agent: systems',
  )
})

test('a savor file closes a savor that made no edits, so the first cycle commit counts as cycle 1', async () => {
  const savoring = 'skill: sittings:savor launch docs/briefs/kickoff-sitting-s620-x.md'
  const handed = `${savoring}\nsavored: session 0 handed over in /x.savored; session 1 starts at cycle 1 in /w`
  expect(states(handed, 2)).toBe('savor:done c1:live c2:todo simpl:todo xhigh:todo ship:todo arch:todo')
  const cycle1 = `${handed}\nskill: commit-skill:commit S620 cycle 1: the id\nskill: code-review low a b`
  expect(states(cycle1, 2)).toBe('savor:done c1:done c2:live simpl:todo xhigh:todo ship:todo arch:todo')
})

test('bar blocks fit the pane, between 3 and 9 columns', async () => {
  expect(segmentWidth(60, 7)).toBe(7)
  expect(segmentWidth(40, 7)).toBe(4)
  expect(segmentWidth(12, 9)).toBe(3)
  expect(segmentWidth(200, 5)).toBe(9)
})

test('a phase label is the longest of its names that fits, never a cut word', async () => {
  const label = (p: string, room: number): string => phaseName({ label: p, short: '', state: 'todo' }, room)
  expect(label('simplify', 8)).toBe('simplify')
  expect(label('simplify', 6)).toBe('simpl')
  expect(label('simplify', 4)).toBe('simp')
  expect(label('simplify', 2)).toBe('si')
  expect(label('savor', 4)).toBe('sav')
  expect(label('archiving', 8)).toBe('archive')
  expect(label('archiving', 5)).toBe('arch')
  expect(label('review xhigh', 4)).toBe('xhi')
  expect(label('shipping', 8)).toBe('ship')
  expect(label('cycle 2', 8)).toBe('cycle 2')
  expect(label('cycle 2', 6)).toBe('c2')
  expect(label('cycle 12', 2)).toBe('c1')
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
  // The bar's lit label names the cycle, so the phase line names only the session.
  expect(phaseLine(epic)).toBe('session 1 · Bash: Run the focused check')
  expect(phaseLine(fix)).toBe('session 2')
  expect(phaseLine({ ...epic, stage: 'committing', tool: '' })).toBe('session 1 · committing')
  expect(phaseLine({ ...epic, stage: 'review low', tool: '' })).toBe('session 1')
  expect(phaseLine({ ...epic, phases: epic.phases.map(p => ({ ...p, state: 'done' as const })), tool: '' })).toBe('finishing')
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

test('figures draw as 3-by-7 dot numerals, two braille rows tall', async () => {
  expect(dotDigits('10')).toEqual(['⢺⠀⡏⡇', '⠼⠄⠧⠇'])
  expect(dotDigits('3.5')).toEqual(['⣉⡇⠀⣏⡁', '⠤⠇⠄⠤⠇'])
  expect(dotDigits('0')).toEqual(['⡏⡇', '⠧⠇'])
  expect(dotDigits('7')).toEqual(['⠉⡇', '⠀⠇'])
  // A character the font lacks draws as a blank cell, never a wrong glyph.
  expect(dotDigits('7x')).toEqual([dotDigits('7')[0] + '⠀', dotDigits('7')[1] + '⠀'])
})

test('a header tile sets its figure right-aligned over a rule, and its label in plain lowercase', async () => {
  // The label is wider: the figure shifts right, and the rule spans the label.
  expect(tileFace('7', 'queued')).toEqual({ top: '    ⠉⡇', bottom: '    ⠀⠇', rule: '──────', label: 'queued' })
  // The figure is wider: the label pads out to it, so every row of the tile is one width.
  const [top, bottom] = dotDigits('13402')
  expect(tileFace('13402', '$ month')).toEqual({ top, bottom, rule: '─'.repeat(10), label: '$ month   ' })
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

test('the ledger reads as spends, and totals by day, week, month and all time', async () => {
  const spends = ledgerSpends(LEDGER)
  expect(spends.length).toBe(3)
  expect(spends[0]).toEqual({ startMs: Date.parse('2026-11-06T11:00:00Z'), endMs: Date.parse('2026-11-06T12:00:00Z'), usd: 6 })
  const now = Date.parse('2026-11-06T13:00:00Z')
  // The October commit is outside the week and inside the month.
  expect(spendTotals(spends, now)).toEqual({ day: 7.5, week: 7.5, month: 16.5, all: 16.5 })
  expect(spendTotals(spends, Date.parse('2026-12-30T00:00:00Z'))).toEqual({ day: 0, week: 0, month: 0, all: 16.5 })
})

test('the ledger reads in chunks that cut lines anywhere', async () => {
  const text = `${LEDGER.split('\n').slice(0, 4).join('\n')}\n`
  // Every cut point gives the same spends as one read, and leaves nothing behind.
  for (const cut of [1, 37, 120, text.length - 1]) {
    const first = ledgerChunk('', text.slice(0, cut))
    const second = ledgerChunk(first.partial, text.slice(cut))
    expect([...first.spends, ...second.spends]).toEqual(ledgerSpends(text))
    expect(second.partial).toBe('')
  }
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

test('a live loop shows its stage, and tags a landing of its own', async () => {
  const at = Date.parse('2026-11-01T14:31:00Z')
  const idle = buildBoard(
    { dispatcher: null, running: [], queued: [], finished: [] },
    {},
    new Set(),
    at,
    { loop: buildLoop('2026-11-01-1417', [file('p1/review.log', 1)], 'turn ended: success, 3 turns, $3.20 so far', at) },
  )
  expect(statusLine(idle)).toBe('◐ loop review p1 14m │ $3.20')

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
  expect(statusLine(landing)).toBe('● S316 ⣤⣀⣀⣀⣀⡇ c1 10m (loop) │ $21.49')
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
  // A deploy that failed shipped code but put nothing live, so it is no ship.
  text['kickoff-sitting-s338-red-deploy.progress'] =
    'kind: deploy-red\nfinished: shipped; deploy failed (run 44071838536). ($80.79, 140 min)'
  const recent = recentOf(
    [...picked, { name: 'kickoff-sitting-s338-red-deploy.progress', mtimeMs: 35 }].map(f => ({ ...f, text: text[f.name] ?? '' })),
    [{ entry: 51, brief: 'docs/briefs/kickoff-sitting-s337-gallery-arrange-page.md', lane: 'epic', status: 0, outcome: '', kind: null }],
  )
  // RECENT lists only runs live in production: a stop and a red deploy are left out.
  expect(recent.map(d => `${d.sitting}${laneTag(d)}:${d.endedMs}`)).toEqual(['S337 (epic):40'])
  expect(recent[0]?.detail).toBe('shipped · 1h48m · $32.71 · peak 360k · run 41585826609')
  expect(recent.map(d => [d.minutes, d.usd])).toEqual([[108, 32.71]])
})

test('a cost meter fills braille cells to scale, then the baseline', async () => {
  expect(costMeter(32, 32, 6)).toEqual({ fill: '⣿⣿⣿⣿⣿⣿', rest: '' })
  expect(costMeter(16, 32, 6)).toEqual({ fill: '⣿⣿⣿', rest: '⣀⣀⣀' })
  // A part cell between full ones steps up through partial fills.
  expect(costMeter(18, 32, 6)).toEqual({ fill: '⣿⣿⣿⣄', rest: '⣀⣀' })
  expect(costMeter(0.5, 32, 6)).toEqual({ fill: '⡀', rest: '⣀⣀⣀⣀⣀' })
  expect(costMeter(0, 32, 6)).toEqual({ fill: '', rest: '⣀⣀⣀⣀⣀⣀' })
  expect(costMeter(5, 0, 4)).toEqual({ fill: '', rest: '⣀⣀⣀⣀' })
})

test('a short age reads in minutes, then hours, then days', async () => {
  const at = Date.parse('2026-11-06T12:00:00Z')
  expect(agoShort(at - 14 * 60000, at)).toBe('14m')
  expect(agoShort(at - 5 * 3600000 - 50 * 60000, at)).toBe('5h')
  expect(agoShort(at - 3 * 86400000, at)).toBe('3d')
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
  expect(briefHeader(S342)).toEqual({ epic: 'minisite/E4', after: 'S340, S341', mode: 'ready', why: '' })
  expect(briefHeader('# x\n\nFinishes: issue 1\n\n## y')).toEqual({ epic: '', after: '', mode: 'enrich', why: '' })
})

test('an interactive brief says why it needs a person', async () => {
  const text = '# x\n\n**Mode: interactive.** Removes a wrangler.toml line.\n\n## y\n**Mode: autopilot.**'
  expect(briefHeader(text)).toEqual({ epic: '', after: '', mode: 'interactive', why: 'Removes a wrangler.toml line.' })
})

test('an After line names its sittings', async () => {
  expect(afterSittings('S390, S393')).toEqual(['S390', 'S393'])
  expect(afterSittings('s340 and S341; issue #12')).toEqual(['S340', 'S341'])
  expect(afterSittings('')).toEqual([])
})

test('a queued entry carries its brief\'s After sittings', async () => {
  const raw = parseStatus(STATUS)
  if (raw === null) throw new Error('status did not parse')
  const key = briefKey('docs/briefs/kickoff-sitting-s301-time-limit-record.md')
  const b = buildBoard(raw, {}, new Set(), NOW, { afters: { [key]: ['S299', 'S290'] } })
  expect(b.queued.map(q => q.after)).toEqual([['S299', 'S290']])
  expect(buildBoard(raw, {}, new Set(), NOW).queued.map(q => q.after)).toEqual([[]])
})

const RUNNING = [
  { sitting: 'S403', slug: 'dashboard-groups', lane: 'epic' },
  { sitting: 'S396', slug: 'prune-test-overlaps', lane: 'fix' },
]
const waits = (entry: number, sitting: string, lane: string, after: string[], reason = '') => ({ entry, sitting, slug: sitting.toLowerCase(), lane, reason, after })
const drawn = (rows: ReturnType<typeof queueTree>) => rows.map(r => `${r.rails}${r.joint}${r.sitting} ${r.note}`.trimEnd())

test('the queue draws as a tree: each entry under what it needs, and one that needs nothing in the tree is a root', async () => {
  const queued = [
    waits(3, 'S405', 'epic', ['S404'], 'a free slot'),
    waits(4, 'S406', 'epic', ['S405']),
    waits(7, 'S397', 'fix', ['S395', 'S396']),
    waits(8, 'S398', 'fix', ['S397']),
    waits(12, 'S402', 'fix', ['S396']),
    waits(13, 'S407', 'epic', [], 'a free slot'),
  ]
  // S404 and S395 are neither running nor queued: they shipped, so they draw no edge.
  // S403 runs but nothing names it on an After line, so it draws no root, whatever the lanes say.
  expect(drawn(queueTree(RUNNING, queued, []))).toEqual([
    'S396',
    '├─S397',
    '│ └─S398',
    '└─S402',
    'S405 a free slot',
    '└─S406',
    'S407 a free slot',
  ])
  expect(queueTree(RUNNING, queued, []).map(r => r.kind)).toEqual(['run', 'after', 'after', 'after', 'free', 'after', 'free'])
})

test('an entry with no After line hangs under no run, even one whose lane matches', async () => {
  const rows = queueTree([{ sitting: 'S524', slug: 'challenge-read-once', lane: '' }], [waits(145, 'S522', '', [], 'a free slot')], [])
  expect(drawn(rows)).toEqual(['S522 a free slot'])
})

test('an entry that needs two hangs under the one deeper in the tree, and names only the other', async () => {
  const queued = [waits(7, 'S397', 'fix', ['S396']), waits(8, 'S398', 'fix', ['S397']), waits(12, 'S402', 'fix', ['S396', 'S398'])]
  expect(drawn(queueTree(RUNNING, queued, []))).toEqual(['S396', '└─S397', '  └─S398', '    └─S402 after S396'])
})

test('an entry with nothing in the tree to wait on is its own root, with the dispatcher\'s reason', async () => {
  const queued = [waits(9, 'S500', 'epic', ['S404'], 'S404, which is not queued')]
  // No epic run holds the lane, so S500 hangs under nothing; S396 has no waiters and stays out.
  const rows = queueTree(RUNNING.slice(1), queued, [])
  expect(drawn(rows)).toEqual(['S500 S404, which is not queued'])
  expect(rows.map(r => r.kind)).toEqual(['free'])
})

test('an entry held off a run that shares its paths is a root tagged held, not an edge under that run', async () => {
  const queued = [
    waits(10, 'S522', 'epic', [], 'kickoff-sitting-s518-device-lab-webkit in slot 1: both touch CLAUDE.md'),
    waits(11, 'S523', 'epic', [], 'kickoff-sitting-s519-device-lab-simulator (pid 4242): both touch package.json, docs/e2e-testing.md'),
  ]
  const rows = queueTree([], queued, [])
  expect(drawn(rows)).toEqual(['S522 held · S518 shares CLAUDE.md', 'S523 held · S519 shares package.json, docs/e2e-testing.md'])
  expect(rows.map(r => r.kind)).toEqual(['held', 'held'])
})

test('on deck lists unheld briefs by sitting, epic lane from the Epic line', async () => {
  const texts: Record<string, string> = { bbb222: S342, ccc333: '**Mode: autopilot.**\nEpic: account-basics/E8\n## a', fff666: '**Mode: autopilot.**\n## a', '222999': '# issue\n## a' }
  const briefs = briefFiles(LS_TREE).map(f => ({ ...f, text: texts[f.sha] ?? '' }))
  const deck = onDeckOf(briefs, ['docs/briefs/kickoff-sitting-s340-e8-help-pages.md'])
  expect(deck.map(d => `${d.sitting} ${d.slug} ${deckDetail(d)}`)).toEqual([
    'S342 gallery-pass-keeps-stars epic · minisite/E4',
    'S350 split-work fix',
    '#527 gallery-race fix',
  ])
  expect(deck.map(d => d.mode)).toEqual(['ready', 'ready', 'enrich'])
  expect(onDeckOf(briefs, ['docs/briefs/s350-split-work/README.md']).some(d => d.sitting === 'S350')).toBe(false)
})

const deckOf = (sitting: string, mode: Deck['mode'], after = '', why = ''): Deck => ({ sitting, slug: sitting.toLowerCase(), lane: 'fix', epic: '', after, mode, why })
const deckDrawn = (rows: ReturnType<typeof deckTree>) => rows.map(r => `${r.rails}${r.joint}${r.kind === 'group' ? r.slug : r.sitting} ${r.note}`.trimEnd())

test('on deck draws as a tree under ready, enrich and needs you, each brief under the one it waits on', async () => {
  const deck = [
    deckOf('S467', 'ready'),
    deckOf('S470', 'ready', 'S429, S434'),
    deckOf('S471', 'ready', 'S470'),
    deckOf('S473', 'ready', 'S470, S471'),
    deckOf('S472', 'enrich', 'S470, S471, S475'),
    deckOf('S474', 'enrich'),
    deckOf('S435', 'interactive', 'S470', 'Todd records the probe answers.'),
    deckOf('S436', 'interactive', 'S429, S434', 'Removes a wrangler.toml line.'),
  ]
  // S475 is queued, S434 is running, S429 has shipped: only the first two are still waited on.
  expect(deckDrawn(deckTree(deck, ['S475', 'S434']))).toEqual([
    'ready 4',
    '├╌S467 fix',
    '└╌S470 fix · after S434',
    '  └─S471 fix · after S470',
    '    └─S473 fix · after S470, S471',
    'enrich 2',
    '├╌S472 fix · after S470, S471, S475',
    '└╌S474 fix',
    'needs you 2',
    '├╌S435 fix · after S470 · Todd records the probe answers.',
    '└╌S436 fix · after S434 · Removes a wrangler.toml line.',
  ])
  expect(deckTree(deck, []).filter(r => r.kind === 'group').map(r => r.mode)).toEqual(['ready', 'enrich', 'interactive'])
})

test('an empty group draws nothing, and a ring of waits still draws every brief', async () => {
  const deck = [deckOf('S500', 'enrich', 'S501'), deckOf('S501', 'enrich', 'S500')]
  const rows = deckDrawn(deckTree(deck, []))
  expect(rows[0]).toBe('enrich 2')
  expect(rows.length).toBe(3)
  expect(rows.some(r => r.includes('S500')) && rows.some(r => r.includes('S501'))).toBe(true)
})

// S625's real stop: its progress file as the launcher wrote it, and the status
// file of the dispatcher that ran it, which writes no `kind` and no `cause`.
const S625_PROGRESS = [
  'skill: sittings:savor launch /Users/toddwshaffer/Desktop/apps/shootsfilm/.claude/worktrees/s625-galler',
  'skill: commit-skill:commit Stop 6 handoff for S625 (autopilot session 0). Commit both changed paths: docs/b',
  "commit: docs(handoff): hand off S625 at step 0's failed premise on the empty panel",
  'turn ended: success, 23 turns, $9.56 so far: Four reviewers running: systems, integration, testing strategy, and history.',
  "woke for a background task: success, 17 turns, $9.56 so far: **Subject:** docs(handoff): hand off S625 at step 0's failed premise on the empty panel",
  'pushes:',
  'kind: decision',
  'finished: stopped: the brief is still in docs/briefs. Read the handoff. ($9.56, 12 min, peak 159k context)',
].join('\n')
const S625_HANDOFF = [
  '# S625 handoff: stop 6, step 0 finds that an added empty panel does not survive the sort',
  '',
  '**Stop:** 6. The step 0 savor at launch (`/savor launch`) classified one finding as `premise fails`.',
  '',
  '**Question: how long does an empty panel the photographer added last, and what may the sort do to it?**',
].join('\n')
const BRIEFS = 'docs/briefs/kickoff-sitting-'
const S625_AFTERS = {
  [`${BRIEFS}s625-gallery-arrange-doors.md`]: ['S624'],
  [`${BRIEFS}s626-gallery-arrange-page.md`]: ['S625'],
  [`${BRIEFS}s627-gallery-arrange-options.md`]: ['S626'],
}
const S625_STATUS = {
  dispatcher: 927,
  running: [],
  queued: [],
  finished: [
    { entry: 281, brief: `${BRIEFS}s624-gallery-sort.md`, lane: '', status: 0, outcome: 'autopilot: kickoff-sitting-s624-gallery-sort shipped; production is live (run 44101392229). ($70.28, 114 min)', kind: null },
    { entry: 282, brief: `${BRIEFS}s625-gallery-arrange-doors.md`, lane: '', status: 1, outcome: 'autopilot: kickoff-sitting-s625-gallery-arrange-doors stopped: the brief is still in docs/briefs. Read the handoff. ($9.56, 12 min, peak 159k context)', kind: null },
    { entry: 283, brief: `${BRIEFS}s626-gallery-arrange-page.md`, lane: '', status: 1, outcome: 'autopilot: kickoff-sitting-s626-gallery-arrange-page refused: S625 stopped before it shipped.', kind: null },
  ],
}
const S625_ENDINGS = [
  { base: 'kickoff-sitting-s624-gallery-sort', text: 'finished: shipped; production is live (run 44101392229). ($70.28, 114 min)', mtimeMs: 10 },
  { base: 'kickoff-sitting-s625-gallery-arrange-doors', text: S625_PROGRESS, mtimeMs: 20 },
  { base: 'kickoff-sitting-s626-gallery-arrange-page', text: 'finished: refused: S625 stopped before it shipped (stopped: the brief is still in docs/briefs. Read the handoff.).', mtimeMs: 21 },
]
const heldDeck = (sitting: string, slug: string): Deck => ({ sitting, slug, lane: 'epic', epic: 'gallery', after: '', mode: 'ready', why: '' })

test("S625's decision stop is one block that holds S626 and S627, which leave on deck", async () => {
  const b = buildBoard(S625_STATUS, {}, new Set([927]), NOW, {
    endings: S625_ENDINGS,
    afters: S625_AFTERS,
    handoffs: { 'kickoff-sitting-s625-gallery-arrange-doors': S625_HANDOFF },
    onDeck: [heldDeck('S625', 'gallery-arrange-doors'), heldDeck('S626', 'gallery-arrange-page'), heldDeck('S627', 'gallery-arrange-options'), heldDeck('S640', 'other')],
  })
  expect(b.blocked.length).toBe(1)
  const k = b.blocked[0]
  if (k === undefined) throw new Error('no block')
  // The kind comes from the progress file's `kind:` line: status.json has none.
  expect(`${KIND_TAG[k.kind]} ${k.headline}`).toBe(
    '? you S625 asks: how long does an empty panel the photographer added last, and what may the sort do to it?',
  )
  expect(k.why).toBe('savor found a failed premise · nothing pushed · 12m · $9.56')
  expect(k.strip.map(c => `${c.stage}:${c.state}`)).toEqual(['savor:broke', 'cycles:todo', 'push:todo', 'staging:todo', 'prod:todo'])
  // The refused S626 is a hold, never a root of its own.
  expect(k.holds).toEqual([
    { sitting: 'S626', slug: 'gallery-arrange-page', parent: 'S625', after: ['S625'] },
    { sitting: 'S627', slug: 'gallery-arrange-options', parent: 'S626', after: ['S626'] },
  ])
  expect(k.next).toBe('answer in the handoff, then relaunch S625')
  expect(b.onDeck.map(d => d.sitting)).toEqual(['S640'])
  expect(foldSummary('blocked', b)).toBe('1 cause · holds 2 · ? you S625')
  expect(b.recent).toEqual([])
})

test('a relaunched sitting is no longer stuck, and its chain waits in the queue', async () => {
  const raw = {
    ...S625_STATUS,
    queued: [
      { entry: 289, brief: `${BRIEFS}s625-gallery-arrange-doors.md`, lane: '', reason: 'a free slot' },
      { entry: 290, brief: `${BRIEFS}s626-gallery-arrange-page.md`, lane: '', reason: 'S625' },
    ],
  }
  const b = buildBoard(raw, {}, new Set(), NOW, { endings: S625_ENDINGS, afters: S625_AFTERS })
  expect(b.blocked).toEqual([])
})

test("the dispatcher's cause holds a queued entry, and a null cause holds none", async () => {
  const raw = parseStatus(
    JSON.stringify({
      dispatcher: 1,
      running: [],
      queued: [
        { entry: 1, brief: `${BRIEFS}s626-gallery-arrange-page.md`, lane: '', reason: 'S625', cause: { kind: 'decision', sitting: 'S625' } },
        { entry: 2, brief: `${BRIEFS}s640-other.md`, lane: '', reason: 'a free slot', cause: null },
        { entry: 3, brief: `${BRIEFS}s641-migrate.md`, lane: '', reason: 'a deploy newer than run 77', cause: { kind: 'deploy-red', run: 77 } },
      ],
      finished: [],
    }),
  )
  if (raw === null) throw new Error('no status')
  const endings = [
    { base: 'kickoff-sitting-s625-gallery-arrange-doors', text: S625_PROGRESS, mtimeMs: 20 },
    { base: 'kickoff-sitting-s623-gallery-pins', text: 'bash: npm run push:checked\nkind: deploy-red\nfinished: shipped; deploy failed (run 77). ($80.79, 140 min)', mtimeMs: 30 },
  ]
  const b = buildBoard(raw, {}, new Set(), NOW, { endings, afters: S625_AFTERS, deployStages: { '77': 'staging' } })
  expect(b.blocked.map(k => `${k.kind} ${k.sitting} holds ${k.holds.map(h => `${h.sitting}<${h.parent}`).join(',')}`)).toEqual([
    'decision S625 holds S626<S625,S627<S626',
    'deploy-red S623 holds S641<S623',
  ])
  const red = b.blocked[1]
  expect(red?.headline).toBe('Deploy red: S623 never went live')
  expect(red?.strip.map(c => `${c.stage}:${c.state}`)).toEqual(['savor:skip', 'cycles:done', 'push:done', 'staging:broke', 'prod:todo'])
  expect(red?.next).toBe('re-run it if it is a flake, else fix main; the next green deploy clears it and releases the one it holds')
})

test('a red deploy stops being stuck once a later run goes live', async () => {
  const endings = [
    { base: 'kickoff-sitting-s623-gallery-pins', text: 'finished: shipped; deploy failed (run 77). ($8.00, 14 min)', mtimeMs: 30 },
    { base: 'kickoff-sitting-s624-gallery-sort', text: 'finished: shipped; production is live (run 78). ($8.00, 14 min)', mtimeMs: 40 },
  ]
  const b = buildBoard({ dispatcher: null, running: [], queued: [], finished: [] }, {}, new Set(), NOW, { endings })
  expect(b.blocked).toEqual([])
  expect(lastEnd(endings[0]?.text ?? '')).toEqual({ outcome: 'shipped; deploy failed (run 77). ($8.00, 14 min)', kind: 'deploy-red', isLive: false })
})

test('a red deploy stops being stuck once a re-run of its own run passes', async () => {
  const endings = [{ base: 'kickoff-sitting-s658-dispatch-holds-on-held-gate', text: 'finished: shipped; deploy failed (run 77). ($8.00, 14 min)', mtimeMs: 30 }]
  const raw = { dispatcher: null, running: [], queued: [], finished: [] }
  expect(buildBoard(raw, {}, new Set(), NOW, { endings, deployStages: { '77': 'staging' } }).blocked.map(b => b.sitting)).toEqual(['S658'])
  expect(buildBoard(raw, {}, new Set(), NOW, { endings, deployStages: { '77': DEPLOY_LIVE } }).blocked).toEqual([])
  expect(deployStateOf('success', [])).toBe(DEPLOY_LIVE)
  expect(deployStateOf('failure', ['Deploy to Staging & E2E'])).toBe('staging')
})

test('recent and on deck fold themselves while BLOCKED shows, unless set by hand', async () => {
  expect(isFolded('recent', {}, true)).toBe(true)
  expect(isFolded('deck', {}, true)).toBe(true)
  expect(isFolded('queued', {}, true)).toBe(false)
  expect(isFolded('recent', { recent: false }, true)).toBe(false)
  expect(isFolded('recent', {}, false)).toBe(false)
  expect(isFolded('blocked', { blocked: true }, true)).toBe(true)
  expect(deployStageOf(['Deploy to Staging & E2E'])).toBe('staging')
  expect(deployStageOf(['Deploy to Cloudflare Workers'])).toBe('prod')
})

test("the pane draws S625's block above a folded recent, and a header press keeps the fold", async ($, on) => {
  const endings = [...S625_ENDINGS, { base: 'kickoff-sitting-s629-board-blocked-hold', text: 'finished: shipped; production is live (run 9). ($27.48, 72 min)', mtimeMs: 5 }]
  const b = buildBoard(S625_STATUS, {}, new Set([927]), NOW, {
    endings,
    afters: S625_AFTERS,
    handoffs: { 'kickoff-sitting-s625-gallery-arrange-doors': S625_HANDOFF },
    recent: recentOf(endings.map(x => ({ name: `${x.base}.progress`, mtimeMs: x.mtimeMs, text: x.text })), []),
  })
  const { ui, sets } = await mountBoard($, on, b)
  expect((await ui.find({ type: 'Text', text: /^ \? you $/ })) === undefined).toBe(false)
  // The blocked card names the chain once, and the queue card draws it.
  expect(await has(ui, 'holds 2 ‖ S626 → S627, drawn in the queue ↓')).toBe(true)
  expect(await has(ui, '└─‖ S626 gallery-arrange-page')).toBe(true)
  expect(await has(ui, '⏸')).toBe(false)
  // Recent folds itself while BLOCKED shows, and keeps its one line.
  expect((await ui.find({ type: 'Text', text: /2 live · last S624/ })) === undefined).toBe(false)
  expect((await ui.findAll({ type: 'Button' })).length).toBe(3)
  await ui.press({ key: 'fold-recent' })
  expect(sets).toEqual([{ recent: false }, { recent: false }])
  await ui.unmount()
})

test('a handoff question reads both the bare and the addressed label', () => {
  expect(handoffQuestion('**Question: how long does an empty panel last?**')).toBe('how long does an empty panel last?')
  expect(
    handoffQuestion("**Question for Todd:** How should the home page's viewer behave when more than one gallery shows all photos?\n\nRule on it."),
  ).toBe("How should the home page's viewer behave when more than one gallery shows all photos?")
  expect(handoffQuestion('**Stop:** 6. No question here.')).toBe('')
})

// The shape the pane's board atom is stored under; it moves with the Board type.
const BOARD_SHAPE = 'board-11'

type Ui = { find: (q: { type: string; text?: RegExp }) => Promise<unknown>; findAll: (q: { type: string }) => Promise<{ text?: string }[]> }

/** Mounts the pane over `b`, with `folds` as the folds set by hand, and records each write. */
async function mountBoard($: any, on: any, b: unknown, folds: Record<string, boolean> = {}) {
  const sets: unknown[] = []
  on('state.get', (_: unknown, e: { key: string }) => ({
    value: { value: e.key === 'board' ? { shape: BOARD_SHAPE, value: b } : { shape: 'folds-1', value: folds }, version: 1 },
  }))
  on('state.set', (_: unknown, e: { value?: { value: unknown } }) => {
    sets.push((e.value ?? { value: undefined }).value)
    return { value: { isSet: true, version: 2 } }
  })
  on('store.set', (_: unknown, e: { value: unknown }) => {
    sets.push(e.value)
    return { value: undefined }
  })
  const ui = await $.ui.mount({
    plugin: 'run-board',
    component: 'Pane',
    requestId: 'run-board',
    surface: 'terminal',
    props: { title: 'Autopilot runs', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
  })
  // A shape the pane declines draws the empty state, and every other assertion would read nothing.
  expect(await has(ui, 'no autopilot status yet')).toBe(false)
  return { ui, sets }
}

/** Whether a drawn Text holds `text`, its nested spans joined. */
const has = async (ui: Ui, text: string): Promise<boolean> => (await ui.findAll({ type: 'Text' })).some(t => (t.text ?? '').includes(text))

/** The index of the first drawn Text that holds `text`, in document order, or -1. */
const firstAt = async (ui: Ui, text: string): Promise<number> => (await ui.findAll({ type: 'Text' })).findIndex(t => (t.text ?? '').includes(text))

// S684's stop as the Paper "Now" pane drew it: S684 stopped at step 0's savor
// and holds the nav chain; S692 runs with two queued under it; S650 waits on
// nothing; S695 to S697 wait on deck.
const S684_BRIEFS: Record<string, string[]> = {
  's684-home-gallery-sections': [],
  's685-layout-gallery-rows': ['S684'],
  's686-dashboard-rail': ['S685'],
  's698-dashboard-frame': ['S686'],
  's687-admin-in-frame': ['S698'],
  's688-account-signed-in': ['S698'],
  's689-nav-addresses': ['S698'],
  's690-nav-overlays': ['S698'],
  's691-nav-words': ['S686', 'S688'],
  's692-design-tokens': [],
  's693-token-export': ['S692'],
  's694-system-catalogue': ['S693'],
  's695-admin-scale': ['S693'],
  's696-state-layers': ['S694', 'S695'],
  's697-admin-tables': ['S694', 'S695'],
  's650-stray-check': [],
}
const S684_AFTERS = Object.fromEntries(Object.entries(S684_BRIEFS).map(([k, v]) => [`${BRIEFS}${k}.md`, v]))
const S684_STATUS = {
  dispatcher: 1,
  running: [{ entry: 300, brief: `${BRIEFS}s692-design-tokens.md`, lane: '1', pid: 11, started: '2026-10-31T16:34:00Z', cost: 10.63 }],
  queued: [
    { entry: 301, brief: `${BRIEFS}s693-token-export.md`, lane: '', reason: 'S692' },
    { entry: 302, brief: `${BRIEFS}s694-system-catalogue.md`, lane: '', reason: 'S693' },
    { entry: 303, brief: `${BRIEFS}s650-stray-check.md`, lane: '', reason: 'a free slot' },
  ],
  finished: [{ entry: 299, brief: `${BRIEFS}s684-home-gallery-sections.md`, lane: '', status: 1, outcome: 'autopilot: stopped', kind: null }],
}
const S684_PROGRESS = [
  'skill: sittings:savor launch /w/docs/briefs/kickoff-sitting-s684-home-gallery-sections.md',
  'skill: commit-skill:commit Stop 6 handoff for S684 (autopilot session 0)',
  "commit: docs(handoff): hand off S684 at step 0's failed premise",
  'pushes:',
  'kind: decision',
  'finished: stopped: the brief is still in docs/briefs. Read the handoff. ($13.12, 19 min, peak 150k context)',
].join('\n')
const S684_HANDOFF = [
  '# S684 handoff: stop 6',
  '',
  '**Stop:** 6. The step 0 savor at launch classified one finding as `premise fails`.',
  '',
  "**Question for Todd:** How should the home page's viewer behave when more than one gallery shows all photos?",
].join('\n')
const S684_DECK: Deck[] = [
  ...Object.keys(S684_BRIEFS)
    .filter(k => /s6(8[4-9]|9[01]|98)-/.test(k))
    .map(k => deckOf(`S${k.slice(1, 4)}`, 'ready', S684_BRIEFS[k]?.join(', ') ?? '')),
  deckOf('S695', 'ready', 'S693'),
  deckOf('S696', 'ready', 'S694, S695'),
  deckOf('S697', 'ready', 'S694, S695'),
]
const s684Board = (extra: Parameters<typeof buildBoard>[4] = {}) =>
  buildBoard(S684_STATUS, {}, new Set([1, 11]), NOW, {
    endings: [{ base: 'kickoff-sitting-s684-home-gallery-sections', text: S684_PROGRESS, mtimeMs: 20 }],
    afters: S684_AFTERS,
    handoffs: { 'kickoff-sitting-s684-home-gallery-sections': S684_HANDOFF },
    onDeck: S684_DECK,
    cycles: { [`${BRIEFS}s692-design-tokens.md`]: 3 },
    ...extra,
  })

test("S684's held chain draws once, in the queue, under its block and after the free roots", async () => {
  const b = s684Board()
  const rows = queueTree(b.running, b.queued, b.blocked)
  expect(drawn(rows)).toEqual([
    'S692',
    '└─S693',
    '  └─S694',
    'S650 a free slot',
    'S684 blocked ↑ · holds 8',
    '└─S685',
    '  └─S686',
    '    └─S698',
    '      ├─S687',
    '      ├─S688',
    '      │ └─S691 after S686',
    '      ├─S689',
    '      └─S690',
  ])
  expect(rows.slice(4).every(r => r.kind !== 'after')).toBe(true)
  // The blocked card's holds are the queue's order, each under the same parent.
  expect(b.blocked[0]?.holds.map(h => `${h.sitting}<${h.parent}`)).toEqual([
    'S685<S684', 'S686<S685', 'S698<S686', 'S687<S698', 'S688<S698', 'S691<S688', 'S689<S698', 'S690<S698',
  ])
  expect(b.blocked[0]?.why).toBe('savor found a failed premise · nothing pushed · 19m · $13.12')
})

test('the pane draws the blocked card first, its chain on one line, and no hold list', async ($, on) => {
  const { ui } = await mountBoard($, on, s684Board())
  expect(await has(ui, 'holds 8 ‖ S685 → S686 → S698 +5, drawn in the queue ↓')).toBe(true)
  expect(await has(ui, '⏸')).toBe(false)
  const you = await firstAt(ui, ' ? you ')
  expect(you >= 0 && you < (await firstAt(ui, 'S692'))).toBe(true)
  await ui.unmount()
})

test('a stop reads in words from the table, a number off it reads stop N, and two numbers join', async () => {
  const whyWith = (stop: string): string =>
    buildBoard(S625_STATUS, {}, new Set(), NOW, {
      endings: S625_ENDINGS,
      afters: S625_AFTERS,
      handoffs: { 'kickoff-sitting-s625-gallery-arrange-doors': `# x\n\n${stop}\n` },
    }).blocked[0]?.why ?? ''
  expect(whyWith('No stop line here.')).toBe('step 0 savor · nothing pushed · 12m · $9.56')
  expect(whyWith('**Stop:** 9. Not a stop the rules list.')).toBe('step 0 savor · stop 9 · nothing pushed · 12m · $9.56')
  expect(whyWith('**Stop:** 5 and 6.')).toBe('a come-up-for-air finding and savor found a failed premise · nothing pushed · 12m · $9.56')
})

test('a ring of After lines inside a block draws each hold once', async () => {
  const raw = {
    dispatcher: 1,
    running: [],
    queued: [
      { entry: 1, brief: `${BRIEFS}s626-gallery-arrange-page.md`, lane: '', reason: 'S625', cause: { kind: 'decision', sitting: 'S625' } },
      { entry: 2, brief: `${BRIEFS}s627-gallery-arrange-options.md`, lane: '', reason: 'S625', cause: { kind: 'decision', sitting: 'S625' } },
    ],
    finished: [],
  }
  const afters = { ...S625_AFTERS, [`${BRIEFS}s626-gallery-arrange-page.md`]: ['S627'], [`${BRIEFS}s627-gallery-arrange-options.md`]: ['S626'] }
  const b = buildBoard(raw, {}, new Set(), NOW, { endings: S625_ENDINGS, afters })
  expect(b.blocked[0]?.holds.map(h => h.sitting).sort()).toEqual(['S626', 'S627'])
  const rows = queueTree(b.running, b.queued, b.blocked).map(r => r.sitting)
  expect(rows.filter(s => s === 'S626').length).toBe(1)
  expect(rows.filter(s => s === 'S627').length).toBe(1)
})

test('a red deploy that holds nothing draws no queue root and no chain line', async ($, on) => {
  const endings = [{ base: 'kickoff-sitting-s658-dispatch-holds-on-held-gate', text: 'finished: shipped; deploy failed (run 77). ($8.00, 14 min)', mtimeMs: 30 }]
  const b = buildBoard({ dispatcher: null, running: [], queued: [], finished: [] }, {}, new Set(), NOW, { endings, deployStages: { '77': 'staging' } })
  expect(b.blocked.map(k => k.sitting)).toEqual(['S658'])
  expect(queueTree(b.running, b.queued, b.blocked)).toEqual([])
  const { ui } = await mountBoard($, on, b)
  expect(await has(ui, 'blocked ↑')).toBe(false)
  expect(await has(ui, 'drawn in the queue')).toBe(false)
  await ui.unmount()
})

test('the header draws three figures and one spend line, and a running card has no grey last sentence', async ($, on) => {
  const raw = parseStatus(STATUS)
  if (raw === null) throw new Error('status did not parse')
  const spend = { day: 608.2, week: 4629, month: 11964, all: 15742 }
  const b = buildBoard(raw, { 'docs/briefs/kickoff-sitting-s300-loop-run-record.md': S300 }, new Set([5147, 21491]), NOW, { spend })
  const { ui } = await mountBoard($, on, b)
  expect(await has(ui, 'spend $608 24h · $4,629 7d · $11,964 30d · $15,742 all')).toBe(true)
  for (const label of ['running', 'queued', 'on deck']) expect(await has(ui, label)).toBe(true)
  expect(await has(ui, '$ in flight')).toBe(false)
  expect(await has(ui, 'The archive commit is pushing.')).toBe(false)
  await ui.unmount()
})

test('spend that could not be read draws no spend line', async ($, on) => {
  const raw = parseStatus(STATUS)
  if (raw === null) throw new Error('status did not parse')
  const { ui } = await mountBoard($, on, buildBoard(raw, {}, new Set([5147]), NOW, { spend: null }))
  expect(await has(ui, 'spend ')).toBe(false)
  expect(await has(ui, 'queued')).toBe(true)
  await ui.unmount()
})
