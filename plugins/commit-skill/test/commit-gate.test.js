'use strict';

// The commit gate as git runs it: `commit-gate install` writes the commit-msg
// stub into a throwaway repository, and each commit goes through git, the stub
// and `commit-gate check`. A Claude Code session that commits by hand skips
// /commit's message format and its cost line; every way this admits a commit
// with no token is a way back to that.
//
// Run: node --test plugins/commit-skill/test/commit-gate.test.js

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  GATE, SESSION, OTHER, RECIPE, NO_TOKEN, NO_RECIPE, NO_SESSION, NOT_ENABLED, claude, run, sandbox,
} = require('./gate-sandbox');
const { SHIP_DOCS, NOT_SHIP_DOCS, shipDocsSubjects } = require('./cases');

const MARKER = '# commit-skill commit gate: written by `commit-gate install`';
const hookFile = (repo) => path.join(repo, '.git', 'hooks', 'commit-msg');

describe('outside a Claude Code shell the gate admits every commit', () => {
  test('lands a commit with no token and no Recipe line', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo();
    const before = sb.head(repo);

    const r = sb.commit(repo, 'plain message\n');

    assert.equal(r.status, 0, r.stderr);
    assert.notEqual(sb.head(repo), before);
  });

  test("lands Todd's commit in a gated repository with commit-skill disabled", (t) => {
    // Replaces S103's "branch that predates the gate script": the gate no
    // longer lives on the branch, and the stub exits 0 before it looks for it.
    const sb = sandbox(t);
    const repo = sb.repo();
    const before = sb.head(repo);

    const r = sb.commit(repo, 'plain message\n', { PATH: `${sb.bin('git-only', ['git'])}:/bin` });

    assert.equal(r.status, 0, r.stderr);
    assert.notEqual(sb.head(repo), before);
  });
});

describe('in a Claude Code shell the gate refuses a commit with no token', () => {
  test('refuses, names /commit, and leaves HEAD where it was', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo();
    const before = sb.head(repo);

    const r = sb.commit(repo, RECIPE, claude());

    sb.refused(repo, r, before, NO_TOKEN);
    assert.ok(r.stderr.includes('/commit'));
  });

  test('refuses when the session id is missing', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo();
    sb.mint(repo, 'commit');
    const before = sb.head(repo);

    const r = sb.commit(repo, RECIPE, { CLAUDECODE: '1' });

    sb.refused(repo, r, before, NO_SESSION);
  });

  test('refuses an amend with no token', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo();
    const before = sb.head(repo);

    const amend = run('git', ['commit', '-q', '--amend', '--allow-empty', '-m', 'amended'], { cwd: repo, env: sb.envWith(claude()) });

    sb.refused(repo, amend, before, NO_TOKEN);
  });
});

describe('a commit token admits one commit with a Recipe line', () => {
  test('lands one commit and deletes the token; a second commit is refused', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo();
    sb.mint(repo, 'commit');
    const before = sb.head(repo);

    const first = sb.commit(repo, RECIPE, claude());

    assert.equal(first.status, 0, first.stderr);
    assert.notEqual(sb.head(repo), before);
    assert.equal(fs.existsSync(sb.token(repo, 'commit')), false);

    const landed = sb.head(repo);
    const second = sb.commit(repo, RECIPE, claude());

    sb.refused(repo, second, landed, NO_TOKEN);
  });

  test('refuses a message with no Recipe line and keeps the token', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo();
    sb.mint(repo, 'commit');
    const before = sb.head(repo);

    const r = sb.commit(repo, 'Add a thing\n\nNo recipe here.\n', claude());

    sb.refused(repo, r, before, NO_RECIPE);
    assert.ok(r.stderr.includes('/commit'));
    assert.equal(fs.existsSync(sb.token(repo, 'commit')), true);
  });

  for (const [what, message] of [
    ['a Recipe that does not start its line', 'Add a thing\n\nSee the Recipe: below.\n'],
    ['a commented-out Recipe line', 'Add a thing\n\n# Recipe: add the thing\n'],
  ]) {
    test(`does not count ${what}`, (t) => {
      const sb = sandbox(t);
      const repo = sb.repo();
      sb.mint(repo, 'commit');
      const before = sb.head(repo);

      const r = sb.commit(repo, message, claude());

      sb.refused(repo, r, before, NO_RECIPE);
      assert.equal(fs.existsSync(sb.token(repo, 'commit')), true);
    });
  }

  test('reads the Recipe line of a CRLF message', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo();
    sb.mint(repo, 'commit');

    const r = sb.commit(repo, RECIPE.replace(/\n/g, '\r\n'), claude());

    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(sb.token(repo, 'commit')), false);
  });

  test("does not admit another session's commit", (t) => {
    const sb = sandbox(t);
    const repo = sb.repo();
    sb.mint(repo, 'commit', SESSION);
    const before = sb.head(repo);

    const r = sb.commit(repo, RECIPE, claude(OTHER));

    sb.refused(repo, r, before, NO_TOKEN);
    assert.equal(fs.existsSync(sb.token(repo, 'commit', SESSION)), true);
  });

  test('admits a commit from a linked worktree, whose token is in the common git directory', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo();
    const tree = path.join(sb.root, 'tree');
    sb.git(repo, 'worktree', 'add', '-q', '-b', 'side', tree);
    sb.mint(repo, 'commit');

    const r = sb.commit(tree, RECIPE, claude());

    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(sb.token(repo, 'commit')), false);
  });
});

describe("a ship-docs token admits only /ship's docs subject", () => {
  const admitted = [
    ...SHIP_DOCS.map((s) => [s, `${s}\n\nChanges:\n  README — updated\n`]),
    // The gate reads the raw message file: the subject is its first line that
    // is neither blank nor a comment.
    ['after a comment line', '# Please enter the commit message\nUpdate docs to reflect: add a.txt\n'],
    ['after blank lines', '\n\nUpdate docs to reflect: add a.txt\n'],
    ['in a CRLF message', 'Update docs to reflect: add a.txt\r\n\r\nChanges:\r\n'],
  ];

  for (const [what, message] of admitted) {
    test(`lands "${what}" and deletes the token`, (t) => {
      const sb = sandbox(t);
      const repo = sb.repo();
      sb.mint(repo, 'ship-docs');
      const before = sb.head(repo);

      const r = sb.commit(repo, message, claude());

      assert.equal(r.status, 0, r.stderr);
      assert.notEqual(sb.head(repo), before);
      assert.equal(fs.existsSync(sb.token(repo, 'ship-docs')), false);
    });
  }

  const refused = [
    ...NOT_SHIP_DOCS.map((s) => [s, `${s}\n`]),
    ['a Recipe line', RECIPE],
    ['the docs subject below another subject', 'Add a thing\n\nUpdate docs to reflect: add a.txt\n'],
  ];

  for (const [what, message] of refused) {
    test(`refuses "${what}" and keeps the token`, (t) => {
      const sb = sandbox(t);
      const repo = sb.repo();
      sb.mint(repo, 'ship-docs');
      const before = sb.head(repo);

      const r = sb.commit(repo, message, claude());

      sb.refused(repo, r, before, NO_TOKEN);
      assert.equal(fs.existsSync(sb.token(repo, 'ship-docs')), true);
    });
  }

  for (const subject of shipDocsSubjects()) {
    test(`lands the subject ship's SKILL.md tells it to write: "${subject}"`, (t) => {
      const sb = sandbox(t);
      const repo = sb.repo();
      sb.mint(repo, 'ship-docs');

      const r = sb.commit(repo, `${subject}\n\nChanges:\n  README — updated\n`, claude());

      assert.equal(r.status, 0, r.stderr);
    });
  }
});

describe('the token the mint writes is the token the gate spends', () => {
  // The mint and the gate each build the token's path; each one's own tests
  // check only its half, so a path that drifts in one of them fails here.
  test('admits the commit after a /commit Skill call', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo();
    const m = sb.hook('PreToolUse', 'Skill', {
      session_id: SESSION, cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Skill',
      tool_input: { skill: 'commit-skill:commit' },
    }, { CLAUDE_PROJECT_DIR: repo });
    assert.equal(m.status, 0, m.stderr);
    const before = sb.head(repo);

    const r = sb.commit(repo, RECIPE, claude());

    assert.equal(r.status, 0, r.stderr);
    assert.notEqual(sb.head(repo), before);
  });

  test('admits the docs commit after Todd types /ship', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo();
    const m = sb.hook('UserPromptSubmit', '', {
      session_id: SESSION, cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: '/ship',
    }, { CLAUDE_PROJECT_DIR: repo });
    assert.equal(m.status, 0, m.stderr);
    const before = sb.head(repo);

    const r = sb.commit(repo, 'Update docs to reflect: Add a thing\n', claude());

    assert.equal(r.status, 0, r.stderr);
    assert.notEqual(sb.head(repo), before);
  });
});

describe('the stub', () => {
  test('is executable, carries its marker, and runs commit-gate from PATH', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo();
    const lines = fs.readFileSync(hookFile(repo), 'utf8').split('\n');

    assert.equal(lines[0], '#!/bin/sh');
    assert.ok(lines.includes(MARKER));
    assert.ok(lines.includes('exec commit-gate check "$@"'));
    assert.notEqual(fs.statSync(hookFile(repo)).mode & 0o111, 0);
  });

  test('refuses with the named message when commit-gate is not on PATH', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo();
    sb.mint(repo, 'commit');
    const before = sb.head(repo);

    const r = sb.commit(repo, RECIPE, { ...claude(), PATH: `${sb.bin('git-only', ['git'])}:/bin` });

    sb.refused(repo, r, before, NOT_ENABLED);
  });

  test('refuses when commit-gate is on PATH but Node is not', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo();
    sb.mint(repo, 'commit');
    const before = sb.head(repo);
    const gateOnly = sb.bin('gate-only', ['git']);
    fs.symlinkSync(GATE, path.join(gateOnly, 'commit-gate'));

    const r = sb.commit(repo, RECIPE, { ...claude(), PATH: `${gateOnly}:/bin` });

    sb.refused(repo, r, before, 'node');
  });
});

describe('install and uninstall', () => {
  test('install leaves the stub byte-identical on a second run', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo();
    const first = fs.readFileSync(hookFile(repo));

    const r = sb.gate(repo, ['install']);

    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(fs.readFileSync(hookFile(repo)), first);
  });

  test('install refuses a commit-msg hook it did not write, and leaves that file unchanged', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo('repo', { gated: false });
    const foreign = '#!/bin/sh\necho "my own commit-msg"\n';
    fs.writeFileSync(hookFile(repo), foreign);

    const r = sb.gate(repo, ['install']);

    assert.notEqual(r.status, 0);
    assert.equal(fs.readFileSync(hookFile(repo), 'utf8'), foreign);
  });

  test('install refuses when core.hooksPath is set', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo('repo', { gated: false });
    sb.git(repo, 'config', 'core.hooksPath', path.join(sb.root, 'hooks'));

    const r = sb.gate(repo, ['install']);

    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /core\.hooksPath/);
    assert.equal(fs.existsSync(path.join(sb.root, 'hooks', 'commit-msg')), false);
    assert.equal(fs.existsSync(hookFile(repo)), false);
  });

  test('uninstall removes its own stub, and refuses one it did not write', (t) => {
    const sb = sandbox(t);
    const repo = sb.repo();

    assert.equal(sb.gate(repo, ['uninstall']).status, 0);
    assert.equal(fs.existsSync(hookFile(repo)), false);

    const foreign = '#!/bin/sh\necho "my own commit-msg"\n';
    fs.writeFileSync(hookFile(repo), foreign);
    assert.notEqual(sb.gate(repo, ['uninstall']).status, 0);
    assert.equal(fs.readFileSync(hookFile(repo), 'utf8'), foreign);
  });

  test('install and uninstall refuse in a Claude Code shell', (t) => {
    // Both are on the session's PATH; ungating is the person's call.
    const sb = sandbox(t);
    const gated = sb.repo('gated');
    const open = sb.repo('open', { gated: false });
    const stub = fs.readFileSync(hookFile(gated), 'utf8');

    const un = sb.gate(gated, ['uninstall'], claude());
    const inst = sb.gate(open, ['install'], claude());

    assert.notEqual(un.status, 0);
    assert.equal(fs.readFileSync(hookFile(gated), 'utf8'), stub);
    assert.notEqual(inst.status, 0);
    assert.equal(fs.existsSync(hookFile(open)), false);
  });
});
