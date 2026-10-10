'use strict';

// The subjects /ship's own docs commit can carry, shared by the ledger's suite
// and the gate's, so the two callers of lib/commit-format.js read one table.
// SHIP_DOCS rows are counted by the ledger as /ship's docs commit and admitted
// by the gate under a ship-docs token; NOT_SHIP_DOCS rows are neither.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const SHIP_DOCS = [
  'Update docs to reflect: add a.txt',
  // The typed subject /ship is to move to (Migration step 4).
  'docs(a): sync with add a.txt',
  'docs: sync with add a.txt',
  // Slips a model can make copying the code commit's prefix or the phrase.
  'docs!: sync with add a.txt',
  'docs(a)!: sync with add a.txt',
  'docs(a(b)): sync with add a.txt',
  'Docs: Sync With add a.txt',
  'docs(a):  sync  with add a.txt',
  'update docs to reflect: add a.txt',
];

const NOT_SHIP_DOCS = [
  'docs(readme): fix a typo',
  'Updates docs to reflect: add a.txt',
  'Add a thing',
];

// The docs subject /ship is told to write, read from its SKILL.md, so the
// template there and the matcher cannot drift apart unnoticed.
function shipDocsSubjects() {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'ship', 'SKILL.md'), 'utf8');
  // The subject is the first line of the code block after step 6's
  // "Commit with the message format:".
  const after = skill.slice(skill.indexOf('Commit with the message format:'));
  const template = /```\n(.+)\n/.exec(after)?.[1];
  assert.ok(template, 'ship SKILL.md step 6 shows no docs commit subject');
  const filled = template.replace(/<[^>]+>$/, 'add a.txt');
  if (!filled.includes('(<scope>)')) return [filled];
  return [filled.replace('<scope>', 'a'), filled.replace('(<scope>)', '')];
}

module.exports = { SHIP_DOCS, NOT_SHIP_DOCS, shipDocsSubjects };
