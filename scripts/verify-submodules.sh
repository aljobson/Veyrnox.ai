#!/usr/bin/env bash
# Fail if any submodule is missing, dirty, or does not match the pinned commit
# recorded in the superproject index. Runs in CI and locally.
#
# Exit codes:
#   0  every submodule matches the pinned commit and is clean.
#   1  a submodule is missing, uninitialised, dirty, or points at a different commit.

set -euo pipefail

if [ ! -f .gitmodules ]; then
  echo "verify-submodules: no .gitmodules present; nothing to verify."
  exit 0
fi

# `git submodule status --recursive`:
#   " <sha> path (ref)"      => in sync
#   "-<sha> path"            => uninitialised
#   "+<sha> path (ref)"      => different commit than recorded (drift)
#   "U<sha> path"            => merge conflict inside submodule
status=$(git submodule status --recursive || true)

if [ -z "${status}" ]; then
  echo "verify-submodules: git reports no submodules."
  exit 0
fi

bad=0
while IFS= read -r line; do
  case "${line:0:1}" in
    "-")
      echo "DRIFT: uninitialised submodule -> ${line}" >&2
      bad=1
      ;;
    "+")
      echo "DRIFT: submodule commit does not match superproject pin -> ${line}" >&2
      bad=1
      ;;
    "U")
      echo "DRIFT: unresolved merge conflict inside submodule -> ${line}" >&2
      bad=1
      ;;
  esac
done <<< "${status}"

if [ "${bad}" -ne 0 ]; then
  echo "verify-submodules: FAILED. See docs/SUBMODULE_PINNING.md" >&2
  exit 1
fi

echo "verify-submodules: OK"
