#!/usr/bin/env bash
# Mines the git history /savor's historical reviewer reads, in one call, so the
# reviewer runs no per-file loop of git commands that a worktree-isolation guard
# refuses.
#
# Usage: history.sh <file>...
#
# It runs in the current directory's repository and prints, in order:
#   repo: <top level>
#   shallow: true | false
#   then, per file, a `== <file> (<n> commits)` heading and either
#   `skipped: <reason>`, or four sections:
#     origin:     the first commit that touched it, with its body, followed
#                 through renames
#     inflection: up to 3 commits whose subject names a refactor, migrate,
#                 rewrite, rip out, flip, introduce, deprecate, split or merge,
#                 or whose body is over 5 lines, newest first
#     recent:     the last 10 commits
#     dormant:    `yes` when no commit, merges included, touched it in 90 days
#   then `overflow:` with the files past the cap.
#
# A file is mined when it has more than 10 commits, and at most 5 files are
# mined: those with the most commits. Fields are separated by the unit
# separator, 0x1f. Merges are left out except in the dormancy check. Exit 0, or
# 2 on a usage error or outside a repository.

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: history.sh <file>..." >&2
  exit 2
fi
repo="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "history: not in a git repository" >&2; exit 2; }
echo "repo: $repo"
echo "shallow: $(git rev-parse --is-shallow-repository)"

counted=""
for file in "$@"; do
  n="$(git rev-list --count HEAD -- "$file" 2>/dev/null || echo 0)"
  counted+="$n"$'\t'"$file"$'\n'
done

mined=0 overflow=""
while IFS=$'\t' read -r n file; do
  [ -n "$file" ] || continue
  if [ "$n" -le 10 ]; then
    printf '== %s (%s commits)\nskipped: %s\n' "$file" "$n" "$([ "$n" -eq 0 ] && echo 'no history at HEAD' || echo '10 commits or fewer')"
    continue
  fi
  if [ "$mined" -ge 5 ]; then overflow+=" $file"; continue; fi
  mined=$((mined + 1))
  printf '== %s (%s commits)\n' "$file" "$n"
  echo "origin:"
  git log --follow --reverse --no-merges --pretty=tformat:'%h%x1f%ad%x1f%an%x1f%s%n%b%n---END---' --date=short -- "$file" |
    sed -n '1,/---END---/p'
  echo "inflection:"
  git log --follow --no-merges --pretty=tformat:'%h%x1f%ad%x1f%s%n%b%n---END---' --date=short -- "$file" |
    awk -v RS='---END---\n' '
      { split($0, lines, "\n"); subject = lines[1]; body = 0
        for (i = 2; i in lines; i++) if (lines[i] != "") body++
        if (kept < 3 && (tolower(subject) ~ /refactor|migrate|rewrite|rip out|flip|introduce|deprecate|split|merge/ || body > 5)) {
          printf "%s---END---\n", $0; kept++ } }'
  echo "recent:"
  git log --max-count=10 --follow --no-merges --pretty=tformat:'%h%x1f%ad%x1f%s' --date=short -- "$file"
  echo "dormant: $([ -z "$(git log -1 --since=90.days.ago --format=%h -- "$file")" ] && echo yes || echo no)"
done < <(sort -t$'\t' -k1,1nr <<<"$counted")

echo "overflow:${overflow:- (none)}"
