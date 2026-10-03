# ADR-0067 — Reviewed exceptions in the dependency audit gate

- **Status**: **Accepted 2026-10-03**
- **Date**: 2026-10-03
- **Deciders**: Product owner
- **Related**: CLAUDE.md "OWASP Top 10" item 6, `.github/workflows/ci.yml`,
  `scripts/check-audit.mjs`, `deploy-production.yml` (deploys only a commit whose `ci` is green)

## Context

CI ran `npm audit --audit-level=high`, and production deploys only a commit whose `ci` run is
green. On 2026-10-03 npm began reporting GHSA-vfj7-8cjw-p6xm against `braces` (<= 3.0.3, every
release, no fixed version). `main` went red on a commit that changed no dependency, and the
deploy of #448 was refused.

`braces` reaches this repo only through build tools: `tailwindcss` 3 (via `chokidar` and
`micromatch`) and `eslint-config-next` (via `fast-glob`). They expand glob patterns written in
our own config at build and lint time. The advisory is stack exhaustion from a deeply nested
pattern, so it needs an attacker-supplied pattern, and none reaches these tools.
`npm audit --omit=dev` is clean.

There was nothing to upgrade to. Tailwind 4 drops the dependency but is a breaking migration,
and the `eslint-config-next` path would remain.

## Decision

1. The gate is `scripts/check-audit.mjs`. It fails on every high or critical advisory, as
   before, except advisories listed in its `EXCEPTIONS` by GHSA id and package, each with a
   reason and a `reviewBy` date.
2. An exception covers build tools only. The script also audits with `--omit=dev`; an advisory
   that appears there blocks even when listed.
3. An exception stops working the day after `reviewBy`. Renewing it is a change someone makes
   on purpose after checking for a fixed version. The script warns in the last 7 days.
4. "Could not audit" exits 2 and fails the job. It is never a pass.
5. `--omit=dev` alone was rejected: `wrangler` and `@opennextjs/cloudflare` are
   devDependencies whose code builds and ships the Worker, and they must stay audited.
6. First exception: GHSA-vfj7-8cjw-p6xm (`braces`), review by 2026-11-02.

## Consequences

- `main` deploys again without lowering the bar for any other advisory.
- On 2026-11-03 CI fails for every branch until the `braces` exception is removed (a fixed
  version exists, or Tailwind 4 and a lint-config change removed the path) or renewed. That
  is intended: an exception nobody looks at again is how a gate rots.
- An exception whose advisory is no longer reported is printed as a notice, not a failure, so
  a fix landing upstream cannot turn `main` red.
