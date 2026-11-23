'use strict';

// Drives bin/ship-run against a bare origin made in the sandbox: the target,
// the push, the outcome decided by fetch, the rebase and transport retries,
// the ledger's ship marker and --finish.
//
// Run: node --test plugins/commit-skill/test/ship-run.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { PATH_ENV, SESSION, run, sandbox, which } = require('./gate-sandbox');

const BIN = path.join(__dirname, '..', 'bin', 'ship-run');
const REAL_GIT = which('git');

function setup(t, opts) {
  const sb = sandbox(t);
  const repo = sb.clone('work', opts);
  const env = {
    TOKEN_LEDGER_FILE: path.join(sb.root, 'ledger.jsonl'),
    TOKEN_LEDGER_MARKERS: path.join(sb.root, 'markers.json'),
    CLAUDE_CODE_SESSION_ID: SESSION,
    GIT_TERMINAL_PROMPT: '0',
    SHIP_RUN_BACKOFF_MS: '0',
    // npm in a fresh HOME checks for its own update and builds a cache: skip both, so a loaded run stays in time.
    npm_config_update_notifier: 'false',
    npm_config_cache: path.join(sb.root, 'npm-cache'),
  };
  const shipRun = (args = [], { bin = BIN, cwd = repo, env: extra = {} } = {}) => {
    const r = run(bin, args, { cwd, timeout: 30000, env: sb.envWith({ ...env, ...extra }) });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch { /* usage errors print no JSON */ }
    return { ...r, json };
  };
  const write = (name, text = `${name}\n`, cwd = repo) => {
    fs.mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
    fs.writeFileSync(path.join(cwd, name), text);
  };
  const commit = (name, text, cwd = repo) => {
    write(name, text, cwd);
    sb.git(cwd, 'add', name);
    sb.git(cwd, 'commit', '-q', '-m', `add ${name}`);
    return sb.git(cwd, 'rev-parse', 'HEAD');
  };
  const remoteSha = (branch = 'main') => sb.git(path.join(sb.root, 'origin.git'), 'rev-parse', branch);
  const markers = () => {
    try { return JSON.parse(fs.readFileSync(env.TOKEN_LEDGER_MARKERS, 'utf8')); } catch { return {}; }
  };
  /** A teammate's push: another clone commits `name` and pushes it to main. */
  const teammate = (name, text) => {
    const other = path.join(sb.root, 'teammate');
    if (!fs.existsSync(other)) sb.clone('teammate');
    else sb.git(other, 'pull', '-q', '--rebase');
    commit(name, text, other);
    sb.git(other, 'push', '-q', 'origin', 'HEAD:main');
  };
  /** A package.json committed with `scripts`. */
  const pkg = (scripts) => commit('package.json', JSON.stringify({ name: 'x', scripts }));
  const hook = (body) => {
    const file = path.join(repo, '.git', 'hooks', 'pre-push');
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(file, 0o755);
  };
  /**
   * A `git` first on PATH, so npm's children inherit it too, that runs real git by absolute path. `onPush` is
   * shell run for the `push` subcommand, read after any `-c` pairs, with `$n` its 1-based count.
   */
  const gitShim = (onPush) => {
    const dir = path.join(sb.root, 'shim');
    fs.mkdirSync(dir, { recursive: true });
    const count = path.join(sb.root, 'push-count');
    fs.writeFileSync(path.join(dir, 'git'), `#!/bin/sh
sub=""; skip=0
for a in "$@"; do
  if [ $skip = 1 ]; then skip=0; continue; fi
  case "$a" in -c) skip=1 ;; -*) ;; *) sub="$a"; break ;; esac
done
if [ "$sub" = push ]; then
  n=$(( $(cat '${count}' 2>/dev/null || echo 0) + 1 )); echo $n > '${count}'
  ${onPush}
fi
exec '${REAL_GIT}' "$@"
`);
    fs.chmodSync(path.join(dir, 'git'), 0o755);
    return { PATH: `${dir}:${PATH_ENV}` };
  };
  return { sb, repo, shipRun, write, commit, remoteSha, markers, teammate, pkg, hook, gitShim, env };
}

test('lands a clean branch and reports its commits, push lines and untracked files', (t) => {
  const { repo, sb, shipRun, write, commit, remoteSha } = setup(t);
  const before = sb.git(repo, 'rev-parse', 'origin/main');
  const a = commit('a.txt');
  const b = commit('b.txt');
  write('scratch.txt');
  const r = shipRun();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.json.outcome, 'landed');
  assert.equal(r.json.target, 'origin/main');
  assert.equal(r.json.before, before);
  assert.deepEqual(r.json.commits, [{ sha: a, subject: 'add a.txt' }, { sha: b, subject: 'add b.txt' }]);
  assert.deepEqual(r.json.untracked, ['scratch.txt']);
  assert.deepEqual(r.json.changed, [{ status: 'A', path: 'a.txt' }, { status: 'A', path: 'b.txt' }]);
  assert.deepEqual(r.json.retries, { rebase: 0, transport: 0 });
  assert.match(r.json.push_lines[0], /^ {3}[0-9a-f]+\.\.[0-9a-f]+ {2}HEAD -> main$/);
  assert.equal(r.json.output_tail, undefined);
  assert.equal(remoteSha(), b);
});

test('an empty range is nothing to push', (t) => {
  const { shipRun } = setup(t);
  const r = shipRun();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.outcome, 'nothing-to-push');
});

test('a tracked change refuses before any fetch', (t) => {
  const { repo, sb, shipRun, write, commit, teammate } = setup(t);
  commit('a.txt');
  teammate('t.txt');
  const seen = sb.git(repo, 'rev-parse', 'origin/main');
  write('README', 'changed\n');
  const r = shipRun();
  assert.equal(r.status, 2);
  assert.deepEqual(r.json, { outcome: 'dirty', files: ['README'], next: 'run /commit first' });
  assert.equal(sb.git(repo, 'rev-parse', 'origin/main'), seen, 'ship-run fetched');
});

test('a rebase left in progress refuses', (t) => {
  const { repo, shipRun, commit } = setup(t);
  commit('a.txt');
  fs.mkdirSync(path.join(repo, '.git', 'rebase-merge'));
  const r = shipRun();
  assert.equal(r.status, 2);
  assert.equal(r.json.outcome, 'dirty');
});

test('a rebase stopped on a conflict names the rebase, not /commit', (t) => {
  const { repo, sb, shipRun, commit, teammate } = setup(t);
  commit('f.txt', 'mine\n');
  teammate('f.txt', 'theirs\n');
  sb.git(repo, 'fetch', '-q');
  assert.notEqual(run('git', ['rebase', 'origin/main'], { cwd: repo, env: sb.env }).status, 0);
  const r = shipRun();
  assert.equal(r.status, 2);
  assert.equal(r.json.outcome, 'dirty');
  assert.match(r.json.next, /rebase is in progress/);
});

test('a pre-push hook refusal is refused, with its words', (t) => {
  const { shipRun, commit, hook, remoteSha } = setup(t);
  const seed = remoteSha();
  commit('a.txt');
  hook('echo "suite: 3 tests failed" >&2; exit 1');
  const r = shipRun();
  assert.equal(r.status, 1);
  assert.equal(r.json.outcome, 'refused');
  assert.match(r.json.output_tail, /suite: 3 tests failed/);
  assert.equal(remoteSha(), seed);
});

test('a hook that prints a transport word in its own output is refused, not retried', (t) => {
  const { shipRun, commit, hook } = setup(t);
  commit('a.txt');
  hook('echo "test said: RPC failed in fixture" >&2; exit 1');
  const r = shipRun();
  assert.equal(r.status, 1);
  assert.equal(r.json.outcome, 'refused');
  assert.equal(r.json.retries.transport, 0);
});

test('a push that exits 0 but moves nothing is refused: the fetch decides', (t) => {
  const { shipRun, commit, gitShim } = setup(t);
  commit('a.txt');
  const r = shipRun([], { env: gitShim('exit 0') });
  assert.equal(r.status, 1, r.stdout);
  assert.equal(r.json.outcome, 'refused');
});

test('with check:push, a moved remote rebases once, reruns the check and lands', (t) => {
  const { repo, shipRun, commit, pkg, teammate, remoteSha } = setup(t);
  pkg({ 'check:push': 'echo x >> .git/checks' });
  const mine = commit('a.txt');
  teammate('t.txt');
  const r = shipRun();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.json.outcome, 'landed');
  assert.equal(r.json.retries.rebase, 1);
  assert.equal(fs.readFileSync(path.join(repo, '.git', 'checks'), 'utf8'), 'x\nx\n');
  assert.notEqual(remoteSha(), mine, 'the rebase rewrote the sha');
  assert.deepEqual(r.json.commits.map((c) => c.subject), ['add package.json', 'add a.txt']);
});

test('with check:push, a conflicting remote answers conflict and aborts the rebase', (t) => {
  const { repo, sb, shipRun, commit, pkg, teammate } = setup(t);
  pkg({ 'check:push': 'true' });
  const head = commit('a.txt', 'mine\n');
  teammate('a.txt', 'theirs\n');
  const r = shipRun();
  assert.equal(r.status, 1, r.stdout);
  assert.equal(r.json.outcome, 'conflict');
  assert.match(r.json.output_tail, /a\.txt/);
  assert.equal(fs.existsSync(path.join(repo, '.git', 'rebase-merge')), false);
  assert.equal(sb.git(repo, 'rev-parse', 'HEAD'), head);
});

test('with no check to rerun, a moved remote is refused without a rebase', (t) => {
  const { repo, sb, shipRun, commit, teammate } = setup(t);
  const head = commit('a.txt');
  teammate('t.txt');
  const r = shipRun();
  assert.equal(r.status, 1, r.stdout);
  assert.equal(r.json.outcome, 'refused');
  assert.equal(r.json.retries.rebase, 0);
  assert.match(r.json.output_tail, /rebase and re-check/);
  assert.equal(sb.git(repo, 'rev-parse', 'HEAD'), head);
});

test('a failing check:push is refused and pushes nothing', (t) => {
  const { shipRun, commit, pkg, remoteSha } = setup(t);
  const seed = remoteSha();
  pkg({ 'check:push': 'echo "lint: 2 errors" >&2; exit 1' });
  commit('a.txt');
  const r = shipRun();
  assert.equal(r.status, 1);
  assert.equal(r.json.outcome, 'refused');
  assert.match(r.json.output_tail, /lint: 2 errors/);
  assert.equal(remoteSha(), seed);
});

test("push:checked's stopped rebase answers conflict", (t) => {
  const { shipRun, pkg } = setup(t);
  pkg({ 'push:checked': "echo \"pre-push: rebasing main onto the remote's main (abc1234) stopped; conflicts in: a.txt. main is back.\" >&2; exit 1" });
  const r = shipRun();
  assert.equal(r.status, 1, r.stdout);
  assert.equal(r.json.outcome, 'conflict');
});

test('push:checked runs in place of the push', (t) => {
  const { repo, shipRun, pkg, remoteSha } = setup(t);
  const head = pkg({ 'push:checked': 'touch .git/checked-ran && git push' });
  const r = shipRun();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.json.outcome, 'landed');
  assert.ok(fs.existsSync(path.join(repo, '.git', 'checked-ran')));
  assert.equal(remoteSha(), head);
});

test('transport failures retry with a larger post buffer, and land', (t) => {
  const { sb, shipRun, commit, gitShim, remoteSha } = setup(t);
  const head = commit('a.txt');
  const seen = path.join(sb.root, 'post-buffer');
  const r = shipRun([], { env: gitShim(`echo "$n $GIT_CONFIG_KEY_0=$GIT_CONFIG_VALUE_0" >> '${seen}'
  if [ $n -le 2 ]; then echo "error: RPC failed; curl 56 Recv failure: Connection reset by peer" >&2; exit 1; fi`) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.json.outcome, 'landed');
  assert.equal(r.json.retries.transport, 2);
  assert.equal(fs.readFileSync(seen, 'utf8'), '1 =\n2 http.postBuffer=157286400\n3 http.postBuffer=157286400\n');
  assert.equal(remoteSha(), head);
});

test('a transport failure on every attempt answers transport after 3 retries', (t) => {
  const { shipRun, commit, gitShim } = setup(t);
  commit('a.txt');
  const r = shipRun([], { env: gitShim('echo "fatal: the remote end hung up unexpectedly" >&2; exit 128') });
  assert.equal(r.status, 1);
  assert.equal(r.json.outcome, 'transport');
  assert.equal(r.json.retries.transport, 3);
});

test('--to-default targets the remote default branch from a branch with no upstream', (t) => {
  const { repo, sb, shipRun, commit, remoteSha } = setup(t);
  sb.git(repo, 'checkout', '-q', '-b', 'work');
  const head = commit('a.txt');
  const r = shipRun(['--to-default']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.json.target, 'origin/main');
  assert.equal(remoteSha(), head);
});

test('a branch with no upstream and no --to-default publishes itself', (t) => {
  const { repo, sb, shipRun, commit, remoteSha } = setup(t);
  sb.git(repo, 'checkout', '-q', '-b', 'feature');
  const head = commit('a.txt');
  const r = shipRun();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.json.target, 'origin/feature');
  assert.equal(r.json.before, null);
  assert.deepEqual(r.json.commits.map((c) => c.sha), [head]);
  assert.equal(remoteSha('feature'), head);
  assert.equal(sb.git(repo, 'rev-parse', '--abbrev-ref', '@{u}'), 'origin/feature');
});

test('--to-default with no default branch to find exits 2 naming set-head', (t) => {
  const { repo, sb, shipRun, commit } = setup(t, { branch: 'trunk' });
  // git 2.48 and later recreate origin/HEAD on fetch unless told not to.
  sb.git(repo, 'config', 'remote.origin.followRemoteHEAD', 'never');
  sb.git(repo, 'remote', 'set-head', 'origin', '-d');
  sb.git(repo, 'checkout', '-q', '-b', 'work');
  commit('a.txt');
  const r = shipRun(['--to-default']);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stderr, /git remote set-head origin -a/);
});

test('a refused run then a landed one keeps the first ship-begin marker', (t) => {
  const { repo, shipRun, commit, hook, markers } = setup(t);
  commit('a.txt');
  hook('exit 1');
  assert.equal(shipRun().json.outcome, 'refused');
  const first = markers()[repo];
  assert.ok(first, 'ship-begin wrote no marker');
  hook('exit 0');
  const r = shipRun();
  assert.equal(r.json.outcome, 'landed', r.stdout);
  assert.deepEqual(markers()[repo], first);
});

test('a rerun after a landed push, the ship still open, answers landed', (t) => {
  const { repo, sb, shipRun, commit } = setup(t);
  const before = sb.git(repo, 'rev-parse', 'origin/main');
  const head = commit('a.txt');
  assert.equal(shipRun().json.outcome, 'landed');
  const r = shipRun();
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.json.outcome, 'landed');
  assert.equal(r.json.before, before);
  assert.deepEqual(r.json.commits.map((c) => c.sha), [head]);
});

/** A transcript line for the session, so `token-ledger ship` has spend to bill. */
function spend(sb) {
  const dir = path.join(sb.home, '.claude', 'projects', '-sandbox');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${SESSION}.jsonl`), JSON.stringify({
    type: 'assistant', timestamp: new Date().toISOString(), cwd: sb.root, gitBranch: 'main',
    message: { id: `msg_${Date.now()}`, model: 'claude-haiku-4-5', usage: { input_tokens: 1e6 } },
  }) + '\n');
}

test('--finish pushes the docs commit and adds staleness and the ship cost', (t) => {
  const { repo, sb, shipRun, commit, remoteSha, markers } = setup(t);
  commit('scripts/staleness.mjs', "console.log('2 docs stale')\n");
  spend(sb);
  assert.equal(shipRun().json.outcome, 'landed');
  const docs = commit('README', 'docs\n');
  spend(sb);
  const r = shipRun(['--finish']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.json.outcome, 'landed');
  assert.equal(remoteSha(), docs);
  assert.equal(r.json.staleness, '2 docs stale');
  assert.match(r.json.ship_cost, /^\*\*Ship cost:\*\*/);
  assert.equal(markers()[repo], undefined, 'ship closes the marker');
});

test('--finish whose push is refused skips the ledger and staleness and keeps the marker', (t) => {
  const { repo, sb, shipRun, commit, hook, markers } = setup(t);
  commit('scripts/staleness.mjs', "console.log('2 docs stale')\n");
  spend(sb);
  assert.equal(shipRun().json.outcome, 'landed');
  commit('README', 'docs\n');
  hook('exit 1');
  const r = shipRun(['--finish']);
  assert.equal(r.status, 1, r.stdout);
  assert.equal(r.json.outcome, 'refused');
  assert.equal(r.json.staleness, null);
  assert.equal(r.json.ship_cost, null);
  assert.ok(markers()[repo], 'the marker was closed');
});

test('--finish with no ledger beside it or on PATH answers ship_cost null', (t) => {
  const { sb, shipRun, commit } = setup(t);
  commit('a.txt');
  const lone = path.join(sb.root, 'lone');
  fs.mkdirSync(lone);
  fs.copyFileSync(BIN, path.join(lone, 'ship-run'));
  fs.chmodSync(path.join(lone, 'ship-run'), 0o755);
  const PATH = PATH_ENV.split(':').filter((d) => d !== path.dirname(BIN)).join(':');
  const r = shipRun(['--finish'], { bin: path.join(lone, 'ship-run'), env: { PATH } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.json.outcome, 'landed');
  assert.equal(r.json.ship_cost, null);
});
