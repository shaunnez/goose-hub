#!/usr/bin/env bash
# Safely remove merged agent worktrees and their local branches.
#
# Safety rules (a worktree/branch is only removed when ALL hold):
#   1. Branch is fully merged into main (reachable from main tip)
#   2. Branch exists on origin (was pushed — not the sole copy)
#   3. Working tree has no uncommitted changes (tracked or untracked)
#
# Crashes, open PRs, closed-without-merge PRs, un-pushed branches → untouched.

set -euo pipefail

MAIN="${MAIN_BRANCH:-main}"
WORKTREES_DIR=".claude/worktrees"

cd "$(git rev-parse --show-toplevel)"

# Sync remote state; ignore failures (offline is fine — we just skip the pushed check)
git fetch --prune --quiet 2>/dev/null || true

# Clean up git's internal references to already-missing worktree directories
git worktree prune

if [ -d "$WORKTREES_DIR" ]; then
  for wt_path in "$WORKTREES_DIR"/*/; do
    [ -d "$wt_path" ] || continue

    branch=$(git -C "$wt_path" rev-parse --abbrev-ref HEAD 2>/dev/null) || continue
    [[ "$branch" == "HEAD" ]] && continue
    [[ "$branch" == "$MAIN" ]] && continue

    # Rule 1: merged into main?
    git merge-base --is-ancestor "$branch" "$MAIN" 2>/dev/null || { echo "  keep $branch (not merged)"; continue; }

    # Rule 2: pushed to origin?
    git ls-remote --heads origin "$branch" 2>/dev/null | grep -q . || { echo "  keep $branch (not pushed — sole copy)"; continue; }

    # Rule 3: clean working tree?
    if [ -n "$(git -C "$wt_path" status --porcelain 2>/dev/null)" ]; then
      echo "  keep $branch (dirty working tree)"
      continue
    fi

    echo "  remove worktree: $wt_path  (branch: $branch)"
    git worktree remove --force "$wt_path"
  done
fi

# Delete local branches that are merged into main AND exist on origin
git branch --merged "$MAIN" \
  | grep -v "^\*" \
  | grep -v "^\s*$MAIN\s*$" \
  | while IFS= read -r raw_branch; do
      branch="${raw_branch#"${raw_branch%%[![:space:]]*}"}"  # trim leading whitespace
      [ -z "$branch" ] && continue

      # Rule 2: only delete if pushed — if branch was never pushed it's the sole copy
      git ls-remote --heads origin "$branch" 2>/dev/null | grep -q . || continue

      echo "  delete branch: $branch"
      git branch -d "$branch"
    done || true

git worktree prune
echo "cleanup done"
