'use strict';

// Drives bin/commit-run against throwaway repositories: build, stage, commit,
// report, and the commit gate admitting what it commits.
//
// Run: node --test plugins/commit-skill/test/commit-run.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { PATH_ENV, RECIPE, NO_TOKEN, claude, run, sandbox, which } = require('./gate-sandbox');

const BIN = path.join(__dirname, '..', 'bin', 'commit-run');

function setup(t, opts) {
  const sb = sandbox(t);
  const repo = sb.repo('repo', opts);
  const commitRun = (args, { input = RECIPE, env = {} } = {}) =>
    run(BIN, args, { cwd: repo, input, env: sb.envWith(env) });
  const write = (name, text = name) => fs.writeFileSync(path.join(repo, name), text);
  return { sb, repo, commitRun, write };
}

test('commits the named paths and leaves the rest of the tree', (t) => {
  const { sb, repo, commitRun, write } = setup(t, { gated: false });
  write('a.txt');
  write('b.txt');
  const r = commitRun(['a.txt']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(sb.git(repo, 'log', '-1', '--format=%s'), 'Add a thing');
  assert.equal(sb.git(repo, 'show', '--name-only', '--format=', 'HEAD'), 'a.txt');
  assert.match(r.stdout, /^build: none$/m);
  assert.match(r.stdout, /^committed: [0-9a-f]+ Add a thing$/m);
  assert.match(r.stdout, /^ {2}A\ta\.txt$/m);
  assert.match(r.stdout, /left in the tree:\n {2}\?\? b\.txt/);
});

test('reports a clean tree', (t) => {
  const { commitRun, write } = setup(t, { gated: false });
  write('a.txt');
  const r = commitRun(['a.txt']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^tree: clean$/m);
});

test('stages a deletion', (t) => {
  const { sb, repo, commitRun, write } = setup(t, { gated: false });
  write('a.txt');
  sb.git(repo, 'add', 'a.txt');
  sb.git(repo, 'commit', '-q', '-m', 'add a');
  fs.unlinkSync(path.join(repo, 'a.txt'));
  const r = commitRun(['a.txt']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ {2}D\ta\.txt$/m);
});

/** A repo that ignores `h/` and `s/*.log`, with `h/x` tracked and `a.txt` committed. */
function ignoredDir(t) {
  const ctx = setup(t, { gated: false });
  const { sb, repo, write } = ctx;
  fs.mkdirSync(path.join(repo, 'h'));
  fs.mkdirSync(path.join(repo, 's'));
  write('.gitignore', 'h/\ns/*.log\n');
  write('h/x', 'one');
  write('a.txt', 'one');
  sb.git(repo, 'add', '-f', '.gitignore', 'h/x', 'a.txt');
  sb.git(repo, 'commit', '-q', '-m', 'seed');
  return ctx;
}

test('commits a tracked path under an ignored directory', (t) => {
  const { sb, repo, commitRun, write } = ignoredDir(t);
  write('h/x', 'two');
  const r = commitRun(['h/x']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(sb.git(repo, 'show', '--name-status', '--format=', 'HEAD'), 'M\th/x');
});

test('refuses an untracked ignored path and stages nothing', (t) => {
  const { sb, repo, commitRun, write } = ignoredDir(t);
  write('h/new');
  write('a.txt', 'two');
  const alone = commitRun(['h/new']);
  assert.equal(alone.status, 1);
  assert.match(alone.stdout, /h\/new.*ignored/);
  assert.equal(sb.git(repo, 'diff', '--cached', '--name-only'), '');
  const mixed = commitRun(['h/new', 'a.txt']);
  assert.equal(mixed.status, 1);
  assert.equal(sb.git(repo, 'diff', '--cached', '--name-only'), '');
});

test('a directory commits its new files and skips its ignored ones', (t) => {
  const { sb, repo, commitRun, write } = ignoredDir(t);
  write('s/x.log');
  write('s/n.txt');
  const r = commitRun(['s']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(sb.git(repo, 'show', '--name-only', '--format=', 'HEAD'), 's/n.txt');
});

test('a typo beside a tracked ignored path stages nothing', (t) => {
  const { sb, repo, commitRun, write } = ignoredDir(t);
  write('h/x', 'two');
  const r = commitRun(['h/x', 'typo']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /typo/);
  assert.equal(sb.git(repo, 'diff', '--cached', '--name-only'), '');
});

test('a failed second add unstages the first, so nothing is left staged', (t) => {
  const { sb, repo, commitRun, write } = ignoredDir(t);
  write('h/x', 'two');
  write('a.txt', 'two');
  // A git first on PATH whose `add -u` fails, as a held index.lock would fail it after the plain add.
  const shim = path.join(sb.root, 'shim');
  fs.mkdirSync(shim);
  fs.writeFileSync(path.join(shim, 'git'), `#!/bin/sh
case " $* " in *" add -u "*) echo "fatal: index.lock held" >&2; exit 128 ;; esac
exec '${which('git')}' "$@"
`);
  fs.chmodSync(path.join(shim, 'git'), 0o755);
  const r = commitRun(['a.txt', 'h/x'], { env: { PATH: `${shim}:${PATH_ENV}` } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /nothing was staged/);
  assert.equal(sb.git(repo, 'diff', '--cached', '--name-only'), '');
});

test('runs the package.json build and stops before staging when it fails', (t) => {
  const { sb, repo, commitRun, write } = setup(t, { gated: false });
  write('package.json', JSON.stringify({ scripts: { build: 'echo boom >&2; exit 3' } }));
  write('a.txt');
  const before = sb.git(repo, 'rev-parse', 'HEAD');
  const r = commitRun(['a.txt', 'package.json']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^build failed: npm run build \(exit 3\)/m);
  assert.match(r.stdout, /boom/);
  assert.equal(sb.git(repo, 'rev-parse', 'HEAD'), before);
  assert.equal(sb.git(repo, 'diff', '--cached', '--name-only'), '');
});

test('reports build warnings after a passing build', (t) => {
  const { commitRun, write } = setup(t, { gated: false });
  write('build.sh', 'echo "warning: something is deprecated"\necho done\n');
  write('a.txt');
  const r = commitRun(['a.txt']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^build: sh build\.sh, passed$/m);
  assert.match(r.stdout, /warnings:\n {2}warning: something is deprecated/);
});

test('--build runs the given command and --no-build skips the detected one', (t) => {
  const { commitRun, write } = setup(t, { gated: false });
  write('build.sh', 'exit 1\n');
  write('a.txt');
  write('b.txt');
  assert.match(commitRun(['--no-build', 'a.txt']).stdout, /^build: none$/m);
  const r = commitRun(['--build', 'true', 'b.txt']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^build: true, passed$/m);
});

test('refuses bad usage without touching the tree', (t) => {
  const { sb, repo, commitRun, write } = setup(t, { gated: false });
  write('a.txt');
  assert.equal(commitRun([]).status, 2);
  assert.equal(commitRun(['a.txt'], { input: '  \n' }).status, 2);
  assert.equal(commitRun(['--bogus', 'a.txt']).status, 2);
  assert.equal(sb.git(repo, 'diff', '--cached', '--name-only'), '');
});

test('the commit gate admits it under a /commit token and refuses it without one', (t) => {
  const { sb, repo, commitRun, write } = setup(t);
  write('a.txt');
  const refused = commitRun(['a.txt'], { env: claude() });
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /git commit failed; the paths are still staged/);
  assert.ok(refused.stdout.includes(NO_TOKEN));

  sb.mint(repo, 'commit');
  const r = commitRun(['a.txt'], { env: claude() });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(sb.git(repo, 'log', '-1', '--format=%s'), 'Add a thing');
});
