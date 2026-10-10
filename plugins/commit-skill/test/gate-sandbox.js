'use strict';

// The sandbox the commit gate's two suites share: throwaway repositories, a
// whitelisted environment, and the gate's hooks run the way Claude Code runs
// them. Never this checkout: a commit-msg hook in its hooks directory would
// gate every session working here.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin');
const GATE = path.join(BIN, 'commit-gate');
const HOOKS_JSON = path.join(ROOT, 'hooks', 'hooks.json');
const SESSION = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';
const RECIPE = 'Add a thing\n\nWhy it changed.\n\nRecipe: add the thing\n';

// The gate's own refusals, matched in stderr so a refusal for another reason
// (the gate not found, Node missing) cannot pass for one.
const NO_TOKEN = 'no /commit call made room for this commit';
const NO_RECIPE = 'the message has no line starting with Recipe:';
const NO_SESSION = 'no Claude Code session id in this shell';
const NOT_ENABLED = 'commit-gate: commit-skill is not enabled, so a Claude Code session cannot commit in this '
  + 'repository. Enable commit-skill, or remove .git/hooks/commit-msg from a terminal to ungate it.';

// This tree's bin/ first, then the runner's PATH without any directory that
// holds another commit-gate or token-ledger: Claude Code puts an installed
// plugin's bin/ on a session's PATH, and the suite must test this tree.
const PATH_ENV = [
  BIN,
  path.dirname(process.execPath),
  ...(process.env.PATH || '').split(':')
    .filter((d) => d && !['commit-gate', 'token-ledger'].some((f) => fs.existsSync(path.join(d, f)))),
].join(':');

function which(name) {
  for (const d of (process.env.PATH || '').split(':')) {
    const f = path.join(d, name);
    if (d && fs.existsSync(f)) return f;
  }
  throw new Error(`${name} is not on PATH`);
}

// Every child gets a timeout: node:test has none, and a hook that waits on
// stdin must fail the test, not hang it.
function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000, ...opts });
  assert.equal(r.signal, null, `${cmd} ${args.join(' ')} was killed (${r.signal}):\n${r.stderr}`);
  return r;
}

/** The environment of a Claude Code shell in session `sid`. */
const claude = (sid = SESSION) => ({ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: sid });

/** The commands hooks.json runs for `event` and `matcher` ('' for none). */
function hookCommands(event, matcher) {
  const cfg = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));
  return (cfg.hooks[event] || [])
    .filter((entry) => (entry.matcher ?? '') === matcher)
    .flatMap((entry) => entry.hooks.map((h) => h.command));
}

function sandbox(t) {
  // realpath: macOS tmpdir is a symlink, and git reports the resolved path.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'commit-gate-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  fs.mkdirSync(home);

  const env = {
    PATH: PATH_ENV,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
  };

  // `extra` overrides the environment; an empty value unsets a variable.
  const envWith = (extra = {}) => {
    const vars = { ...env, ...extra };
    for (const k of Object.keys(vars)) if (vars[k] === '') delete vars[k];
    return vars;
  };

  const sb = {
    root,
    env,
    envWith,

    git(cwd, ...args) {
      const r = run('git', args, { cwd, env });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${r.stderr}`);
      return r.stdout.trim();
    },

    head(cwd) {
      return sb.git(cwd, 'rev-parse', 'HEAD');
    },

    gate(cwd, args, extra = {}) {
      return run(GATE, args, { cwd, env: envWith(extra) });
    },

    /** A repository with one commit, gated by `commit-gate install` unless `gated` is false. */
    repo(name = 'repo', { gated = true } = {}) {
      const dir = path.join(root, name);
      fs.mkdirSync(dir);
      sb.git(dir, 'init', '-q', '-b', 'main');
      sb.git(dir, 'config', 'commit.gpgsign', 'false');
      sb.git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
      if (gated) {
        const r = sb.gate(dir, ['install']);
        assert.equal(r.status, 0, r.stderr);
      }
      return dir;
    },

    /** Commits a new file with `message` read from stdin, the way /commit passes it. */
    commit(cwd, message, extra = {}) {
      const file = `f-${Math.random().toString(36).slice(2)}.txt`;
      fs.writeFileSync(path.join(cwd, file), file);
      sb.git(cwd, 'add', file);
      return run('git', ['commit', '-q', '-F', '-'], { cwd, input: message, env: envWith(extra) });
    },

    token(repo, kind, sid = SESSION) {
      return path.join(repo, '.git', 'commit-gate', `${sid}.${kind}`);
    },

    mint(repo, kind, sid = SESSION) {
      fs.mkdirSync(path.join(repo, '.git', 'commit-gate'), { recursive: true });
      fs.writeFileSync(sb.token(repo, kind, sid), '');
    },

    /**
     * Runs the hook hooks.json wires to `event` and `matcher` as Claude Code
     * does: through a shell, with the plugin root, the session id and the
     * project directory in its environment, and the payload on stdin.
     */
    hook(event, matcher, payload, extra = {}) {
      const commands = hookCommands(event, matcher);
      assert.equal(commands.length, 1, `hooks.json wires ${commands.length} commands to ${event} ${matcher}`);
      return run('/bin/sh', ['-c', commands[0]], {
        cwd: os.tmpdir(),
        input: JSON.stringify(payload),
        env: envWith({ CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_CODE_SESSION_ID: SESSION, ...extra }),
      });
    },

    /**
     * A bin directory holding only links to `tools`, for a PATH that lacks
     * Node or commit-gate.
     */
    bin(name, tools) {
      const dir = path.join(root, name);
      fs.mkdirSync(dir);
      for (const tool of tools) fs.symlinkSync(which(tool), path.join(dir, tool));
      return dir;
    },
  };

  /** Asserts a commit was refused for `reason`, and that HEAD did not move. */
  sb.refused = (cwd, r, before, reason) => {
    assert.notEqual(r.status, 0, 'the commit landed');
    assert.equal(sb.head(cwd), before, 'HEAD moved');
    assert.ok(r.stderr.includes(reason), `stderr does not name "${reason}":\n${r.stderr}`);
  };

  return sb;
}

module.exports = {
  ROOT, GATE, SESSION, OTHER, RECIPE, NO_TOKEN, NO_RECIPE, NO_SESSION, NOT_ENABLED,
  claude, hookCommands, run, sandbox,
};
