# ADR-0067 — Dated, dev-only exceptions to the dependency audit gate

- **Status**: **Proposed 2026-10-03.** Accepted when the owner merges it.
- **Date**: 2026-10-03
- **Deciders**: Product owner
- **Related**: `scripts/check-audit.mjs`, `scripts/audit-exceptions.json`,
  `.github/workflows/ci.yml` (`build-test`), `CLAUDE.md` (OWASP 6), ADR-0023

## Context

`build-test` ran `npm audit --audit-level=high`, and `main-protection` requires
`build-test`. `deploy-production` deploys a commit only when `ci` is green on it.

On 2026-10-03 the audit began failing on every commit: advisory
GHSA-vfj7-8cjw-p6xm (high, denial of service through deeply nested patterns)
covers `braces` <= 3.0.3, and 3.0.3 is the latest release. There is nothing to
upgrade to. `npm audit fix` offers only `tailwindcss` 4, a major version this
project's Tailwind 3 configuration does not build under.

`braces` is installed only beneath dev dependencies: `tailwindcss` 3 (through
`chokidar`, `micromatch` and `fast-glob`) and `@next/eslint-plugin-next`
(through `fast-glob`). `npm audit --omit=dev` reports nothing. The patterns it
expands come from `tailwind.config.js` and the ESLint config, not from a user.

The effect was total: no pull request could pass `build-test`, and the deploy
of #448 was refused, so `main` was no longer deployable.

## Options considered

1. **Wait for a fixed `braces`.** No date exists. `main` stays undeployable.
2. **Audit production dependencies only (`--omit=dev`).** One line, but it stops
   auditing every build tool for good, and build tools run in the deploy job
   next to `CLOUDFLARE_API_TOKEN`.
3. **Migrate to Tailwind 4 now.** A site-wide styling change, and not enough on
   its own: `@next/eslint-plugin-next` would still install `braces`.
4. **A named, dated exception for this advisory.** Chosen.

## Decision

`scripts/check-audit.mjs` replaces the bare `npm audit` call. It fails on every
high or critical advisory, as before, unless all of these hold:

- the advisory is listed in `scripts/audit-exceptions.json` by GHSA id and
  package, with a written reason and an expiry date;
- the expiry is no more than 90 days away and has not passed;
- the advisory does **not** appear in `npm audit --omit=dev`. An exception can
  never cover something a production dependency pulls in.

An invalid entry excepts nothing. Output that is not a readable audit report
fails the gate (exit 2); it is never read as clean. An exception within 7 days
of expiry prints a CI warning, and an entry that no longer matches anything is
reported so it gets removed.

The first entry is GHSA-vfj7-8cjw-p6xm for `braces`, expiring 2026-11-02.

## Consequences

- `main` can merge and deploy again, and every other advisory is gated exactly
  as it was.
- On 2026-11-03 the gate fails again unless `braces` has shipped a fix, the
  Tailwind 4 migration has removed it, or the owner renews the entry. That is
  intended: an exception is a deadline, and renewing one is a decision.
- Adding or extending an entry changes the security gate, so it goes through a
  pull request like any other change to it.
- The entry goes when `braces` ships a fix, or when neither Tailwind nor the
  Next ESLint plugin installs it. Tailwind 4 alone does not remove it.
