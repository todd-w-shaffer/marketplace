'use strict';

// Drives bin/token-ledger as the skills do, against throwaway repos with a bare
// remote. HOME points into the sandbox, so transcripts, the ledger and the
// ship markers never touch the real ~/.claude.
//
// Run: node --test plugins/commit-skill/test/token-ledger.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'token-ledger');

// ---------- sandbox ----------

function sandbox(t) {
  // realpath: macOS tmpdir is a symlink, and git reports the resolved path.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'token-ledger-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const projects = path.join(home, '.claude', 'projects', '-sandbox');
  fs.mkdirSync(projects, { recursive: true });

  const env = {
    PATH: process.env.PATH,
    HOME: home,
    TOKEN_LEDGER_FILE: path.join(root, 'ledger.jsonl'),
    TOKEN_LEDGER_MARKERS: path.join(root, 'markers.json'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
  };

  let nextId = 0;
  const sb = {
    root,
    env,

    git(cwd, ...args) {
      const r = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${r.stderr}`);
      return r.stdout.trim();
    },

    gitStatus(cwd, ...args) {
      return spawnSync('git', args, { cwd, env, encoding: 'utf8' }).status;
    },

    ledger(cwd, session, ...args) {
      const r = spawnSync(process.execPath, [BIN, ...args], {
        cwd, env: { ...env, CLAUDE_CODE_SESSION_ID: session }, encoding: 'utf8',
      });
      if (r.status !== 0) throw new Error(`token-ledger ${args.join(' ')} failed:\n${r.stderr}`);
      return r.stdout;
    },

    // Writes one API call to a session's transcript, timestamped now. `dup`
    // writes it twice, as Claude Code does for a call with several blocks.
    spend(session, { model = 'claude-haiku-4-5', sub = false, dup = false, ...usage } = {}) {
      tick();
      const file = sub
        ? path.join(projects, session, 'subagents', 'agent-1.jsonl')
        : path.join(projects, session + '.jsonl');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const line = JSON.stringify({
        type: 'assistant',
        timestamp: new Date().toISOString(),
        message: { id: `msg_${++nextId}`, model, usage },
      }) + '\n';
      fs.appendFileSync(file, dup ? line + line : line);
      tick();
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
      const remote = path.join(root, 'remote.git');
      if (!fs.existsSync(remote)) {
        sb.git(root, 'init', '-q', '--bare', '-b', 'main', remote);
        const seed = path.join(root, 'seed');
        sb.git(root, 'clone', '-q', remote, seed);
        fs.writeFileSync(path.join(seed, 'README'), 'seed\n');
        sb.git(seed, 'add', '.');
        sb.git(seed, 'commit', '-q', '-m', 'seed');
        sb.git(seed, 'push', '-q', 'origin', 'HEAD:main');
      }
      const dir = path.join(root, name);
      sb.git(root, 'clone', '-q', remote, dir);
      return dir;
    },

    // Writes a file and commits it by hand, as /commit does before it tallies.
    commit(cwd, file, body = file + '\n') {
      fs.writeFileSync(path.join(cwd, file), body);
      sb.git(cwd, 'add', file);
      sb.git(cwd, 'commit', '-q', '-m', 'add ' + file);
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

function worktree(sb) {
  const main = sb.repo();
  sb.git(main, 'remote', 'set-head', 'origin', 'main');
  const wt = path.join(sb.root, 'work-feature');
  sb.git(main, 'worktree', 'add', '-q', '-b', 'feature', wt);
  assert.equal(spawnSync('git', ['rev-parse', '@{u}'], { cwd: wt, env: sb.env }).status, 128, 'feature has no upstream');
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
  const r = spawnSync(process.execPath, [BIN, 'ship'], {
    cwd: dir, env: { ...sb.env, CLAUDE_CODE_SESSION_ID: 's1' }, encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /no ship base/);
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

test('rebase between ship-begin and push: the ship claims only its own commits', {
  todo: 'claims session B\'s already-shipped commit and its $3.00; see PR description',
}, (t) => {
  const sb = sandbox(t);
  const { bSha, shipA } = raceToMain(sb, { shipBegin: true });
  t.diagnostic(`ship A claimed ${shipA.commits.length} commits, `
    + `${shipA.commits.filter((c) => c.matched).length} matched, $${shipA.cost.usd}`);
  assert.deepEqual(shipA.commits.map((c) => c.sha).includes(bSha), false);
  assert.equal(shipA.commits.length, 1);
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
