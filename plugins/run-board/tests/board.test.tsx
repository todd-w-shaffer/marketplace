import { expect, mock, test } from 'claude-code/testing'

import {
  afterSittings,
  ago,
  agoShort,
  briefFiles,
  briefFacts,
  briefKey,
  briefsRead,
  cycleBlobMap,
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
  phaseFill,
  LOG_MARKS,
  logEventsOf,
  phaseLine,
  phaseName,
  splitCells,
  recordRead,
  queueTree,
  parseStatus,
  recentCandidates,
  recentOf,
  segmentWidth,
  runStartedMs,
  stripOf,
  statusLine,
  tileFace,
  KIND_TAG,
  deployStageOf,
  deployStateOf,
  DEPLOY_LIVE,
  foldSummary,
  isFolded,
  liveDepths,
  historyTag,
  lineTimes,
  UNREAD_HEADER,
  splitCounts,
  TIMELINE_AHEAD_MS,
  TIMELINE_BACK_MS,
  daySums,
  planBlobs,
  planHeadings,
  recordedEpics,
  archivedSittings,
  shortDollars,
  sparkGlyphs,
} from '../hooks/board'
import type { Deck, Ended, Run } from '../types'
import type { BriefFacts, BriefHeader, Ending, RecordRead } from '../hooks/board'

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

const S300_BRIEF = 'docs/briefs/kickoff-sitting-s300-loop-run-record.md'
// S300's record: pushing the ship, $10.07 in.
const S300_READ = () => runRead({ stage: 'pushing', phases: phasesAt(1, 3), note: { text: 'The archive commit is pushing.', cost: 10.07 } })

const S300 = [
  'skill: commit-skill:commit S300 cycle 1: ...',
  'commit: feat(x): y',
  'skill: code-review xhigh /usr/bin/git diff a b -- c',
  'woke for a background task: success, 6 turns, $10.07 so far: The archive commit is pushing.',
  'bash: set -o pipefail; npm run push:checked -- origin HEAD:main 2>&1 | tail',
].join('\n')

const NOW = Date.parse('2026-10-31T16:49:25Z')

// ---------- the run record ----------

// A record as scripts/run-status.mjs writes it: pasted from
// ~/Library/Logs/shootsfilm-autopilot/kickoff-sitting-s727-gallery-edit-batch.run.json.
const RECORD_BASE = {
  version: 1,
  stage: 'finished',
  phases: [
    { label: 'savor', short: 'savor', state: 'done' },
    { label: 'cycle 1', short: 'c1', state: 'done' },
    { label: 'cycle 2', short: 'c2', state: 'done' },
    { label: 'simplify', short: 'simpl', state: 'done' },
    { label: 'review xhigh', short: 'xhigh', state: 'done' },
    { label: 'shipping', short: 'ship', state: 'done' },
    { label: 'archiving', short: 'arch', state: 'done' },
  ],
  end: {
    outcome: 'shipped',
    text: 'shipped; production is live (run 45194059532). ($23.27, 73 min, peak 226k context, effort medium, agents low-xhigh)',
    kind: null,
    live: true,
    deploy_run: null,
  },
  note: { text: 'S727 has shipped and is archived. The new `POST /api/gallery/:galleryId/edits` door is on `main` at 2d2f29a38..52c68e7bf', cost: 9 },
  named_cycles: 2,
  phase_since: null,
  phase_ms: [
    { label: 'cycle 1', ms: 478000 },
    { label: 'savor', ms: 480000 },
    { label: 'cycle 2', ms: 1070000 },
    { label: 'simplify', ms: 595000 },
    { label: 'review xhigh', ms: 1370000 },
    { label: 'shipping', ms: 243000 },
    { label: 'archiving', ms: 200000 },
  ],
  phase_split: { savor: 480000, cycles: 3473000, ship: 443000 },
  launch_spans: [{ slot: 2, start: '2026-11-23T13:15:56Z', end: '2026-11-23T14:25:34Z', live: true }],
  stops: [],
  handoff: null,
  brief: 'docs/briefs/kickoff-sitting-s727-gallery-edit-batch.md',
  mode: 'autopilot',
  epic: 'gallery-panels/E11',
  after: ['S725', 'S752'],
  split_from: [],
  cycles: 2,
  landed: true,
  launches: 1,
  progress: '/Users/toddwshaffer/Library/Logs/shootsfilm-autopilot/kickoff-sitting-s727-gallery-edit-batch.progress',
  log: '/Users/toddwshaffer/Library/Logs/shootsfilm-autopilot/kickoff-sitting-s727-gallery-edit-batch.log',
}

// The record `--print` answers, as
// `node scripts/run-status.mjs --print ~/Library/Logs/shootsfilm-autopilot/kickoff-sitting-s727-gallery-edit-batch.progress docs/archive/s727-gallery-edit-batch/kickoff-sitting-s727-gallery-edit-batch.md`
// printed it: the written record with the brief path it was given.
const PRINT_BASE = { ...RECORD_BASE, brief: 'docs/archive/s727-gallery-edit-batch/kickoff-sitting-s727-gallery-edit-batch.md' }

// A running chain at the xhigh review.
const XHIGH_PHASES = [
  { label: 'cycle 1', short: 'c1', state: 'done' },
  { label: 'cycle 2', short: 'c2', state: 'done' },
  { label: 'simplify', short: 'simpl', state: 'done' },
  { label: 'review xhigh', short: 'xhigh', state: 'live' },
  { label: 'shipping', short: 'ship', state: 'todo' },
  { label: 'archiving', short: 'arch', state: 'todo' },
]
/** A running run's record, from the base: at the xhigh review for nine minutes, $3 in. */
const runningRecord = (more: object = {}) => ({
  ...RECORD_BASE,
  stage: 'review xhigh',
  phases: XHIGH_PHASES,
  end: null,
  phase_since: new Date(NOW - 9 * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  note: { text: 'reviewing', cost: 3 },
  launch_spans: [{ slot: 1, start: new Date(NOW - 30 * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z'), end: null, live: true }],
  ...more,
})

/**
 * The fixed chain over `cycles` cycles, each phase before index `live` done,
 * that one live and the rest to come: the phases a record lists.
 */
function phasesAt(cycles: number, live: number) {
  const names: [string, string][] = [
    ...Array.from({ length: cycles }, (_, i): [string, string] => [`cycle ${i + 1}`, `c${i + 1}`]),
    ['simplify', 'simpl'],
    ['review xhigh', 'xhigh'],
    ['shipping', 'ship'],
    ['archiving', 'arch'],
  ]
  return names.map(([label, short], i) => ({ label, short, state: i < live ? 'done' : i === live ? 'live' : 'todo' }))
}

/** A running record read through the board's reader, from `runningRecord(more)`. */
function runRead(more: object = {}): RecordRead {
  const read = recordRead(JSON.stringify(runningRecord(more)))
  if (read.kind !== 'record') throw new Error('the fixture is no record')
  return read
}


/** A record's end: shipped with production live when `kind` is null, else a stop of that kind. */
const endOf = (text: string, kind: string | null = null, more: object = {}) => ({
  outcome: /^[a-z-]+/.exec(text)?.[0] ?? 'unknown',
  text,
  kind,
  live: kind === null,
  deploy_run: null,
  ...more,
})

/**
 * A run that is not running, as the poll reads it: its run name, the record
 * the base gives with `end` and `more`, read through the board's reader, its
 * progress text and mtime. The record holds no spans or timings unless `more`
 * names them, and a null `end` is a run that has not ended.
 */
function ending(base: string, mtimeMs: number, end: object | null, more: object = {}, text = ''): Ending {
  const read = recordRead(recordJson(end, more))
  if (read.kind !== 'record') throw new Error('the fixture is no record')
  return { base, text, mtimeMs, record: read.record }
}

/** A record file's text: the base with `end` and `more`, and no spans or timings unless `more` names them. */
const recordJson = (end: object | null, more: object = {}): string =>
  JSON.stringify({ ...RECORD_BASE, phase_ms: [], phase_split: null, launch_spans: [], named_cycles: 0, launches: 0, ...more, end })

// What `--print` prints for each fixture brief's text, by the text: the facts
// the fixture states for it. A text with none prints as a brief with no mode yet.
type PrintedFacts = { mode: string | null; epic: string | null; after: string[]; split_from: string[]; cycles: number }
const FACTS = new Map<string, PrintedFacts>()
const NO_FACTS: PrintedFacts = { mode: 'none', epic: null, after: [], split_from: [], cycles: 0 }

/** Registers `text` as a brief whose printed record states `facts`, and answers the text. */
function briefWith(text: string, facts: Partial<PrintedFacts>): string {
  FACTS.set(text, { ...NO_FACTS, ...facts })
  return text
}

/** What `--print` prints for a brief made of `texts`, piped in: the first text's facts, from the base. */
const printedFor = (texts: readonly string[]): string => JSON.stringify({ ...PRINT_BASE, end: null, ...(FACTS.get(texts[0] ?? '') ?? NO_FACTS) })

/** The facts the board reads from that print. */
function factsFor(texts: readonly string[]): BriefFacts {
  const read = recordRead(printedFor(texts))
  const facts = read.kind === 'record' ? briefFacts(read.record) : null
  if (facts === null) throw new Error('the fixture prints no facts')
  return facts
}

/** A header as the board draws one. */
const hdr = (mode: BriefHeader['mode'], epic = '', after = '', splitFrom: string[] = []): BriefHeader => ({ epic, after, mode, splitFrom })

/**
 * The answer a stub gives the board's piped `--print` of a brief's blobs:
 * the print of their texts, or a failed read, exit 128, when `blob` answers
 * null for any of them, as `git cat-file` under `pipefail` does.
 */
function printAnswer(argv: readonly string[], blob: (sha: string) => string | null): { exitCode: number; stdout: string } | undefined {
  if (argv[0] !== 'sh' || !(argv[2] ?? '').includes('--print /dev/null /dev/stdin')) return undefined
  const texts = argv.slice(5).map(blob)
  if (texts.length === 0 || texts.some(t => t === null)) return { exitCode: 128, stdout: '' }
  return { exitCode: 0, stdout: printedFor(texts as string[]) }
}

/** A stamp `minutes` from NOW, as a record writes it. */
const stampAt = (minutes: number): string => new Date(NOW + minutes * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z')

/** A launch span as a record states it, its times in minutes from NOW; a null end leaves it open. */
const spanAt = (slot: number | null, from: number, to: number | null, live = true) => ({
  slot,
  start: stampAt(from),
  end: to === null ? null : stampAt(to),
  live,
})

test('a board reads runs, queue, outcomes and liveness', async () => {
  const raw = parseStatus(STATUS)
  expect(raw === null).toBe(false)
  if (raw === null) return
  const b = buildBoard(raw, new Set([5147, 21491]), NOW, { records: { [S300_BRIEF]: S300_READ() } })
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
  const b = buildBoard({ dispatcher: null, running: [], queued: [], finished: [] }, new Set(), NOW)
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
  const b = buildBoard(oneRun, new Set([5147, 79762]), NOW)
  // S299 has no record, so it draws from status.json alone.
  expect(statusLine(b)).toBe('● S299 starting 1h06m │ $7.65')
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

test('a ship-run call is a push in the strip', async () => {
  expect(stripOf(`${S395}\nbash: ship-run`, 'run-broke').map(c => `${c.stage}:${c.state}`)).toEqual([
    'savor:skip', 'cycles:done', 'push:broke', 'staging:todo', 'prod:todo',
  ])
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

test("a directory brief's blobs are every .md file directly in it, its README first", async () => {
  const ls = [
    '100644 blob aaa\tdocs/briefs/kickoff-sitting-s393-images-panel.md',
    '100644 blob bbb\tdocs/briefs/s410-big/README.md',
    '100644 blob ccc\tdocs/briefs/s410-big/cycles.md',
    '100644 blob ddd\tdocs/briefs/s410-big/notes/deep.md',
    '100644 blob eee\tdocs/briefs/s410-big/data.json',
    // A file that lists before README.md still pipes after it, so the header leads.
    '100644 blob aa1\tdocs/briefs/s411-cut/AAA.md',
    '100644 blob bb2\tdocs/briefs/s411-cut/README.md',
  ].join('\n')
  const byKey = cycleBlobMap(lsTreeBlobs(ls))
  expect(byKey.get('docs/briefs/kickoff-sitting-s393-images-panel.md')).toEqual(['aaa'])
  expect(byKey.get('docs/briefs/s410-big')).toEqual(['bbb', 'ccc'])
  expect(byKey.get('docs/briefs/s411-cut')).toEqual(['bb2', 'aa1'])
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
    new Set([5147, 79762, 21491]),
    NOW,
    {
      records: {
        [s393]: runRead({ stage: 'working', phases: phasesAt(2, 1), note: { text: "Cycle 2's build is running.", cost: 10.62 } }),
        [s395]: runRead({ phases: phasesAt(3, 4), note: { text: "Waiting for cycle 3's build.", cost: 6.06 } }),
      },
      tools: { [s393]: 'Bash: Run the focused check' },
      cycles: { [s393]: 2, [s395]: 3 },
      marks: { [s393]: marks(skillMark(1, 'R1', 'code-review', 'low a~1..a'), useMark(2, 'E1', 'Edit', '"file_path":"/x/a.ts')) },
    },
  )
  const [epic, fix] = b.running
  if (epic === undefined || fix === undefined) throw new Error('runs missing')
  // The live phase fills from the run's log marks; a run whose marks were not read has no fill.
  expect(near(epic.fill)).toBe(0.2)
  expect(fix.fill).toBeNull()
  // The bar's lit label names the phase, so the phase line names neither the phase nor its session.
  expect(phaseLine(epic)).toBe('Bash: Run the focused check')
  expect(phaseLine(fix)).toBe('')
  expect(phaseLine({ ...epic, stage: 'committing', tool: '' })).toBe('committing')
  expect(phaseLine({ ...epic, stage: 'committing' })).toBe('committing · Bash: Run the focused check')
  expect(phaseLine({ ...epic, stage: 'review low', tool: '' })).toBe('')
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
  const b = buildBoard(raw, new Set([5147]), NOW, { utcOffset: '-0500', records: { [S300_BRIEF]: S300_READ() } })
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

test('a phase block fills with braille: full when done, filled to its fraction in flight, a baseline to come', async () => {
  expect(phaseGlyphs('done', 4)).toBe('⣿⣿⣿⣿')
  expect(phaseGlyphs('todo', 3)).toBe('⣀⣀⣀')
  // Each cell climbs ⣀ ⣤ ⣶ ⣿, so a block of 6 has 18 steps.
  expect(phaseGlyphs('live', 6, 0.5)).toBe('⣿⣿⣿⣀⣀⣀')
  expect(phaseGlyphs('live', 6, 0.4)).toBe('⣿⣿⣤⣀⣀⣀')
  // A live block always shows a step, and never fills, however near done it reads.
  expect(phaseGlyphs('live', 6, 0)).toBe('⣤⣀⣀⣀⣀⣀')
  expect(phaseGlyphs('live', 6)).toBe('⣤⣀⣀⣀⣀⣀')
  expect(phaseGlyphs('live', 6, 1)).toBe('⣿⣿⣿⣿⣿⣶')
  expect(phaseGlyphs('live', 2, 0.99)).toBe('⣿⣶')
})

// A run log's marks as readLogMarks prints them, one `grep -noE` match a line: `<log line>:<match>`.
const useMark = (n: number, id: string, name: string, input = '', nestedIn = ''): string[] => [
  `${n}:"type":"tool_use","id":"${id}","name":"${name}"`,
  ...(input === '' ? [] : [`${n}:"input":{${input}`]),
  ...(nestedIn === '' ? [] : [`${n}:"parent_tool_use_id":"${nestedIn}"`]),
]
// As real `grep -noE LOG_MARKS` prints a Skill call: no input mark, the name and args in one.
const skillMark = (n: number, id: string, skill: string, args: string): string[] => [
  ...useMark(n, id, 'Skill'),
  `${n}:"skill":"${skill}"${args === '' ? '' : `,"args":"${args}`}`,
]
const taskMark = (n: number, step: 'started' | 'progress' | 'notification', id: string, type = ''): string[] => [
  `${n}:"subtype":"task_${step}","task_id":"a1","run_id":"r1","tool_use_id":"${id}"`,
  ...(type === '' ? [] : [`${n}:"task_type":"${type}"`]),
]
const resultMark = (n: number, id: string): string => `${n}:"tool_use_id":"${id}","type":"tool_result"`
// A fill to two places, so a checkpoint's fraction compares exactly.
const near = (x: number | null): number | null => (x === null ? null : Math.round(x * 100) / 100)
const marks = (...groups: (string | string[])[]): string => groups.flat().join('\n')

test('logEventsOf reads tool calls, their inputs, nesting, task events and results from the marks', async () => {
  const events = logEventsOf(
    marks(
      '1:"type":"tool_use","id":"cut-off',
      skillMark(2, 'S1', 'simplify', 'over the changed'),
      taskMark(3, 'started', 'A1', 'local_agent'),
      resultMark(4, 'A1'),
      useMark(5, 'B1', 'Bash', '"command":"git diff --stat', 'A1'),
      taskMark(6, 'notification', 'A1'),
      'not a mark',
    ),
  )
  expect(events).toEqual([
    { kind: 'use', id: 'S1', name: 'Skill', detail: '', skill: 'simplify', args: 'over the changed', nested: false },
    { kind: 'task', step: 'started', id: 'A1', agent: true },
    { kind: 'result', id: 'A1' },
    { kind: 'use', id: 'B1', name: 'Bash', detail: 'git diff --stat', skill: '', args: '', nested: true },
    { kind: 'task', step: 'notification', id: 'A1', agent: false },
  ])
})

test("LOG_MARKS reads a Skill call's name and args from a real log line", async () => {
  // `grep -o` resumes after each match, as a global JS match does: an earlier mark must not take the skill's name.
  const line = '{"type":"tool_use","id":"R1","name":"Skill","input":{"skill":"code-review","args":"low abc..def"}}'
  const found = [...line.matchAll(new RegExp(LOG_MARKS, 'g'))].map(m => m[0])
  expect(found).toEqual(['"type":"tool_use","id":"R1","name":"Skill"', '"skill":"code-review","args":"low abc..def'])
  const bare = '{"type":"tool_use","id":"S1","name":"Skill","input":{"skill":"simplify"}}'
  const events = logEventsOf([...bare.matchAll(new RegExp(LOG_MARKS, 'g'))].map(m => `1:${m[0]}`).join('\n'))
  expect(events).toEqual([{ kind: 'use', id: 'S1', name: 'Skill', detail: '', skill: 'simplify', args: '', nested: false }])
})

test('simplify fills by how many of its agents are back, then by its fixes, build and commit', async () => {
  const opened = [skillMark(1, 'S1', 'code-review', 'low abc'), skillMark(10, 'S2', 'simplify', 'over the range')]
  const fanned = [...opened, ...['A1', 'A2', 'A3', 'A4'].map((id, i) => taskMark(11 + i, 'started', id, 'local_agent'))]
  const fill = (...more: (string | string[])[]) => phaseFill('simplify', logEventsOf(marks(...fanned, ...more)))
  const none = fill()
  const two = fill(taskMark(20, 'notification', 'A2'), taskMark(21, 'notification', 'A4'))
  const all = fill(...['A1', 'A2', 'A3', 'A4'].map((id, i) => taskMark(20 + i, 'notification', id)))
  const fixed = fill(...['A1', 'A2', 'A3', 'A4'].map((id, i) => taskMark(20 + i, 'notification', id)), useMark(30, 'E1', 'Edit', '"file_path":"/x/a.ts'))
  const committed = fill(useMark(30, 'E1', 'Edit', '"file_path":"/x/a.ts'), skillMark(40, 'C1', 'commit-skill:commit', 'refactor: x'))
  expect(none).toBeLessThan(0.1)
  expect(near(two)).toBe(0.3)
  expect(near(all)).toBe(0.55)
  expect(near(fixed)).toBe(0.65)
  expect(near(committed)).toBe(0.9)
  // A second wave of agents does not draw the fill backwards.
  const wave = fill(taskMark(20, 'notification', 'A1'), taskMark(21, 'notification', 'A2'), taskMark(22, 'notification', 'A3'), taskMark(23, 'notification', 'A4'), taskMark(24, 'started', 'A5', 'local_agent'))
  expect(near(wave)).toBe(0.55)
  // A background build is no agent: it neither counts toward the fan-out nor holds it back.
  expect(near(fill(taskMark(16, 'started', 'K1', 'local_bash'), taskMark(20, 'notification', 'A2'), taskMark(21, 'notification', 'A4')))).toBe(0.3)
})

test('a phase creeps toward its next checkpoint as tool calls land, and never reaches it', async () => {
  const opened = skillMark(1, 'X1', 'code-review', 'xhigh 719d3f796..HEAD')
  const calls = (n: number) => Array.from({ length: n }, (_, i) => useMark(2 + i, `N${i}`, 'Bash', '"command":"git diff', 'X1'))
  const fills = [0, 5, 20, 60, 400].map(n => phaseFill('review xhigh', logEventsOf(marks(opened, ...calls(n)))))
  for (let i = 1; i < fills.length; i++) expect(fills[i]).toBeGreaterThan(fills[i - 1] ?? 1)
  expect(fills[4]).toBeLessThan(0.7)
  // The review's end is a checkpoint; a fix after it and its commit are the next two.
  const ended = marks(opened, ...calls(60), taskMark(80, 'notification', 'X1'))
  expect(near(phaseFill('review xhigh', logEventsOf(ended)))).toBe(0.7)
  expect(near(phaseFill('review xhigh', logEventsOf(marks(ended, skillMark(90, 'C1', 'commit-skill:commit', 'fix: y')))))).toBe(0.9)
  // Nothing fills past the cap.
  expect(phaseFill('review xhigh', logEventsOf(marks(ended, skillMark(90, 'C1', 'commit-skill:commit', 'fix: y'), ...calls(400))))).toBeLessThan(0.96)
})

test('a cycle opens at the last review low and fills by its first edit, its build and its commit', async () => {
  const before = [skillMark(1, 'C0', 'commit-skill:commit', 'cycle 1 of S1'), useMark(2, 'E0', 'Edit', '"file_path":"/x/old.ts'), skillMark(3, 'R0', 'code-review', 'low a~1..a')]
  const fill = (...more: (string | string[])[]) => phaseFill('cycle 2', logEventsOf(marks(...before, ...more)))
  // The last cycle's edit and commit sit before the opener, so they count for nothing here.
  expect(fill()).toBeLessThan(0.05)
  expect(near(fill(useMark(10, 'E1', 'Write', '"file_path":"/x/a.test.ts')))).toBe(0.2)
  expect(near(fill(useMark(10, 'E1', 'Edit', '"file_path":"/x/a.ts'), useMark(11, 'B1', 'Bash', '"command":"npm run check:cycle')))).toBe(0.5)
  expect(near(fill(useMark(10, 'E1', 'Edit', '"file_path":"/x/a.ts'), skillMark(12, 'C1', 'commit-skill:commit', 'cycle 2 of S1')))).toBe(0.8)
  // An edit inside an agent is the agent's, not the cycle's.
  expect(fill(useMark(10, 'E1', 'Edit', '"file_path":"/x/a.ts', 'A9'))).toBeLessThan(0.05)
})

test('the savor fills by its agents, the ship by its push, the archive by its commit and push', async () => {
  const savor = [skillMark(1, 'V1', 'sittings:savor', 'launch docs/briefs/x.md'), ...['A1', 'A2'].map((id, i) => taskMark(2 + i, 'started', id, 'local_agent'))]
  expect(near(phaseFill('savor', logEventsOf(marks(...savor, taskMark(5, 'notification', 'A1')))))).toBe(0.4)
  expect(near(phaseFill('savor', logEventsOf(marks(...savor, skillMark(9, 'C1', 'commit-skill:commit', 'step 0')))))).toBe(0.9)
  const shipped = [skillMark(1, 'X1', 'code-review', 'xhigh a..HEAD'), skillMark(2, 'P1', 'commit-skill:ship', 'autopilot run')]
  expect(phaseFill('shipping', logEventsOf(marks(...shipped)))).toBeLessThan(0.1)
  expect(near(phaseFill('shipping', logEventsOf(marks(...shipped, taskMark(3, 'notification', 'P1')))))).toBe(0.8)
  const archived = [...shipped, taskMark(3, 'notification', 'P1'), skillMark(4, 'C2', 'commit-skill:commit', 'archive commit')]
  expect(phaseFill('archiving', logEventsOf(marks(...archived)))).toBeLessThan(0.1)
  expect(near(phaseFill('archiving', logEventsOf(marks(...archived, resultMark(5, 'C2')))))).toBe(0.4)
  expect(near(phaseFill('archiving', logEventsOf(marks(...archived, resultMark(5, 'C2'), skillMark(6, 'P2', 'commit-skill:ship', 'archive push')))))).toBe(0.6)
})

test('no marks fill a phase to nothing, and an unknown phase reads from its first event', async () => {
  expect(phaseFill('simplify', [])).toBe(0)
  expect(phaseFill('observations', logEventsOf(marks(useMark(1, 'E1', 'Edit', '"file_path":"/x/a.ts'))))).toBeGreaterThan(0)
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
  expect(spends[0]).toEqual({ startMs: Date.parse('2026-11-06T11:00:00Z'), endMs: Date.parse('2026-11-06T12:00:00Z'), usd: 6, kind: 'commit' })
  expect(spends[3]).toEqual({ startMs: Date.parse('2026-11-06T12:50:00Z'), endMs: Date.parse('2026-11-06T12:50:00Z'), usd: 2, kind: 'commit' })
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
    new Set([1, 7]),
    at,
    {
      loop: buildLoop('2026-11-01-1417', [file('p1/plan-01.autopilot', 4)], LOOP_PROGRESS, at),
      records: { 'docs/briefs/kickoff-sitting-s316-x.md': runRead({ phases: phasesAt(1, 0), note: null }) },
    },
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
  // A run whose record has no end is no ending, so S336 is not among them.
  const ends = [
    ending('kickoff-sitting-s337-gallery-arrange-page', 40, endOf('shipped; production is live (run 41585826609). ($32.71, 108 min, peak 360k context)')),
    ending('kickoff-sitting-s339-background-suite', 30, endOf('stopped: the brief is still in docs/briefs. Read the handoff.', 'run-broke')),
    // A deploy that failed shipped code but put nothing live, so it is no ship.
    ending('kickoff-sitting-s338-red-deploy', 35, endOf('shipped; deploy failed (run 44071838536). ($80.79, 140 min)', 'deploy-red', { deploy_run: 44071838536 })),
  ]
  const recent = recentOf(
    ends,
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
  const stop = endOf('stopped: the brief is still in docs/briefs. Read the handoff. ($26.47, 70 min, peak 254k context)', 'run-broke')
  const recent = recentOf(
    [ending('kickoff-sitting-s721-landing-outcomes', 20, stop), ending('kickoff-sitting-s722-step-up-controls', 30, stop)],
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

test("a brief's facts are its printed record's: its mode mapped, its After sittings joined, its cycles", () => {
  const facts = (more: object) => {
    const read = recordRead(JSON.stringify({ ...PRINT_BASE, end: null, ...more }))
    if (read.kind !== 'record') throw new Error('no record')
    return briefFacts(read.record)
  }
  expect(facts({ mode: 'autopilot', epic: 'minisite/E4', after: ['S340', 'S341'], split_from: ['S300'], cycles: 3 })).toEqual({
    header: { epic: 'minisite/E4', after: 'S340, S341', mode: 'ready', splitFrom: ['S300'] },
    cycles: 3,
  })
  expect(facts({ mode: 'interactive' })?.header.mode).toBe('interactive')
  expect(facts({ mode: 'none', epic: null, after: [], split_from: [], cycles: 0 })).toEqual({ header: UNREAD_HEADER, cycles: 0 })
  // A brief --print could not read prints no mode, and one of a mode the board does not know reads the same.
  expect(facts({ mode: null })).toBe(null)
  expect(facts({ mode: 'weekly' })).toBe(null)
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
  const b = buildBoard(raw, new Set(), NOW, { afters: { [key]: ['S299', 'S290'] } })
  expect(b.queued.map(q => q.after)).toEqual([['S299', 'S290']])
  expect(buildBoard(raw, new Set(), NOW).queued.map(q => q.after)).toEqual([[]])
})

const RUNNING = [
  { sitting: 'S403', slug: 'dashboard-groups', lane: 'epic' },
  { sitting: 'S396', slug: 'prune-test-overlaps', lane: 'fix' },
]
const waits = (entry: number, sitting: string, lane: string, after: string[], reason = '') => ({ entry, sitting, slug: sitting.toLowerCase(), lane, reason, after, next: 'machine', mode: 'autopilot', stop: null })
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
  const headers: Record<string, BriefHeader> = { bbb222: hdr('ready', 'minisite/E4', 'S340, S341'), ccc333: hdr('ready', 'account-basics/E8'), fff666: hdr('ready'), '222999': hdr('enrich') }
  const briefs = briefFiles(lsTreeBlobs(LS_TREE)).map(f => ({ ...f, header: headers[f.sha] ?? UNREAD_HEADER }))
  const deck = onDeckOf(briefs, ['docs/briefs/kickoff-sitting-s340-e8-help-pages.md'])
  expect(deck.map(d => `${d.sitting} ${d.slug} ${d.lane}${d.epic === '' ? '' : ` · ${d.epic}`}`)).toEqual([
    'S342 gallery-pass-keeps-stars epic · minisite/E4',
    'S350 split-work fix',
    '#527 gallery-race fix',
  ])
  expect(deck.map(d => d.mode)).toEqual(['ready', 'ready', 'enrich'])
  expect(onDeckOf(briefs, ['docs/briefs/s350-split-work/README.md']).some(d => d.sitting === 'S350')).toBe(false)
})

const deckOf = (sitting: string, mode: Deck['mode'], after = ''): Deck => ({ sitting, slug: sitting.toLowerCase(), lane: 'fix', epic: '', after, mode })
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
    deckOf('S435', 'interactive', 'S470'),
    deckOf('S436', 'interactive', 'S429, S434'),
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
    '├╌S435 after S470',
    '└╌S436 after S434',
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
const S625_END = endOf('stopped: the brief is still in docs/briefs. Read the handoff. ($9.56, 12 min, peak 159k context)', 'decision')
const S625_ENDINGS = [
  ending('kickoff-sitting-s624-gallery-sort', 10, endOf('shipped; production is live (run 44101392229). ($70.28, 114 min)')),
  ending('kickoff-sitting-s625-gallery-arrange-doors', 20, S625_END, {}, S625_PROGRESS),
  ending('kickoff-sitting-s626-gallery-arrange-page', 21, endOf('refused: S625 stopped before it shipped (stopped: the brief is still in docs/briefs. Read the handoff.).', 'run-broke')),
]
/** A red deploy's end, naming deploy run `run`. */
const redEnd = (text: string, run: number) => endOf(text, 'deploy-red', { deploy_run: run })
const heldDeck = (sitting: string, slug: string): Deck => ({ sitting, slug, lane: 'epic', epic: 'gallery', after: '', mode: 'ready' })

test("S625's decision stop is one block that holds S626 and S627, which leave on deck", async () => {
  const b = buildBoard(S625_STATUS, new Set([927]), NOW, {
    endings: S625_ENDINGS,
    afters: S625_AFTERS,
    handoffs: { 'kickoff-sitting-s625-gallery-arrange-doors': S625_HANDOFF },
    onDeck: [heldDeck('S625', 'gallery-arrange-doors'), heldDeck('S626', 'gallery-arrange-page'), heldDeck('S627', 'gallery-arrange-options'), heldDeck('S640', 'other')],
  })
  expect(b.blocked.length).toBe(1)
  const k = b.blocked[0]
  if (k === undefined) throw new Error('no block')
  // The kind comes from the record's end: status.json has none.
  expect(`${KIND_TAG[k.kind]} ${k.headline}`).toBe(
    '? you S625 asks: how long does an empty panel the photographer added last, and what may the sort do to it?',
  )
  expect(k.why).toBe('savor found a failed premise · nothing pushed · 12m · $9.56')
  expect(k.strip.map(c => `${c.stage}:${c.state}`)).toEqual(['savor:broke', 'cycles:todo', 'push:todo', 'staging:todo', 'prod:todo'])
  // The refused S626 is a hold, never a root of its own.
  expect(k.holds).toEqual([
    { sitting: 'S626', slug: 'gallery-arrange-page', parent: 'S625', after: ['S625'], next: 'machine' },
    { sitting: 'S627', slug: 'gallery-arrange-options', parent: 'S626', after: ['S626'], next: 'machine' },
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
  const b = buildBoard(raw, new Set(), NOW, { endings: S625_ENDINGS, afters: S625_AFTERS })
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
    ending('kickoff-sitting-s625-gallery-arrange-doors', 20, S625_END, {}, S625_PROGRESS),
    ending(
      'kickoff-sitting-s623-gallery-pins',
      30,
      redEnd('shipped; deploy failed (run 77). ($80.79, 140 min)', 77),
      {},
      'bash: npm run push:checked\nkind: deploy-red\nfinished: shipped; deploy failed (run 77). ($80.79, 140 min)',
    ),
  ]
  const b = buildBoard(raw, new Set(), NOW, { endings, afters: S625_AFTERS, deployStages: { '77': 'staging' } })
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
    ending('kickoff-sitting-s623-gallery-pins', 30, redEnd('shipped; deploy failed (run 77). ($8.00, 14 min)', 77)),
    ending('kickoff-sitting-s624-gallery-sort', 40, endOf('shipped; production is live (run 78). ($8.00, 14 min)')),
  ]
  const b = buildBoard({ dispatcher: null, running: [], queued: [], finished: [] }, new Set(), NOW, { endings })
  expect(b.blocked).toEqual([])
})

test('a red deploy stops being stuck once a re-run of its own run passes', async () => {
  const endings = [ending('kickoff-sitting-s658-dispatch-holds-on-held-gate', 30, redEnd('shipped; deploy failed (run 77). ($8.00, 14 min)', 77))]
  const raw = { dispatcher: null, running: [], queued: [], finished: [] }
  expect(buildBoard(raw, new Set(), NOW, { endings, deployStages: { '77': 'staging' } }).blocked.map(b => b.sitting)).toEqual(['S658'])
  expect(buildBoard(raw, new Set(), NOW, { endings, deployStages: { '77': DEPLOY_LIVE } }).blocked).toEqual([])
  expect(deployStateOf('success', [])).toBe(DEPLOY_LIVE)
  expect(deployStateOf('failure', ['Deploy to Staging & E2E'])).toBe('staging')
})

// S689's run 44933073127 failed in production, and run 44934802905, shipped by
// hand from an interactive session, went live on main with no autopilot end after it.
test('a red deploy stops being stuck once a newer deploy run on main goes live', async () => {
  const endings = [ending('kickoff-sitting-s689-nav-residues', 30, redEnd('shipped; deploy failed (run 44933073127). ($8.00, 14 min)', 44933073127))]
  const raw = { dispatcher: null, running: [], queued: [], finished: [] }
  const deployStages = { '44933073127': 'prod' }
  const blocked = (liveDeploy: string) => buildBoard(raw, new Set(), NOW, { endings, deployStages, liveDeploy }).blocked.map(b => b.sitting)
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
  const endings = [...S625_ENDINGS, ending('kickoff-sitting-s629-board-blocked-hold', 5, endOf('shipped; production is live (run 9). ($27.48, 72 min)'))]
  const b = buildBoard(S625_STATUS, new Set([927]), NOW, {
    endings,
    afters: S625_AFTERS,
    handoffs: { 'kickoff-sitting-s625-gallery-arrange-doors': S625_HANDOFF },
    recent: recentOf(endings, []),
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
const BOARD_SHAPE = 'board-17'

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
/** S684's board; `launches` is the launch count its record states. */
const s684Board = (extra: Parameters<typeof buildBoard>[3] = {}, launches = 0) =>
  buildBoard(S684_STATUS, new Set([1, 11]), NOW, {
    endings: [
      ending(
        'kickoff-sitting-s684-home-gallery-sections',
        20,
        endOf('stopped: the brief is still in docs/briefs. Read the handoff. ($13.12, 19 min, peak 150k context)', 'decision'),
        { launches },
        S684_PROGRESS,
      ),
    ],
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
    buildBoard(S625_STATUS, new Set(), NOW, {
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
    buildBoard(S625_STATUS, new Set(), NOW, {
      endings: S625_ENDINGS.map(e =>
        e.text === S625_PROGRESS ? ending(e.base, e.mtimeMs, { ...S625_END, kind }, {}, S625_PROGRESS.replace('kind: decision', `kind: ${kind}`)) : e,
      ),
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
  const b = buildBoard(S625_STATUS, new Set([927]), NOW, {
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
  const b = buildBoard(raw, new Set(), NOW, { endings: S625_ENDINGS, afters })
  expect(b.blocked[0]?.holds.map(h => h.sitting).sort()).toEqual(['S626', 'S627'])
  const rows = queueTree(b.running, b.queued, b.blocked).map(r => r.sitting)
  expect(rows.filter(s => s === 'S626').length).toBe(1)
  expect(rows.filter(s => s === 'S627').length).toBe(1)
})

test('a red deploy that holds nothing draws no queue root and no chain line', async ($, on) => {
  const endings = [ending('kickoff-sitting-s658-dispatch-holds-on-held-gate', 30, redEnd('shipped; deploy failed (run 77). ($8.00, 14 min)', 77))]
  const b = buildBoard({ dispatcher: null, running: [], queued: [], finished: [] }, new Set(), NOW, { endings, deployStages: { '77': 'staging' } })
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
  const b = buildBoard(raw, new Set([5147, 21491]), NOW, { spend, records: { [S300_BRIEF]: S300_READ() } })
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
  const { ui } = await mountBoard($, on, buildBoard(raw, new Set([5147]), NOW, { spend: null }))
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
    phaseMs: {},
  }))
const recentBoard = (recent: Ended[], extra: Parameters<typeof buildBoard>[3] = {}) =>
  buildBoard({ dispatcher: null, running: [], queued: [], finished: [] }, new Set(), NOW, { recent, ...extra })

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

test('each line takes the time of the nearest at line above it', () => {
  const text = `commit: before any stamp\n${stamped([[0, 'slot: 1'], [5, 'skill: simplify x']])}\nbash: under the last stamp`
  expect(lineTimes(text)).toEqual([null, T0, T0, T0 + 300000, T0 + 300000, T0 + 300000])
})

test("a run's split milliseconds round to six cells by largest remainder, ties to the earlier phase", () => {
  expect(splitCells({ savor: 10 * 60000, cycles: 40 * 60000, ship: 10 * 60000 })).toEqual({ savor: 1, cycles: 4, ship: 1 })
  // 7m, 46m and 7m give 0.7, 4.6 and 0.7 cells.
  expect(splitCells({ savor: 7 * 60000, cycles: 46 * 60000, ship: 7 * 60000 })).toEqual({ savor: 1, cycles: 4, ship: 1 })
  // Three even thirds: the earlier phases take the ties.
  expect(splitCells({ savor: 1, cycles: 1, ship: 1 })).toEqual({ savor: 2, cycles: 2, ship: 2 })
  expect(splitCells({ savor: 0, cycles: 0, ship: 0 })).toBe(null)
  expect(splitCells(null)).toBe(null)
})

// RECENT with one run per figure, each spending that many minutes in cycle 1.
const recentWithCycles = (minutes: number[]): Ended[] =>
  endedOf(minutes.map((_, i): [string, number, number] => [`S60${i}`, 60, 10])).map((d, i) => ({
    ...d,
    phaseMs: { 'cycle 1': (minutes[i] ?? 0) * 60000 },
  }))
// S692 started 16:34, and its record opened cycle 1 at 16:40.
const phaseClockBoard = (recent: Ended[]) =>
  buildBoard(S684_STATUS, new Set([1, 11]), NOW, {
    cycles: { [`${BRIEFS}s692-design-tokens.md`]: 3 },
    recent,
    records: { [`${BRIEFS}s692-design-tokens.md`]: runRead({ phases: phasesAt(3, 0), phase_since: '2026-10-31T16:40:00Z', note: null }) },
  })

test("the running card's header reads phase time · total · cost, the phase time peach under its median", async ($, on) => {
  const { ui } = await mountBoard($, on, phaseClockBoard(recentWithCycles([12, 20, 30])))
  expect(await coloursOf(ui, '9m')).toEqual(['#f5a97f'])
  expect(await has(ui, '9m · 15m · $10.63')).toBe(true)
  // The total and the cost draw alike; only the phase time carries a tint.
  expect(await coloursOf(ui, '15m')).toEqual(['#cad3f5'])
  expect(await coloursOf(ui, '$10.63')).toEqual(['#cad3f5'])
  await ui.unmount()
})

test("the time in phase turns red past the phase's median", async ($, on) => {
  const { ui } = await mountBoard($, on, phaseClockBoard(recentWithCycles([4, 6, 8])))
  expect(await coloursOf(ui, '9m')).toEqual(['#ed8796'])
  await ui.unmount()
})

test('with no recent run timing the phase, the time in phase stays peach', async ($, on) => {
  const { ui } = await mountBoard($, on, phaseClockBoard([]))
  expect(await coloursOf(ui, '9m')).toEqual(['#f5a97f'])
  await ui.unmount()
})

test('recent draws each run as a phase split, and a file with no times as the grey baseline', async ($, on) => {
  const live = endOf('shipped; production is live (run 1). ($22.40, 60 min)')
  // 10m of savor, 40m of cycles and 10m of ship, as a record states them; a record with no split draws the baseline.
  const files = [
    ending('kickoff-sitting-s682-dom-wait-quiet', NOW - 2 * HOUR, live, { phase_split: { savor: 600000, cycles: 2400000, ship: 600000 } }),
    ending('kickoff-sitting-s683-doc-tests-read-map', NOW - 3 * HOUR, live),
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

// The plan costs plan-costs.mjs prints for S682 and S683, the board's stub answer:
// `node scripts/plan-costs.mjs ledger.jsonl` printed PLAN_COSTS_STDOUT in a scratch
// repository over S682's plan commits at $4 and $2 and S683's at $40.
const PLAN_COSTS_STDOUT = '{"S682":6,"S683":40}\n'
const PLAN_COSTS: Record<string, number> = JSON.parse(PLAN_COSTS_STDOUT)
/** Whether argv runs the main checkout's plan-costs.mjs. */
const isPlanCosts = (argv: readonly string[]): boolean => argv[0] === 'node' && (argv[1] ?? '').endsWith('/scripts/plan-costs.mjs')
// The sha a stub answers for `origin/main`.
const MAIN_SHA = 'c0ffee'.padEnd(40, '0')
// Ledger lines, which the spend sparkline reads.
const PLAN_LEDGER = [
  JSON.stringify({ kind: 'commit', ts: '2026-10-31T08:00:00Z', phase: 'plan', sitting: 682, cost: { usd: 4 } }),
  JSON.stringify({ kind: 'commit', ts: '2026-10-31T08:10:00Z', phase: 'plan', sitting: 682, cost: { usd: 2 } }),
  JSON.stringify({ kind: 'session', ts: '2026-10-31T08:20:00Z', phase: 'plan', sitting: 682, cost: { usd: 1 } }),
  JSON.stringify({ kind: 'ship', ts: '2026-10-31T08:30:00Z', phase: 'plan', sitting: 682, overhead: { usd: 3 } }),
  JSON.stringify({ kind: 'commit', ts: '2026-10-31T09:00:00Z', sitting: 682, cost: { usd: 9 } }),
  JSON.stringify({ kind: 'commit', ts: '2026-10-31T09:10:00Z', phase: 'plan', sitting: '682', cost: { usd: 5 } }),
  JSON.stringify({ kind: 'commit', ts: '2026-10-31T09:20:00Z', phase: 'plan', sitting: 683, cost: { usd: 40 } }),
].join('\n')

test('recent draws each run its plan cost, dim, bright past the build cost, and +— with none', async ($, on) => {
  const recent = endedOf(PROPOSED_RECENT.slice(0, 3))
  const { ui } = await mountBoard($, on, recentBoard(recent, { plans: PLAN_COSTS }))
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
const S684_RUN = 'kickoff-sitting-s684-home-gallery-sections'

test('the blocked why-line gives the plan cost and which launch stopped', async ($, on) => {
  const plans = { S684: 11.36 }
  const once = s684Board({ plans }, 1)
  expect(historyTag(once.blocked[0] ?? { plan: 'unread', launches: null })).toBe('+$11.36 plan · 1st launch')
  const { ui } = await mountBoard($, on, once)
  expect(await has(ui, '$13.12 +$11.36 plan · 1st launch')).toBe(true)
  await ui.unmount()
  // The second launch emptied the progress file; the record counts both launches.
  const twice = s684Board({ plans }, 2)
  expect(historyTag(twice.blocked[0] ?? { plan: 'unread', launches: null })).toBe('+$11.36 plan · 2nd launch')
  // A record of no launch gives no launch tag; no plan commit gives no plan tag.
  expect(historyTag(s684Board({ plans: {} }).blocked[0] ?? { plan: 'unread', launches: null })).toBe('')
})

const SPLIT_BRIEFS = [
  { path: `${BRIEFS}s686-dashboard-rail.md`, text: briefWith('# S686\n\nAfter: S685\n\n## a', { after: ['S685'] }) },
  { path: `${BRIEFS}s690-nav-overlays.md`, text: briefWith('# S690\n\nSplit from: S686\nAfter: S698\n\n## a\nSplit from: S1', { after: ['S698'], split_from: ['S686'] }) },
]
const SITTINGS_JSON = JSON.stringify({ floor: 60, claims: { s700: { slug: 'x', record: { split_from: ['s686', 's690'] } }, s650: { slug: 'y', record: { cards: [] } } } })

test("a split parent's queue row reads how many briefs were split from it", async ($, on) => {
  const headed = SPLIT_BRIEFS.map(b => ({ path: b.path, header: factsFor([b.text]).header }))
  const splits = splitCounts(headed, sittingsClaims(SITTINGS_JSON))
  expect(splits).toEqual({ S686: 2, S690: 1 })
  // A sittings.json that does not parse counts only the live briefs.
  expect(splitCounts(headed, sittingsClaims('{"claims": '))).toEqual({ S686: 1 })
  const raw = { dispatcher: 1, running: [], queued: [{ entry: 1, brief: `${BRIEFS}s686-dashboard-rail.md`, lane: '', reason: 'a free slot', cause: null }], finished: [] }
  const { ui } = await mountBoard($, on, buildBoard(raw, new Set([1]), NOW, { splits }))
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
/** S684's stop as its record states it: one launch on slot 2, from 40m back to its stop 19m back. */
const S684_ENDING = () =>
  ending(
    S684_RUN,
    NOW - 19 * MIN,
    endOf('stopped: the brief is still in docs/briefs. Read the handoff. ($13.12, 19 min)', 'decision'),
    { launch_spans: [spanAt(2, -40, -19, false)] },
    S684_STOP,
  )
const tlBoard = (recent: Ended[] = endedOf(PROPOSED_RECENT)) => {
  const raw = parseStatus(TL_STATUS)
  if (raw === null) throw new Error('status did not parse')
  return buildBoard(raw, new Set([1, 11]), NOW, {
    recent,
    afters: TL_AFTERS,
    endings: [S684_ENDING()],
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
  const live = endOf(done.slice('finished: '.length))
  const endings = [
    // The status record takes the span its stamp matches, so S677 draws once.
    ending('kickoff-sitting-s677-drafts', NOW - 7 * HOUR, live, { launch_spans: [spanAt(1, -540 + 0.05, -420)] }, stampedAt([[NOW - 9 * HOUR + 3000, 'slot: 1'], [NOW - 7 * HOUR, done]])),
    // The finished list no longer holds S681: its record's span places it.
    ending(
      'kickoff-sitting-s681-dropped',
      NOW - 290 * MIN,
      live,
      { launch_spans: [spanAt(2, -360, -300)] },
      stampedAt([[NOW - 6 * HOUR, 'slot: 2'], [NOW - 5 * HOUR, 'landed: a..b'], [NOW - 290 * MIN, done]]),
    ),
    // Neither: slot 1 holds S677 then, so slot 2 takes it.
    ending('kickoff-sitting-s679-null-slot', NOW - 430 * MIN, live, { launch_spans: [spanAt(null, -470, -430)] }, stampedAt([[NOW - 470 * MIN, 'slot: none'], [NOW - 430 * MIN, done]])),
    // Neither, and no slot is free over its span: not drawn.
    ending('kickoff-sitting-s678-no-room', NOW - 440 * MIN, live, {}, stampedAt([[NOW - 460 * MIN, 'skill: simplify x'], [NOW - 440 * MIN, done]])),
  ]
  const b = buildBoard(raw, new Set(), NOW, { endings, afters: {} })
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
  const endings = [ending('kickoff-sitting-s681-dropped', NOW - 5 * HOUR, endOf(done.slice('finished: '.length)), { launch_spans: [spanAt(99999999, -360, -300)] })]
  const b = buildBoard(raw, new Set(), NOW, { endings, afters: {} })
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
// status.json's `sources` on the machine the defaults name; DEFAULT_STATUS heads every poll fixture's status.json.
const DEFAULT_SOURCES = { main: `${HOME}/Desktop/apps/shootsfilm`, log_dir: LOGS, archloop_log_dir: `${HOME}/Library/Logs/shootsfilm-archloop` }
const DEFAULT_STATUS = { version: 1, sources: DEFAULT_SOURCES }
// The main checkout's scripts directory as a poll lists it: the owner is there, so --print runs.
const OWNER_LISTING = { value: [{ name: 'run-status.mjs', kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false }] }
const POLL_FILES: Record<string, string> = {
  [`${LOGS}/status.json`]: JSON.stringify({ ...DEFAULT_STATUS, dispatcher: 1, running: [], queued: [], finished: [] }),
  [`${LOGS}/kickoff-sitting-s682-dom-wait-quiet.progress`]: stampedAt([[NOW - 3 * HOUR, 'slot: 1'], [NOW - 2 * HOUR, 'finished: shipped; production is live (run 1). ($22.40, 60 min)']]),
  [`${LOGS}/kickoff-sitting-s681-dropped.progress`]: stampedAt([[NOW - 6 * HOUR, 'slot: 2'], [NOW - 5 * HOUR, 'finished: shipped; production is live (run 2). ($9.00, 60 min)']]),
  [`${LOGS}/${S684_RUN}.progress`]: S684_STOP,
  [`${LOGS}/${S684_RUN}.launches`]: 'launch: 1 fresh slot 2 at 2026-10-31T16:09:25Z\n',
  // Each run's record beside its progress file, at the log directory status.json's `sources` names.
  [`${LOGS}/kickoff-sitting-s682-dom-wait-quiet.run.json`]: recordJson(endOf('shipped; production is live (run 1). ($22.40, 60 min)'), { launch_spans: [spanAt(1, -180, -120)] }),
  [`${LOGS}/kickoff-sitting-s681-dropped.run.json`]: recordJson(endOf('shipped; production is live (run 2). ($9.00, 60 min)'), { launch_spans: [spanAt(2, -360, -300)] }),
  [`${LOGS}/${S684_RUN}.run.json`]: recordJson(endOf('stopped: the brief is still in docs/briefs. Read the handoff. ($13.12, 19 min)', 'decision'), {
    launches: 1,
    launch_spans: [spanAt(2, -40, -19, false)],
  }),
}
const POLL_MTIMES: Record<string, number> = {
  'kickoff-sitting-s682-dom-wait-quiet.progress': NOW - 2 * HOUR,
  'kickoff-sitting-s681-dropped.progress': NOW - 5 * HOUR,
  [`${S684_RUN}.progress`]: NOW - 19 * MIN,
  [`${S684_RUN}.launches`]: NOW - 40 * MIN,
  'kickoff-sitting-s682-dom-wait-quiet.run.json': NOW - 2 * HOUR,
  'kickoff-sitting-s681-dropped.run.json': NOW - 5 * HOUR,
  [`${S684_RUN}.run.json`]: NOW - 19 * MIN,
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
      : e.path === `${DEFAULT_SOURCES.main}/scripts`
        ? OWNER_LISTING
        : { deny: 'no such directory' },
  )
  const ledger = `${PLAN_LEDGER}\n`
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    const [cmd = '', ...args] = e.argv
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd === 'git' && args[0] === 'ls-tree') return out(`100644 blob aaaa\tdocs/briefs/${S684_RUN}.md\n`)
    if (cmd === 'git' && args[0] === 'rev-parse') return out(`${MAIN_SHA}\n`)
    const printed = printAnswer(e.argv, sha => (sha === 'aaaa' ? '# S684\n\n**Mode: autopilot.**\n\n## x\n' : null))
    if (printed !== undefined) return out(printed.stdout, printed.exitCode)
    if (isPlanCosts(e.argv)) return out(PLAN_COSTS_STDOUT)
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
  const live = endOf(DONE_LIVE.slice('finished: '.length))
  const endings = [
    ending('kickoff-sitting-s681-dropped', NOW - 3 * HOUR, live, { launch_spans: [spanAt(2, -240 + 0.05, -180)] }, stampedAt([[NOW - 4 * HOUR + 3000, 'slot: 2'], [NOW - 3 * HOUR, DONE_LIVE]])),
    // No span to match: the status record draws to the file's mtime.
    ending('kickoff-sitting-s682-no-slot-line', NOW - 150 * MIN, live, {}, stampedAt([[NOW - 4 * HOUR, 'skill: simplify x'], [NOW - 150 * MIN, DONE_LIVE]])),
  ]
  const b = buildBoard(raw, new Set(), NOW, { endings, afters: {} })
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
  // Its record: a launch on slot 2 that stopped two hours back, and the launch in flight on slot 1.
  const records = { [brief]: runRead({ launch_spans: [spanAt(2, -240, -120, false), spanAt(1, -30, null)] }) }
  const b = buildBoard(raw, new Set([11]), NOW, { records, endings: [], afters: {} })
  expect(barsOf(b, 2)).toEqual(['S684 stopped -240..-120'])
  expect(barsOf(b, 1)).toEqual(['S684 running -30..0'])
})

test("a run that is not running closes its record's open last span at its progress file's mtime", () => {
  // The record closed S681's first launch at the next slot line and left the last one open; neither run has ended.
  const endings = [
    ending(
      'kickoff-sitting-s681-dropped',
      NOW - 3 * HOUR,
      null,
      { launch_spans: [spanAt(2, -360, -300, false), spanAt(2, -300, null)] },
      stampedAt([[NOW - 6 * HOUR, 'slot: 2'], [NOW - 330 * MIN, 'skill: x'], [NOW - 5 * HOUR, 'slot: 2'], [NOW - 4 * HOUR, 'skill: y']]),
    ),
    ending('kickoff-sitting-s690-lone', NOW - 150 * MIN, null, { launch_spans: [spanAt(1, -200, null)] }, stampedAt([[NOW - 200 * MIN, 'slot: 1']])),
  ]
  const b = buildBoard(statusOf({}), new Set(), NOW, { endings, afters: {} })
  expect(barsOf(b, 2)).toEqual(['S681 stopped -360..-300', 'S681 stopped -300..-180'])
  expect(barsOf(b, 1)).toEqual(['S690 stopped -200..-150'])
})

test('an empty or unparsable at line keeps the stamp above it', () => {
  expect(lineTimes(`at: ${iso(T0)}\nslot: 1\nat: \nskill: x\nat: garbage\nbash: y`)).toEqual([T0, T0, T0, T0, T0, T0])
})

test("you starts at the stop of the ending BLOCKED reads, the sitting's newest", () => {
  const raw = parseStatus(TL_STATUS)
  if (raw === null) throw new Error('status did not parse')
  const older = `${stampedAt([[NOW - 4 * HOUR, 'skill: x'], [NOW - 3 * HOUR, 'kind: decision']])}\nfinished: stopped: an older stop. ($1.00, 60 min)`
  const b = buildBoard(raw, new Set([1, 11]), NOW, {
    recent: endedOf(PROPOSED_RECENT),
    afters: TL_AFTERS,
    endings: [ending('kickoff-sitting-s684-an-older-slug', NOW - 3 * HOUR, endOf('stopped: an older stop. ($1.00, 60 min)', 'decision'), {}, older), S684_ENDING()],
    utcOffset: '-0500',
  })
  expect(b.timeline.you?.sitting).toBe('S684 ? 19m')
})

test('a running record whose slot_taken does not parse draws on its slot from its start, projected', () => {
  const raw = statusOf({
    running: [{ entry: 5, brief: `${BRIEFS}s692-design-tokens.md`, lane: '', pid: 11, started: iso(NOW - 30 * MIN), session_cost: 1, slot: 2, slot_taken: 'not a time', slot_released: null }],
  })
  const b = buildBoard(raw, new Set([11]), NOW, { recent: endedOf(PROPOSED_RECENT), endings: [], afters: {} })
  expect(barsOf(b, 1)).toEqual([])
  expect(barsOf(b, 2)).toEqual(['S692 running -30..34 live to 0'])
})

test("recent's totals put the time and cost under the rows' columns when plan cells show", async ($, on) => {
  const recent = endedOf(PROPOSED_RECENT.slice(0, 3))
  const { ui } = await mountBoard($, on, recentBoard(recent, { plans: PLAN_COSTS }))
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
  const { ui } = await mountBoard($, on, buildBoard(raw, new Set(), NOW, { endings: [], afters: {} }))
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
  const status = JSON.stringify({ ...DEFAULT_STATUS, dispatcher: 1, running: [], queued: [{ entry: 1, brief: `${BRIEFS}s686-dashboard-rail.md`, lane: '', reason: 'a free slot', cause: null }], finished: [] })
  on('fs.read', (_: unknown, e: { path: string }) => (e.path === `${LOGS}/status.json` ? { value: status } : { deny: 'no such file' }))
  on('fs.list', (_: unknown, e: { path: string }) =>
    e.path === LOGS
      ? { value: [{ name: 'status.json', kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false }] }
      : e.path === `${DEFAULT_SOURCES.main}/scripts`
        ? OWNER_LISTING
        : { deny: 'no such directory' },
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
    const printed = printAnswer(e.argv, sha => blobs[sha] ?? null)
    if (printed !== undefined) return out(printed.stdout, printed.exitCode)
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

// A brief's header and its cycle headings, as the planner writes them, registered with what --print prints for it.
const briefText = (sitting: string, epic: string, after: string, cycles: number): string =>
  briefWith(
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
  ].join('\n'),
    { mode: 'autopilot', epic: epic === '' ? null : epic, after: afterSittings(after), cycles },
  )

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

/** What the poll reads from an `ls-tree` and its blobs, for `buildBoard`: each brief's facts as --print prints them. */
const fromTree = (ls: string, blobs: Readonly<Record<string, string>>, raw: Parameters<typeof buildBoard>[0]) => {
  const tree = lsTreeBlobs(ls)
  const byKey = cycleBlobMap(tree)
  return briefsRead(
    tree,
    k => {
      const texts = (byKey.get(k) ?? []).map(sha => blobs[sha])
      return texts.length === 0 || texts.some(t => t === undefined) ? undefined : factsFor(texts as string[])
    },
    sha => blobs[sha] ?? null,
    raw.running.map(r => r.brief),
    raw.queued.map(r => r.brief),
  )
}

// Four live runs: $7.70 over 1 cycle, $30 over 2, $10 over 2, and $1 whose commits name no cycle, each its record's `named_cycles`.
const COST_FILES = (
  [
    ['s601-one', 1, '$7.70'],
    ['s602-two', 2, '$30.00'],
    ['s603-two', 2, '$10.00'],
    ['s604-fix', 0, '$1.00'],
  ] as const
).map(([name, named, usd], i) =>
  ending(`kickoff-sitting-${name}`, NOW - (i + 1) * HOUR, endOf(`shipped; production is live (run 1). (${usd}, 30 min)`), { named_cycles: named }),
)

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
  return buildBoard(raw, new Set([1, 11]), NOW, {
    ...tree,
    cycles,
    endings: [
      ending(S684_RUN, NOW - 19 * MIN, endOf('stopped: the brief is still in docs/briefs. Read the handoff. ($13.12, 19 min, peak 150k context)', 'decision'), {}, S684_PROGRESS),
    ],
    recent: opts.recent ?? recentOf(COST_FILES, []),
    records: { [`${BRIEFS}s693-token-export.md`]: runRead({ phases: phasesAt(2, 0), note: null }) },
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
  const b = buildBoard(statusOf({ dispatcher: 1 }), new Set([1]), SPARK_NOW, { spend, utcOffset: '-1000' })
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
  const status = JSON.stringify({ ...DEFAULT_STATUS, dispatcher: 1, running: [], queued: [{ entry: 1, brief: `${BRIEFS}s694-system-catalogue.md`, lane: '', reason: 'a free slot', cause: null }], finished: [] })
  on('fs.read', (_: unknown, e: { path: string }) => (e.path === `${LOGS}/status.json` ? { value: status } : { deny: 'no such file' }))
  on('fs.list', (_: unknown, e: { path: string }) =>
    e.path === LOGS
      ? { value: [{ name: 'status.json', kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false }] }
      : e.path === `${DEFAULT_SOURCES.main}/scripts`
        ? OWNER_LISTING
        : { deny: 'no such directory' },
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
    const printed = printAnswer(e.argv, sha => blobs[sha] ?? null)
    if (printed !== undefined) return out(printed.stdout, printed.exitCode)
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

// An issue brief on dashboard/E1 beside S700 on deck on the same epic.
const ISSUE_BRIEF = 'docs/briefs/kickoff-527-fix-thing.md'
const ISSUE_LS = [`100644 blob a527\t${ISSUE_BRIEF}`, `100644 blob a700\t${BRIEFS}s700-rail-polish.md`, '100644 blob e901\tdocs/plans/dashboard.md'].join('\n')
const ISSUE_BLOBS: Record<string, string> = { a527: briefText('#527', 'dashboard/E1', '', 1), a700: briefText('S700', 'dashboard/E1', '', 1), e901: DASHBOARD_PLAN }

test('an issue brief keys its epic state by its #number, queued or running', async ($, on) => {
  const queued = statusOf({ dispatcher: 1, queued: [{ entry: 1, brief: ISSUE_BRIEF, lane: '', reason: 'a free slot', cause: null }] })
  // An issue number sorts after every sitting, so the queued state shows on an epic #527 holds alone.
  const alone = ISSUE_LS.split('\n').filter(l => !l.includes('s700')).join('\n')
  const q = buildBoard(queued, new Set([1]), NOW, fromTree(alone, ISSUE_BLOBS, queued))
  expect(q.epics.map(e => `${e.label} ${e.cells.join(',')} ${e.next?.kind} ${e.next?.sitting}`)).toEqual(['nav todo queued #527'])
  const running = statusOf({ dispatcher: 1, running: [{ entry: 1, brief: ISSUE_BRIEF, lane: '1', pid: 11, started: iso(NOW - 30 * MIN), session_cost: 2 }] })
  const r = buildBoard(running, new Set([1, 11]), NOW, fromTree(ISSUE_LS, ISSUE_BLOBS, running))
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
  const text = JSON.stringify({ ...DEFAULT_STATUS, dispatcher: 1, running: [], queued: [], finished: [], ...status })
  on('fs.read', (_: unknown, e: { path: string }) => (e.path === `${LOGS}/status.json` ? { value: text } : { deny: 'no such file' }))
  on('fs.list', (_: unknown, e: { path: string }) =>
    e.path === LOGS
      ? { value: [{ name: 'status.json', kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false }] }
      : e.path === `${DEFAULT_SOURCES.main}/scripts`
        ? OWNER_LISTING
        : { deny: 'no such directory' },
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
    const printed = printAnswer(e.argv, sha => {
      const a = answer(poll - 1, ['cat-file', 'blob', sha])
      return a === 'deny' || (a.exitCode ?? 0) !== 0 ? null : a.stdout
    })
    if (printed !== undefined) return out(printed.stdout, printed.exitCode)
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

// Every path the board reads from status.json's `sources`, each off its default.
const SOURCES = { main: '/src/main', log_dir: '/src/logs', archloop_log_dir: '/src/loop' }
const S758 = 'kickoff-sitting-s758-run-board-reads-record'
const S758_BRIEF = `docs/briefs/${S758}.md`
const S758_RECORD = '/src/records/s758.run.json'
/** A status.json with one running run, S758, whose record sits at S758_RECORD. */
const runningStatus = (more: object = {}, run: object = {}) =>
  JSON.stringify({
    version: 1,
    sources: SOURCES,
    dispatcher: 1,
    running: [
      { entry: 9, brief: S758_BRIEF, lane: '1', pid: 11, started: iso(NOW - 30 * MIN), session_cost: 2, slot: 1, slot_taken: iso(NOW - 30 * MIN), slot_released: null, run_record: S758_RECORD, ...run },
    ],
    queued: [],
    finished: [],
    ...more,
  })
// The progress text names another stage than any record here: a board that reads it lights `ship`.
const S758_PROGRESS = stampedAt([[NOW - 30 * MIN, 'slot: 1'], [NOW - 2 * MIN, 'skill: commit-skill:ship']])

type Argv = readonly string[]
type RunAnswer = { exitCode: number; stdout: string } | undefined

/**
 * Polls over `files` as a file tree, each file at its `mtimes` entry or NOW,
 * with `run` answering the commands it knows. Returns the pane the last poll
 * wrote, every command the polls ran with its working directory, and the
 * clock.
 */
async function pollPane(
  $: any,
  on: any,
  files: Record<string, string>,
  run: (argv: Argv, cwd: string | undefined) => RunAnswer | Promise<RunAnswer> = () => undefined,
  mtimes: Record<string, number> = {},
  gate?: Promise<void>,
) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME })
  mock.store(on, { folds: {} })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'board' } }))
  on('ui.status', () => ({ value: undefined }))
  on('fs.read', (_: unknown, e: { path: string }) => (e.path in files ? { value: files[e.path] } : { deny: 'no such file' }))
  on('fs.list', (_: unknown, e: { path: string }) => {
    const entries = new Map<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean }>()
    for (const p of Object.keys(files)) {
      if (!p.startsWith(`${e.path}/`)) continue
      const [name = '', ...deeper] = p.slice(e.path.length + 1).split('/')
      entries.set(name, { name, kind: deeper.length > 0 ? 'dir' : 'file', size: 1, mtimeMs: mtimes[p] ?? NOW, isLink: false })
    }
    return entries.size === 0 ? { deny: 'no such directory' } : { value: [...entries.values()] }
  })
  const calls: { argv: Argv; cwd: string | undefined }[] = []
  on('process.run', async (_: unknown, e: { argv: Argv; init?: { cwd?: string } }) => {
    calls.push({ argv: e.argv, cwd: e.init?.cwd })
    const answer = await run(e.argv, e.init?.cwd)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (answer !== undefined) return out(answer.stdout, answer.exitCode)
    const [cmd = ''] = e.argv
    if (cmd === 'date') return out('-0500')
    if (cmd === 'ps') return out('1\n7\n11\n')
    return out('', 1)
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  if (gate === undefined) await clock.advance(0)
  const mount = () =>
    $.ui.mount({
      plugin: 'run-board',
      component: 'Pane',
      requestId: 'run-board',
      surface: 'terminal',
      props: { title: 'Autopilot runs', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
    })
  return { ui: gate === undefined ? await mount() : undefined, calls, clock, mount }
}

/** The bar labels drawn lit: peach and bold, the phase in flight. */
const litLabels = async (ui: Ui): Promise<string[]> =>
  (await ui.findAll({ type: 'Text' }))
    .filter(t => t.props?.color === PEACH && (t.props as { bold?: boolean } | undefined)?.bold === true)
    .map(t => (t.text ?? '').trim())

const isPrint = (argv: Argv): boolean => argv[0] === 'node' && argv.includes('--print')

test('the record base passes the reader, and so does the --print answer', () => {
  expect(recordRead(JSON.stringify(RECORD_BASE)).kind).toBe('record')
  expect(recordRead(JSON.stringify(PRINT_BASE)).kind).toBe('record')
})

test("a running run draws its record's stage, phases and clock, whatever its progress text says", async ($, on) => {
  const { ui, calls } = await pollPane(
    $,
    on,
    {
      [`${LOGS}/status.json`]: runningStatus(),
      [S758_RECORD]: JSON.stringify(runningRecord()),
      [`${LOGS}/${S758}.progress`]: S758_PROGRESS,
    },
    argv => (isPrint(argv) ? { exitCode: 0, stdout: JSON.stringify({ ...PRINT_BASE, stage: 'committing' }) } : undefined),
  )
  expect(await litLabels(ui)).toEqual(['xhigh'])
  expect(await has(ui, '9m · 30m · $3.00')).toBe(true)
  expect(calls.filter(c => isPrint(c.argv))).toEqual([])
  await ui.unmount()
})

test('a record of a version the board does not know draws no run, says it is newer, and never asks --print', async ($, on) => {
  // A whole record with its own stage, and a field v1 would refuse: a board that checks fields first reads it as old.
  const newer = { ...runningRecord({ stage: 'observations' }), version: 2, phases: 'every phase' }
  const { ui, calls } = await pollPane(
    $,
    on,
    {
      [`${LOGS}/status.json`]: runningStatus(),
      [S758_RECORD]: JSON.stringify(newer),
      [`${LOGS}/${S758}.progress`]: S758_PROGRESS,
    },
    argv => (isPrint(argv) ? { exitCode: 0, stdout: JSON.stringify({ ...runningRecord({ stage: 'committing' }) }) } : undefined),
  )
  expect(await has(ui, 'the record is newer than the board')).toBe(true)
  expect(await litLabels(ui)).toEqual([])
  expect(await has(ui, 'observations')).toBe(false)
  expect(await has(ui, 'committing')).toBe(false)
  expect(calls.filter(c => isPrint(c.argv))).toEqual([])
  await ui.unmount()
})

test('a --print answer of a version the board does not know draws the newer line too', async ($, on) => {
  const { ui } = await pollPane(
    $,
    on,
    { [`${LOGS}/status.json`]: runningStatus(), [`${LOGS}/${S758}.progress`]: S758_PROGRESS, [`${SOURCES.main}/scripts/run-status.mjs`]: '' },
    argv => (isPrint(argv) ? { exitCode: 0, stdout: JSON.stringify({ ...runningRecord({ stage: 'observations' }), version: 2 }) } : undefined),
  )
  expect(await has(ui, 'the record is newer than the board')).toBe(true)
  expect(await litLabels(ui)).toEqual([])
  await ui.unmount()
})

test('a status.json of a version the board does not know draws no board and says it is newer', async ($, on) => {
  const { ui } = await pollPane($, on, {
    [`${LOGS}/status.json`]: runningStatus({ version: 2 }),
    [S758_RECORD]: JSON.stringify(runningRecord()),
  })
  expect(await has(ui, 'status.json is newer than the board')).toBe(true)
  expect(await has(ui, 'S758')).toBe(false)
  await ui.unmount()
})

for (const [name, status] of [
  ['a missing status.json', undefined],
  ['a status.json with no sources', JSON.stringify({ ...JSON.parse(runningStatus()), sources: undefined })],
  ['a status.json whose sources name no strings', JSON.stringify({ ...JSON.parse(runningStatus()), sources: { main: 7 } })],
] as const) {
  test(`${name} draws the no-sources line alone, with no loop and no ON DECK`, async ($, on) => {
    const files: Record<string, string> = {
      [S758_RECORD]: JSON.stringify(runningRecord()),
      [`${HOME}/Library/Logs/shootsfilm-archloop/.lock/pid`]: '7\n',
      [`${HOME}/Library/Logs/shootsfilm-archloop/2026-10-31-1600/progress`]: '',
    }
    if (status !== undefined) files[`${LOGS}/status.json`] = status
    const { ui } = await pollPane($, on, files, argv =>
      argv[0] === 'git' && argv[1] === 'ls-tree'
        ? { exitCode: 0, stdout: '100644 blob d777\tdocs/briefs/kickoff-sitting-s777-on-deck.md\n' }
        : argv[0] === 'git' && argv[1] === 'cat-file'
          ? { exitCode: 0, stdout: '# S777\n\n**Mode: autopilot.**\n' }
          : undefined,
    )
    expect(await has(ui, 'status.json names no sources')).toBe(true)
    expect(await has(ui, 'S777')).toBe(false)
    expect(await has(ui, 'S758')).toBe(false)
    expect(await has(ui, '2026-10-31-1600')).toBe(false)
    await ui.unmount()
  })
}

test("status.json's sources name the main checkout and the loop's log directory", async ($, on) => {
  const { ui, calls } = await pollPane(
    $,
    on,
    {
      [`${LOGS}/status.json`]: runningStatus(),
      [S758_RECORD]: JSON.stringify(runningRecord()),
      [`${SOURCES.archloop_log_dir}/.lock/pid`]: '7\n',
      [`${SOURCES.archloop_log_dir}/2026-10-31-1600/progress`]: '',
      [`${SOURCES.archloop_log_dir}/2026-10-31-1600/p1/review.log`]: '',
    },
    argv => (argv[0] === 'git' && argv[1] === 'ls-tree' ? { exitCode: 0, stdout: '' } : undefined),
  )
  expect(await has(ui, '2026-10-31-1600')).toBe(true)
  expect([...new Set(calls.filter(c => c.argv[0] === 'git').map(c => c.cwd))]).toEqual([SOURCES.main])
  await ui.unmount()
})

// ---------- finished runs from their records ----------

test("a finished run's block kind is status.json's kind when it is not null, else the record's, and a red one matches its own run", () => {
  const red = 'kickoff-sitting-s761-red-run'
  const split = 'kickoff-sitting-s762-split-run'
  const raw = statusOf({
    finished: [
      { entry: 1, brief: `${BRIEFS}s761-red-run.md`, lane: '', status: 0, outcome: 'x', kind: null, slot: 2, slot_taken: iso(NOW - 2 * HOUR), slot_released: iso(NOW - HOUR) },
      { entry: 2, brief: `${BRIEFS}s762-split-run.md`, lane: '', status: 1, outcome: 'x', kind: 'split', slot: null, slot_taken: null, slot_released: null },
    ],
  })
  // The outcome's first word is `shipped`: a board that keys the kind on it reads no red deploy.
  const redEnd = { outcome: 'shipped', text: 'shipped; deploy failed (run 45149929776). ($8.00, 14 min)', kind: 'deploy-red', live: false, deploy_run: 45149929776 }
  const b = buildBoard(raw, new Set(), NOW, {
    endings: [ending(red, NOW - HOUR, redEnd, { launch_spans: [spanAt(2, -120, -60, false)] }), ending(split, NOW - 2 * HOUR, endOf('stopped: over the ceiling. ($3.00, 9 min)', 'decision'))],
    afters: { [`${BRIEFS}s762-split-run.md`]: [] },
    deployStages: { '45149929776': 'prod' },
  })
  expect(b.blocked.map(k => `${k.sitting} ${k.kind}`).sort()).toEqual(['S761 deploy-red', 'S762 split'])
  expect(b.blocked.find(k => k.sitting === 'S761')?.why).toBe('deploy failed · at production · run 45149929776 · 14m · $8.00')
  // Its bar takes the record's liveness: not live.
  expect(barsOf(b, 2)).toEqual(['S761 stopped -120..-60'])
})

test('a docs-only ship is live: RECENT lists it and BLOCKED does not', () => {
  const docs = { outcome: 'shipped', text: 'shipped; no deploy, because the run pushed docs only. ($2.00, 6 min)', kind: null, live: true, deploy_run: null }
  const endings = [ending('kickoff-sitting-s763-docs-only', NOW - HOUR, docs)]
  expect(recentOf(endings, []).map(d => `${d.sitting} ${d.minutes} ${d.usd}`)).toEqual(['S763 6 2'])
  expect(buildBoard(statusOf({}), new Set(), NOW, { endings, afters: { [`${BRIEFS}s763-docs-only.md`]: [] } }).blocked).toEqual([])
})

test("RECENT's medians read the record's phase_ms, and a record with no end draws in neither RECENT nor BLOCKED", () => {
  const live = endOf('shipped; production is live (run 1). ($9.00, 40 min)')
  const timed = ending('kickoff-sitting-s764-timed', NOW - HOUR, live, { phase_ms: [{ label: 'cycle 1', ms: 600000 }, { label: 'simplify', ms: 120000 }] })
  expect(recentOf([timed], []).map(d => d.phaseMs)).toEqual([{ 'cycle 1': 600000, simplify: 120000 }])
  const open = ending('kickoff-sitting-s765-no-end', NOW - HOUR, null)
  expect(recentOf([open], [])).toEqual([])
  expect(buildBoard(statusOf({}), new Set(), NOW, { endings: [open], afters: { [`${BRIEFS}s765-no-end.md`]: [] } }).blocked).toEqual([])
})

// A finished run that the board finds by name, S761, with no record off its `run_record`.
const FIN = 'kickoff-sitting-s761-finished-run'
const FIN_LIVE = endOf('shipped; production is live (run 3). ($12.00, 42 min)')
const finishedStatus = () =>
  JSON.stringify({
    version: 1,
    sources: SOURCES,
    dispatcher: 1,
    running: [],
    queued: [],
    finished: [{ entry: 4, brief: `docs/briefs/${FIN}.md`, lane: '', status: 0, outcome: 'x', kind: null, slot: null, slot_taken: null, slot_released: null, run_record: '/elsewhere/s761.run.json' }],
  })
/** The files a poll of S761 reads: status.json, its progress file, its brief and the owner, each at NOW unless `mtimes` says. */
const finFiles = (more: Record<string, string> = {}): Record<string, string> => ({
  [`${LOGS}/status.json`]: finishedStatus(),
  [`${LOGS}/${FIN}.progress`]: stampedAt([[NOW - 2 * HOUR, 'slot: 1'], [NOW - HOUR, 'finished: shipped; production is live (run 3). ($12.00, 42 min)']]),
  [`${SOURCES.main}/docs/briefs/${FIN}.md`]: '# S761',
  [`${SOURCES.main}/scripts/run-status.mjs`]: '',
  ...more,
})
// What `--print` printed for S761, from the base as `--print` prints it.
const FIN_PRINTED = JSON.stringify({ ...PRINT_BASE, end: FIN_LIVE, launch_spans: [] })
const isFinPrint = (argv: Argv): boolean =>
  isPrint(argv) && argv[1] === `${SOURCES.main}/scripts/run-status.mjs` && argv[3] === `${LOGS}/${FIN}.progress` && argv[4] === `${SOURCES.main}/docs/briefs/${FIN}.md`

test("a finished run's record sits at <sources.log_dir>/<name>.run.json, off LOG_DIR and off its run_record", async ($, on) => {
  const stopped = recordJson(endOf('stopped: read the handoff. ($1.00, 3 min)', 'decision'))
  const { ui, calls } = await pollPane($, on, finFiles({
    [`${SOURCES.log_dir}/${FIN}.run.json`]: recordJson(FIN_LIVE),
    [`${LOGS}/${FIN}.run.json`]: stopped,
    '/elsewhere/s761.run.json': stopped,
  }))
  expect(await has(ui, '42m')).toBe(true)
  expect(calls.filter(c => isPrint(c.argv))).toEqual([])
  await ui.unmount()
})

for (const [name, files] of [
  ['a run with no record', () => finFiles()],
  // A record that predates phase_ms is an old record: its own end, a stop, never draws.
  [
    'a run whose record has no phase_ms',
    () => finFiles({ [`${SOURCES.log_dir}/${FIN}.run.json`]: JSON.stringify({ ...JSON.parse(recordJson(endOf('stopped: x. ($1.00, 3 min)', 'run-broke'))), phase_ms: undefined }) }),
  ],
] as const) {
  test(`${name} draws what --print prints, run in the main checkout`, async ($, on) => {
    const { ui, calls } = await pollPane($, on, files(), argv => (isFinPrint(argv) ? { exitCode: 0, stdout: FIN_PRINTED } : undefined))
    expect(await has(ui, '42m')).toBe(true)
    expect(calls.filter(c => isFinPrint(c.argv)).map(c => c.cwd)).toEqual([SOURCES.main])
    await ui.unmount()
  })
}

for (const [name, answer] of [
  ['exits 1, its stdout a record', { exitCode: 1, stdout: FIN_PRINTED }],
  ['exits 0 with no stdout', { exitCode: 0, stdout: '' }],
  ['exits 0 with stdout that is no JSON', { exitCode: 0, stdout: 'TypeError: x is not a function' }],
] as const) {
  test(`a --print that ${name} draws the run from status.json alone`, async ($, on) => {
    const { ui } = await pollPane($, on, finFiles(), argv => (isFinPrint(argv) ? answer : undefined))
    expect(await has(ui, '42m')).toBe(false)
    await ui.unmount()
  })
}

test('--print runs once per progress mtime, brief mtime and owner mtime, and again after it fails', async ($, on) => {
  const mtimes: Record<string, number> = {}
  let fails = false
  const { clock, calls } = await pollPane($, on, finFiles(), argv => (isFinPrint(argv) ? (fails ? { exitCode: 1, stdout: '' } : { exitCode: 0, stdout: FIN_PRINTED }) : undefined), mtimes)
  const printed = () => calls.filter(c => isFinPrint(c.argv)).length
  await clock.advance(5000)
  expect(printed()).toBe(1)
  for (const path of [`${LOGS}/${FIN}.progress`, `${SOURCES.main}/docs/briefs/${FIN}.md`, `${SOURCES.main}/scripts/run-status.mjs`]) {
    mtimes[path] = (mtimes[path] ?? NOW) + 1000
    const before = printed()
    await clock.advance(5000)
    expect(printed()).toBe(before + 1)
  }
  // A failed --print keeps nothing: the next poll asks again.
  fails = true
  mtimes[`${LOGS}/${FIN}.progress`] = NOW + 9000
  const before = printed()
  await clock.advance(5000)
  await clock.advance(5000)
  expect(printed()).toBe(before + 2)
})

test('a red end with no deploy run asks gh for no run', async ($, on) => {
  const broke = endOf('stopped: the hook stayed red. ($4.00, 11 min)', 'run-broke')
  const { calls } = await pollPane($, on, finFiles({ [`${SOURCES.log_dir}/${FIN}.run.json`]: recordJson(broke) }))
  expect(calls.filter(c => c.argv[0] === 'gh' && c.argv[1] === 'run' && c.argv[2] === 'view')).toEqual([])
})

test('two polls that overlap on one slow --print run it once', async ($, on) => {
  let release = () => {}
  const gate = new Promise<void>(r => (release = r))
  const { clock, calls, mount } = await pollPane(
    $,
    on,
    finFiles(),
    async argv => {
      if (!isFinPrint(argv)) return undefined
      await gate
      return { exitCode: 0, stdout: FIN_PRINTED }
    },
    {},
    gate,
  )
  // The test clock does not wait for a poll, so the second starts while the first's --print is held.
  const first = clock.advance(0)
  await new Promise(r => setTimeout(r, 20))
  const second = clock.advance(5000)
  await new Promise(r => setTimeout(r, 20))
  release()
  await first
  await second
  await new Promise(r => setTimeout(r, 20))
  expect(calls.filter(c => isFinPrint(c.argv)).length).toBe(1)
  const ui = await mount()
  expect(await has(ui, '42m')).toBe(true)
  await ui.unmount()
})

// ---------- ON DECK and plan costs through the owner ----------

// S780 waits on deck at blob d0d758; S682 shipped, its record by name; the ledger is PLAN_LEDGER.
const DECK_BLOB = 'd0d758'
const DECK_LS = `100644 blob ${DECK_BLOB}\tdocs/briefs/kickoff-sitting-s780-deck-brief.md\n`
const DECK_PRINTED = JSON.stringify({ ...PRINT_BASE, end: null, mode: 'autopilot', epic: null, after: ['S758'], split_from: [], cycles: 3 })
const LEDGER_PATH = `${HOME}/.claude/token-ledger.jsonl`
const LEDGER_TEXT = `${PLAN_LEDGER}\n`
const S682_RUN = 'kickoff-sitting-s682-dom-wait-quiet'
const deckFiles = (): Record<string, string> => ({
  [`${LOGS}/status.json`]: JSON.stringify({ version: 1, sources: SOURCES, dispatcher: 1, running: [], queued: [], finished: [] }),
  [`${LOGS}/${S682_RUN}.progress`]: stampedAt([[NOW - 2 * HOUR, 'slot: 1'], [NOW - HOUR, 'finished: shipped; production is live (run 1). ($22.40, 60 min)']]),
  [`${SOURCES.log_dir}/${S682_RUN}.run.json`]: recordJson(endOf('shipped; production is live (run 1). ($22.40, 60 min)')),
  [`${SOURCES.main}/scripts/run-status.mjs`]: '',
})
/** Whether argv is the board's piped --print of S780's blob: pipefail, /dev/stdin, the main checkout's owner, the sha. */
const isDeckPrint = (argv: Argv): boolean =>
  argv[0] === 'sh' &&
  (argv[2] ?? '').startsWith('set -o pipefail;') &&
  (argv[2] ?? '').includes('--print /dev/null /dev/stdin') &&
  argv[4] === `${SOURCES.main}/scripts/run-status.mjs` &&
  argv.slice(5).join(' ') === DECK_BLOB

/**
 * The commands of a poll over deckFiles: the listing, S780's print by `deck`,
 * the plan costs by `plans` (asked in the main checkout only), and the ledger,
 * whose `origin/main` sha `sha()` answers.
 */
function deckRun(deck: () => RunAnswer | Promise<RunAnswer>, plans: () => RunAnswer, sha: () => string = () => MAIN_SHA) {
  return (argv: Argv, cwd: string | undefined): RunAnswer | Promise<RunAnswer> => {
    if (argv[0] === 'git' && argv[1] === 'ls-tree') return { exitCode: 0, stdout: DECK_LS }
    if (argv[0] === 'git' && argv[1] === 'rev-parse') return { exitCode: 0, stdout: `${sha()}\n` }
    if (isDeckPrint(argv)) return deck()
    if (isPlanCosts(argv)) return cwd === SOURCES.main ? plans() : { exitCode: 1, stdout: '' }
    if (argv[0] === 'stat') return { exitCode: 0, stdout: String(LEDGER_TEXT.length) }
    if (argv[0] === 'sh' && (argv[2] ?? '').includes('tail -c')) {
      const from = Number(argv[4]) - 1
      return { exitCode: 0, stdout: LEDGER_TEXT.slice(from, from + Number(argv[6])) }
    }
    return undefined
  }
}

test("ON DECK draws what --print prints for a brief's blob, and the plan column what plan-costs.mjs prints", async ($, on) => {
  const { ui, calls } = await pollPane(
    $,
    on,
    deckFiles(),
    deckRun(() => ({ exitCode: 0, stdout: DECK_PRINTED }), () => ({ exitCode: 0, stdout: PLAN_COSTS_STDOUT })),
  )
  expect(await has(ui, 'ready 1')).toBe(true)
  expect((await costBox(ui, 'S780 deck-brief')).squares.join('')).toMatch(/^■■■ /)
  expect(await has(ui, '+$6')).toBe(true)
  expect(calls.filter(c => isPlanCosts(c.argv)).map(c => c.cwd)).toEqual([SOURCES.main])
  expect(calls.filter(c => isPlanCosts(c.argv)).map(c => c.argv[2])).toEqual([LEDGER_PATH])
  await ui.unmount()
})

for (const [name, answer] of [
  ['exits 1', { exitCode: 1, stdout: '' }],
  ['exits 0 with stdout that is no S<n> object', { exitCode: 0, stdout: '{"S682":"6","x":1}' }],
] as const) {
  test(`a plan-costs.mjs that ${name} draws no plan cell, and the sparkline still draws`, async ($, on) => {
    const { ui } = await pollPane($, on, deckFiles(), deckRun(() => ({ exitCode: 0, stdout: DECK_PRINTED }), () => answer))
    expect(await has(ui, '+$6')).toBe(false)
    expect(await has(ui, '14d')).toBe(true)
    await ui.unmount()
  })
}

test('plan-costs.mjs runs once per ledger size and origin/main sha, and again on a new sha or after a refusal', async ($, on) => {
  let sha = MAIN_SHA
  let refuse = false
  const { clock, calls } = await pollPane(
    $,
    on,
    deckFiles(),
    deckRun(
      () => ({ exitCode: 0, stdout: DECK_PRINTED }),
      () => (refuse ? { exitCode: 1, stdout: '' } : { exitCode: 0, stdout: PLAN_COSTS_STDOUT }),
      () => sha,
    ),
  )
  const asked = () => calls.filter(c => isPlanCosts(c.argv)).length
  await clock.advance(5000)
  expect(asked()).toBe(1)
  sha = 'beef'.padEnd(40, '1')
  await clock.advance(5000)
  expect(asked()).toBe(2)
  refuse = true
  sha = 'face'.padEnd(40, '2')
  await clock.advance(5000)
  await clock.advance(5000)
  expect(asked()).toBe(4)
})

test("ON DECK's --print runs once per blob sha", async ($, on) => {
  const { clock, calls } = await pollPane($, on, deckFiles(), deckRun(() => ({ exitCode: 0, stdout: DECK_PRINTED }), () => ({ exitCode: 0, stdout: PLAN_COSTS_STDOUT })))
  await clock.advance(5000)
  await clock.advance(5000)
  expect(calls.filter(c => isDeckPrint(c.argv)).length).toBe(1)
})

for (const [name, deck] of [
  ['exits 1 with a record on stdout', (): RunAnswer | Promise<RunAnswer> => ({ exitCode: 1, stdout: DECK_PRINTED })],
  ['rejects', (): RunAnswer | Promise<RunAnswer> => Promise.reject(new Error('spawn failed'))],
] as const) {
  test(`an ON DECK --print that ${name} draws the brief unread, and the next poll runs it again`, async ($, on) => {
    const { ui, clock, calls } = await pollPane($, on, deckFiles(), deckRun(deck, () => ({ exitCode: 0, stdout: PLAN_COSTS_STDOUT })))
    // An unread brief has no mode yet, so it sits under enrich.
    expect(await has(ui, 'enrich 1')).toBe(true)
    expect(await has(ui, 'ready 1')).toBe(false)
    await ui.unmount()
    await clock.advance(5000)
    expect(calls.filter(c => isDeckPrint(c.argv)).length).toBe(2)
  })
}

// ---------- each launch, each run, each brief its own ----------

test("an earlier launch that stopped keeps its stopped bar after a later launch of the brief ships", () => {
  const brief = `${BRIEFS}s700-relaunched.md`
  const raw = statusOf({
    finished: [
      { entry: 1, brief, lane: '', status: 1, outcome: 'x', kind: 'decision', slot: 1, slot_taken: iso(NOW - 5 * HOUR), slot_released: iso(NOW - 4 * HOUR) },
      { entry: 2, brief, lane: '', status: 0, outcome: 'x', kind: null, slot: 2, slot_taken: iso(NOW - 2 * HOUR), slot_released: iso(NOW - HOUR) },
    ],
  })
  // The record is the latest launch's: it shipped, and it holds both launches' spans.
  const record = { launch_spans: [spanAt(1, -300, -240, false), spanAt(2, -120, -60, true)] }
  const b = buildBoard(raw, new Set(), NOW, { endings: [ending('kickoff-sitting-s700-relaunched', NOW - HOUR, endOf('shipped; production is live (run 1). ($9.00, 60 min)'), record)], afters: {} })
  expect(barsOf(b, 1)).toEqual(['S700 stopped -300..-240'])
  expect(barsOf(b, 2)).toEqual(['S700 live -120..-60'])
})

test('a finished run whose record is newer than the board is named on one line, and its --print answer is kept', async ($, on) => {
  const newer = JSON.stringify({ ...JSON.parse(recordJson(FIN_LIVE)), version: 2 })
  const { ui, clock, calls } = await pollPane($, on, finFiles(), argv => (isFinPrint(argv) ? { exitCode: 0, stdout: newer } : undefined))
  expect(await has(ui, 'S761: the record is newer than the board')).toBe(true)
  expect(await has(ui, '42m')).toBe(false)
  await ui.unmount()
  await clock.advance(5000)
  expect(calls.filter(c => isFinPrint(c.argv)).length).toBe(1)
})

test('a record older than its progress file missed its last write, so the run draws through --print', async ($, on) => {
  const stale = recordJson(null)
  const { ui } = await pollPane(
    $,
    on,
    finFiles({ [`${SOURCES.log_dir}/${FIN}.run.json`]: stale }),
    argv => (isFinPrint(argv) ? { exitCode: 0, stdout: FIN_PRINTED } : undefined),
    { [`${SOURCES.log_dir}/${FIN}.run.json`]: NOW - 10 * MIN, [`${LOGS}/${FIN}.progress`]: NOW },
  )
  expect(await has(ui, '42m')).toBe(true)
  await ui.unmount()
})

test('a run whose brief is a directory brief prints with its README', async ($, on) => {
  const files = finFiles()
  delete files[`${SOURCES.main}/docs/briefs/${FIN}.md`]
  files[`${SOURCES.main}/docs/briefs/${FIN}/README.md`] = '# S761'
  const { ui } = await pollPane($, on, files, argv =>
    isPrint(argv) && argv[4] === `${SOURCES.main}/docs/briefs/${FIN}/README.md` ? { exitCode: 0, stdout: FIN_PRINTED } : undefined,
  )
  expect(await has(ui, '42m')).toBe(true)
  await ui.unmount()
})

test('a main checkout with no run-status.mjs runs no --print', async ($, on) => {
  const files = finFiles()
  delete files[`${SOURCES.main}/scripts/run-status.mjs`]
  const { calls } = await pollPane($, on, files, argv => (isPrint(argv) ? { exitCode: 0, stdout: FIN_PRINTED } : undefined))
  expect(calls.filter(c => isPrint(c.argv) || (c.argv[2] ?? '').includes('--print'))).toEqual([])
})

test('a dead run whose record is newer than the board says the launcher is gone', async ($, on) => {
  const { ui } = await pollPane(
    $,
    on,
    { [`${LOGS}/status.json`]: runningStatus({}, { pid: 99 }), [S758_RECORD]: JSON.stringify({ ...runningRecord(), version: 2 }) },
  )
  expect(await has(ui, 'launcher gone, no finished line')).toBe(true)
  expect(await has(ui, 'the record is newer than the board')).toBe(false)
  await ui.unmount()
})

test("ON DECK pipes a directory brief's blobs with a newline between them", async ($, on) => {
  const ls = `100644 blob a781\tdocs/briefs/s781-dir/README.md\n100644 blob b781\tdocs/briefs/s781-dir/cycles.md\n`
  const printed = JSON.stringify({ ...PRINT_BASE, end: null, mode: 'autopilot', epic: null, after: [], split_from: [], cycles: 2 })
  const { ui } = await pollPane($, on, deckFiles(), argv => {
    if (argv[0] === 'git' && argv[1] === 'ls-tree') return { exitCode: 0, stdout: ls }
    const script = argv[2] ?? ''
    if (argv[0] === 'sh' && script.includes('--print /dev/null /dev/stdin'))
      return script.includes('git cat-file blob "${2}" && echo && git cat-file blob "${3}"') && argv.slice(5).join(' ') === 'a781 b781'
        ? { exitCode: 0, stdout: printed }
        : { exitCode: 1, stdout: '' }
    return undefined
  })
  expect(await has(ui, 'ready 1')).toBe(true)
  await ui.unmount()
})

// The queued records `write_status` in shootsfilm's scripts/dispatch.sh writes. The machine, waiting and
// soon records are its output under `./scripts/vt.sh test/scripts/dispatch-contract.test.mjs -t 'queues
// waiting behind its queued After'`, with status.json's queued list logged after the row's `machine` and
// `soon` assertions; each brief path names a sitting in place of the fixture's `kickoff-i.md`.
const NEXT_MACHINE = { entry: 1, brief: `${BRIEFS}s901-x.md`, lane: '', reason: 'a free slot', cause: { kind: 'slot' }, early: null, next: 'machine', mode: 'autopilot', stop: null }
const NEXT_WAITING = { entry: 2, brief: `${BRIEFS}s902-i.md`, lane: '', reason: 'S901', cause: { kind: 'after', waits_on: 'S901' }, early: null, next: 'waiting', mode: 'interactive', stop: null }
const NEXT_SOON = { entry: 3, brief: `${BRIEFS}s903-j.md`, lane: '', reason: 'S901', cause: { kind: 'after', waits_on: 'S901' }, early: null, next: 'soon', mode: 'interactive', stop: null }
// An interactive entry that nothing holds, as the same file's `next_of` rows assert it: `{ next: 'you', reason: '' }`.
const NEXT_YOU = { entry: 4, brief: `${BRIEFS}s904-k.md`, lane: '', reason: '', cause: null, early: null, next: 'you', mode: 'interactive', stop: null }
// A stopped node, from `jq -c '.queued[] | select(.stop != null)' ~/Library/Logs/shootsfilm-autopilot/status.json`.
const S769_RUN = 'kickoff-sitting-s769-red-deploy-fix'
const NODE = {
  entry: 460,
  brief: `docs/briefs/${S769_RUN}.md`,
  lane: '',
  reason: `autopilot: ${S769_RUN} started 14:39; follow it with scripts/autopilot.sh --watch docs/briefs/${S769_RUN}.md`,
  cause: null,
  early: null,
  next: 'you',
  mode: 'autopilot',
  stop: 'run-broke',
}
const NEXT_AFTERS = { [`${BRIEFS}s901-x.md`]: [], [`${BRIEFS}s902-i.md`]: ['S901'], [`${BRIEFS}s903-j.md`]: ['S901'], [`${BRIEFS}s904-k.md`]: [], [`docs/briefs/${S769_RUN}.md`]: [] }
const nextStatus = (queued: object[], finished: object[] = []) => parseStatus(JSON.stringify({ dispatcher: 1, running: [], queued, finished })) as NonNullable<ReturnType<typeof parseStatus>>
const RED = '#ed8796'
const TEXT = '#cad3f5'

/**
 * Each queue row drawn for `sitting`: its glyph and the colours of its glyph
 * span and its id span. A row's glyph span sits just before its id span, so a
 * bar or a card that also names the sitting is not read.
 */
async function rowMarks(ui: Ui, sitting: string): Promise<{ glyph: string; glyphColor: string; idColor: string }[]> {
  const ts = await ui.findAll({ type: 'Text' })
  const out: { glyph: string; glyphColor: string; idColor: string }[] = []
  for (let i = 1; i < ts.length; i++) {
    const g = ts[i - 1]?.text ?? ''
    if (ts[i]?.text === sitting && /^[●○‖◇] $/.test(g)) out.push({ glyph: g.trim(), glyphColor: ts[i - 1]?.props?.color ?? '', idColor: ts[i]?.props?.color ?? '' })
  }
  return out
}

test("a Todd node draws ◇, its id and its ◇ in the colour of its next, and the machine's draws ○", async ($, on) => {
  const b = buildBoard(nextStatus([NEXT_MACHINE, NEXT_WAITING, NEXT_SOON, NEXT_YOU]), new Set([1]), NOW, { afters: NEXT_AFTERS })
  expect(drawn(queueTree(b.running, b.queued, b.blocked))).toEqual(['S901 a free slot', '├─S902', '└─S903', 'S904'])
  const { ui } = await mountBoard($, on, b)
  expect(await rowMarks(ui, 'S901')).toEqual([{ glyph: '○', glyphColor: BLUE, idColor: TEXT }])
  expect(await rowMarks(ui, 'S902')).toEqual([{ glyph: '◇', glyphColor: TEXT, idColor: TEXT }])
  expect(await rowMarks(ui, 'S903')).toEqual([{ glyph: '◇', glyphColor: YELLOW, idColor: YELLOW }])
  expect(await rowMarks(ui, 'S904')).toEqual([{ glyph: '◇', glyphColor: RED, idColor: RED }])
  await ui.unmount()
})

test('a stopped node is a BLOCKED card and one red ◇ root that reads blocked ↑, with no holds', async ($, on) => {
  const b = buildBoard(nextStatus([NODE]), new Set([1]), NOW, {
    afters: NEXT_AFTERS,
    endings: [ending(S769_RUN, NOW - 10 * MIN, endOf('autopilot: the run broke. ($4.00, 20 min)', 'run-broke'))],
  })
  expect(b.blocked.map(k => [k.sitting, k.kind, k.holds.length, k.nodeNext])).toEqual([['S769', 'run-broke', 0, 'you']])
  const rows = queueTree(b.running, b.queued, b.blocked)
  expect(rows.filter(r => r.sitting === 'S769').map(r => [r.kind, r.note])).toEqual([['block', 'blocked ↑']])
  const { ui } = await mountBoard($, on, b)
  expect(await has(ui, 'S769: the run broke')).toBe(true)
  expect(await rowMarks(ui, 'S769')).toEqual([{ glyph: '◇', glyphColor: RED, idColor: RED }])
  await ui.unmount()
})

test("a stopped node blocks as its stop, with no ending and over an older decision's ending", () => {
  const bare = buildBoard(nextStatus([NODE]), new Set([1]), NOW, { afters: NEXT_AFTERS })
  expect(bare.blocked.map(k => [k.sitting, k.kind, k.why])).toEqual([['S769', 'run-broke', NODE.reason]])
  const older = buildBoard(nextStatus([NODE], [{ entry: 400, brief: NODE.brief, lane: '', status: 1, outcome: 'stopped', kind: 'decision' }]), new Set([1]), NOW, {
    afters: NEXT_AFTERS,
    endings: [ending(S769_RUN, NOW - 600 * MIN, endOf('stopped: the brief is still in docs/briefs. Read the handoff. ($2.00, 9 min)', 'decision'))],
  })
  expect(older.blocked.map(k => [k.sitting, k.kind])).toEqual([['S769', 'run-broke']])
})

test("a stop the board does not know blocks as run-broke and reads the node's reason as written", () => {
  const b = buildBoard(nextStatus([{ ...NODE, stop: 'paused' }]), new Set([1]), NOW, { afters: NEXT_AFTERS })
  expect(b.blocked.map(k => [k.kind, k.why])).toEqual([['run-broke', NODE.reason]])
})

test('a decision node with no ending draws no ? bar on the timeline', () => {
  const b = buildBoard(nextStatus([{ ...NODE, stop: 'decision' }]), new Set([1]), NOW, { afters: NEXT_AFTERS })
  expect(b.blocked.map(k => k.kind)).toEqual(['decision'])
  expect(b.timeline.you).toBeNull()
})

test('a queued next and stop that is null, a number or empty read as machine and null', () => {
  for (const v of [null, 7, '']) {
    const raw = parseStatus(JSON.stringify({ dispatcher: 1, running: [], queued: [{ ...NEXT_WAITING, next: v, stop: v }], finished: [] }))
    expect([raw?.queued[0]?.next, raw?.queued[0]?.stop]).toEqual(['machine', null])
  }
  const raw = parseStatus(JSON.stringify({ dispatcher: 1, running: [], queued: [NODE], finished: [] }))
  expect([raw?.queued[0]?.next, raw?.queued[0]?.mode, raw?.queued[0]?.stop]).toEqual(['you', 'autopilot', 'run-broke'])
})

test('a needs cause parses with its missing text, and one with no missing reads as null', () => {
  const needs = { kind: 'needs', missing: 'needs the Worker secret RESEND_KEY' }
  const raw = parseStatus(JSON.stringify({ dispatcher: 1, running: [], queued: [{ ...NEXT_YOU, cause: needs }, { ...NEXT_WAITING, cause: { kind: 'needs' } }], finished: [] }))
  expect(raw?.queued.map(q => q.cause)).toEqual([needs, null])
})

const nextFiles = (queued: object[]): Record<string, string> => ({ [`${LOGS}/status.json`]: JSON.stringify({ ...DEFAULT_STATUS, dispatcher: 1, running: [], queued, finished: [] }) })

test('a polled record with no next draws ○, and one whose next the board does not know draws ◇ noted with it', async ($, on) => {
  const { next: _, ...noNext } = NEXT_MACHINE
  const { ui } = await pollPane($, on, nextFiles([noNext, { ...NEXT_YOU, next: 'review' }]))
  expect(await rowMarks(ui, 'S901')).toEqual([{ glyph: '○', glyphColor: BLUE, idColor: TEXT }])
  expect(await rowMarks(ui, 'S904')).toEqual([{ glyph: '◇', glyphColor: TEXT, idColor: TEXT }])
  expect(await has(ui, 'review')).toBe(true)
  await ui.unmount()
})

test('a polled needs cause holds nothing in BLOCKED and is not counted held on the timeline', async ($, on) => {
  const needs = { ...NEXT_YOU, reason: 'needs the Worker secret RESEND_KEY', cause: { kind: 'needs', missing: 'needs the Worker secret RESEND_KEY' } }
  const { ui } = await pollPane($, on, nextFiles([needs]))
  expect(await has(ui, 'blocked')).toBe(false)
  expect(await has(ui, ' held')).toBe(false)
  expect(await rowMarks(ui, 'S904')).toEqual([{ glyph: '◇', glyphColor: RED, idColor: RED }])
  await ui.unmount()
})
