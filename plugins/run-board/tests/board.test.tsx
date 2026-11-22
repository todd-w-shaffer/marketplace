import { expect, mock, test } from 'claude-code/testing'

import {
  afterSittings,
  ago,
  agoShort,
  briefFiles,
  briefHeader,
  briefKey,
  briefsRead,
  cycleBlobMap,
  cycleCount,
  lsTreeBlobs,
  shippedCount,
  sittingsClaims,
  dotDigits,
  handoffQuestion,
  handoffStops,
  buildBoard,
  buildLoop,
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
  liveDepths,
  historyTag,
  launchCount,
  lineTimes,
  phaseSplit,
  planCosts,
  splitCounts,
  TIMELINE_AHEAD_MS,
  TIMELINE_BACK_MS,
  daySums,
  namedCycles,
  planBlobs,
  planHeadings,
  recordedEpics,
  archivedSittings,
  shortDollars,
  sparkGlyphs,
} from '../hooks/board'
import type { Deck, Ended, Run } from '../types'

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
  const byKey = cycleBlobMap(lsTreeBlobs(ls))
  expect(byKey.get('docs/briefs/kickoff-sitting-s393-images-panel.md')).toEqual(['aaa'])
  expect(byKey.get('docs/briefs/s410-big')).toEqual(['bbb', 'ccc'])
  expect(byKey.get('docs/briefs/gone.md')).toBe(undefined)
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
  JSON.stringify({ kind: 'commit', ts: '2026-11-06T12:50:00Z', phase: 'plan', sitting: 682, cost: { usd: 2 } }),
  '{"kind":"commit","ts":"2026-11-06T13:0',
].join('\n')

test('the ledger reads as spends', async () => {
  const spends = ledgerSpends(LEDGER)
  expect(spends.length).toBe(4)
  expect(spends[0]).toEqual({ startMs: Date.parse('2026-11-06T11:00:00Z'), endMs: Date.parse('2026-11-06T12:00:00Z'), usd: 6, kind: 'commit', phase: null, sitting: null })
  expect(spends[3]).toEqual({ startMs: Date.parse('2026-11-06T12:50:00Z'), endMs: Date.parse('2026-11-06T12:50:00Z'), usd: 2, kind: 'commit', phase: 'plan', sitting: 682 })
})

test('the ledger reads in chunks that cut lines anywhere', async () => {
  const text = `${LEDGER.split('\n').slice(0, 5).join('\n')}\n`
  // Every cut point gives the same spends as one read, and leaves nothing behind; one cuts inside `"sitting"`.
  for (const cut of [1, 37, 120, text.indexOf('"sitting"') + 4, text.length - 1]) {
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
  expect(
    outcomeDetail('stopped at review. ($15.21, 47 min, peak 159k context, effort medium-high, agents low-xhigh)'),
  ).toBe('stopped at review. · 47m · $15.21 · peak 159k · effort medium-high · agents low-xhigh')
  expect(outcomeDetail('stopped at review. ($15.21, 47 min, peak 159k context, effort medium)')).toBe(
    'stopped at review. · 47m · $15.21 · peak 159k · effort medium',
  )
  expect(outcomeDetail('stopped at review. ($15.21, 47 min, effort unknown)')).toBe(
    'stopped at review. · 47m · $15.21 · effort unknown',
  )
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

test('a stopped run whose claim records an archive reads as rescued in RECENT', () => {
  const claims = sittingsClaims(
    JSON.stringify({
      claims: {
        s721: { slug: 'landing-outcomes', at: '2026-11-22T13:39:09Z', record: { archived: '2026-11-22', finishes: [] } },
        s722: { slug: 'step-up-controls', at: '2026-11-22T14:00:00Z' },
      },
    }),
  )
  expect(archivedSittings(claims)).toEqual(['S721'])
  const stop = 'kind: run-broke\nfinished: stopped: the brief is still in docs/briefs. Read the handoff. ($26.47, 70 min, peak 254k context)'
  const recent = recentOf(
    [
      { name: 'kickoff-sitting-s721-landing-outcomes.progress', mtimeMs: 20, text: stop },
      { name: 'kickoff-sitting-s722-step-up-controls.progress', mtimeMs: 30, text: stop },
    ],
    [],
    new Set(archivedSittings(claims)),
  )
  // S722 has no archive record, so its stop still belongs to BLOCKED.
  expect(recent.map(d => d.sitting)).toEqual(['S721'])
  expect(recent[0]?.detail).toBe('rescued · 1h10m · $26.47 · peak 254k')
  expect(recent.map(d => [d.minutes, d.usd])).toEqual([[70, 26.47]])
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
  expect(briefFiles(lsTreeBlobs(LS_TREE)).map(f => f.path)).toEqual([
    'docs/briefs/kickoff-sitting-s342-gallery-pass-keeps-stars.md',
    'docs/briefs/kickoff-sitting-s340-e8-help-pages.md',
    'docs/briefs/s350-split-work/README.md',
    'docs/briefs/kickoff-527-gallery-race.md',
  ])
  expect(briefFiles(lsTreeBlobs(LS_TREE))[0]?.sha).toBe('bbb222')
})

test('a brief key is the queue path, and a directory brief is its directory', async () => {
  expect(briefKey('docs/briefs/s350-split-work/README.md')).toBe('docs/briefs/s350-split-work')
  expect(briefKey('/Users/x/repo/docs/briefs/s350-split-work/')).toBe('docs/briefs/s350-split-work')
  expect(briefKey('docs/briefs/kickoff-sitting-s342-x.md')).toBe('docs/briefs/kickoff-sitting-s342-x.md')
})

test('the header stops at the first heading', async () => {
  expect(briefHeader(S342)).toEqual({ epic: 'minisite/E4', after: 'S340, S341', mode: 'ready', why: '', splitFrom: [] })
  expect(briefHeader('# x\n\nFinishes: issue 1\n\n## y')).toEqual({ epic: '', after: '', mode: 'enrich', why: '', splitFrom: [] })
})

test('an interactive brief says why it needs a person', async () => {
  const text = '# x\n\n**Mode: interactive.** Removes a wrangler.toml line.\n\n## y\n**Mode: autopilot.**'
  expect(briefHeader(text)).toEqual({ epic: '', after: '', mode: 'interactive', why: 'Removes a wrangler.toml line.', splitFrom: [] })
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

test('an entry held off a running run that shares its paths hangs under that run on a dashed joint', async () => {
  const running = [{ sitting: 'S518', slug: 'device-lab-webkit', lane: 'epic' }, { sitting: 'S519', slug: 'device-lab-simulator', lane: 'epic' }]
  const queued = [
    waits(10, 'S522', 'epic', [], 'kickoff-sitting-s518-device-lab-webkit in slot 1: both touch CLAUDE.md'),
    waits(11, 'S523', 'epic', [], 'kickoff-sitting-s519-device-lab-simulator (pid 4242): both touch package.json, docs/e2e-testing.md'),
    waits(12, 'S524', 'epic', ['S518']),
    waits(13, 'S525', 'epic', ['S522']),
  ]
  const rows = queueTree(running, queued, [])
  // Siblings go in queue order whatever the joint, and a held entry's own waiters hang under it.
  expect(drawn(rows)).toEqual(['S518', '├┄S522', '│ └─S525', '└─S524', 'S519', '└┄S523'])
  expect(rows.map(r => r.kind)).toEqual(['run', 'held', 'after', 'after', 'run', 'held'])
})

test('an entry held off a run the board does not show running is a root tagged held', async () => {
  const queued = [waits(10, 'S522', 'epic', [], 'kickoff-sitting-s518-device-lab-webkit in slot 1: both touch CLAUDE.md')]
  const rows = queueTree([], queued, [])
  expect(drawn(rows)).toEqual(['S522 held · S518'])
  expect(rows.map(r => r.kind)).toEqual(['held'])
})

test('on deck lists unheld briefs by sitting, epic lane from the Epic line', async () => {
  const texts: Record<string, string> = { bbb222: S342, ccc333: '**Mode: autopilot.**\nEpic: account-basics/E8\n## a', fff666: '**Mode: autopilot.**\n## a', '222999': '# issue\n## a' }
  const briefs = briefFiles(lsTreeBlobs(LS_TREE)).map(f => ({ ...f, header: briefHeader(texts[f.sha] ?? '') }))
  const deck = onDeckOf(briefs, ['docs/briefs/kickoff-sitting-s340-e8-help-pages.md'])
  expect(deck.map(d => `${d.sitting} ${d.slug} ${d.lane}${d.epic === '' ? '' : ` · ${d.epic}`}`)).toEqual([
    'S342 gallery-pass-keeps-stars epic · minisite/E4',
    'S350 split-work fix',
    '#527 gallery-race fix',
  ])
  expect(deck.map(d => d.mode)).toEqual(['ready', 'ready', 'enrich'])
  expect(onDeckOf(briefs, ['docs/briefs/s350-split-work/README.md']).some(d => d.sitting === 'S350')).toBe(false)
})

const deckOf = (sitting: string, mode: Deck['mode'], after = '', why = ''): Deck => ({ sitting, slug: sitting.toLowerCase(), lane: 'fix', epic: '', after, mode, why })
const deckDrawn = (rows: ReturnType<typeof deckTree>) =>
  rows.map(r => `${r.rails}${r.joint}${r.kind === 'group' ? r.slug : r.sitting} ${[r.wait === '' ? '' : `after ${r.wait}`, r.note].filter(x => x !== '').join(' · ')}`.trimEnd())

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
  // S434 is running, S475 is queued one deep, S429 has shipped. Each row names
  // only its nearest wait, and none under the parent the tree draws.
  const live = new Map([['S434', 0], ['S475', 1]])
  expect(deckDrawn(deckTree(deck, live, new Set(['S475'])))).toEqual([
    'ready 4',
    '├╌S467',
    '└╌S470 after S434',
    '  └─S471',
    '    └─S473',
    'enrich 2',
    '├╌S472 after S471',
    '└╌S474',
    'needs you 2',
    '├╌S435 after S470 · Todd records the probe answers.',
    '└╌S436 after S434 · Removes a wrangler.toml line.',
  ])
  expect(deckTree(deck, new Map(), new Set()).filter(r => r.kind === 'group').map(r => r.mode)).toEqual(['ready', 'enrich', 'interactive'])
})

test('an empty group draws nothing, and a ring of waits still draws every brief', async () => {
  const deck = [deckOf('S500', 'enrich', 'S501'), deckOf('S501', 'enrich', 'S500')]
  const rows = deckDrawn(deckTree(deck, new Map(), new Set()))
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

// S689's run 44933073127 failed in production, and run 44934802905, shipped by
// hand from an interactive session, went live on main with no autopilot end after it.
test('a red deploy stops being stuck once a newer deploy run on main goes live', async () => {
  const endings = [{ base: 'kickoff-sitting-s689-nav-residues', text: 'finished: shipped; deploy failed (run 44933073127). ($8.00, 14 min)', mtimeMs: 30 }]
  const raw = { dispatcher: null, running: [], queued: [], finished: [] }
  const deployStages = { '44933073127': 'prod' }
  const blocked = (liveDeploy: string) => buildBoard(raw, {}, new Set(), NOW, { endings, deployStages, liveDeploy }).blocked.map(b => b.sitting)
  expect(blocked('')).toEqual(['S689'])
  expect(blocked('44933073127')).toEqual(['S689'])
  expect(blocked('44930000000')).toEqual(['S689'])
  expect(blocked('44934802905')).toEqual([])
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
  expect((await ui.findAll({ type: 'Button' })).length).toBe(4)
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
const BOARD_SHAPE = 'board-14'

type Ui = {
  find: (q: { type: string; text?: RegExp }) => Promise<unknown>
  findAll: (q: { type: string }) => Promise<{ text?: string; props?: { color?: string; backgroundColor?: string } }[]>
}

/** Mounts the pane over `b`, `bodyColumns` wide, with `folds` as the folds set by hand, and records each write. */
async function mountBoard($: any, on: any, b: unknown, folds: Record<string, boolean> = {}, bodyColumns = 100) {
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
    props: { title: 'Autopilot runs', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
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

test('only a line that starts with the marker is a stop line', () => {
  expect(handoffStops('**Stop:** 6.\n\nThe relaunch reads the `**Stop:** <n>.` line again.')).toEqual(['6'])
  expect(handoffStops('**Stop:** 6.\n\nA quoted **Stop:** 7. is prose.')).toEqual(['6'])
})

test('a broken run reads its stop in words, and a split leaves out the stop its headline says', () => {
  const blockOf = (kind: string, stop: string) =>
    buildBoard(S625_STATUS, {}, new Set(), NOW, {
      endings: S625_ENDINGS.map(e => (e.text === S625_PROGRESS ? { ...e, text: S625_PROGRESS.replace('kind: decision', `kind: ${kind}`) } : e)),
      afters: S625_AFTERS,
      handoffs: { 'kickoff-sitting-s625-gallery-arrange-doors': `# x\n\n${stop}\n` },
    }).blocked[0]
  expect(blockOf('run-broke', '**Stop:** 1. The hook stayed red.')?.why).toBe('the pre-push hook stayed red · nothing pushed · 12m · $9.56')
  expect(blockOf('run-broke', 'No stop line here.')?.why).toBe('stopped: the brief is still in docs/briefs. Read the handoff.')
  const split = blockOf('split', '**Stop:** 7.')
  expect(split?.headline).toBe('S625 is over its size ceiling')
  expect(split?.why).toBe('step 0 savor · nothing pushed · 12m · $9.56')
})

test('a folded queue card with nothing queued names only the holds', () => {
  const b = buildBoard(S625_STATUS, {}, new Set([927]), NOW, {
    endings: S625_ENDINGS,
    afters: S625_AFTERS,
    handoffs: { 'kickoff-sitting-s625-gallery-arrange-doors': S625_HANDOFF },
  })
  expect(b.queued).toEqual([])
  expect(foldSummary('queued', b)).toBe('holds 2')
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
  // The October commit is 11 days back and the only day of spend; the November ones are after now.
  const spends = ledgerSpends(LEDGER)
  const spend = { days: daySums(spends, NOW, '') }
  const b = buildBoard(raw, { 'docs/briefs/kickoff-sitting-s300-loop-run-record.md': S300 }, new Set([5147, 21491]), NOW, { spend })
  const { ui } = await mountBoard($, on, b)
  expect(await has(ui, `spend ▁▁█${'▁'.repeat(11)}`)).toBe(true)
  expect(await has(ui, '$0 today · $9 14d')).toBe(true)
  expect(await has(ui, '24h')).toBe(false)
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
  expect(await has(ui, '14d')).toBe(false)
  expect((await ui.findAll({ type: 'Text' })).some((t: { text?: string }) => /[▁-█]/.test(t.text ?? ''))).toBe(false)
  expect(await has(ui, 'queued')).toBe(true)
  await ui.unmount()
})

/** The colours of every drawn Text whose own text is exactly `text`. */
const coloursOf = async (ui: Ui, text: string): Promise<string[]> =>
  (await ui.findAll({ type: 'Text' })).filter(t => t.text === text).map(t => t.props?.color ?? '')

test('on deck names only the nearest wait, and writes a queued one in blue', async ($, on) => {
  const b = s684Board()
  expect(deckDrawn(deckTree(b.onDeck, liveDepths(b), new Set(b.queued.map(q => q.sitting))))).toEqual([
    'ready 3',
    '└╌S695 after S693',
    '  ├─S696',
    '  └─S697',
  ])
  const { ui } = await mountBoard($, on, b, { deck: false })
  expect(await has(ui, 'after S693')).toBe(true)
  expect(await has(ui, 'after S694')).toBe(false)
  expect(await coloursOf(ui, 'S693')).toContain('#8aadf4')
  await ui.unmount()
})

test('a deck wait that has shipped draws no wait', async () => {
  const rows = deckDrawn(deckTree([deckOf('S800', 'ready', 'S429, S430')], new Map(), new Set()))
  expect(rows).toEqual(['ready 1', '└╌S800'])
})

// The Proposed pane's ten recent runs, newest first: minutes and cost.
const PROPOSED_RECENT: [string, number, number][] = [
  ['S682', 73, 22.4],
  ['S683', 99, 34.4],
  ['S680', 107, 38.4],
  ['S677', 297, 22.4],
  ['S678', 55, 29.4],
  ['S676', 117, 24.4],
  ['S679', 39, 19.4],
  ['S681', 32, 14.4],
  ['S675', 34, 17.4],
  ['S674', 39, 15.4],
]
const HOUR = 3600000
const endedOf = (rows: [string, number | null, number | null][]): Ended[] =>
  rows.map(([sitting, minutes, usd], i) => ({
    sitting,
    slug: sitting.toLowerCase(),
    lane: '',
    detail: '',
    minutes,
    usd,
    endedMs: NOW - ((i + 1) * 12 * HOUR) / rows.length,
    split: null,
    plan: 'unread',
    cycles: 0,
  }))
const recentBoard = (recent: Ended[], extra: Parameters<typeof buildBoard>[4] = {}) =>
  buildBoard({ dispatcher: null, running: [], queued: [], finished: [] }, {}, new Set(), NOW, { recent, ...extra })

test('recent ends in a totals row: count, span, median, total time and the unrounded spend', async ($, on) => {
  const { ui } = await mountBoard($, on, recentBoard(endedOf(PROPOSED_RECENT)))
  expect(await has(ui, '10 live in 12h · median 1h04m')).toBe(true)
  expect(await has(ui, '14h52m')).toBe(true)
  // The rows round to $234; the total sums the unrounded costs, then rounds.
  expect(await coloursOf(ui, '$238')).toEqual(['#cad3f5'])
  expect(await has(ui, '$22.40')).toBe(false)
  expect(await has(ui, '$22')).toBe(true)
  // Over twice the median draws peach; S676's 1h57m is under it.
  expect(await coloursOf(ui, '4h57m')).toEqual(['#f5a97f'])
  expect(await coloursOf(ui, '1h57m')).toEqual(['#939ab7'])
  await ui.unmount()
})

test('a total wider than the rows widens its column, so the rows line up under it', async ($, on) => {
  const long = endedOf(PROPOSED_RECENT.map(([s]) => [s, 600, 1100] as [string, number, number]))
  const { ui } = await mountBoard($, on, recentBoard(long))
  const texts = (await (ui as Ui).findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(texts).toContain('100h00m')
  expect(texts).toContain(' 10h00m')
  expect(texts).toContain(' $11,000')
  expect(texts).toContain('  $1,100')
  await ui.unmount()
})

test('a run with no totals counts, and moves no median or sum', async ($, on) => {
  const eleven = endedOf([...PROPOSED_RECENT, ['S673', null, null]])
  const { ui } = await mountBoard($, on, recentBoard(eleven))
  expect(await has(ui, '11 live in 12h · median 1h04m')).toBe(true)
  expect(await has(ui, '14h52m')).toBe(true)
  expect(await has(ui, '$238')).toBe(true)
  await ui.unmount()
})


// A progress file as S699's launcher writes it: an `at:` line above each write.
const T0 = Date.parse('2026-10-31T10:00:00Z')
const stamped = (rows: readonly [number, string][]): string =>
  rows.flatMap(([minute, line]) => [`at: ${new Date(T0 + minute * 60000).toISOString().replace(/\.000Z$/, 'Z')}`, line]).join('\n')

// 10m of savor over six lines, 40m of cycles over three, simplify and the
// xhigh review among them, and 10m of ship over two: the lines alone would
// split the cells 3-2-1.
const PHASED: [number, string][] = [
  [0, 'slot: 1'],
  [0, 'skill: sittings:savor launch /w/docs/briefs/kickoff-sitting-s682-dom-wait-quiet.md'],
  [2, 'turn ended: success, 9 turns, $1.00 so far: Reviewers are running.'],
  [4, 'woke for a background task: success, 1 turns, $1.00 so far: One reviewer is done.'],
  [6, 'woke for a background task: success, 1 turns, $1.00 so far: Two reviewers are done.'],
  [8, 'woke for a background task: success, 1 turns, $1.00 so far: Step 0 is done.'],
  [10, 'savored: session 0 handed over in /x.savored; session 1 starts at cycle 1 in /w'],
  [30, 'skill: simplify Changed paths over a..HEAD'],
  [45, 'skill: code-review xhigh git diff a b'],
  [50, 'skill: commit-skill:ship'],
  [55, 'bash: npm run push:checked -- origin HEAD:main 2>&1 | tail'],
  [60, 'finished: shipped; production is live (run 1). ($22.40, 60 min)'],
]

test('each line takes the time of the nearest at line above it', () => {
  const text = `commit: before any stamp\n${stamped([[0, 'slot: 1'], [5, 'skill: simplify x']])}\nbash: under the last stamp`
  expect(lineTimes(text)).toEqual([null, T0, T0, T0 + 300000, T0 + 300000, T0 + 300000])
})

test("a run's time splits into savor, cycles and ship cells by the at lines, not by the line count", () => {
  expect(phaseSplit(stamped(PHASED))).toEqual({ savor: 1, cycles: 4, ship: 1 })
  // Cells round by largest remainder: 7m, 46m and 7m give 0.7, 4.6 and 0.7 cells.
  const odd: [number, string][] = [
    [0, 'skill: sittings:savor launch /w/b.md'],
    [7, 'savored: session 0 handed over'],
    [53, 'skill: commit-skill:ship'],
    [60, 'finished: shipped; production is live (run 1). ($9.00, 60 min)'],
  ]
  expect(phaseSplit(stamped(odd))).toEqual({ savor: 1, cycles: 4, ship: 1 })
  // A relaunch's wait between the stop and the next slot line counts in no phase.
  const relaunched: [number, string][] = [
    [0, 'slot: 1'],
    [0, 'skill: sittings:savor launch /w/b.md'],
    [10, 'savored: session 0 handed over'],
    [30, 'kind: decision'],
    [30, 'finished: stopped: the brief is still in docs/briefs. Read the handoff. ($5.00, 30 min)'],
    [150, 'slot: 1'],
    [150, 'turn ended: success, 9 turns, $1.00 so far: Cycle 2 is building.'],
    [170, 'skill: commit-skill:ship'],
    [180, 'finished: shipped; production is live (run 1). ($9.00, 60 min)'],
  ]
  expect(phaseSplit(stamped(relaunched))).toEqual({ savor: 1, cycles: 4, ship: 1 })
  // A file with no at lines has no times.
  expect(phaseSplit(PHASED.map(([, line]) => line).join('\n'))).toBe(null)
})

test('recent draws each run as a phase split, and a file with no times as the grey baseline', async ($, on) => {
  const files = [
    { name: 'kickoff-sitting-s682-dom-wait-quiet.progress', mtimeMs: NOW - 2 * HOUR, text: stamped(PHASED) },
    { name: 'kickoff-sitting-s683-doc-tests-read-map.progress', mtimeMs: NOW - 3 * HOUR, text: PHASED.map(([, line]) => line).join('\n') },
  ]
  const recent = recentOf(files, [])
  expect(recent.map(d => d.split)).toEqual([{ savor: 1, cycles: 4, ship: 1 }, null])
  const { ui } = await mountBoard($, on, recentBoard(recent))
  // Savor lavender, cycles green, ship blue; the legend in the card head names them.
  expect(await coloursOf(ui, '⣿')).toEqual(['#b7bdf8', '#8aadf4'])
  expect(await coloursOf(ui, '⣿⣿⣿⣿')).toEqual(['#a6da95'])
  expect(await coloursOf(ui, '⣀⣀⣀⣀⣀⣀')).toEqual(['#494d64'])
  expect(await has(ui, '▪ savor ▪ cycles ▪ ship')).toBe(true)
  await ui.unmount()
})

// Plan commits for S682 at $4 and $2, and records that are not plan cost: a
// plan session and a plan ship that name S682, a build commit, and a sitting
// written as a string.
const PLAN_LEDGER = [
  JSON.stringify({ kind: 'commit', ts: '2026-10-31T08:00:00Z', phase: 'plan', sitting: 682, cost: { usd: 4 } }),
  JSON.stringify({ kind: 'commit', ts: '2026-10-31T08:10:00Z', phase: 'plan', sitting: 682, cost: { usd: 2 } }),
  JSON.stringify({ kind: 'session', ts: '2026-10-31T08:20:00Z', phase: 'plan', sitting: 682, cost: { usd: 1 } }),
  JSON.stringify({ kind: 'ship', ts: '2026-10-31T08:30:00Z', phase: 'plan', sitting: 682, overhead: { usd: 3 } }),
  JSON.stringify({ kind: 'commit', ts: '2026-10-31T09:00:00Z', sitting: 682, cost: { usd: 9 } }),
  JSON.stringify({ kind: 'commit', ts: '2026-10-31T09:10:00Z', phase: 'plan', sitting: '682', cost: { usd: 5 } }),
  JSON.stringify({ kind: 'commit', ts: '2026-10-31T09:20:00Z', phase: 'plan', sitting: 683, cost: { usd: 40 } }),
].join('\n')

test('plan cost is the plan commits that carry the sitting, and nothing else', () => {
  expect(planCosts(ledgerSpends(PLAN_LEDGER))).toEqual({ S682: 6, S683: 40 })
})

test('recent draws each run its plan cost, dim, bright past the build cost, and +— with none', async ($, on) => {
  const recent = endedOf(PROPOSED_RECENT.slice(0, 3))
  const { ui } = await mountBoard($, on, recentBoard(recent, { plans: planCosts(ledgerSpends(PLAN_LEDGER)) }))
  expect(await coloursOf(ui, '+$6')).toEqual(['#8087a2'])
  // S683's plan cost passes its $34 build.
  expect(await coloursOf(ui, '+$40')).toEqual(['#cad3f5'])
  expect(await coloursOf(ui, '+—')).toEqual(['#5b6078'])
  expect(await has(ui, '+ $46 plan')).toBe(true)
  await ui.unmount()
})

test('a ledger that could not be read draws no plan cell and no plan total', async ($, on) => {
  const { ui } = await mountBoard($, on, recentBoard(endedOf(PROPOSED_RECENT.slice(0, 3)), { plans: null }))
  expect(await has(ui, '+$')).toBe(false)
  expect(await has(ui, '+—')).toBe(false)
  expect(await has(ui, 'plan')).toBe(false)
  await ui.unmount()
})

const LONG_SLUG = 'a-slug-much-longer-than-the-old-cut-point-for-names'
const longSlugBoard = () => recentBoard(endedOf([['S682', 73, 22.4]]).map(d => ({ ...d, slug: LONG_SLUG })))

test('a recent slug draws whole where the pane is wide', async ($, on) => {
  const { ui } = await mountBoard($, on, longSlugBoard(), {}, 100)
  expect(await has(ui, `S682 ${LONG_SLUG}`)).toBe(true)
  await ui.unmount()
})

test('a recent slug is cut where the pane is narrow', async ($, on) => {
  const { ui } = await mountBoard($, on, longSlugBoard(), {}, 50)
  expect(await has(ui, LONG_SLUG)).toBe(false)
  expect(await has(ui, 'S682 a-slug')).toBe(true)
  expect(await has(ui, '…')).toBe(true)
  await ui.unmount()
})

// S684's plan commits, $11.36, and a plan ship and a plan session that name it.
const S684_PLAN_LEDGER = [
  JSON.stringify({ kind: 'commit', ts: '2026-10-30T08:00:00Z', phase: 'plan', sitting: 684, cost: { usd: 10 } }),
  JSON.stringify({ kind: 'commit', ts: '2026-10-30T08:10:00Z', phase: 'plan', sitting: 684, cost: { usd: 1.36 } }),
  JSON.stringify({ kind: 'ship', ts: '2026-10-30T08:20:00Z', phase: 'plan', sitting: 684, overhead: { usd: 3 } }),
  JSON.stringify({ kind: 'session', ts: '2026-10-30T08:30:00Z', phase: 'plan', sitting: 684, cost: { usd: 2 } }),
].join('\n')
const S684_RUN = 'kickoff-sitting-s684-home-gallery-sections'

test('the blocked why-line gives the plan cost and which launch stopped', async ($, on) => {
  const plans = planCosts(ledgerSpends(S684_PLAN_LEDGER))
  const once = s684Board({ plans, launches: { [S684_RUN]: launchCount('launch: 1 fresh slot 1 at 2026-10-31T16:00:00Z\n') } })
  expect(historyTag(once.blocked[0] ?? { plan: 'unread', launches: null })).toBe('+$11.36 plan · 1st launch')
  const { ui } = await mountBoard($, on, once)
  expect(await has(ui, '$13.12 +$11.36 plan · 1st launch')).toBe(true)
  await ui.unmount()
  // The second launch emptied the progress file; the launch log keeps both.
  const twice = s684Board({ plans, launches: { [S684_RUN]: launchCount('launch: 1 fresh slot 1 at 2026-10-31T12:00:00Z\nlaunch: 2 fresh slot 2 at 2026-10-31T16:00:00Z\n') } })
  expect(historyTag(twice.blocked[0] ?? { plan: 'unread', launches: null })).toBe('+$11.36 plan · 2nd launch')
  // No launch log gives no launch tag; no plan commit gives no plan tag.
  expect(historyTag(s684Board({ plans: {} }).blocked[0] ?? { plan: 'unread', launches: null })).toBe('')
  expect(launchCount('launch: 1 fresh slot 1 at x\nlaunch: 2 relaunch slot 1 at y\nlaunch: 3 relaunch slot 2 at z\n')).toBe(3)
})

const SPLIT_BRIEFS = [
  { path: `${BRIEFS}s686-dashboard-rail.md`, text: '# S686\n\nAfter: S685\n\n## a' },
  { path: `${BRIEFS}s690-nav-overlays.md`, text: '# S690\n\nSplit from: S686\nAfter: S698\n\n## a\nSplit from: S1' },
]
const SITTINGS_JSON = JSON.stringify({ floor: 60, claims: { s700: { slug: 'x', record: { split_from: ['s686', 's690'] } }, s650: { slug: 'y', record: { cards: [] } } } })

test("a split parent's queue row reads how many briefs were split from it", async ($, on) => {
  expect(briefHeader(SPLIT_BRIEFS[1]?.text ?? '').splitFrom).toEqual(['S686'])
  const headed = SPLIT_BRIEFS.map(b => ({ path: b.path, header: briefHeader(b.text) }))
  const splits = splitCounts(headed, sittingsClaims(SITTINGS_JSON))
  expect(splits).toEqual({ S686: 2, S690: 1 })
  // A sittings.json that does not parse counts only the live briefs.
  expect(splitCounts(headed, sittingsClaims('{"claims": '))).toEqual({ S686: 1 })
  const raw = { dispatcher: 1, running: [], queued: [{ entry: 1, brief: `${BRIEFS}s686-dashboard-rail.md`, lane: '', reason: 'a free slot', cause: null }], finished: [] }
  const { ui } = await mountBoard($, on, buildBoard(raw, {}, new Set([1]), NOW, { splits }))
  expect(await has(ui, 'S686 dashboard-rail split ×2')).toBe(true)
  await ui.unmount()
})

// The timeline at NOW: slot 1 ran S677 from 9h back to 7h back and runs S692
// since 30m back; slot 2 sat idle 3h, then ran S683, then S684, which stopped
// for a decision 19m back. S693 waits on S692, S695 on nothing, and S700 on a
// red deploy; S684 holds S685 and S686.
const MIN = 60000
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const stampedAt = (rows: readonly [number, string][]): string => rows.flatMap(([ms, line]) => [`at: ${iso(ms)}`, line]).join('\n')
const LIVE_OUTCOME = 'shipped; production is live (run 1). ($20.00, 60 min)'
const TL_STATUS = JSON.stringify({
  dispatcher: 1,
  running: [
    { entry: 300, brief: `${BRIEFS}s692-design-tokens.md`, lane: '1', pid: 11, started: iso(NOW - 30 * MIN), session_cost: 5, slot: 1, slot_taken: iso(NOW - 30 * MIN), slot_released: null },
  ],
  queued: [
    { entry: 301, brief: `${BRIEFS}s693-token-export.md`, lane: '', reason: 'S692', cause: null },
    { entry: 302, brief: `${BRIEFS}s695-admin-scale.md`, lane: '', reason: 'a free slot', cause: null },
    { entry: 303, brief: `${BRIEFS}s700-board-round-one.md`, lane: '', reason: 'run 77', cause: { kind: 'deploy-red', run: 77 } },
  ],
  finished: [
    { entry: 290, brief: `${BRIEFS}s677-drafts.md`, lane: '', status: 0, outcome: LIVE_OUTCOME, kind: null, slot: 1, slot_taken: iso(NOW - 9 * HOUR), slot_released: iso(NOW - 7 * HOUR) },
    { entry: 295, brief: `${BRIEFS}s683-doc-tests.md`, lane: '', status: 0, outcome: LIVE_OUTCOME, kind: null, slot: 2, slot_taken: iso(NOW - 5 * HOUR), slot_released: iso(NOW - 3 * HOUR) },
  ],
})
const TL_AFTERS: Record<string, string[]> = {
  [`${BRIEFS}s684-home-gallery-sections.md`]: [],
  [`${BRIEFS}s685-layout-gallery-rows.md`]: ['S684'],
  [`${BRIEFS}s686-dashboard-rail.md`]: ['S685'],
  [`${BRIEFS}s692-design-tokens.md`]: [],
  [`${BRIEFS}s693-token-export.md`]: ['S692'],
  [`${BRIEFS}s695-admin-scale.md`]: [],
  [`${BRIEFS}s700-board-round-one.md`]: [],
}
// `kind:` and `finished:` share one stamp.
const S684_STOP = [
  stampedAt([
    [NOW - 40 * MIN, 'slot: 2'],
    [NOW - 40 * MIN, 'skill: sittings:savor launch /w/docs/briefs/kickoff-sitting-s684-home-gallery-sections.md'],
    [NOW - 19 * MIN, 'kind: decision'],
  ]),
  'finished: stopped: the brief is still in docs/briefs. Read the handoff. ($13.12, 19 min)',
].join('\n')
const tlBoard = (recent: Ended[] = endedOf(PROPOSED_RECENT)) => {
  const raw = parseStatus(TL_STATUS)
  if (raw === null) throw new Error('status did not parse')
  return buildBoard(raw, {}, new Set([1, 11]), NOW, {
    recent,
    afters: TL_AFTERS,
    endings: [{ base: S684_RUN, text: S684_STOP, mtimeMs: NOW - 19 * MIN }],
    utcOffset: '-0500',
  })
}
const barsOf = (b: ReturnType<typeof buildBoard>, slot: number): string[] =>
  (b.timeline.slots.find(l => l.slot === slot)?.bars ?? []).map(
    x => `${x.sitting} ${x.tone} ${(x.startMs - NOW) / MIN}..${(x.endMs - NOW) / MIN}${x.liveEndMs === x.endMs ? '' : ` live to ${(x.liveEndMs - NOW) / MIN}`}`,
  )

test('the timeline spans each slot from 8h back to 6h ahead: past runs, the run in flight, then the queue by its waits', () => {
  const b = tlBoard()
  expect([b.timeline.startMs, b.timeline.endMs]).toEqual([NOW - TIMELINE_BACK_MS, NOW + TIMELINE_AHEAD_MS])
  expect(b.timeline.slots.map(l => l.slot)).toEqual([1, 2])
  // S692 runs green to now and peach to its median end; S693 waits for that end on slot 1.
  expect(barsOf(b, 1)).toEqual(['S677 live -540..-420', 'S692 running -30..34 live to 0', 'S693 queued 34..98'])
  // S695 waits on nothing, so it takes the slot free at now.
  expect(barsOf(b, 2)).toEqual(['S683 live -300..-180', 'S684 stopped -40..-19', 'S695 queued 0..64'])
  expect(b.timeline.you).toEqual({ sitting: 'S684 ? 19m', tone: 'stopped', startMs: NOW - 19 * MIN, endMs: NOW, liveEndMs: NOW, isOverMedian: false })
  // S685 and S686 under BLOCKED, and S700 held by its cause, at the 1h04m median.
  expect(b.timeline.held).toEqual({ label: '3 held · ~3h12m', count: 3, ms: 192 * MIN })
  expect(b.timeline.hours.map(h => h.label)).toEqual(['4a', '6a', '8a', '10a', '12p', '2p', '4p'])
})

test('with RECENT empty there is no median: no projected bar, and held reads its count alone', () => {
  const b = tlBoard([])
  expect(barsOf(b, 1)).toEqual(['S677 live -540..-420', 'S692 running -30..0'])
  expect(barsOf(b, 2)).toEqual(['S683 live -300..-180', 'S684 stopped -40..-19'])
  expect(b.timeline.held).toEqual({ label: '3 held', count: 3, ms: null })
})

test('a run reads its slot from its record, else its stamped slot line, else the lowest slot free over its span', () => {
  const raw = parseStatus(
    JSON.stringify({
      dispatcher: null,
      running: [],
      queued: [],
      finished: [
        { entry: 1, brief: `${BRIEFS}s677-drafts.md`, lane: '', status: 0, outcome: LIVE_OUTCOME, kind: null, slot: 1, slot_taken: iso(NOW - 9 * HOUR), slot_released: iso(NOW - 7 * HOUR) },
        // The lane is not the slot.
        { entry: 2, brief: `${BRIEFS}s688-account.md`, lane: '2', status: 0, outcome: LIVE_OUTCOME, kind: null, slot: 1, slot_taken: iso(NOW - 2 * HOUR), slot_released: iso(NOW - HOUR) },
        // A record whose slot fields are null draws nothing of its own.
        { entry: 3, brief: `${BRIEFS}s679-null-slot.md`, lane: '', status: 0, outcome: LIVE_OUTCOME, kind: null, slot: null, slot_taken: null, slot_released: null },
      ],
    }),
  )
  if (raw === null) throw new Error('status did not parse')
  const done = 'finished: shipped; production is live (run 1). ($9.00, 40 min)'
  const endings = [
    // The record takes the span its stamp matches, so S677 draws once.
    { base: 'kickoff-sitting-s677-drafts', text: stampedAt([[NOW - 9 * HOUR + 3000, 'slot: 1'], [NOW - 7 * HOUR, done]]), mtimeMs: NOW - 7 * HOUR },
    // The finished list no longer holds S681: its stamped slot line places it.
    { base: 'kickoff-sitting-s681-dropped', text: stampedAt([[NOW - 6 * HOUR, 'slot: 2'], [NOW - 5 * HOUR, 'landed: a..b'], [NOW - 290 * MIN, done]]), mtimeMs: NOW - 290 * MIN },
    // Neither: slot 1 holds S677 then, so slot 2 takes it.
    { base: 'kickoff-sitting-s679-null-slot', text: stampedAt([[NOW - 470 * MIN, 'slot: none'], [NOW - 430 * MIN, done]]), mtimeMs: NOW - 430 * MIN },
    // Neither, and no slot is free over its span: not drawn.
    { base: 'kickoff-sitting-s678-no-room', text: stampedAt([[NOW - 460 * MIN, 'skill: simplify x'], [NOW - 440 * MIN, done]]), mtimeMs: NOW - 440 * MIN },
  ]
  const b = buildBoard(raw, {}, new Set(), NOW, { endings, afters: {} })
  expect(barsOf(b, 1)).toEqual(['S677 live -540..-420', 'S688 live -120..-60'])
  expect(barsOf(b, 2)).toEqual(['S679 live -470..-430', 'S681 live -360..-300'])
})

test('a slot past the most a dispatcher runs reads as no slot, on a record and on a stamped line', () => {
  const raw = parseStatus(
    JSON.stringify({
      dispatcher: null,
      running: [],
      queued: [],
      finished: [{ entry: 1, brief: `${BRIEFS}s677-drafts.md`, lane: '', status: 0, outcome: LIVE_OUTCOME, kind: null, slot: 1e21, slot_taken: iso(NOW - 2 * HOUR), slot_released: iso(NOW - HOUR) }],
    }),
  )
  if (raw === null) throw new Error('status did not parse')
  const done = 'finished: shipped; production is live (run 1). ($9.00, 40 min)'
  const endings = [{ base: 'kickoff-sitting-s681-dropped', text: stampedAt([[NOW - 6 * HOUR, 'slot: 99999999'], [NOW - 5 * HOUR, done]]), mtimeMs: NOW - 5 * HOUR }]
  const b = buildBoard(raw, {}, new Set(), NOW, { endings, afters: {} })
  expect(b.timeline.slots.map(l => l.slot)).toEqual([1])
})

const MANTLE = '#1e2030'
const GREEN = '#a6da95'
const IDLE = '#494d64'
/** The drawn rows of the timeline: the axis, then each slot, `you` and `held`, by their first word, past the label's own span. */
const rowsOf = async (ui: Ui): Promise<string[]> =>
  (await ui.findAll({ type: 'Text' }))
    .map(t => t.text ?? '')
    .filter(t => t.length > 7 && (/^(slot \d+|you|held) /.test(t) || /^ {7}[ \d]*\d+[ap]( |$)/.test(t)))

test('the timeline card draws each lane in braille under the hour labels, with names inside their bars', async ($, on) => {
  const { ui } = await mountBoard($, on, tlBoard())
  const rows = await rowsOf(ui)
  const row = (name: string): string => rows.find(r => r.startsWith(`${name} `)) ?? ''
  expect(row('slot 1')).toContain('◂ S677')
  expect(row('slot 1')).toContain('S692')
  expect(row('slot 1')).toContain('S693')
  // Slot 2 sits idle for 3h, a faint track, before S683.
  expect(row('slot 2')).toMatch(/^slot 2 ⣀{15,}⣿/)
  expect(row('slot 2')).toContain('S683')
  expect(row('you')).toContain('S684 ? 19m')
  expect(row('held')).toContain('3 held · ~3h12m')
  // A name inside its bar is mantle on the bar's colour.
  const texts = await (ui as Ui).findAll({ type: 'Text' })
  expect(texts.filter(t => t.text === 'S692' && t.props?.backgroundColor !== undefined).map(t => [t.props?.color, t.props?.backgroundColor])).toEqual([[MANTLE, GREEN]])
  // Slot 2's idle span, longer than any phase block or RECENT's baseline.
  const idle = texts.filter(t => /^⣀{15,}$/.test(t.text ?? ''))
  expect(idle.length > 0 && idle.every(t => t.props?.color === IDLE)).toBe(true)
  await ui.unmount()
})

test('at a narrow pane every timeline row is as long as the axis row', async ($, on) => {
  const { ui } = await mountBoard($, on, tlBoard(), {}, 61)
  const rows = await rowsOf(ui)
  expect(rows.length).toBe(5)
  expect(rows.map(r => r.length)).toEqual(rows.map(() => 61 - 4))
  await ui.unmount()
})

test('the timeline card sits under BLOCKED and above the running cards, reads t: ▾ timeline, and t folds it', async ($, on) => {
  const b = tlBoard()
  const { ui, sets } = await mountBoard($, on, b, { recent: false })
  const texts = (await (ui as Ui).findAll({ type: 'Text' })).map(t => t.text ?? '')
  // The card heads in order: BLOCKED, then the timeline, then the rest.
  const heads = texts.filter(t => /^[▾▸] /.test(t))
  expect(b.blocked.length > 0).toBe(true)
  expect(heads.slice(0, 2)).toEqual(['▾ blocked', '▾ timeline'])
  const head = texts.indexOf('▾ timeline')
  // The running card's sitting draws after the timeline's now-line and before the next card head.
  const nowLine = texts.findIndex((t, i) => i > head && t.trimStart() === 'now')
  const running = texts.findIndex((t, i) => i > nowLine && t === 'S692')
  const next = texts.findIndex((t, i) => i > head && /^[▾▸] /.test(t))
  expect(nowLine > head && running > nowLine && running < next).toBe(true)
  // A plain Button draws its hotkey, a colon, then its label: `t: ▾ timeline`.
  const buttons: { text?: string; props?: { hotkey?: string; plain?: boolean } }[] = await ui.findAll({ type: 'Button' })
  expect(buttons.filter(x => x.text === '▾ timeline').map(x => [x.props?.hotkey, x.props?.plain])).toEqual([['t', true]])
  await ui.press({ key: 'fold-timeline' })
  expect(sets[0]).toEqual({ recent: false, timeline: true })
  await ui.unmount()
})

test('a folded timeline keeps one line: what holds each slot now, and the held count', async ($, on) => {
  const b = tlBoard()
  expect(foldSummary('timeline', b)).toBe('slot 1 S692 · slot 2 idle · 3 held')
  const { ui } = await mountBoard($, on, b, { timeline: true })
  expect(await has(ui, 'S684 ? 19m')).toBe(false)
  expect(await has(ui, '▸ timeline')).toBe(true)
  expect(await has(ui, 'slot 1 S692 · slot 2 idle · 3 held')).toBe(true)
  await ui.unmount()
})

test('the timeline does not fold itself while BLOCKED shows', () => {
  expect(isFolded('timeline', {}, true)).toBe(false)
})

// One poll over a home whose files and commands the test answers by path and argv.
const HOME = '/h'
const LOGS = `${HOME}/Library/Logs/shootsfilm-autopilot`
const POLL_FILES: Record<string, string> = {
  [`${LOGS}/status.json`]: JSON.stringify({ dispatcher: 1, running: [], queued: [], finished: [] }),
  [`${LOGS}/kickoff-sitting-s682-dom-wait-quiet.progress`]: stampedAt([[NOW - 3 * HOUR, 'slot: 1'], [NOW - 2 * HOUR, 'finished: shipped; production is live (run 1). ($22.40, 60 min)']]),
  [`${LOGS}/kickoff-sitting-s681-dropped.progress`]: stampedAt([[NOW - 6 * HOUR, 'slot: 2'], [NOW - 5 * HOUR, 'finished: shipped; production is live (run 2). ($9.00, 60 min)']]),
  [`${LOGS}/${S684_RUN}.progress`]: S684_STOP,
  [`${LOGS}/${S684_RUN}.launches`]: 'launch: 1 fresh slot 2 at 2026-10-31T16:09:25Z\n',
}
const POLL_MTIMES: Record<string, number> = {
  'kickoff-sitting-s682-dom-wait-quiet.progress': NOW - 2 * HOUR,
  'kickoff-sitting-s681-dropped.progress': NOW - 5 * HOUR,
  [`${S684_RUN}.progress`]: NOW - 19 * MIN,
  [`${S684_RUN}.launches`]: NOW - 40 * MIN,
  'status.json': NOW,
}

test('one poll reads the files and the ledger, and writes a board with plan costs, launch tags and a dropped run on its slot', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME })
  mock.store(on, { folds: { recent: false } })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'board' } }))
  on('ui.status', () => ({ value: undefined }))
  on('fs.read', (_: unknown, e: { path: string }) => (e.path in POLL_FILES ? { value: POLL_FILES[e.path] } : { deny: 'no such file' }))
  on('fs.list', (_: unknown, e: { path: string }) =>
    e.path === LOGS
      ? { value: Object.entries(POLL_MTIMES).map(([name, mtimeMs]) => ({ name, kind: 'file', size: 1, mtimeMs })) }
      : { deny: 'no such directory' },
  )
  const ledger = `${PLAN_LEDGER}\n`
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    const [cmd = '', ...args] = e.argv
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd === 'git' && args[0] === 'ls-tree') return out(`100644 blob aaaa\tdocs/briefs/${S684_RUN}.md\n`)
    if (cmd === 'git' && args[0] === 'cat-file') return out('# S684\n\n**Mode: autopilot.**\n\n## x\n')
    if (cmd === 'stat') return out(String(ledger.length))
    if (cmd === 'sh') return out(ledger.slice(Number(args[3]) - 1, Number(args[3]) - 1 + Number(args[5])))
    if (cmd === 'date') return out('-0500')
    if (cmd === 'ps') return out('1\n')
    return out('', 1)
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(0)
  const ui = await $.ui.mount({
    plugin: 'run-board',
    component: 'Pane',
    requestId: 'run-board',
    surface: 'terminal',
    props: { title: 'Autopilot runs', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
  })
  expect(await has(ui, '+$6')).toBe(true)
  expect(await has(ui, '1st launch')).toBe(true)
  const rows = await rowsOf(ui)
  expect(rows.find(r => r.startsWith('slot 2 '))?.includes('S681')).toBe(true)
  expect(rows.find(r => r.startsWith('slot 1 '))?.includes('S682')).toBe(true)
  await ui.unmount()
})

const DONE_LIVE = 'finished: shipped; production is live (run 1). ($9.00, 40 min)'
const statusOf = (s: object) => {
  const raw = parseStatus(JSON.stringify({ dispatcher: null, running: [], queued: [], finished: [], ...s }))
  if (raw === null) throw new Error('status did not parse')
  return raw
}

test('a finished record whose slot was never released draws once, to its span end or the file mtime', () => {
  const raw = statusOf({
    finished: [
      { entry: 1, brief: `${BRIEFS}s681-dropped.md`, lane: '', status: 0, outcome: LIVE_OUTCOME, kind: null, slot: 2, slot_taken: iso(NOW - 4 * HOUR), slot_released: null },
      { entry: 2, brief: `${BRIEFS}s682-no-slot-line.md`, lane: '', status: 0, outcome: LIVE_OUTCOME, kind: null, slot: 1, slot_taken: iso(NOW - 4 * HOUR), slot_released: null },
    ],
  })
  const endings = [
    { base: 'kickoff-sitting-s681-dropped', text: stampedAt([[NOW - 4 * HOUR + 3000, 'slot: 2'], [NOW - 3 * HOUR, DONE_LIVE]]), mtimeMs: NOW - 3 * HOUR },
    // No `slot:` line to match: the record draws to the file's mtime.
    { base: 'kickoff-sitting-s682-no-slot-line', text: stampedAt([[NOW - 4 * HOUR, 'skill: simplify x'], [NOW - 150 * MIN, DONE_LIVE]]), mtimeMs: NOW - 150 * MIN },
  ]
  const b = buildBoard(raw, {}, new Set(), NOW, { endings, afters: {} })
  expect(barsOf(b, 2)).toEqual(['S681 live -240..-180'])
  expect(barsOf(b, 1)).toEqual(['S682 live -240..-150'])
})

test('a running bar that ends at now holds its slot in the folded line', () => {
  expect(foldSummary('timeline', tlBoard([]))).toBe('slot 1 S692 · slot 2 idle · 3 held')
})

test("a relaunched run's earlier launches draw on their own slots", () => {
  const brief = `${BRIEFS}s684-home-gallery-sections.md`
  const raw = statusOf({
    running: [{ entry: 5, brief, lane: '', pid: 11, started: iso(NOW - 30 * MIN), session_cost: 1, slot: 1, slot_taken: iso(NOW - 30 * MIN), slot_released: null }],
  })
  const text = stampedAt([
    [NOW - 4 * HOUR, 'slot: 2'],
    [NOW - 2 * HOUR, 'finished: stopped: the brief is still in docs/briefs. ($5.00, 120 min)'],
    [NOW - 30 * MIN, 'slot: 1'],
  ])
  const b = buildBoard(raw, { [brief]: text }, new Set([11]), NOW, { endings: [], afters: {} })
  expect(barsOf(b, 2)).toEqual(['S684 stopped -240..-120'])
  expect(barsOf(b, 1)).toEqual(['S684 running -30..0'])
})

test('a slot span with nothing after it closes at the next slot line, else the last stamp, else the mtime', () => {
  const endings = [
    {
      base: 'kickoff-sitting-s681-dropped',
      text: stampedAt([[NOW - 6 * HOUR, 'slot: 2'], [NOW - 330 * MIN, 'skill: x'], [NOW - 5 * HOUR, 'slot: 2'], [NOW - 4 * HOUR, 'skill: y']]),
      mtimeMs: NOW - 3 * HOUR,
    },
    { base: 'kickoff-sitting-s690-lone', text: stampedAt([[NOW - 200 * MIN, 'slot: 1']]), mtimeMs: NOW - 150 * MIN },
  ]
  const b = buildBoard(statusOf({}), {}, new Set(), NOW, { endings, afters: {} })
  expect(barsOf(b, 2)).toEqual(['S681 stopped -360..-300', 'S681 stopped -300..-240'])
  expect(barsOf(b, 1)).toEqual(['S690 stopped -200..-150'])
})

test('an empty or unparsable at line keeps the stamp above it', () => {
  expect(lineTimes(`at: ${iso(T0)}\nslot: 1\nat: \nskill: x\nat: garbage\nbash: y`)).toEqual([T0, T0, T0, T0, T0, T0])
})

test('plan costs add unrounded', () => {
  const spend = JSON.stringify({ kind: 'commit', ts: '2026-10-31T08:00:00Z', phase: 'plan', sitting: 682, cost: { usd: 0.004 } })
  const plans = planCosts(ledgerSpends([spend, spend, spend].join('\n')))
  expect(Math.abs((plans.S682 ?? 0) - 0.012) < 1e-9).toBe(true)
})

test("you starts at the stop of the ending BLOCKED reads, the sitting's newest", () => {
  const raw = parseStatus(TL_STATUS)
  if (raw === null) throw new Error('status did not parse')
  const older = `${stampedAt([[NOW - 4 * HOUR, 'skill: x'], [NOW - 3 * HOUR, 'kind: decision']])}\nfinished: stopped: an older stop. ($1.00, 60 min)`
  const b = buildBoard(raw, {}, new Set([1, 11]), NOW, {
    recent: endedOf(PROPOSED_RECENT),
    afters: TL_AFTERS,
    endings: [
      { base: 'kickoff-sitting-s684-an-older-slug', text: older, mtimeMs: NOW - 3 * HOUR },
      { base: S684_RUN, text: S684_STOP, mtimeMs: NOW - 19 * MIN },
    ],
    utcOffset: '-0500',
  })
  expect(b.timeline.you?.sitting).toBe('S684 ? 19m')
})

test('a running record whose slot_taken does not parse draws on its slot from its start, projected', () => {
  const raw = statusOf({
    running: [{ entry: 5, brief: `${BRIEFS}s692-design-tokens.md`, lane: '', pid: 11, started: iso(NOW - 30 * MIN), session_cost: 1, slot: 2, slot_taken: 'not a time', slot_released: null }],
  })
  const b = buildBoard(raw, {}, new Set([11]), NOW, { recent: endedOf(PROPOSED_RECENT), endings: [], afters: {} })
  expect(barsOf(b, 1)).toEqual([])
  expect(barsOf(b, 2)).toEqual(['S692 running -30..34 live to 0'])
})

test("recent's totals put the time and cost under the rows' columns when plan cells show", async ($, on) => {
  const recent = endedOf(PROPOSED_RECENT.slice(0, 3))
  const { ui } = await mountBoard($, on, recentBoard(recent, { plans: planCosts(ledgerSpends(PLAN_LEDGER)) }))
  const texts = (await (ui as Ui).findAll({ type: 'Text' })).map(t => t.text ?? '')
  // How many cells follow a figure's last cell in its line.
  const after = (line: string | undefined, figure: string): number => (line === undefined ? -1 : line.length - (line.indexOf(figure) + figure.length))
  const row = texts.find(t => t.includes('$34') && t.includes('+$40'))
  const total = texts.find(t => t.includes('$95') && t.includes('+ $46 plan'))
  expect(after(total, '$95')).toBe(after(row, '$34'))
  expect(after(total, '4h39m')).toBe(after(row, '1h39m'))
  await ui.unmount()
})

test('a lane label of two digits keeps a space before its track', async ($, on) => {
  const raw = statusOf({
    finished: [{ entry: 1, brief: `${BRIEFS}s677-drafts.md`, lane: '', status: 0, outcome: LIVE_OUTCOME, kind: null, slot: 16, slot_taken: iso(NOW - 2 * HOUR), slot_released: iso(NOW - HOUR) }],
  })
  const { ui } = await mountBoard($, on, buildBoard(raw, {}, new Set(), NOW, { endings: [], afters: {} }))
  const texts = (await (ui as Ui).findAll({ type: 'Text' })).map(t => t.text ?? '')
  const lanes = texts.filter(t => /^slot \d+/.test(t) && t.length > 8)
  expect(lanes.length).toBe(16)
  expect(lanes.filter(t => !/^slot \d+ +[^ ]/.test(t))).toEqual([])
  expect(new Set(lanes.map(t => t.length)).size).toBe(1)
  await ui.unmount()
})

test('a brief blob that fails to read is asked for again on the next poll', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME })
  mock.store(on, { folds: {} })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'board' } }))
  on('ui.status', () => ({ value: undefined }))
  const status = JSON.stringify({ dispatcher: 1, running: [], queued: [{ entry: 1, brief: `${BRIEFS}s686-dashboard-rail.md`, lane: '', reason: 'a free slot', cause: null }], finished: [] })
  on('fs.read', (_: unknown, e: { path: string }) => (e.path === `${LOGS}/status.json` ? { value: status } : { deny: 'no such file' }))
  on('fs.list', (_: unknown, e: { path: string }) =>
    e.path === LOGS ? { value: [{ name: 'status.json', kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false }] } : { deny: 'no such directory' },
  )
  const blobs: Record<string, string> = { b686: SPLIT_BRIEFS[0]?.text ?? '', b690: SPLIT_BRIEFS[1]?.text ?? '', '5150': SITTINGS_JSON }
  let registryReads = 0
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    const [cmd = '', ...args] = e.argv
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd === 'git' && args[0] === 'ls-tree')
      return out(`100644 blob b686\t${BRIEFS}s686-dashboard-rail.md\n100644 blob b690\t${BRIEFS}s690-nav-overlays.md\n100644 blob 5150\tdocs/briefs/sittings.json\n`)
    if (cmd === 'git' && args[0] === 'cat-file') {
      const sha = args[2] ?? ''
      // The registry's first read fails.
      if (sha === '5150' && registryReads++ === 0) return out('', 128)
      return sha in blobs ? out(blobs[sha] ?? '') : out('', 128)
    }
    if (cmd === 'date') return out('-0500')
    if (cmd === 'ps') return out('1\n')
    return out('', 1)
  })
  const mount = () =>
    $.ui.mount({
      plugin: 'run-board',
      component: 'Pane',
      requestId: 'run-board',
      surface: 'terminal',
      props: { title: 'Autopilot runs', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
    })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(0)
  const first = await mount()
  expect(await has(first, 'split ×1')).toBe(true)
  await first.unmount()
  await clock.advance(5000)
  const second = await mount()
  expect(await has(second, 'split ×2')).toBe(true)
  await second.unmount()
})

// A brief's header and its cycle headings, as the planner writes them.
const briefText = (sitting: string, epic: string, after: string, cycles: number): string =>
  [
    `# ${sitting}`,
    '',
    '**Mode: autopilot.**',
    '',
    ...(epic === '' ? [] : [`Epic: ${epic}`]),
    ...(after === '' ? [] : [`After: ${after}`]),
    '',
    '## The cycles',
    ...Array.from({ length: cycles }, (_, i) => `### Cycle ${i + 1}: c${i + 1}`),
  ].join('\n')

// The epics as the artboard draws them: S692 shipped on dashboard/E2 with its
// brief still listed, S693 running and S694 queued under it, S684 stopped and
// holding S685 on multi-gallery/E4, S686 queued on dashboard/E1, S650 queued
// with no cycle headings, and S699 on deck on dashboard/E3, which the plan
// gives no heading. Each is its blob, its brief, its epic, its After line and its cycles.
const EPIC_BRIEFS: [string, string, string, string, number][] = [
  ['e692', 's692-design-tokens', 'dashboard/E2', '', 3],
  ['e693', 's693-token-export', 'dashboard/E2', 'S692', 2],
  ['e694', 's694-system-catalogue', 'dashboard/E2', 'S693', 3],
  ['e684', 's684-home-gallery-sections', 'multi-gallery/E4', '', 2],
  ['e685', 's685-layout-gallery-rows', 'multi-gallery/E4', 'S684', 3],
  ['e686', 's686-dashboard-rail', 'dashboard/E1', '', 1],
  ['e650', 's650-stray-check', '', '', 0],
  ['e699', 's699-later-arc', 'dashboard/E3', '', 2],
]
// `### E10:` sits above `### E1:`, and `### E4:` names an epic of another plan.
const DASHBOARD_PLAN = ['# Dashboard', '', '### E10: later', '', '### E1: nav', '', '### E2: design system', '', '### E4: x'].join('\n')
const EPIC_SITTINGS = JSON.stringify({ floor: 60, claims: { s692: { slug: 'design-tokens', record: { epic: ' dashboard/E2 ' } }, s650: { slug: 'stray-check' } } })
const EPIC_LS = [
  ...EPIC_BRIEFS.map(([sha, file]) => `100644 blob ${sha}\t${BRIEFS}${file}.md`),
  '100644 blob e515\tdocs/briefs/sittings.json',
  '100644 blob e901\tdocs/plans/dashboard.md',
].join('\n')
const EPIC_BLOBS: Record<string, string> = {
  ...Object.fromEntries(EPIC_BRIEFS.map(([sha, file, epic, after, cycles]) => [sha, briefText(`S${file.slice(1, 4)}`, epic, after, cycles)])),
  e515: EPIC_SITTINGS,
  e901: DASHBOARD_PLAN,
}

/** What the poll reads from an `ls-tree` and its blobs, for `buildBoard`. */
const fromTree = (ls: string, blobs: Readonly<Record<string, string>>, raw: Parameters<typeof buildBoard>[0]) =>
  briefsRead(
    lsTreeBlobs(ls),
    sha => blobs[sha] ?? null,
    raw.running.map(r => r.brief),
    raw.queued.map(r => r.brief),
  )

// Four live runs: $7.70 over 1 cycle, $30 over 2, $10 over 2, and $1 whose commits name no cycle.
const COST_FILES = [
  ['s601-one', 'skill: commit-skill:commit S601 cycle 1: a\nskill: code-review low a b', '$7.70'],
  ['s602-two', 'skill: commit-skill:commit S602 cycle 1: a\nskill: code-review low a b\nskill: commit-skill:commit S602 cycle 2: b', '$30.00'],
  ['s603-two', 'skill: commit-skill:commit S603 cycle 2: b\nskill: commit-skill:commit S603 cycle 1 review fixes', '$10.00'],
  ['s604-fix', 'skill: commit-skill:commit the one fix\nskill: code-review low a b', '$1.00'],
].map(([name, text, usd], i) => ({
  name: `kickoff-sitting-${name}.progress`,
  mtimeMs: NOW - (i + 1) * HOUR,
  text: `${text}\nfinished: shipped; production is live (run 1). (${usd ?? ''}, 30 min)`,
}))

const EPIC_STATUS = {
  dispatcher: 1,
  running: [{ entry: 10, brief: `${BRIEFS}s693-token-export.md`, lane: '1', pid: 11, started: iso(NOW - 30 * MIN), session_cost: 2 }],
  queued: [
    { entry: 11, brief: `${BRIEFS}s694-system-catalogue.md`, lane: '', reason: 'S693', cause: null },
    { entry: 12, brief: `${BRIEFS}s686-dashboard-rail.md`, lane: '', reason: 'a free slot', cause: null },
    { entry: 13, brief: `${BRIEFS}s650-stray-check.md`, lane: '', reason: 'a free slot', cause: null },
  ],
  finished: [],
}

const epicBoard = (opts: { sittings?: string; recent?: Ended[]; drop?: string } = {}) => {
  const raw = statusOf(EPIC_STATUS)
  const tree = fromTree(EPIC_LS, { ...EPIC_BLOBS, e515: opts.sittings ?? EPIC_SITTINGS }, raw)
  const cycles = Object.fromEntries(Object.entries(tree.cycles).filter(([k]) => k !== opts.drop))
  return buildBoard(raw, {}, new Set([1, 11]), NOW, {
    ...tree,
    cycles,
    endings: [{ base: S684_RUN, text: S684_PROGRESS, mtimeMs: NOW - 19 * MIN }],
    recent: opts.recent ?? recentOf(COST_FILES, []),
  })
}

type Drawn = { text?: string; props?: { color?: string; dimColor?: boolean; hotkey?: string; plain?: boolean } }

/** Each cell run on the epics row whose Text starts with `label`, as its glyphs and colour. */
const epicCells = async (ui: Ui, label: string): Promise<string[]> => {
  const all: Drawn[] = await ui.findAll({ type: 'Text' })
  const at = all.findIndex(t => (t.text ?? '').startsWith(label))
  const out: string[] = []
  for (const t of at < 0 ? [] : all.slice(at + 1)) {
    if (/^\s*\d+\/\d+\s*$/.test(t.text ?? '')) break
    if (/^[■□]+$/.test(t.text ?? '')) out.push(`${t.text} ${t.props?.color ?? ''}`)
  }
  return out
}

/** The squares-and-cost Text of the row whose Text holds `name`, and its square runs with their colours. */
const costBox = async (ui: Ui, name: string): Promise<{ text: string; squares: string[] }> => {
  const all: Drawn[] = await ui.findAll({ type: 'Text' })
  const at = all.findIndex(t => (t.text ?? '').includes(name))
  const box = at < 0 ? -1 : all.findIndex((t, i) => i > at && (t.text ?? '').includes('~$'))
  const squares: string[] = []
  for (const t of box < 0 ? [] : all.slice(box + 1)) {
    if ((t.text ?? '').includes('~$')) break
    if (/^[■·]+$/.test(t.text ?? '')) squares.push(`${t.text} ${t.props?.color ?? ''}`)
  }
  return { text: box < 0 ? '' : (all[box]?.text ?? ''), squares }
}

const BLUE = '#8aadf4'
const PEACH = '#f5a97f'
const YELLOW = '#eed49f'
const SURFACE2 = '#5b6078'
const OVERLAY1 = '#8087a2'

test('namedCycles is the highest cycle a /commit line names, and recent writes it on each run', () => {
  expect(namedCycles('skill: commit-skill:commit S1 cycle 2: b\nskill: commit-skill:commit S1 cycle 1 review fixes')).toBe(2)
  expect(namedCycles('skill: commit-skill:commit the fix\nskill: code-review low a b')).toBe(0)
  expect(namedCycles('turn ended: success, 3 turns, $1.00 so far: cycle 4 is next')).toBe(0)
  expect(recentOf(COST_FILES, []).map(d => [d.sitting, d.cycles])).toEqual([['S601', 1], ['S602', 2], ['S603', 2], ['S604', 0]])
})

test('the epics card names each epic by its plan title, a cell per sitting, shipped over total, and the next state', async ($, on) => {
  const b = epicBoard()
  expect(b.epics.map(e => `${e.label} ${e.cells.join(',')} ${shippedCount(e)}/${e.cells.length} ${e.next?.kind} ${e.next?.sitting}`)).toEqual([
    'multi-gallery/E4 todo,todo 0/2 blocked S684',
    'nav todo 0/1 queued S686',
    'design system shipped,running,todo 1/3 running S693',
    'dashboard/E3 todo 0/1 deck S699',
  ])
  const { ui } = await mountBoard($, on, b)
  expect(await epicCells(ui, 'design system')).toEqual([`■ ${GREEN}`, `■ ${PEACH}`, `□ ${SURFACE2}`])
  expect(await has(ui, '1/3')).toBe(true)
  expect(await has(ui, '● S693 running')).toBe(true)
  expect(await has(ui, 'blocked at S684')).toBe(true)
  expect(await has(ui, '‖ held')).toBe(false)
  expect(await has(ui, 'queued')).toBe(true)
  // A plan with no `### E3` heading, and a plan file the listing lacks, give the raw value.
  expect(await epicCells(ui, 'dashboard/E3')).toEqual([`□ ${SURFACE2}`])
  expect(await epicCells(ui, 'multi-gallery/E4')).toEqual([`□□ ${SURFACE2}`])
  expect(await has(ui, 'later')).toBe(false)
  // The card sits between the running cards and the queue.
  const head = await firstAt(ui, '▾ epics')
  expect(head > (await firstAt(ui, 'S693 token-export')) && head < (await firstAt(ui, '▾ queued'))).toBe(true)
  await ui.unmount()
})

test('a sittings.json that does not parse draws the same epics with no shipped cell', async ($, on) => {
  const b = epicBoard({ sittings: '{"claims": ' })
  expect(b.epics.map(e => e.label)).toEqual(['multi-gallery/E4', 'nav', 'design system', 'dashboard/E3'])
  const { ui } = await mountBoard($, on, b)
  expect(await epicCells(ui, 'design system')).toEqual([`■ ${PEACH}`, `□□ ${SURFACE2}`])
  expect(await has(ui, '0/3')).toBe(true)
  await ui.unmount()
})

test('a heading matches its epic id exactly, and a plan path is the part before the last slash', () => {
  expect(planHeadings(DASHBOARD_PLAN)).toEqual({ E10: 'later', E1: 'nav', E2: 'design system', E4: 'x' })
  expect(planBlobs(lsTreeBlobs(EPIC_LS))).toEqual([{ plan: 'dashboard', sha: 'e901' }])
  expect(recordedEpics(sittingsClaims(EPIC_SITTINGS))).toEqual({ S692: 'dashboard/E2' })
  expect(recordedEpics(sittingsClaims('not json'))).toEqual({})
})

test('the epics card starts open while BLOCKED shows, and e folds it to its one line', async ($, on) => {
  const b = epicBoard()
  expect(isFolded('epics', {}, true)).toBe(false)
  expect(foldSummary('epics', b)).toBe('multi-gallery/E4 0/2 · nav 0/1 · design system 1/3 · dashboard/E3 0/1')
  const { ui, sets } = await mountBoard($, on, b)
  const buttons: Drawn[] = await ui.findAll({ type: 'Button' })
  expect(buttons.filter(x => x.text === '▾ epics').map(x => [x.props?.hotkey, x.props?.plain])).toEqual([['e', true]])
  await ui.press({ key: 'fold-epics' })
  expect(sets[0]).toEqual({ epics: true })
  await ui.unmount()
})

test('a folded epics card keeps one line: each epic, shipped over total', async ($, on) => {
  const { ui } = await mountBoard($, on, epicBoard(), { epics: true })
  expect(await has(ui, '▸ epics')).toBe(true)
  expect(await has(ui, 'multi-gallery/E4 0/2 · nav 0/1 · design system 1/3 · dashboard/E3 0/1')).toBe(true)
  expect(await has(ui, 'blocked at S684')).toBe(false)
  await ui.unmount()
})

test('queue and deck rows draw a square per cycle and the projected cost from the median cost per cycle', async ($, on) => {
  const b = epicBoard()
  // $7.70, $15 and $5 a cycle: the median is $7.70, so 3 cycles cost $23.10. The $1 run names no cycle.
  expect(Math.abs((b.costs.S694?.usd ?? 0) - 23.1) < 1e-9).toBe(true)
  expect(b.costs.S650).toEqual({ cycles: 0, usd: null })
  const { ui } = await mountBoard($, on, b, { deck: false })
  const s694 = await costBox(ui, 'S694 system-catalogue')
  expect(s694.squares).toEqual([`■■■ ${BLUE}`])
  expect(s694.text.endsWith('~$23')).toBe(true)
  // A running row lights the cycle under way in peach.
  expect((await costBox(ui, 'S693 token-export')).squares).toEqual([`■ ${PEACH}`, `■ ${SURFACE2}`])
  const s650 = await costBox(ui, 'S650 stray-check')
  expect(s650.squares).toEqual([`· ${SURFACE2}`])
  expect(s650.text.endsWith('~$?')).toBe(true)
  expect((await costBox(ui, 'S685 layout-gallery-rows')).squares).toEqual([`■■■ ${YELLOW}`])
  // An on-deck brief takes its group's colour.
  expect((await costBox(ui, 'S699 later-arc')).squares).toEqual([`■■ ${GREEN}`])
  // Every box is one width across the queue and deck cards, a tree child's included, so each cost ends in one column.
  const boxes = await Promise.all(['S693 token-export', 'S694 system-catalogue', 'S686 dashboard-rail', 'S650 stray-check', 'S685 layout-gallery-rows', 'S699 later-arc'].map(n => costBox(ui, n)))
  expect(new Set(boxes.map(x => x.text.length)).size).toBe(1)
  expect(boxes.every(x => /~\$(\d+|\?)$/.test(x.text))).toBe(true)
  // A held row's cost is yellow and dim.
  const held: Drawn[] = (await ui.findAll({ type: 'Text' })).filter((t: Drawn) => t.text === '~$23' && t.props?.color === YELLOW)
  expect(held.length > 0 && held.every(t => t.props?.dimColor === true)).toBe(true)
  expect(await coloursOf(ui, '~$23')).toContain(PEACH)
  await ui.unmount()
})

test('a RECENT with no usable row, and a brief whose blob was not read, project ~$?', async ($, on) => {
  const nulls = endedOf([['S601', 30, null], ['S602', 30, null]]).map(d => ({ ...d, cycles: 2 }))
  const b = epicBoard({ recent: nulls, drop: `${BRIEFS}s686-dashboard-rail.md` })
  expect(b.costs.S694).toEqual({ cycles: 3, usd: null })
  expect(b.costs.S686).toEqual({ cycles: null, usd: null })
  const { ui } = await mountBoard($, on, b)
  expect((await costBox(ui, 'S694 system-catalogue')).text.endsWith('~$?')).toBe(true)
  const s686 = await costBox(ui, 'S686 dashboard-rail')
  expect(s686.squares).toEqual([])
  expect(s686.text.endsWith('~$?')).toBe(true)
  await ui.unmount()
})

test('a figure at or over $1,000 after rounding to a tenth of a thousand reads $N.Nk', () => {
  expect(shortDollars(999.6)).toBe('$1.0k')
  expect(shortDollars(7000)).toBe('$7.0k')
  expect(shortDollars(7132)).toBe('$7.1k')
  expect(shortDollars(568)).toBe('$568')
})

// The sparkline's ledger at -1000, now 12:00 local on Nov 20: today $568, $5,680 at 23:30 local the day before,
// then $284, $250, $200 and $150; $1,000 at 18:00 local 14 days before, and $999 an hour after now.
const SPARK_NOW = Date.parse('2026-11-20T22:00:00Z')
const LOCAL_MIDNIGHT = Date.parse('2026-11-20T10:00:00Z')
const DAY = 24 * HOUR
const SPARK_SPENDS = ledgerSpends(
  [
    [LOCAL_MIDNIGHT + 8 * HOUR, 568],
    [LOCAL_MIDNIGHT - DAY + 23.5 * HOUR, 5680],
    [LOCAL_MIDNIGHT - 2 * DAY + 9 * HOUR, 284],
    [LOCAL_MIDNIGHT - 3 * DAY + 9 * HOUR, 250],
    [LOCAL_MIDNIGHT - 4 * DAY + 9 * HOUR, 200],
    [LOCAL_MIDNIGHT - 5 * DAY + 9 * HOUR, 150],
    [LOCAL_MIDNIGHT - 14 * DAY + 18 * HOUR, 1000],
    [SPARK_NOW + HOUR, 999],
  ]
    .map(([ms, usd]) => JSON.stringify({ kind: 'commit', ts: iso(ms ?? 0), cost: { usd } }))
    .join('\n'),
)

test('spend sums by local day over 14 days, today last, and scales its bars to the second-highest day', () => {
  // The 23:30 spend falls the day before, and the spend 14 days back and the one after now in no day.
  expect(daySums(SPARK_SPENDS, SPARK_NOW, '-1000')).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 150, 200, 250, 284, 5680, 568])
  // An offset that does not parse sums by UTC day.
  expect(daySums(SPARK_SPENDS, SPARK_NOW, 'garbage')).toEqual(daySums(SPARK_SPENDS, SPARK_NOW, '+0000'))
  // The highest day is ten times the cap, and tops out; a day at half the cap is exactly ▄.
  expect(sparkGlyphs(daySums(SPARK_SPENDS, SPARK_NOW, '-1000'))).toBe('▁▁▁▁▁▁▁▁▃▃▄▄██')
  // One day of spend is the cap, and fourteen empty days divide by nothing.
  expect(sparkGlyphs([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0])).toBe('▁▁▁▁▁▁▁▁▁▁▁▁█▁')
  expect(daySums([], SPARK_NOW, '-1000')).toEqual(new Array<number>(14).fill(0))
  expect(sparkGlyphs(new Array<number>(14).fill(0))).toBe('▁'.repeat(14))
})

test('the header draws the 14-day sparkline, today peach, then today and 14d', async ($, on) => {
  const spend = { days: daySums(SPARK_SPENDS, SPARK_NOW, '-1000') }
  const b = buildBoard(statusOf({ dispatcher: 1 }), {}, new Set([1]), SPARK_NOW, { spend, utcOffset: '-1000' })
  const { ui } = await mountBoard($, on, b)
  expect(await has(ui, 'spend ▁▁▁▁▁▁▁▁▃▃▄▄██')).toBe(true)
  expect(await has(ui, '$568 today · $7.1k 14d')).toBe(true)
  expect(await coloursOf(ui, '$568')).toEqual([PEACH])
  expect(await coloursOf(ui, '█')).toEqual([OVERLAY1, PEACH])
  expect(new Set(await coloursOf(ui, '▁'))).toEqual(new Set([SURFACE2]))
  await ui.unmount()
})

test('one poll counts every brief, reads epics from sittings.json and the plan, and sums the ledger by local day', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME })
  mock.store(on, { folds: {} })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'board' } }))
  on('ui.status', () => ({ value: undefined }))
  const status = JSON.stringify({ dispatcher: 1, running: [], queued: [{ entry: 1, brief: `${BRIEFS}s694-system-catalogue.md`, lane: '', reason: 'a free slot', cause: null }], finished: [] })
  on('fs.read', (_: unknown, e: { path: string }) => (e.path === `${LOGS}/status.json` ? { value: status } : { deny: 'no such file' }))
  on('fs.list', (_: unknown, e: { path: string }) =>
    e.path === LOGS ? { value: [{ name: 'status.json', kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false }] } : { deny: 'no such directory' },
  )
  const blobs: Record<string, string> = { c7694: briefText('S694', 'dashboard/E2', '', 3), c7515: EPIC_SITTINGS, c7901: DASHBOARD_PLAN }
  // Shorter than PLAN_LEDGER, which an earlier poll read, so this poll reads the ledger again from its start.
  // At -0500 its one commit falls at 22:00 the day before.
  const ledger = `${JSON.stringify({ kind: 'commit', ts: '2026-10-31T03:00:00Z', cost: { usd: 5 } })}\n`
  let planReads = 0
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    const [cmd = '', ...args] = e.argv
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd === 'git' && args[0] === 'ls-tree') {
      const plans = args.includes('docs/plans/') ? '100644 blob c7901\tdocs/plans/dashboard.md\n' : ''
      return out(`100644 blob c7694\t${BRIEFS}s694-system-catalogue.md\n100644 blob c7515\tdocs/briefs/sittings.json\n${plans}`)
    }
    if (cmd === 'git' && args[0] === 'cat-file') {
      const sha = args[2] ?? ''
      // The plan's first read fails.
      if (sha === 'c7901' && planReads++ === 0) return out('', 128)
      return sha in blobs ? out(blobs[sha] ?? '') : out('', 128)
    }
    if (cmd === 'stat') return out(String(ledger.length))
    if (cmd === 'sh') return out(ledger.slice(Number(args[3]) - 1, Number(args[3]) - 1 + Number(args[5])))
    if (cmd === 'date') return out('-0500')
    if (cmd === 'ps') return out('1\n')
    return out('', 1)
  })
  const mount = () =>
    $.ui.mount({
      plugin: 'run-board',
      component: 'Pane',
      requestId: 'run-board',
      surface: 'terminal',
      props: { title: 'Autopilot runs', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
    })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(0)
  const first = await mount()
  expect((await costBox(first, 'S694 system-catalogue')).squares).toEqual([`■■■ ${BLUE}`])
  // The plan blob failed, so the epic reads its raw value; sittings.json gives its shipped cell.
  expect(await epicCells(first, 'dashboard/E2')).toEqual([`■ ${GREEN}`, `□ ${SURFACE2}`])
  expect(await has(first, 'design system')).toBe(false)
  expect(await has(first, `spend ${'▁'.repeat(12)}█▁`)).toBe(true)
  await first.unmount()
  await clock.advance(5000)
  const second = await mount()
  expect(await epicCells(second, 'design system')).toEqual([`■ ${GREEN}`, `□ ${SURFACE2}`])
  await second.unmount()
})

test('namedCycles counts only the cycle commits, not the savor, simplify, review fix or archive commits', () => {
  const savor = ['skill: sittings:savor launch x', 'skill: commit-skill:commit Step 0 of S701: savor edits split its cycle 3 into S703', 'skill: commit-skill:commit Cycle 1 of S701: x'].join('\n')
  expect(namedCycles(savor)).toBe(1)
  const tail = [
    'skill: commit-skill:commit Cycle 1 of S701: x',
    'skill: code-review low a b',
    'skill: simplify x',
    'skill: commit-skill:commit simplify cycle 2 of the fix list',
    'skill: code-review xhigh a b',
    'skill: commit-skill:commit xhigh fixes to cycle 4',
    'bash: npm run push:checked -- origin HEAD:main',
    'skill: commit-skill:commit archive: split its cycle 5 into S703',
  ].join('\n')
  expect(namedCycles(tail)).toBe(1)
})

// An issue brief on dashboard/E1 beside S700 on deck on the same epic.
const ISSUE_BRIEF = 'docs/briefs/kickoff-527-fix-thing.md'
const ISSUE_LS = [`100644 blob a527\t${ISSUE_BRIEF}`, `100644 blob a700\t${BRIEFS}s700-rail-polish.md`, '100644 blob e901\tdocs/plans/dashboard.md'].join('\n')
const ISSUE_BLOBS: Record<string, string> = { a527: briefText('#527', 'dashboard/E1', '', 1), a700: briefText('S700', 'dashboard/E1', '', 1), e901: DASHBOARD_PLAN }

test('an issue brief keys its epic state by its #number, queued or running', async ($, on) => {
  const queued = statusOf({ dispatcher: 1, queued: [{ entry: 1, brief: ISSUE_BRIEF, lane: '', reason: 'a free slot', cause: null }] })
  // An issue number sorts after every sitting, so the queued state shows on an epic #527 holds alone.
  const alone = ISSUE_LS.split('\n').filter(l => !l.includes('s700')).join('\n')
  const q = buildBoard(queued, {}, new Set([1]), NOW, fromTree(alone, ISSUE_BLOBS, queued))
  expect(q.epics.map(e => `${e.label} ${e.cells.join(',')} ${e.next?.kind} ${e.next?.sitting}`)).toEqual(['nav todo queued #527'])
  const running = statusOf({ dispatcher: 1, running: [{ entry: 1, brief: ISSUE_BRIEF, lane: '1', pid: 11, started: iso(NOW - 30 * MIN), session_cost: 2 }] })
  const r = buildBoard(running, {}, new Set([1, 11]), NOW, fromTree(ISSUE_LS, ISSUE_BLOBS, running))
  expect(r.epics.map(e => `${e.label} ${e.cells.join(',')} ${e.next?.kind} ${e.next?.sitting}`)).toEqual(['nav running,todo running #527'])
  const { ui } = await mountBoard($, on, r)
  expect(await epicCells(ui, 'nav')).toEqual([`■ ${PEACH}`, `□ ${SURFACE2}`])
  expect(await has(ui, '● #527 running')).toBe(true)
  await ui.unmount()
})

type GitAnswer = { stdout: string; exitCode?: number } | 'deny'

/**
 * A poll over `status`, with `git` answered by `answer(poll, args)`, where
 * `poll` counts from 0; `mount` draws the pane the last poll wrote.
 */
async function pollFixture($: any, on: any, status: object, answer: (poll: number, args: readonly string[]) => GitAnswer) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME })
  mock.store(on, { folds: {} })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'board' } }))
  on('ui.status', () => ({ value: undefined }))
  const text = JSON.stringify({ dispatcher: 1, running: [], queued: [], finished: [], ...status })
  on('fs.read', (_: unknown, e: { path: string }) => (e.path === `${LOGS}/status.json` ? { value: text } : { deny: 'no such file' }))
  on('fs.list', (_: unknown, e: { path: string }) =>
    e.path === LOGS ? { value: [{ name: 'status.json', kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false }] } : { deny: 'no such directory' },
  )
  let poll = 0
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    const [cmd = '', ...args] = e.argv
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd === 'git') {
      if (args[0] === 'ls-tree') poll++
      const a = answer(poll - 1, args)
      return a === 'deny' ? { deny: 'spawn failed' } : out(a.stdout, a.exitCode ?? 0)
    }
    if (cmd === 'date') return out('-0500')
    if (cmd === 'ps') return out('1\n')
    return out('', 1)
  })
  const mount = () =>
    $.ui.mount({
      plugin: 'run-board',
      component: 'Pane',
      requestId: 'run-board',
      surface: 'terminal',
      props: { title: 'Autopilot runs', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
    })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(0)
  return { clock, mount }
}

/** A `git` answer from an ls-tree listing and blob texts by id; a blob not in `blobs` fails. */
const fromBlobs = (ls: string, blobs: Readonly<Record<string, string>>) => (args: readonly string[]): GitAnswer => {
  if (args[0] === 'ls-tree') return { stdout: ls }
  const sha = args[2] ?? ''
  return sha in blobs ? { stdout: blobs[sha] ?? '' } : { stdout: '', exitCode: 128 }
}

test('a blob read that throws counts as a failed read, and the poll still draws the rest', async ($, on) => {
  const ls = `100644 blob f710\t${BRIEFS}s710-throw-read.md\n100644 blob f901\tdocs/plans/dashboard.md\n`
  const read = fromBlobs(ls, { f710: briefText('S710', 'dashboard/E2', '', 3), f901: DASHBOARD_PLAN })
  const queued = [{ entry: 1, brief: `${BRIEFS}s710-throw-read.md`, lane: '', reason: 'a free slot', cause: null }]
  // The plan's read throws on the first poll.
  const { clock, mount } = await pollFixture($, on, { queued }, (poll, args) => (poll === 0 && args[2] === 'f901' ? 'deny' : read(args)))
  const first = await mount()
  expect((await costBox(first, 'S710 throw-read')).squares).toEqual([`■■■ ${BLUE}`])
  expect(await epicCells(first, 'dashboard/E2')).toEqual([`□ ${SURFACE2}`])
  await first.unmount()
  await clock.advance(5000)
  const second = await mount()
  expect(await epicCells(second, 'design system')).toEqual([`□ ${SURFACE2}`])
  await second.unmount()
})

test('a failed listing keeps the last good read: plan titles, recorded epics, epics and cycles', async ($, on) => {
  const ls = `100644 blob f711\t${BRIEFS}s711-keep-read.md\n100644 blob f515\tdocs/briefs/sittings.json\n100644 blob f902\tdocs/plans/dashboard.md\n`
  const read = fromBlobs(ls, { f711: briefText('S711', 'dashboard/E2', '', 3), f515: EPIC_SITTINGS, f902: DASHBOARD_PLAN })
  const queued = [{ entry: 1, brief: `${BRIEFS}s711-keep-read.md`, lane: '', reason: 'a free slot', cause: null }]
  // The second poll's listing fails.
  const { clock, mount } = await pollFixture($, on, { queued }, (poll, args) => (poll === 1 && args[0] === 'ls-tree' ? { stdout: '', exitCode: 128 } : read(args)))
  const first = await mount()
  expect(await epicCells(first, 'design system')).toEqual([`■ ${GREEN}`, `□ ${SURFACE2}`])
  await first.unmount()
  await clock.advance(5000)
  const second = await mount()
  expect(await epicCells(second, 'design system')).toEqual([`■ ${GREEN}`, `□ ${SURFACE2}`])
  expect((await costBox(second, 'S711 keep-read')).squares).toEqual([`■■■ ${BLUE}`])
  await second.unmount()
})

test('a running brief whose Epic line leaves origin/main leaves the epics card', async ($, on) => {
  const path = `${BRIEFS}s712-drop-epic.md`
  const before = fromBlobs(`100644 blob f712\t${path}\n`, { f712: briefText('S712', 'dashboard/E2', '', 2) })
  const after = fromBlobs(`100644 blob f713\t${path}\n`, { f713: briefText('S712', '', '', 2) })
  const running = [{ entry: 1, brief: path, lane: '1', pid: 1, started: iso(NOW - 30 * MIN), session_cost: 2 }]
  const { clock, mount } = await pollFixture($, on, { running }, (poll, args) => (poll === 0 ? before(args) : after(args)))
  const first = await mount()
  expect(await has(first, '● S712 running')).toBe(true)
  await first.unmount()
  await clock.advance(5000)
  const second = await mount()
  expect(await has(second, '▾ epics')).toBe(false)
  await second.unmount()
})
