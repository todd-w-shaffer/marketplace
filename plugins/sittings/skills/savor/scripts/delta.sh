#!/usr/bin/env bash
# Builds the two deltas of /savor's delta pass in one call, so no session
# chains git commands that a worktree-isolation guard refuses.
#
# Usage: delta.sh <since sha> <spec sha> <spec> <out dir> [<path>...]
#
# It runs in the current directory's repository. It checks the pair first:
#   - `<since sha>` is an ancestor of HEAD;
#   - `<spec sha>`'s tree holds a file at `<spec>`.
# A pair that fails prints `full pass: <the check that failed>` and exits 3, and
# writes nothing.
#
# Otherwise it writes, into `<out dir>`:
#   spec-delta.diff   `git diff <spec sha> HEAD -- <spec>`, less each hunk whose
#                     changed lines all start with `**Status:`, because the
#                     caller rewrites the status line on every relaunch
#   code-delta.diff   `git diff <since sha> HEAD -- <path>...`, with `<spec>`
#                     left out; empty when no path is given
# and prints one line per file: `<name> <changed line count>`. A count of 0 is an
# empty delta. Exit 0, or 2 on a usage error.

set -euo pipefail

if [ "$#" -lt 4 ]; then
  echo "usage: delta.sh <since sha> <spec sha> <spec> <out dir> [<path>...]" >&2
  exit 2
fi
since="$1" spec_sha="$2" spec="$3" out="$4"
shift 4

if ! git merge-base --is-ancestor "$since" HEAD 2>/dev/null; then
  echo "full pass: $since is not an ancestor of HEAD"
  exit 3
fi
if ! git cat-file -e "$spec_sha:$spec" 2>/dev/null; then
  echo "full pass: $spec_sha holds no file at $spec"
  exit 3
fi

mkdir -p "$out"

# Drops each hunk whose added and removed lines all start with `**Status:`.
# A file header with no hunk left is dropped too.
git diff "$spec_sha" HEAD -- "$spec" | awk '
  function flush() {
    if (hunk != "" && !status_only) body = body hunk
    hunk = ""
  }
  /^diff --git / { flush(); if (body != "") printf "%s%s", head, body; head = $0 "\n"; body = ""; inhunk = 0; next }
  /^@@/ { flush(); inhunk = 1; hunk = $0 "\n"; status_only = 1; next }
  !inhunk { head = head $0 "\n"; next }
  {
    hunk = hunk $0 "\n"
    if ($0 ~ /^[+-]/ && $0 !~ /^[+-]\*\*Status:/) status_only = 0
  }
  END { flush(); if (body != "") printf "%s%s", head, body }
' > "$out/spec-delta.diff"

if [ "$#" -gt 0 ]; then
  git diff "$since" HEAD -- "$@" ":(exclude)$spec" > "$out/code-delta.diff"
else
  : > "$out/code-delta.diff"
fi

for name in spec-delta.diff code-delta.diff; do
  echo "$name $(grep -cE '^[+-][^+-]|^[+-]$' "$out/$name" || true)"
done
