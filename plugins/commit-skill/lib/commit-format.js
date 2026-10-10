'use strict';

// The commit message rules the commit gate and token-ledger share, so the two
// cannot drift apart: the gate admits /ship's docs commit by the subject the
// ledger recognises it by.

// /ship's doc step commits under this subject. The legacy prefix stays
// recognised so older ships still read the same. Loose on case, spacing, a
// breaking-change "!" and nested parens in the scope, since a model writes it.
const SHIP_DOCS_SUBJECT = /^(docs(\(.*\))?!?:\s*sync\s+with\s|update docs to reflect:)/i;

/** Whether `subject`, already taken from its message, is /ship's docs commit. */
function isShipDocs(subject) {
  return SHIP_DOCS_SUBJECT.test(subject || '');
}

/**
 * Whether `message` has a line starting with `Recipe:`, read as `grep
 * '^Recipe:'` reads it: lines end at "\n" only, and a comment line counts as a
 * line. The check is loose on purpose; a stricter one would copy /commit's
 * SKILL.md into a pattern the two then have to keep in step.
 */
function hasRecipe(message) {
  return String(message).split('\n').some((line) => line.startsWith('Recipe:'));
}

module.exports = { isShipDocs, hasRecipe };
