'use strict';

// The skills tell a session which commands to run, and a session in a
// worktree runs under Claude Code's isolation guard. The guard refuses a
// command that hides git inside `$(…)` or joins git to another step, so a
// skill step written in either shape costs a refused call every time it runs.
//
// Run: node --test plugins/commit-skill/test/skill-shell-shapes.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SKILLS = path.join(__dirname, '..', 'skills');
const skillFiles = fs.readdirSync(SKILLS).map((name) => path.join(SKILLS, name, 'SKILL.md')).filter((f) => fs.existsSync(f));

for (const file of skillFiles) {
  const name = path.relative(SKILLS, file);
  const text = fs.readFileSync(file, 'utf8');

  test(`${name} runs no git inside a command substitution`, () => {
    assert.deepEqual(text.match(/\$\(\s*git\b[^)]*\)/g) || [], []);
  });

  test(`${name} joins no git command to another step`, () => {
    // A backticked command that holds git and a separator, on either side.
    const joined = text.split('\n').filter((line) => /`[^`]*(\bgit\b[^`]*(&&|;|\|\|)|(&&|;|\|\|)[^`]*\bgit\b)[^`]*`/.test(line));
    assert.deepEqual(joined, []);
  });
}

test('the commit skill says to stage and commit in separate calls', () => {
  const text = fs.readFileSync(path.join(SKILLS, 'commit', 'SKILL.md'), 'utf8');
  assert.match(text, /`git add[^`]*` as its own Bash call/);
  assert.match(text, /Run `token-ledger commit`\./);
});
