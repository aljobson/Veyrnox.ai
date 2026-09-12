#!/usr/bin/env bash
# Migration numbers must be unique within each schema directory.
#
# Two sessions numbered migrations independently on 2026-09-12 and produced
# five collisions (two files each at 0018, 0019, 0020, 0021, 0022). Because
# `scripts/migrate.mjs` applies files in filename order, a duplicate number
# makes the replay order ambiguous — and the database's own migration list
# shows one of each pair as applied, so the gap is invisible at a glance.
# Four security migrations sat unapplied for a day behind exactly that.
#
# The number is the apply order. Never reuse one, never renumber a file that
# has already been applied anywhere; always take the next free number.

set -uo pipefail

DIRS=(
  "packages/db/schema"
  "packages/db/schema/supabase"
)

status=0

for dir in "${DIRS[@]}"; do
  [ -d "$dir" ] || continue

  # Numeric prefixes of the .sql files directly in this dir (not recursive).
  prefixes=$(find "$dir" -maxdepth 1 -name '[0-9][0-9][0-9][0-9]_*.sql' \
    -exec basename {} \; | cut -c1-4 | sort)

  [ -n "$prefixes" ] || continue

  dupes=$(echo "$prefixes" | uniq -d)
  if [ -n "$dupes" ]; then
    status=1
    next=$(printf '%04d' $(( 10#$(echo "$prefixes" | tail -1) + 1 )))
    for n in $dupes; do
      echo "ERROR: $dir has more than one migration numbered $n:"
      find "$dir" -maxdepth 1 -name "${n}_*.sql" -exec basename {} \; | sed 's/^/         /'
    done
    echo ""
    echo "  Give the one that has NOT been applied yet the next free number"
    echo "  in $dir ($next or higher). If both are already applied, number"
    echo "  them in the order the database actually ran them — check the"
    echo "  Supabase migration list, not the commit dates."
  fi
done

if [ "$status" -eq 0 ]; then
  echo "migration numbering OK"
fi

exit "$status"
