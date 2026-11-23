'use strict';

// Drives bin/token-ledger as the skills do, against throwaway repos with a bare
// remote. HOME points into the sandbox, so transcripts, the ledger and the
// ship markers never touch the real ~/.claude.
//
// Run: node --test plugins/commit-skill/test/token-ledger.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'token-ledger');
const { SHIP_DOCS, shipDocsSubjects } = require('./cases');
const { baseSandbox, run } = require('./gate-sandbox');

// ---------- sandbox ----------

function sandbox(t) {
  // No GIT_CONFIG_GLOBAL: the color.ui test writes $HOME/.gitconfig. The
  // runner's PATH, since the ledger has no installed copy to shadow.
  const base = baseSandbox(t, {
    prefix: 'token-ledger-',
    env: (root) => ({
      PATH: process.env.PATH,
      TOKEN_LEDGER_FILE: path.join(root, 'ledger.jsonl'),
      TOKEN_LEDGER_MARKERS: path.join(root, 'markers.json'),
    }),
  });
  const { root, home, env, envWith } = base;
  const projects = path.join(home, '.claude', 'projects', '-sandbox');
  fs.mkdirSync(projects, { recursive: true });

  let nextId = 0;
  const sb = {
    ...base,
    projects,
    lockFile: env.TOKEN_LEDGER_FILE + '.lock',
    errorsFile: env.TOKEN_LEDGER_FILE + '.errors',

    gitStatus(cwd, ...args) {
      return run('git', args, { cwd, env }).status;
    },

    // A run with its status and stderr kept, which `ledger` drops.
    ledgerRun(cwd, session, args, { env: extra = {}, input } = {}) {
      return run(process.execPath, [BIN, ...args], {
        cwd, env: envWith({ CLAUDE_CODE_SESSION_ID: session, ...extra }), input,
      });
    },

    ledger(cwd, session, ...args) {
      const r = sb.ledgerRun(cwd, session, args);
      if (r.status !== 0) throw new Error(`token-ledger ${args.join(' ')} failed:\n${r.stderr}`);
      return r.stdout;
    },

    // The hook's run, which waits for the detached recorder it starts.
    sessionEnd(session, input) {
      return sb.ledgerRun(sb.root, session, ['session-end'], { input, env: { TOKEN_LEDGER_SESSION_END_WAIT: '1' } });
    },

    // Writes one API call to a session's transcript, timestamped now, with the
    // `cwd` and `gitBranch` every real line carries, and returns the timestamp.
    // `dup` writes it twice, as Claude Code does for a call with several blocks.
    // `again` writes the previous call once more under a later timestamp, as
    // Claude Code does when a call's blocks land seconds apart.
    spend(session, {
      model = 'claude-haiku-4-5', sub = false, dup = false, again = false, cwd = root, gitBranch = 'main',
      project = projects, ...usage
    } = {}) {
      if (!again) ++nextId;
      tick();
      const file = sub
        ? path.join(project, session, 'subagents', 'agent-1.jsonl')
        : path.join(project, session + '.jsonl');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const timestamp = new Date().toISOString();
      const line = JSON.stringify({
        type: 'assistant', timestamp, cwd, gitBranch,
        message: { id: `msg_${nextId}`, model, usage },
      }) + '\n';
      fs.appendFileSync(file, dup ? line + line : line);
      tick();
      return timestamp;
    },

    rows() {
      try {
        return fs.readFileSync(env.TOKEN_LEDGER_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      } catch { return []; }
    },

    writeRows(rows) {
      fs.writeFileSync(env.TOKEN_LEDGER_FILE, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    },

    markers() {
      try { return JSON.parse(fs.readFileSync(env.TOKEN_LEDGER_MARKERS, 'utf8')); } catch { return {}; }
    },

    // A bare remote with one commit on main, and a clone tracking it.
    repo(name = 'work') {
      return base.clone(name);
    },

    // Writes a file and commits it by hand, as /commit does before it tallies.
    commit(cwd, file, body = file + '\n', subject = 'add ' + file) {
      fs.writeFileSync(path.join(cwd, file), body);
      sb.git(cwd, 'add', file);
      sb.git(cwd, 'commit', '-q', '-m', subject);
      return sb.git(cwd, 'rev-parse', 'HEAD');
    },

    // /commit end to end: spend, commit, tally.
    tracked(cwd, session, file, spend = { input_tokens: 1e6 }) {
      sb.spend(session, spend);
      const sha = sb.commit(cwd, file);
      sb.ledger(cwd, session, 'commit', '--sha', sha);
      return sha;
    },
  };
  return sb;
}

// Transcript windows are split on millisecond timestamps, so keep each
// write and each run in a millisecond of its own.
function tick() {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3);
}

const last = (rows, kind) => rows.filter((r) => r.kind === kind).at(-1);

// ---------- commit ----------

test('commit tallies lead and subagent calls once each, priced by cost share', (t) => {
  const sb = sandbox(t);
  const dir = sb.repo();

  // $1 lead (1M input on haiku, written twice for one call) + $1 subagent (200K output).
  sb.spend('s1', { input_tokens: 1e6, dup: true });
  sb.spend('s1', { sub: true, output_tokens: 2e5 });
  const sha = sb.commit(dir, 'a.txt', 'one\ntwo\n');
  const out = sb.ledger(dir, 's1', 'commit', '--sha', sha);

  assert.equal(out.split('\n')[0],
    '**Cost:** $2.00 · 2 calls (1 subagent) · 50% lead · 50% subagent · 0 cache read · 0 cache write · 200K out');
  const row = last(sb.rows(), 'commit');
  assert.equal(row.sha, sha);
  assert.ok(row.patch_id);
  assert.equal(row.repo, dir);
  assert.equal(row.project, dir);
  assert.equal(row.branch, 'main');
  assert.equal(row.subject, 'add a.txt');
  assert.deepEqual(row.cost, {
    usd: 2, lead_usd: 1, sub_usd: 1, prices_version: row.cost.prices_version, partial: false, unpriced_models: [],
  });
  assert.equal(row.lead.calls, 1);
  assert.equal(row.sub.calls, 1);
  assert.deepEqual([row.files, row.insertions, row.deletions], [1, 2, 0]);
});

test('lead context peak and end come from lead steps only, not a larger subagent step', (t) => {
  const sb = sandbox(t);
  const dir = sb.repo();

  // Contexts 30K, 500K, 200K on the lead; 900K on the subagent, written last.
  sb.spend('s1', { input_tokens: 1e4, cache_creation_input_tokens: 2e4 });
  sb.spend('s1', { input_tokens: 1e3, cache_read_input_tokens: 4.89e5, cache_creation_input_tokens: 1e4 });
  sb.spend('s1', { input_tokens: 2e3, cache_read_input_tokens: 1.98e5 });
  sb.spend('s1', { sub: true, input_tokens: 1e5, cache_read_input_tokens: 8e5 });
  sb.ledger(dir, 's1', 'commit', '--sha', sb.commit(dir, 'a.txt'));

  const row = last(sb.rows(), 'commit');
  assert.equal(row.lead.calls, 3);
  assert.equal(row.lead.context_peak, 5e5);
  assert.equal(row.lead.context_end, 2e5);
  assert.ok(!('context_peak' in row.sub) && !('context_end' in row.sub));
});

test('consecutive commits get contiguous windows and count each call once', (t) => {
  const sb = sandbox(t);
  const dir = sb.repo();

  sb.tracked(dir, 's1', 'a.txt');
  sb.spend('s1', { input_tokens: 5e5 });
  const sha = sb.commit(dir, 'b.txt');
  const out = sb.ledger(dir, 's1', 'commit', '--sha', sha);

  assert.match(out, /^\*\*Cost:\*\* \$0\.50 · 1 calls \(0 subagent\)/);
  const [first, second] = sb.rows();
  assert.equal(second.window.start, first.window.end);
  assert.equal(first.cost.usd + second.cost.usd, 1.5);
});

test('a dated model id prices as its alias; an unknown id makes the cost a floor', (t) => {
  const sb = sandbox(t);
  const dir = sb.repo();

  sb.spend('s1', { model: 'claude-haiku-4-5-20251001', input_tokens: 1e6 });
  let out = sb.ledger(dir, 's1', 'commit', '--sha', sb.commit(dir, 'a.txt'));
  assert.match(out, /^\*\*Cost:\*\* \$1\.00 · /);
  assert.deepEqual(last(sb.rows(), 'commit').cost.unpriced_models, []);
  assert.equal(last(sb.rows(), 'commit').cost.partial, false);

  sb.spend('s1', { model: 'claude-imaginary-9', input_tokens: 1e6 });
  out = sb.ledger(dir, 's1', 'commit', '--sha', sb.commit(dir, 'b.txt'));
  assert.match(out, /^\*\*Cost:\*\* \$0\.00\+ · /);
  assert.match(out, /unpriced model, cost is a floor: claude-imaginary-9/);
  assert.equal(last(sb.rows(), 'commit').cost.partial, true);
});

// ---------- ship ----------

test('ship from a branch with an upstream, after ship-begin', (t) => {
  const sb = sandbox(t);
  const dir = sb.repo();
  const base = sb.git(dir, 'rev-parse', 'origin/main');

  sb.tracked(dir, 's1', 'a.txt');
  sb.tracked(dir, 's1', 'b.txt');
  sb.commit(dir, 'c.txt'); // outside /commit
  sb.ledger(dir, 's1', 'ship-begin');
  assert.equal(sb.markers()[dir].ref, 'origin/main');
  assert.equal(sb.markers()[dir].base, base);

  sb.git(dir, 'push', '-q');
  sb.spend('s1', { input_tokens: 2.5e5 });
  const out = sb.ledger(dir, 's1', 'ship');
  const head = sb.git(dir, 'rev-parse', 'HEAD');

  assert.equal(out,
    '**Ship cost:** $2.25 across 3 commits (+ $0.25 ship overhead) · 100% lead · 0% subagent\n'
    + '  1 commit not tracked (committed outside /commit)\n');
  const ship = last(sb.rows(), 'ship');
  assert.equal(ship.range, `${base}..${head}`);
  assert.deepEqual(ship.commits.map((c) => c.matched), [true, true, false]);
  assert.equal(ship.untracked, 1);
  assert.equal(ship.cost.usd, 2.25);
  assert.equal(sb.markers()[dir], undefined, 'ship clears its marker');
});

function worktree(sb, branch = 'feature') {
  const main = sb.repo();
  sb.git(main, 'remote', 'set-head', 'origin', 'main');
  const wt = path.join(sb.root, 'work-feature');
  sb.git(main, 'worktree', 'add', '-q', '-b', branch, wt);
  assert.equal(sb.gitStatus(wt, 'rev-parse', '@{u}'), 128, `${branch} has no upstream`);
  return { main, wt };
}

test('ship from a worktree branch with no upstream, after ship-begin: base is origin/HEAD', (t) => {
  const sb = sandbox(t);
  const { main, wt } = worktree(sb);
  const base = sb.git(wt, 'rev-parse', 'origin/main');

  const sha = sb.tracked(wt, 's1', 'a.txt');
  sb.ledger(wt, 's1', 'ship-begin');
  assert.deepEqual([sb.markers()[wt].ref, sb.markers()[wt].base], ['origin/main', base]);

  sb.git(wt, 'push', '-q', 'origin', 'HEAD:main');
  sb.ledger(wt, 's1', 'ship');

  const ship = last(sb.rows(), 'ship');
  assert.equal(ship.range, `${base}..${sha}`);
  assert.deepEqual(ship.commits.map((c) => [c.sha, c.matched]), [[sha, true]]);
  assert.equal(ship.repo, wt);
  assert.equal(ship.project, main);
  assert.equal(ship.branch, 'feature');
});

test('ship from a worktree branch with no upstream, without ship-begin: base is the reflog', (t) => {
  const sb = sandbox(t);
  const { wt } = worktree(sb);
  const base = sb.git(wt, 'rev-parse', 'origin/main');

  const a = sb.tracked(wt, 's1', 'a.txt');
  const b = sb.tracked(wt, 's1', 'b.txt');
  sb.git(wt, 'push', '-q', 'origin', 'HEAD:main');
  sb.ledger(wt, 's1', 'ship');

  const ship = last(sb.rows(), 'ship');
  assert.equal(ship.range, `${base}..${b}`);
  assert.deepEqual(ship.commits.map((c) => c.sha), [a, b]);
  assert.ok(ship.commits.every((c) => c.matched));
});

test('ship with no marker and nothing pushed refuses rather than guessing', (t) => {
  const sb = sandbox(t);
  const dir = sb.repo();
  sb.tracked(dir, 's1', 'a.txt');
  const r = sb.ledgerRun(dir, 's1', ['ship']);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /no ship base/);
});

// ---------- phase and sitting ----------

const RULES = {
  phase: [{ field: 'branch', pattern: '^worktree-plan-', phase: 'plan' }],
  sitting: [{ field: 'subject', pattern: '\\bS(\\d+)\\b' }],
};

function writeRules(dir, body) {
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'token-ledger.json'),
    typeof body === 'string' ? body : JSON.stringify(body));
}

test('commit and ship take their phase and sitting from the main checkout\'s rules file', (t) => {
  const sb = sandbox(t);
  const { main, wt } = worktree(sb, 'worktree-plan-x');
  // The rules sit in the main checkout only: a worktree's own root has none.
  writeRules(main, RULES);

  sb.spend('s1', { input_tokens: 1e6 });
  const sha = sb.commit(wt, 'a.txt', 'a\n', 'docs(briefs): savor S581');
  sb.ledger(wt, 's1', 'commit', '--sha', sha);
  const row = last(sb.rows(), 'commit');
  assert.equal(row.phase, 'plan');
  assert.equal(row.sitting, 581);

  sb.ledger(wt, 's1', 'ship-begin');
  sb.git(wt, 'push', '-q', 'origin', 'HEAD:main');
  sb.ledger(wt, 's1', 'ship');
  const ship = last(sb.rows(), 'ship');
  // A ship entry has no subject, so the subject rule cannot name its sitting.
  assert.equal(ship.phase, 'plan');
  assert.ok(!('sitting' in ship));
});

test('with no rules file an entry carries neither field', (t) => {
  const sb = sandbox(t);
  const dir = sb.repo();
  sb.spend('s1', { input_tokens: 1e6 });
  const r = sb.ledgerRun(dir, 's1', ['commit', '--sha', sb.commit(dir, 'a.txt', 'a\n', 'docs(briefs): savor S581')]);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  const row = last(sb.rows(), 'commit');
  assert.ok(!('phase' in row));
  assert.ok(!('sitting' in row));
});

for (const [name, body] of [
  ['not JSON', '{phase:'],
  ['not an object', '[]'],
  ['a phase list that is not a list', { phase: 'plan' }],
  ['a rule with no pattern', { sitting: [{ field: 'subject' }] }],
  ['a pattern that is not a regex', { sitting: [{ field: 'subject', pattern: '(' }] }],
]) {
  test(`a rules file that is ${name} writes neither field, says so once, and still costs the commit`, (t) => {
    const sb = sandbox(t);
    const dir = sb.repo();
    writeRules(dir, body);
    sb.spend('s1', { input_tokens: 1e6 });
    const r = sb.ledgerRun(dir, 's1', ['commit', '--sha', sb.commit(dir, 'a.txt', 'a\n', 'docs(briefs): savor S581')]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^\*\*Cost:\*\* \$1\.00 · /);
    assert.equal(r.stderr.split('\n').filter(Boolean).length, 1, r.stderr);
    assert.match(r.stderr, /token-ledger\.json/);
    const row = last(sb.rows(), 'commit');
    assert.ok(!('phase' in row));
    assert.ok(!('sitting' in row));
  });
}

test('a sitting rule whose match has no all-digit group falls through to the next rule', (t) => {
  const sb = sandbox(t);
  const dir = sb.repo();
  writeRules(dir, { sitting: [
    { field: 'subject', pattern: 'savor' },
    { field: 'repo', pattern: 'nothing-matches-(\\d+)' },
    { field: 'subject', pattern: 'S(\\d+)' },
  ] });
  sb.spend('s1', { input_tokens: 1e6 });
  sb.ledger(dir, 's1', 'commit', '--sha', sb.commit(dir, 'a.txt', 'a\n', 'docs(briefs): savor S581'));
  assert.equal(last(sb.rows(), 'commit').sitting, 581);
});

// ---------- sessions ----------
//
// A session id here is hex and dashes, because session-end refuses any other.

const S1 = 'aaaa-0001';

// A session with one tracked commit and a tail past it: $0.50 lead, then a
// $0.50 subagent call last, on a branch the repo itself is not on.
function withTail(sb) {
  const dir = sb.repo();
  sb.tracked(dir, S1, 'a.txt');
  const at = { cwd: dir, gitBranch: 'topic' };
  sb.spend(S1, { input_tokens: 5e5, ...at });
  const end = sb.spend(S1, { sub: true, output_tokens: 1e5, ...at });
  return { dir, end };
}

const sessions = (sb) => sb.rows().filter((r) => r.kind === 'session');

test('record-session prices the tail past the last window and records it once', (t) => {
  const sb = sandbox(t);
  const { dir, end } = withTail(sb);
  const commitEnd = last(sb.rows(), 'commit').window.end;

  // Run from outside the repo: repo and branch come from the transcript.
  assert.equal(sb.ledgerRun(sb.root, 'other', ['record-session', S1]).status, 0);
  const [row] = sessions(sb);
  assert.ok(row, 'one session entry');
  assert.equal(row.via, 'session-end');
  assert.equal(row.session, S1);
  assert.deepEqual(row.window, { start: commitEnd, end });
  assert.equal(row.ts, end);
  assert.equal(row.repo, dir);
  assert.equal(row.project, dir);
  assert.equal(row.branch, 'topic');
  assert.equal(row.lead.calls, 1);
  assert.equal(row.sub.calls, 1);
  assert.equal(row.cost.usd, 1);
  assert.equal(row.cost.lead_usd, 0.5);
  assert.equal(row.cost.sub_usd, 0.5);
  assert.ok(!('phase' in row));

  assert.equal(sb.ledgerRun(sb.root, 'other', ['record-session', S1]).status, 0);
  assert.equal(sessions(sb).length, 1, 'a second run records nothing');
});

test('a call written again seconds later is counted once across two recordings', (t) => {
  const sb = sandbox(t);
  const dir = sb.repo();
  sb.tracked(dir, S1, 'a.txt');
  const end = sb.spend(S1, { input_tokens: 5e5, cwd: dir });
  sb.spend(S1, { input_tokens: 5e5, cwd: dir, again: true });
  sb.ledger(sb.root, 'other', 'record-session', S1);
  sb.ledger(sb.root, 'other', 'record-session', S1);
  const got = sessions(sb);
  assert.equal(got.length, 1, 'the later line of a counted call opens no second entry');
  assert.equal(got[0].window.end, end, 'the window ends at the last counted line');
  assert.equal(got[0].cost.usd, 0.5);
});

test('a call a commit counted is not counted again when its later line lands after the commit', (t) => {
  const sb = sandbox(t);
  const dir = sb.repo();
  sb.tracked(dir, S1, 'a.txt');
  sb.spend(S1, { input_tokens: 1e6, cwd: dir, again: true });
  sb.ledger(sb.root, 'other', 'record-session', S1);
  assert.equal(sessions(sb).length, 0, 'the call belongs to the commit that holds its first line');
});

test('a session entry takes its phase and sitting from the transcript\'s project', (t) => {
  const sb = sandbox(t);
  const { dir } = withTail(sb);
  writeRules(dir, { phase: [{ field: 'branch', pattern: '^topic$', phase: 'build' }],
    sitting: [{ field: 'subject', pattern: 'S(\\d+)' }, { field: 'branch', pattern: 'topic' }] });
  sb.ledger(sb.root, 'other', 'record-session', S1);
  const [row] = sessions(sb);
  assert.equal(row.phase, 'build');
  assert.ok(!('sitting' in row));
});

test('a commit after a recorded tail starts where the tail ended', (t) => {
  const sb = sandbox(t);
  const { dir, end } = withTail(sb);
  sb.ledger(sb.root, 'other', 'record-session', S1);
  sb.tracked(dir, S1, 'b.txt');
  const c = last(sb.rows(), 'commit');
  assert.equal(c.window.start, end);
  assert.equal(c.cost.usd, 1);
});

test('session-end records the named session through a detached recorder', (t) => {
  const sb = sandbox(t);
  const { end } = withTail(sb);
  const input = JSON.stringify({ session_id: S1, transcript_path: '/nowhere.jsonl', cwd: '/nowhere', reason: 'clear' });
  const r = sb.sessionEnd('stale-env-id', input);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  const [row] = sessions(sb);
  assert.ok(row, 'the entry landed');
  assert.equal(row.window.end, end);
  assert.equal(row.via, 'session-end');
});

for (const [name, input] of [
  ['empty', ''],
  ['not JSON', '{session_id'],
  ['not an object', '["aaaa-0001"]'],
  ['missing session_id', '{"reason":"clear"}'],
  ['a session_id that is a path', '{"session_id":"../aaaa-0001"}'],
]) {
  test(`session-end with stdin that is ${name} exits 0 and records nothing`, (t) => {
    const sb = sandbox(t);
    withTail(sb);
    const r = sb.sessionEnd(S1, input);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.equal(sessions(sb).length, 0);
    assert.ok(!fs.existsSync(sb.errorsFile), 'no recorder was started');
  });
}

test('a recorder that fails leaves its stderr in the errors file', (t) => {
  const sb = sandbox(t);
  sb.repo();
  const input = JSON.stringify({ session_id: 'dead-beef' });
  const r = sb.sessionEnd(S1, input);
  assert.equal(r.status, 0);
  assert.match(fs.readFileSync(sb.errorsFile, 'utf8'), /dead-beef/);
});

// ---------- the lock ----------

// The binary asks `ps` in UTC under the C locale; the writer runs in another zone.
function startOf(pid) {
  return spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)],
    { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } }).stdout.trim();
}

function holdLock(sb, pid, start) {
  fs.writeFileSync(sb.lockFile, JSON.stringify({ pid, start }));
}

async function liveChild(t) {
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore' });
  t.after(() => child.kill());
  await new Promise((r) => child.once('spawn', r));
  return child;
}

// A writer that never took over would wait forever; under no-wait it fails.
function noWaitCommit(sb, dir) {
  sb.spend(S1, { input_tokens: 1e6 });
  const sha = sb.commit(dir, 'a.txt');
  return sb.ledgerRun(dir, S1, ['commit', '--sha', sha], { env: { TOKEN_LEDGER_LOCK_NOWAIT: '1', TZ: 'Pacific/Honolulu' } });
}

test('a lock whose holder has exited does not stop a commit', (t) => {
  const sb = sandbox(t);
  const dir = sb.repo();
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  holdLock(sb, dead, 'Thu Jan  1 00:00:00 1970');
  const r = noWaitCommit(sb, dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(sb.rows().length, 1);
  assert.ok(!fs.existsSync(sb.lockFile), 'the writer released the lock');
});

test('a lock whose pid now names another process does not stop a commit', async (t) => {
  const sb = sandbox(t);
  const dir = sb.repo();
  const child = await liveChild(t);
  holdLock(sb, child.pid, 'Thu Jan  1 00:00:00 1970');
  const r = noWaitCommit(sb, dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(sb.rows().length, 1);
});

test('a live holder keeps the lock: a no-wait writer refuses and appends nothing', async (t) => {
  const sb = sandbox(t);
  const dir = sb.repo();
  const child = await liveChild(t);
  holdLock(sb, child.pid, startOf(child.pid));
  const r = noWaitCommit(sb, dir);
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, new RegExp(`\\b${child.pid}\\b`));
  assert.equal(sb.rows().length, 0);
});

test('an append after a torn last line starts a line of its own', (t) => {
  const sb = sandbox(t);
  const dir = sb.repo();
  fs.writeFileSync(sb.env.TOKEN_LEDGER_FILE, '{"v":1,"kind":"commit","ts":"2026-01-01T00:00');
  sb.tracked(dir, S1, 'a.txt');
  const lines = fs.readFileSync(sb.env.TOKEN_LEDGER_FILE, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]).kind, 'commit');
});

// ---------- sweep ----------

// Four sessions: never recorded (its cwd is a worktree path that is gone),
// a tail past its last commit, fully recorded, and a tail on the session the
// sweep runs inside, which it skips.
function fourSessions(sb) {
  const dir = sb.repo();
  const gone = path.join(sb.root, 'gone', '.claude', 'worktrees', 'old');
  const ids = { never: 'aaaa-0001', tail: 'bbbb-0002', done: 'cccc-0003', self: 'dddd-0004' };

  sb.spend(ids.never, { input_tokens: 1e6, cwd: gone, gitBranch: 'old' });

  sb.tracked(dir, ids.tail, 'a.txt');
  sb.spend(ids.tail, { input_tokens: 5e5, cwd: dir });

  sb.tracked(dir, ids.done, 'b.txt');

  sb.tracked(dir, ids.self, 'c.txt');
  sb.spend(ids.self, { input_tokens: 2e5, cwd: dir });
  return { dir, gone, ids };
}

const sweep = (sb, ...args) => sb.ledgerRun(sb.root, 'dddd-0004', ['sweep', ...args]);

test('sweep records every session past its last window, skipping its own', (t) => {
  const sb = sandbox(t);
  const { dir, ids } = fourSessions(sb);
  const before = sb.rows().length;

  const dry = sweep(sb, '--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(sb.rows().length, before, 'a dry run appends nothing');

  const r = sweep(sb);
  assert.equal(r.status, 0, r.stderr);
  const got = sessions(sb);
  assert.deepEqual(got.map((e) => e.session).sort(), [ids.never, ids.tail]);
  assert.ok(got.every((e) => e.via === 'sweep'));

  const never = got.find((e) => e.session === ids.never);
  assert.equal(never.project, path.join(sb.root, 'gone'));
  assert.equal(never.repo, path.join(sb.root, 'gone', '.claude', 'worktrees', 'old'));
  assert.equal(never.branch, 'old');
  assert.equal(never.cost.usd, 1);
  const tail = got.find((e) => e.session === ids.tail);
  assert.equal(tail.project, dir);
  assert.equal(tail.cost.usd, 0.5);

  // The dry run's per-project totals sum to what the real sweep wrote.
  const totals = [...dry.stdout.matchAll(/^\$(\d+\.\d\d) · (\d+) sessions? · (.+)$/gm)];
  const byProject = Object.fromEntries(totals.map((m) => [m[3], Number(m[1])]));
  assert.deepEqual(byProject, { [path.join(sb.root, 'gone')]: 1, [dir]: 0.5 });

  assert.equal(sweep(sb).status, 0);
  assert.equal(sessions(sb).length, 2, 'a second sweep records nothing');
});

test('report prints the session spend outside any commit under its table', (t) => {
  const sb = sandbox(t);
  fourSessions(sb);
  sweep(sb);
  const out = sb.ledger(sb.root, 'dddd-0004', 'report', '--by', 'commit', '--all');
  assert.match(out, /\n2 sessions · \$1\.50 outside any commit\n$/);
  const ships = sb.ledger(sb.root, 'dddd-0004', 'report', '--all');
  assert.match(ships, /\(nothing recorded\)\n2 sessions · \$1\.50 outside any commit\n$/);
});

test('a transcript that throws is reported and the sweep goes on', (t) => {
  const sb = sandbox(t);
  const { ids } = fourSessions(sb);
  // A directory where a transcript should be makes its scan throw.
  fs.mkdirSync(path.join(sb.projects, 'eeee-0005.jsonl'));
  const r = sweep(sb);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /eeee-0005/);
  assert.deepEqual(sessions(sb).map((e) => e.session).sort(), [ids.never, ids.tail]);
});

for (const args of [['--dry-run', '1'], ['--dry-run=true'], ['--dryrun']]) {
  test(`sweep ${args.join(' ')} refuses and appends nothing`, (t) => {
    const sb = sandbox(t);
    fourSessions(sb);
    const before = sb.rows().length;
    const r = sweep(sb, ...args);
    assert.notEqual(r.status, 0);
    assert.equal(sb.rows().length, before);
  });
}

test('a sweep reports a broken rules file once', (t) => {
  const sb = sandbox(t);
  const { dir } = fourSessions(sb);
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'token-ledger.json'), '{not json');
  sb.spend('ffff-0006', { input_tokens: 1e5, cwd: dir });
  const r = sweep(sb);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(sessions(sb).filter((e) => e.project === dir).length, 2, 'two sessions of one project');
  assert.equal(r.stderr.match(/token-ledger\.json/g).length, 1);
});

// ---------- report ----------

test('report groups worktrees and legacy repo-only entries under one project root', (t) => {
  const sb = sandbox(t);
  const { main, wt } = worktree(sb);
  const ts = new Date().toISOString();
  const row = (extra) => ({
    v: 1, kind: 'commit', ts, sha: 'abcdef0123', subject: 's',
    cost: { usd: 1, lead_usd: 1, sub_usd: 0 }, ...extra,
  });
  sb.writeRows([
    row({ repo: main, project: main, subject: 'main checkout' }),
    row({ repo: wt, project: main, subject: 'worktree' }),
    row({ repo: main, subject: 'legacy, the root itself' }),
    row({ repo: path.join(main, '.claude', 'worktrees', 'x'), subject: 'legacy, nested worktree' }),
    row({ repo: main + '-old', subject: 'legacy, sibling worktree' }),
    row({ repo: '/elsewhere', project: '/elsewhere', subject: 'another project' }),
    row({ repo: '/elsewhere', subject: 'another legacy project' }),
    row({ repo: wt, project: main, kind: 'ship', commits: [{}, {}], branch: 'feature' }),
  ]);

  for (const cwd of [main, wt]) {
    const out = sb.ledger(cwd, 's1', 'report', '--by', 'commit');
    assert.match(out, /^Commits — work — since /);
    assert.match(out, /\n5 commits · \$5\.00 total · \$1\.00 per commit/);
    assert.doesNotMatch(out, /another/);
  }

  const ships = sb.ledger(wt, 's1', 'report');
  assert.match(ships, /^Ships — work — since /);
  assert.match(ships, /\n1 ship · 2 commits · \$1\.00 total/);

  const all = sb.ledger(wt, 's1', 'report', '--by', 'commit', '--all');
  assert.match(all, /^Commits — all repos — /);
  assert.match(all, /\n7 commits · /);
});

// ---------- the rebase risk ----------
//
// /ship runs ship-begin first, then on a non-fast-forward rejection runs
// `git pull --rebase` and pushes again. The marker's base is the pre-fetch
// origin/main, so base..HEAD then spans the commits the rebase pulled in.

function raceToMain(sb, { shipBegin }) {
  const a = sb.repo('work-a');
  const b = sb.repo('work-b');

  // Session A commits first but has not pushed.
  sb.tracked(a, 'sA', 'a.txt');
  if (shipBegin) sb.ledger(a, 'sA', 'ship-begin');

  // Session B ships its own commit in the meantime.
  const bSha = sb.tracked(b, 'sB', 'b.txt', { input_tokens: 3e6 });
  sb.ledger(b, 'sB', 'ship-begin');
  sb.git(b, 'push', '-q');
  sb.ledger(b, 'sB', 'ship');

  // A's push is rejected; /ship pulls with rebase and pushes once more.
  assert.notEqual(sb.gitStatus(a, 'push', '-q'), 0, 'first push is rejected');
  sb.git(a, 'pull', '-q', '--rebase');
  sb.git(a, 'push', '-q');
  sb.ledger(a, 'sA', 'ship');

  const ships = sb.rows().filter((r) => r.kind === 'ship');
  return { bSha, shipA: ships.find((r) => r.session === 'sA'), shipB: ships.find((r) => r.session === 'sB') };
}

test('rebase between ship-begin and push: the ship claims only its own commits', (t) => {
  const sb = sandbox(t);
  const { bSha, shipA } = raceToMain(sb, { shipBegin: true });
  assert.ok(!shipA.commits.some((c) => c.sha === bSha));
  assert.equal(shipA.commits.length, 1);
  assert.equal(shipA.skipped, 1);
  assert.equal(shipA.cost.usd, 1);
});

test('rebase before the push without ship-begin: the reflog base claims only its own commits', (t) => {
  const sb = sandbox(t);
  const { bSha, shipA, shipB } = raceToMain(sb, { shipBegin: false });
  assert.equal(shipB.commits.length, 1);
  assert.equal(shipA.commits.length, 1);
  assert.ok(!shipA.commits.some((c) => c.sha === bSha));
  assert.equal(shipA.cost.usd, 1);
});

// ---------- review findings ----------

test('a branch stacked on a shipped branch claims only its own commits', (t) => {
  const sb = sandbox(t);
  const dir = sb.repo();

  sb.git(dir, 'checkout', '-q', '-b', 'parent');
  sb.tracked(dir, 's1', 'p.txt', { input_tokens: 3e6 });
  sb.ledger(dir, 's1', 'ship-begin');
  sb.git(dir, 'push', '-q', '-u', 'origin', 'parent');
  sb.ledger(dir, 's1', 'ship');

  sb.git(dir, 'checkout', '-q', '-b', 'child');
  const c = sb.tracked(dir, 's1', 'c.txt');
  sb.ledger(dir, 's1', 'ship-begin');
  sb.git(dir, 'push', '-q', 'origin', 'HEAD:child');
  const out = sb.ledger(dir, 's1', 'ship');

  const ship = last(sb.rows(), 'ship');
  assert.deepEqual(ship.commits.map((x) => x.sha), [c]);
  assert.equal(ship.cost.usd, 1);
  assert.match(out, /^\*\*Ship cost:\*\* \$1\.00 across 1 commit /);
});

for (const subject of new Set([...shipDocsSubjects(), ...SHIP_DOCS])) {
  test(`/ship's own docs commit is not reported as untracked: "${subject}"`, (t) => {
    const sb = sandbox(t);
    const dir = sb.repo();

    sb.tracked(dir, 's1', 'a.txt');
    sb.ledger(dir, 's1', 'ship-begin');
    sb.git(dir, 'push', '-q');
    fs.writeFileSync(path.join(dir, 'README'), 'updated\n');
    sb.git(dir, 'commit', '-q', '-am', subject);
    sb.git(dir, 'push', '-q');
    const out = sb.ledger(dir, 's1', 'ship');

    assert.equal(out, '**Ship cost:** $1.00 across 1 commit (+ $0.00 ship overhead) · 100% lead · 0% subagent\n');
    const ship = last(sb.rows(), 'ship');
    assert.equal(ship.untracked, 0);
    assert.deepEqual(ship.commits.map((c) => Boolean(c.docs)), [false, true]);
    assert.match(sb.ledger(dir, 's1', 'report'), /\n1 ship · 1 commit · /);
  });
}

test('a /commit docs commit that says "sync with" is still paid for, not taken as /ship\'s', (t) => {
  const sb = sandbox(t);
  const dir = sb.repo();

  sb.spend('s1', { input_tokens: 1e6 });
  fs.writeFileSync(path.join(dir, 'README'), 'synced\n');
  sb.git(dir, 'add', 'README');
  sb.git(dir, 'commit', '-q', '-m', 'docs(readme): sync with upstream API');
  sb.ledger(dir, 's1', 'commit', '--sha', sb.git(dir, 'rev-parse', 'HEAD'));
  sb.ledger(dir, 's1', 'ship-begin');
  sb.git(dir, 'push', '-q');
  const out = sb.ledger(dir, 's1', 'ship');

  assert.match(out, /^\*\*Ship cost:\*\* \$1\.00 across 1 commit /);
  const ship = last(sb.rows(), 'ship');
  assert.equal(ship.untracked, 0);
  assert.deepEqual(ship.commits.map((c) => [c.matched, Boolean(c.docs)]), [[true, false]]);
});

test('a docs commit that is not /ship\'s sync is still untracked', (t) => {
  const sb = sandbox(t);
  const dir = sb.repo();

  sb.tracked(dir, 's1', 'a.txt');
  sb.ledger(dir, 's1', 'ship-begin');
  fs.writeFileSync(path.join(dir, 'README'), 'updated\n');
  sb.git(dir, 'commit', '-q', '-am', 'docs(readme): fix a typo');
  sb.git(dir, 'push', '-q');
  sb.ledger(dir, 's1', 'ship');

  const ship = last(sb.rows(), 'ship');
  assert.equal(ship.untracked, 1);
  assert.deepEqual(ship.commits.map((c) => Boolean(c.docs)), [false, false]);
});

test('patch ids survive color.ui=always in the user\'s git config', (t) => {
  const sb = sandbox(t);
  fs.writeFileSync(path.join(sb.env.HOME, '.gitconfig'), '[color]\n\tui = always\n');
  const dir = sb.repo();

  const sha = sb.tracked(dir, 's1', 'a.txt');
  const plain = run('sh', ['-c', `git -c color.ui=never show ${sha} | git patch-id --stable`],
    { cwd: dir, env: sb.env }).stdout.split(' ')[0];
  assert.match(plain, /^[0-9a-f]{40}$/);
  assert.equal(last(sb.rows(), 'commit').patch_id, plain);
});

test('a repo without origin/HEAD: a new branch ships from origin/main', (t) => {
  const sb = sandbox(t);
  const { wt } = worktree(sb);
  sb.git(wt, 'remote', 'set-head', 'origin', '-d');
  const base = sb.git(wt, 'rev-parse', 'origin/main');

  const sha = sb.tracked(wt, 's1', 'a.txt');
  sb.ledger(wt, 's1', 'ship-begin');
  sb.git(wt, 'push', '-q', '-u', 'origin', 'feature');
  sb.ledger(wt, 's1', 'ship');

  const ship = last(sb.rows(), 'ship');
  assert.equal(ship.range, `${base}..${sha}`);
  assert.deepEqual(ship.commits.map((c) => c.matched), [true]);
});

test('one ledger entry is claimed once per ship, even when a later commit repeats its patch', (t) => {
  const sb = sandbox(t);
  const dir = sb.repo();

  sb.tracked(dir, 's1', 'a.txt');
  sb.git(dir, 'revert', '--no-edit', 'HEAD');
  sb.commit(dir, 'a.txt'); // the same patch again, outside /commit
  sb.ledger(dir, 's1', 'ship-begin');
  sb.git(dir, 'push', '-q');
  sb.ledger(dir, 's1', 'ship');

  const ship = last(sb.rows(), 'ship');
  assert.deepEqual(ship.commits.map((c) => c.matched), [true, false, false]);
  assert.equal(ship.untracked, 2);
  assert.equal(ship.cost.usd, 1);
});
