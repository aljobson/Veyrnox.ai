# ADR-0015 — Legacy MuAPI studio extraction

- **Status**: Accepted (2026-09-12)
- **Date**: 2026-09-12
- **Deciders**: Product owner (sole)
- **Related**: [ADR-0007 — Legacy Muapi proxy deprecation](0007-legacy-muapi-proxy-deprecation.md), [ADR-0000 — Product strategy](0000-product-strategy.md), `CLAUDE.md` HARD WALL

## Context

`packages/studio` was the MuAPI-era generative studio: thirteen studio surfaces
(image, video, audio, clipping, lip sync, cinema, marketing, workflow, agent,
apps and others) mounted at `/studio`, `/workflow`, `/agents` and `/assistant`
through `components/StandaloneShell.js`, and served by catch-all proxies at
`/api/agents/*`, `/api/app/*` and `/api/workflow/*`.

It is a different product from Veyrnox.ai on every axis that matters:

- **Billing.** It is a bring-your-own-key client. Requests authenticate with the
  caller's own `__Host-muapi_key` cookie and bill the caller's MuAPI account.
  No ledger entry, no debit, no margin, no refund path.
- **Catalog.** It carried its own 31,000-line `models.js` listing models we do
  not sell — the source of the Seedance and MiniMax H3 references that kept
  surfacing in sweeps of this repo.
- **Dependencies.** It pulled three third-party submodules (`Vibe-Workflow`,
  `Open-Poe-AI`, `Open-AI-Design-Agent`) into the build, plus four npm
  workspaces, purely to serve routes no Veyrnox surface links to.

ADR-0007 already retired the `/api/v1/*` passthroughs on those grounds. This ADR
finishes the job for the front-end and its remaining proxies.

## Options considered

### A. Leave it in place

- Effort: zero.
- Cost: the HARD WALL keeps a hole. A MuAPI credential surface stays in a repo
  with no other use for one, the submodules stay in every CI checkout and
  Workers build, and every catalog sweep keeps turning up models we do not sell.

### B. Delete it outright

- Effort: ~2 hours.
- Cost: the code survives only in this repo's history. Recovering a runnable
  copy later means reconstructing scattered paths from a range of commits.

### C. Extract to its own repository, then delete

Filter the legacy paths into a standalone repository with their history intact,
then remove them here.

- Effort: ~3 hours.
- Cost: one more repository to own.

## Decision

**Option C.** Extracted to the private repository `aljobson/veyrnox-legacy-studio`
on 2026-09-12 from commit `a78a090`, with 88 commits of history for those paths
preserved via `git filter-repo`, plus a README recording provenance and the fact
that it is an archive rather than a runnable app.

Removed from this repo in the same change:

- `packages/studio` and the three submodules, with their npm workspaces,
  the `studio` / `ai-agent` / `workflow-builder` dependencies, `axios`, the
  `build:packages` script chain and `transpilePackages`.
- Routes `/studio`, `/workflow`, `/agents`, `/assistant`.
- Proxies `/api/agents/*`, `/api/app/*`, `/api/workflow/*`, `/api/session/muapi`,
  `/api/upload-binary`.
- `components/StandaloneShell.js`, `components/ApiKeyModal.js` and the four
  `lib/` helpers used only by the above, with their tests.
- The `verify-submodules` workflow and its script, which had nothing left to
  verify.

## Consequences

- The four legacy routes now return 404. Nothing in this app linked to them and
  they were never in the sitemap, so no first-party surface changes.
- The `__Host-muapi_key` cookie is no longer read or written anywhere in this
  repo. That closes the last place a user's MuAPI credential touched this code.
- CI checkouts and Workers builds no longer clone three third-party submodules.
- The `/api/v1/*` passthroughs retired under ADR-0007 keep their 410 and Sunset
  headers until their 2026-09-26 date. They are self-contained and carry no
  MuAPI dependency, so they were left alone here.
- Anyone needing the studio back pulls it from the archive repository. Its
  submodules point at public upstreams that are not ours and may move.
