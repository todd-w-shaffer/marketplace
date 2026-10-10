'use strict';

// The two Claude Code hooks around the commit gate, run from hooks/hooks.json
// the way Claude Code runs them. The mint writes the token the gate spends, on
// a /commit or /ship call and on nothing else; the guard denies a Bash command
// that would skip the git hook or write the token by hand. Both do nothing in
// a repository the gate is not installed in.
//
// A mint that fires on the wrong call admits a hand-made commit; a mint that
// misses /commit refuses the skill's own commit.
//
// Run: node --test plugins/commit-skill/test/commit-gate-hooks.test.js

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SESSION, OTHER, hookCommands, sandbox } = require('./gate-sandbox');

const skillCall = (repo, skill, sid = SESSION) => ({
  session_id: sid, cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill },
});
const prompt = (repo, text) => ({
  session_id: SESSION, cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: text,
});
const bash = (cwd, command) => ({
  session_id: SESSION, cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command },
});

/** A gated repository, and the mint run against it as the project. */
function minting(t) {
  const sb = sandbox(t);
  const repo = sb.repo();
  const tokens = path.join(repo, '.git', 'commit-gate');
  const has = (kind, sid = SESSION) => fs.existsSync(sb.token(repo, kind, sid));
  const skill = (name, extra) => sb.hook('PreToolUse', 'Skill', skillCall(repo, name), { CLAUDE_PROJECT_DIR: repo, ...extra });
  const typed = (text) => sb.hook('UserPromptSubmit', '', prompt(repo, text), { CLAUDE_PROJECT_DIR: repo });
  const clear = () => fs.rmSync(tokens, { recursive: true, force: true });
  return { sb, repo, tokens, has, skill, typed, clear };
}

describe('the mint writes a token for /commit and /ship and for nothing else', () => {
  test('writes the commit token on a commit-skill:commit call, and prints nothing', (t) => {
    const { has, skill } = minting(t);

    const r = skill('commit-skill:commit');

    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.equal(has('commit'), true);
    assert.equal(has('ship-docs'), false);
  });

  for (const name of ['commit-skill:ship']) {
    test(`writes the ship-docs token on a ${name} call`, (t) => {
      const { has, skill } = minting(t);

      const r = skill(name);

      assert.equal(r.status, 0, r.stderr);
      assert.equal(has('ship-docs'), true);
      assert.equal(has('commit'), false);
    });
  }

  test('deletes an unspent commit token on any other skill, and keeps the ship-docs token', (t) => {
    const { sb, repo, has, skill } = minting(t);
    sb.mint(repo, 'commit');
    sb.mint(repo, 'ship-docs');

    const r = skill('simplify');

    assert.equal(r.status, 0, r.stderr);
    assert.equal(has('commit'), false);
    assert.equal(has('ship-docs'), true);
  });

  test("matches exact names only: another plugin's ship or commit skill mints nothing", (t) => {
    const { sb, repo, has, skill } = minting(t);
    sb.mint(repo, 'commit');

    for (const name of ['foo:ship', 'foo:commit', 'commit-skill:commit-all', 'ship-skill:shipit', 'ship-skill:ship']) {
      assert.equal(skill(name).status, 0);
      assert.equal(has('ship-docs'), false, name);
    }
    assert.equal(has('commit'), false);
  });

  test('writes the commit token when Todd types /commit or /commit-skill:commit', (t) => {
    const { has, typed, clear } = minting(t);
    for (const text of ['/commit', '/commit-skill:commit', '/commit only the docs']) {
      clear();

      const r = typed(text);

      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '');
      assert.equal(has('commit'), true, text);
    }
  });

  test('writes the ship-docs token when Todd types /ship or /commit-skill:ship', (t) => {
    const { has, typed, clear } = minting(t);
    for (const text of ['/ship', '/commit-skill:ship']) {
      clear();

      const r = typed(text);

      assert.equal(r.status, 0, r.stderr);
      assert.equal(has('ship-docs'), true, text);
    }
  });

  test('writes nothing for a prompt that is not a /commit or /ship command', (t) => {
    const { has, typed } = minting(t);
    for (const text of ['commit this', '/commitment', 'please run /commit', 'please run\n/commit', '/shipit', '/ship-skill:ship']) {
      const r = typed(text);

      assert.equal(r.status, 0, r.stderr);
      assert.equal(has('commit'), false, text);
      assert.equal(has('ship-docs'), false, text);
    }
  });

  test('deletes both unspent tokens on any other prompt', (t) => {
    // A /commit or /ship call that committed nothing would otherwise leave its
    // token for a commit by hand in a later turn.
    const { sb, repo, has, typed } = minting(t);
    sb.mint(repo, 'commit');
    sb.mint(repo, 'ship-docs');

    const r = typed('now fix the docs');

    assert.equal(r.status, 0, r.stderr);
    assert.equal(has('commit'), false);
    assert.equal(has('ship-docs'), false);
  });

  test('names the token after the session id in its environment, which the shell shares, not the payload', (t) => {
    // After /clear the payload carries a new session id, while the Bash shell
    // keeps the one its process started with. Both inherit the environment.
    const { sb, repo, has } = minting(t);

    const r = sb.hook('PreToolUse', 'Skill', skillCall(repo, 'commit-skill:commit', OTHER), { CLAUDE_PROJECT_DIR: repo });

    assert.equal(r.status, 0, r.stderr);
    assert.equal(has('commit'), true);
    assert.equal(has('commit', OTHER), false);
  });

  test("ignores a subagent's Skill call: it neither writes nor deletes a token", (t) => {
    // A subagent shares the session id, so its calls would act on the main
    // thread's token.
    const { sb, repo, has } = minting(t);
    const sub = (name) => sb.hook('PreToolUse', 'Skill',
      { ...skillCall(repo, name), agent_id: 'a48967d575704bd01', agent_type: 'general-purpose' },
      { CLAUDE_PROJECT_DIR: repo });

    assert.equal(sub('commit-skill:commit').status, 0);
    assert.equal(has('commit'), false);

    sb.mint(repo, 'commit');
    assert.equal(sub('code-review').status, 0);
    assert.equal(has('commit'), true);
  });

  test('deletes token files older than a day when it writes one', (t) => {
    const { sb, repo, tokens, has, skill } = minting(t);
    sb.mint(repo, 'ship-docs');
    const stale = path.join(tokens, `${OTHER}.commit`);
    fs.writeFileSync(stale, '');
    const old = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    fs.utimesSync(stale, old, old);

    assert.equal(skill('commit-skill:commit').status, 0);

    assert.equal(fs.existsSync(stale), false);
    assert.equal(has('ship-docs'), true);
    assert.equal(has('commit'), true);
  });

  test('writes nothing for a session id that is not a plain id', (t) => {
    const { sb, repo, tokens } = minting(t);

    const r = sb.hook('PreToolUse', 'Skill', skillCall(repo, 'commit-skill:commit', '../../escape'),
      { CLAUDE_PROJECT_DIR: repo, CLAUDE_CODE_SESSION_ID: '../../escape' });

    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(tokens), false);
    assert.equal(fs.existsSync(path.join(repo, 'escape.commit')), false);
  });

  test('resolves the git directory from the project directory, wherever the session has gone', (t) => {
    const { sb, repo, has } = minting(t);
    const outside = path.join(sb.root, 'outside');
    fs.mkdirSync(outside);

    const r = sb.hook('PreToolUse', 'Skill', { ...skillCall(repo, 'commit-skill:commit'), cwd: outside },
      { CLAUDE_PROJECT_DIR: repo });

    assert.equal(r.status, 0, r.stderr);
    assert.equal(has('commit'), true);
  });

  test('falls back to cwd with no project directory, and writes nothing outside a repository', (t) => {
    const { sb, repo, has } = minting(t);
    const outside = path.join(sb.root, 'outside');
    fs.mkdirSync(outside);

    assert.equal(sb.hook('PreToolUse', 'Skill', { ...skillCall(repo, 'commit-skill:commit'), cwd: outside }).status, 0);
    assert.equal(has('commit'), false);

    assert.equal(sb.hook('PreToolUse', 'Skill', skillCall(repo, 'commit-skill:commit')).status, 0);
    assert.equal(has('commit'), true);
  });
});

describe('the guard denies the commands that skip the git hook', () => {
  // Run in a gated repository that is both the project and the cwd.
  const decision = (t, command) => {
    const sb = sandbox(t);
    const repo = sb.repo();
    return verdict(sb.hook('PreToolUse', 'Bash', bash(repo, command), { CLAUDE_PROJECT_DIR: repo }));
  };

  const DENIED = [
    'git commit --no-verify -m x',
    'git commit -q --no-verify -F - <<\'EOF\'\nx\nEOF',
    'git commit --no-veri -m x',
    'git commit -n -m x',
    'git commit -qn -m x',
    'cd sub && git commit -n -m x',
    '/usr/bin/git commit -n -m x',
    'git -c core.hooksPath=/dev/null commit -m x',
    'git config core.hooksPath /tmp/h',
    'git -c CORE.HOOKSPATH=/dev/null commit -m x',
    'touch .git/commit-gate/abc.commit',
    'grep -r x .git/commit-gate/',
    'cd .git && ls commit-gate/',
    'cd .git && echo x>commit-gate/t',
    'cd .git && true;rm -r commit-gate/',
    'cd .git && tar --directory=commit-gate/ -c .',
    'unset CLAUDECODE; git commit -m x',
    'unset FOO CLAUDECODE && git commit -m x',
    'env -u CLAUDECODE git commit -m x',
    'env --unset=CLAUDECODE git commit -m x',
    'env -i git commit -m x',
    'env - git commit -m x',
    'env -vi git commit -m x',
    'env -iv git commit -m x',
    'git commit -F msg \\\n  --no-verify',
    'git commit "--no-verify" -m x',
    "git commit '-n' -m x",
    'git commit -m "x" -n -m "y"',
    "git commit -m 'x' --no-verify -m 'y z'",
    'printenv CLAUDECODE',
    'env -C /tmp -i git commit -m x',
    'env --chdir /tmp -u CLAUDECODE git commit -m x',
    'env -P /usr/bin -u CLAUDECODE git commit -m x',
    'CLAUDECODE= git commit -m x',
    'export CLAUDECODE=',
    'CLAUDE_CODE_SESSION_ID=abc git commit -m x',
    // The gate's own subcommands are on the session's PATH.
    'commit-gate uninstall',
    'echo "{}" | commit-gate mint',
    'node ~/x/bin/commit-gate install',
    'commit-gate guard < payload.json',
    // A PATH that puts a fake commit-gate ahead of the real one.
    'PATH=./x:$PATH git commit -m y',
    'env PATH=./x git commit -m y',
    'export PATH=./x:$PATH; git commit -m y',
    'PATH+=:./x git commit -m y',
  ];

  for (const command of DENIED) {
    test(`denies ${JSON.stringify(command)}`, (t) => {
      assert.equal(decision(t, command), 'deny');
    });
  }

  const ALLOWED = [
    'git commit -q -F - <<\'EOF\'\nAdd a thing\n\nRecipe: add it\nEOF',
    'git commit -m "no verify"',
    'git commit --amend -m x',
    'git log --oneline -n 5',
    'grep -n commit scripts/autopilot.sh',
    'node --test plugins/commit-skill/test/commit-gate.test.js plugins/commit-skill/test/commit-gate-hooks.test.js',
    'printenv HOME',
    'mv docs/briefs/x.md docs/archive/s103-commit-gate/x.md',
    'git log -n 3 && git commit -F msg',
    'git commit -m "Pass -n to grep"',
    "git commit -q -F - <<'EOF'\nDeny an env that strips CLAUDECODE\n\nRecipe: deny -n on a git commit line and --no-verify\nEOF",
    "cat > /tmp/notes.md <<EOF\ncore.hooksPath and CLAUDE_CODE_SESSION_ID are named here\nEOF",
    'env FOO=1 git add -i',
    'env -u FOO git status -uno',
    'npm run check',
    'commit-gate status',
    'PATH=./node_modules/.bin:$PATH npm test',
    'echo $PATH && git commit -F msg',
    "git commit -m 'Deny PATH= and commit-gate uninstall'",
  ];

  for (const command of ALLOWED) {
    test(`allows ${JSON.stringify(command)}`, (t) => {
      assert.equal(decision(t, command), 'allow');
    });
  }

  test('names the reason in the deny', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo();
    const r = sb.hook('PreToolUse', 'Bash', bash(repo, 'git commit -n -m x'), { CLAUDE_PROJECT_DIR: repo });

    assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /\/commit/);
  });

  test('guards a command when the project is gated, wherever the cwd is', (t) => {
    // A session that cd-ed into an ungated directory still runs commands
    // against the project.
    const sb = sandbox(t);
    const repo = sb.repo();
    const open = sb.repo('open', { gated: false });

    const r = sb.hook('PreToolUse', 'Bash', bash(open, `git -C ${repo} commit -n -m x`), { CLAUDE_PROJECT_DIR: repo });

    assert.equal(verdict(r), 'deny');
  });

  test('guards a command when the cwd is gated, whatever the project is', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo();
    const open = sb.repo('open', { gated: false });

    const r = sb.hook('PreToolUse', 'Bash', bash(repo, 'git commit -n -m x'), { CLAUDE_PROJECT_DIR: open });

    assert.equal(verdict(r), 'deny');
  });

  test('guards a command from a subdirectory of a gated repository', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo();
    const sub = path.join(repo, 'src', 'deep');
    fs.mkdirSync(sub, { recursive: true });

    const r = sb.hook('PreToolUse', 'Bash', bash(sub, 'git commit -n -m x'), { CLAUDE_PROJECT_DIR: sub });

    assert.equal(verdict(r), 'deny');
  });

  test('guards a command from a linked worktree of a gated repository', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo();
    const tree = path.join(sb.root, 'tree');
    sb.git(repo, 'worktree', 'add', '-q', '-b', 'side', tree);

    const r = sb.hook('PreToolUse', 'Bash', bash(tree, 'git commit -n -m x'), { CLAUDE_PROJECT_DIR: tree });

    assert.equal(verdict(r), 'deny');
  });
});

describe('in a repository without the gate the hooks do nothing', () => {
  test('the mint writes no token directory on /commit, typed or called', (t) => {
    const sb = sandbox(t);
    const open = sb.repo('open', { gated: false });

    assert.equal(sb.hook('PreToolUse', 'Skill', skillCall(open, 'commit-skill:commit'), { CLAUDE_PROJECT_DIR: open }).status, 0);
    assert.equal(sb.hook('UserPromptSubmit', '', prompt(open, '/ship'), { CLAUDE_PROJECT_DIR: open }).status, 0);

    assert.equal(fs.existsSync(path.join(open, '.git', 'commit-gate')), false);
  });

  test('the mint writes no token into an ungated project when only the cwd is gated', (t) => {
    // The front starts Node for a gated cwd, but the mint writes into the
    // project, and that one is not gated.
    const sb = sandbox(t);
    const repo = sb.repo();
    const open = sb.repo('open', { gated: false });

    assert.equal(sb.hook('PreToolUse', 'Skill', skillCall(repo, 'commit-skill:commit'), { CLAUDE_PROJECT_DIR: open }).status, 0);

    assert.equal(fs.existsSync(path.join(open, '.git', 'commit-gate')), false);
    assert.equal(fs.existsSync(path.join(repo, '.git', 'commit-gate')), false);
  });

  test('the guard denies nothing', (t) => {
    const sb = sandbox(t);
    const open = sb.repo('open', { gated: false });

    for (const command of ['git commit -n -m x', 'env -i git commit -m x', 'commit-gate install']) {
      const r = sb.hook('PreToolUse', 'Bash', bash(open, command), { CLAUDE_PROJECT_DIR: open });
      assert.equal(verdict(r), 'allow', command);
    }
  });

  test('outside any repository both exit 0 and print nothing', (t) => {
    const sb = sandbox(t);
    const outside = path.join(sb.root, 'outside');
    fs.mkdirSync(outside);

    for (const r of [
      sb.hook('PreToolUse', 'Skill', skillCall(outside, 'commit-skill:commit'), { CLAUDE_PROJECT_DIR: outside }),
      sb.hook('PreToolUse', 'Bash', bash(outside, 'git commit -n -m x'), { CLAUDE_PROJECT_DIR: outside }),
    ]) {
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '');
    }
    assert.equal(fs.existsSync(path.join(outside, '.git')), false);
  });
});

describe('the fast path never starts Node in a repository without the gate', () => {
  // The guard runs before every Bash call in every project the plugin is
  // enabled in. A fake node records that it ran; git and grep are real, so a
  // missing git cannot pass this by reading every repository as ungated.
  function fastPath(t) {
    const sb = sandbox(t);
    const bin = sb.bin('fast-bin', ['git', 'grep', 'cat']);
    const sentinel = path.join(sb.root, 'node-ran');
    fs.writeFileSync(path.join(bin, 'node'), `#!/bin/sh\n: > '${sentinel}'\ncat >/dev/null\n`, { mode: 0o755 });
    const guard = (cwd, project) => sb.hook('PreToolUse', 'Bash', bash(cwd, 'git commit -n -m x'),
      { CLAUDE_PROJECT_DIR: project, PATH: bin });
    return { sb, sentinel, guard };
  }

  test('starts Node in a gated repository', (t) => {
    const { sb, sentinel, guard } = fastPath(t);
    const repo = sb.repo();

    assert.equal(guard(repo, repo).status, 0);

    assert.equal(fs.existsSync(sentinel), true);
  });

  test('does not start Node in an ungated repository or outside one', (t) => {
    const { sb, sentinel, guard } = fastPath(t);
    const open = sb.repo('open', { gated: false });

    assert.equal(guard(open, open).status, 0);
    assert.equal(guard(os.tmpdir(), os.tmpdir()).status, 0);

    assert.equal(fs.existsSync(sentinel), false);
  });
});

describe('hooks.json wires the three hooks', () => {
  const cfg = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8'));

  for (const [event, matcher, sub] of [
    ['PreToolUse', 'Skill', 'mint'],
    ['UserPromptSubmit', '', 'mint'],
    ['PreToolUse', 'Bash', 'guard'],
  ]) {
    test(`runs ${sub} on ${event}${matcher ? ` ${matcher}` : ''}, through the plugin root, with a timeout`, () => {
      assert.deepEqual(hookCommands(event, matcher), [`"\${CLAUDE_PLUGIN_ROOT}/scripts/gated" ${sub}`]);
      const hooks = (cfg().hooks[event] || []).filter((e) => (e.matcher ?? '') === matcher).flatMap((e) => e.hooks);
      assert.equal(hooks[0].timeout, 5);
    });
  }
});

function verdict(r) {
  assert.equal(r.status, 0, r.stderr);
  if (r.stdout.trim() === '') return 'allow';
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, 'PreToolUse');
  return out.permissionDecision;
}
