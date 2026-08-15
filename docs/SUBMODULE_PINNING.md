# Submodule pinning

This repo consumes three third-party packages as git submodules:

- `packages/Vibe-Workflow`         (workflow-builder)
- `packages/Open-Poe-AI`           (ai-agent)
- `packages/Open-AI-Design-Agent`  (design-agent)

Each submodule is pinned to a specific commit recorded in the superproject
index. That pin — not a floating branch — is what ships. `scripts/verify-submodules.sh`
runs in CI (`.github/workflows/verify-submodules.yml`) and fails the build if
any submodule is uninitialised, dirty, or drifted from the recorded commit.

## Why pin

`file:` workspaces + submodules with no version pin means a fresh
`npm run setup` on a new machine (or a CI runner that fetches with
`origin/main`) can pull a newer commit than what the last successful build
used. That silently changes shipped code without a PR review.

## Bumping a submodule

Prefer bumping to an **immutable tag** when the upstream publishes one:

```bash
cd packages/<Submodule>
git fetch --tags origin
git checkout <tag-or-sha>
cd ../..
git add packages/<Submodule>
git commit -m "chore(deps): bump <submodule> to <tag-or-sha>"
```

If the upstream does not tag releases, pin an **exact commit SHA** — never
`origin/main` or a branch name. Include the upstream commit summary and the
reason for the bump in the commit body.

Open the resulting PR; CI will re-run `verify-submodules.sh` on the new pin.

## First checkout on a new machine

```bash
git submodule update --init --recursive
```

`npm run setup` runs the equivalent, but if a workspace complains about a
missing package the submodules are the first thing to check.

## When CI fails on this check

Either:

1. You forgot to commit the submodule bump — `git add packages/<Submodule> && git commit`.
2. Someone pushed a submodule commit directly to a submodule branch without
   updating the superproject pin — re-pin from a known-good commit.
3. A dirty working copy leaked in — `git submodule foreach 'git status'` and
   clean up.
