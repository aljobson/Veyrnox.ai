# ADR-0353: Build the production Worker with webpack

Status: Implemented locally; production size calibrated on this checkout; CI and remaining pre-merge verification pending
Date: 2026-11-18

## Decision

Use `next build --webpack` for `npm run build`. Both passes of `build:worker`
use that script, including OpenNext's standalone build. `npm run dev` remains
`next dev`, using Turbopack. No route, data, authentication, ledger, CSP policy
or feature flag changes accompany this decision.

This implements the frozen `PLAN-WEBPACK-SWITCH.md`, SHA-256
`cdcfed0a66c4d90c1f67bd44d6eae8c0400486e226606cd92145f71ac8adba72`.
It authorizes no release. Independent review, deployment and merge remain
separate owner decisions.

## Evidence and limits

The work order reports sequential staging measurements in one colo using the
same source: the server function fell from 48.4 to 35.4 MiB, upload from
60,180 to 47,322 KiB, and isolates from 159 to 13 across 399 requests. Handler
survival changed from 0/24 to 24/24 per route kind, except one at 23/24.
Reused-isolate full-page TTFB was 0.13–0.20 s (median 0.16 s over 120 requests);
cold starts remained about 2.2 s. These are supplied staging observations,
not production results or measurements reproduced by this implementation.
The cause is unproven: size and other bundler differences both changed.

The installed Next CLI guide explicitly supports `--webpack`. Existing local
staging artifacts contain the compact webpack CSP function described by the
plan and a 37,087,675-character OpenNext handler. Their provenance was not
re-established with a fresh build in this task.

## Environment verification

Webpack retains the CSP builder's unused development URL branch in server
output. The verifier exempts only occurrences matching that known pattern
whose default equals the requested target. It checks every occurrence in both
server functions and middleware; development defaults, opposite-environment
defaults and stray local addresses fail. Client checks remain strict.

The former 25 MiB cutoff is removed. All supported JavaScript (including CJS),
JSON, HTML and text files are read in full. Text-file symlinks are resolved and
read only when they target a regular file inside the build directory. Dangling,
looping or out-of-tree text-file links fail explicitly, as do read failures and
disappearing subdirectories. Non-text links and directory links are skipped;
directory links are never traversed. The pattern starts at a
parameter delimiter to avoid repeated matching inside long bundled strings.
Regression fixtures cover webpack, multiple copies, stray addresses, oversized
clean/forbidden handlers through `readBundle` and the CLI, and inspection errors.

## Worker budget: measured on 2026-11-18

The budget is **48,500 KiB**. On 2026-11-18 the host (Claude) ran one
production-environment webpack build on this checkout, based on `1003315a8`
plus these changes. The larger measurement was **47,373.34 KiB** on disk
(upload: **47,373.23 KiB**), leaving **1,126.66 KiB** of headroom, approximately
the plan's 1,000 KiB. This was a local build, not CI; CI must confirm.
Both budget-pinning tests retain 48,500; pass/fail fixtures test both
measurements relative to the budget, including exact-boundary acceptance.

## Compatibility audit

- `tsx`, `jose` and `@supabase/supabase-js` are absent from root dependencies
  and direct imports in `app`, `components`, `lib`, `packages` and middleware;
  they are also absent as installed root packages. The historical bundler
  restrictions in CLAUDE.md stay in force. Introducing those packages was not
  tested, and webpack does not by itself prove those historical failures fixed.
- Deployment retention recursively copies `.next/static` files into
  `.open-next/assets/_next/static`, preserving current files. Asset extraction
  accepts `/_next/static/` paths and reads the `dpl` query value; neither it nor
  the workflow depends on Turbopack chunk filenames. `GITHUB_SHA` still supplies
  the deployment ID. No retention workflow change is needed by source inspection.
- Searching tests, scripts and workflows found no pinned Turbopack chunk names.
  The existing catalog-import test deliberately checks both bundlers' ignore
  annotations and remains applicable. Feature-QA's explicit `--webpack` flag
  is redundant with the new build script but still selects the same bundler.
- Deploy and Worker smoke timeouts are 20 minutes; build-test is 30 minutes and
  authenticated feature QA is 35 minutes. A fresh build duration has not been
  measured here, so CI must establish sufficient headroom.

## Local verification record

Host-reported results from 2026-11-18, before the round-1 symlink fix:

- Targeted tests: 20/20 passed.
- Full `npm test`: 9,628 tests, 9,621 passed, zero failed, seven skipped.
- `npm run lint`: zero errors, 334 existing warnings.
- `APP_ENV=production PUBLIC_HOST=https://veyrnox.ai npm run build:worker`,
  run under `with-build-slot` on this checkout: exit 0, webpack.
- `node scripts/verify-baked-environment.mjs production .open-next`: exit 0,
  all checks passed, including no baked local-development address and middleware
  built for production.
- `node scripts/check-worker-size.mjs`: exit 0;
  `Worker: 47373.34 KiB (Total Upload: 47373.23 KiB; files: 47373.34 KiB; budget: 48500 KiB)`.
- `node scripts/check-worker-size.mjs --wrapper`: exit 0;
  5,419.88 KiB inputs, 1,688.06 KiB bundled.

These host results establish local production calibration and full-suite results;
they are not CI results. The host will rerun the full proofs after this fix.

Round-1 fix verification on 2026-11-18: the requested targeted command
(`node --test tests/verifyBakedEnvironment.test.mjs tests/checkWorkerSize.test.mjs tests/templateSwapClipEmpty.test.mjs`)
exited 0: 24 tests passed, zero failed or skipped, including the new symlink cases.
The original budget-history comment block was checked verbatim against the
checkout's HEAD, and `git diff --check` passed. No Worker build or full-suite
rerun was performed in this fix round.

Round-2 fix verification on 2026-11-18: the same targeted command exited 0
with 25 passed, zero failed or skipped. This includes a synthetic 40 MiB
server file containing repeated `,x="development"` fragments and a forbidden
local URL, as well as the existing oversized and symlink cases.

A temporary timing instrument measured the existing production `.open-next`
without rebuilding it: 631 client files, 5,455 server files and two middleware
files, including the 37 MB handler. Both instrumented runs passed all checks.

| Measured phase | Before round-2 read fix | After round-2 read fix |
| --- | ---: | ---: |
| Total instrumented execution | 56.92 s | 9.07 s |
| `readBundle` (walking, opening and reading) | 56.62 s | 8.73 s |
| `readFileSync` calls within that phase | 55.47 s | 1.88 s |
| `readdirSync` calls within that phase | 1.08 s | 1.14 s |
| Environment checks | 0.27 s | 0.33 s |

The baseline checks spent 0.254 s in `includes`, 0.0047 s in `replace` and
0.0034 s consuming `matchAll`. The bottleneck was UTF-8 pathname reads in this
local runtime, so the fix reads every text file through one descriptor and
keeps the matching semantics unchanged. For in-tree text symlinks, containment
is checked before opening; `fstatSync` and `readFileSync` use the same descriptor,
closed in `finally`. Directory-link skipping is preserved. The assets scan
remains limited to `assets/_next/static` with the existing text extension filter;
large speech/vision assets elsewhere are not traversed.

A subsequent normal CLI run, timed with `/usr/bin/time -p`, completed in
**13.69 s wall time** (0.58 s user, 1.65 s system), exit 0, all production checks
passed. These are individual local measurements on the existing output, not CI
or production request latency. The host's earlier still-running-at-2:43 result
was not reproduced by this baseline; filesystem/cache conditions can differ.
No Worker build or full-suite rerun was performed in round 2.

Earlier implementation-session checks and restrictions (historical):

- Targeted frozen proof tests: 20 passed, zero failed or skipped.
- `readBundle` plus `checkBakedEnvironment('staging', ...)` passed against the
  complete existing staging output: 631 client files, 5,455 server files and
  two middleware files, including the large handler. This is not a new build.
- `npm run lint`: exit 0, zero errors and 334 warnings in unchanged source.
- `check-worker-size.mjs --wrapper`: passed; 5,419.88 KiB inputs and
  1,688.06 KiB bundled, with no forbidden inputs.
- Additional identity-header, admin Access, bundler-hook, catalog-import,
  site-health, retention and deployment-recovery tests: 325 passed; four
  deployment-recovery tests failed because localhost `listen` was denied
  (`EPERM`). No tests were weakened or skipped.
- ADR index validation and `git diff --check`: passed. Existing duplicate ADR
  number warnings are unrelated to the new, unused 0353 number.
- The exact combined proof command was attempted through `with-build-slot`
  and exited before execution with a lock-file `PermissionError`. That session
  could not run the full `npm test` suite or production build; the later host results above supersede
  those missing results. `check:capabilities` exited 1 with DNS
  `ENOTFOUND fal.ai`. Local browser/Worker checks require a permitted listener.
- Process listing and direct signaling were also denied by the sandbox;
  exploratory scans were interrupted through their own command sessions.
  No preview or task-owned background command remains running. No worktrees
  or dependency installations were created; other worktrees were preserved.

## Required before merge and rollout

Confirm the full proofs and production-environment build, baked-environment
verification, size and wrapper checks in CI after this fix. Run built-Worker
smoke, isolated and authenticated feature QA, capabilities, and the deployment
retention dry run.

Complete browser hydration/CSP checks on `/`, `/pricing`, `/models`, sign-in,
`/app`, `/app/create`, `/app/library`, the editor and Music, including another
locale. Verify local media decode/playback/export, Turnstile, passkeys, test
checkout, push/service workers, images, fonts, CSS and dark mode. Check auth and
identity headers, API 401s, admin Access, webhooks, cron, cache/ISR, guarded 404s
and OpenNext cache assets on the built Worker. Unit checks do not substitute
for these runtime checks.

Stage only with owner approval, record the previous staging version, repeat
browser and isolate-survival measurements, then roll staging back. Merge and
production deployment require explicit approval. Record the production version
before rollout and collect before/after curl TTFB and Wrangler CPU tables;
do not infer a production performance fix from the supplied staging results.

## Risks and rollback

Webpack changes chunking, CSS, module IDs, minification and bootstrap scripts.
Development uses a different bundler; webpack-specific faults can escape dev
testing. Browser verification and webpack CI are required mitigations. Real
traffic will reuse fewer isolates than a sequential client in one colo, and
cold-start latency remains. Build time and memory may increase.

Rollback by reverting this change (including the lower budget) and deploying
the previous bundler through the normal approved workflow. For an incident,
the owner may approve `wrangler rollback <recorded-previous-version-id>`.
No rollback, deployment, merge, push or commit is part of this implementation.
