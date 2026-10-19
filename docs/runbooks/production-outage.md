# Production outage runbook (veyrnox.ai)

One page. Worker name `veyrnox-ai`, domain `https://veyrnox.ai`. Steps marked **OWNER** touch production with the owner's Cloudflare login or token and are the owner's to run (or to approve in chat). Everything else is read-only or runs on a branch.

Order: **detect, identify, roll back, fix, after**. Roll back before you debug.

## 1. Detect

1. Run the public smoke test. Exit 0 healthy, 1 a check failed, 2 unreachable.
```bash
node scripts/check-site-health.mjs
```
2. Expect `GET /` 200 with "Veyrnox", and `GET /api/v1/health` **401** (anonymous). A 401 there proves the middleware and Worker are both up. A 500, or Cloudflare error 1101, on `/` or `/api/v1/health` is an outage.
```bash
curl -s -o /dev/null -w '%{http_code}\n' https://veyrnox.ai/api/v1/health   # want 401
```
3. `site-health.yml` runs the same check every 15 minutes and `deploy-production` runs it after each deploy; a failure opens a `deploy-failure` issue. Look there first:
```bash
gh issue list --label deploy-failure --state open
```
4. **OWNER** (read-only): watch the live log. Write the raw stream to a file, wait, stop, then filter. Piping straight into `jq` captured nothing; the tail needs about 14 s to connect; keep a watch under 7 minutes. The raw file holds request headers: delete it afterwards.
```bash
npx wrangler tail veyrnox-ai --format json > "$TMPDIR/raw.out" &
sleep 20; curl -s -o /dev/null https://veyrnox.ai/api/v1/health   # self-test: 401 should appear
sleep 40; pkill -f "wrangler.*tail veyrnox-ai"
jq -r '[.outcome, (.event.request.url // "" | split("?")[0]), (.event.response.status // "")
        , ([.logs[]?.message | if type=="array" then join(" ") else tostring end] | join(" | ")),
        ([.exceptions[]?.message] | join(" | "))] | @tsv' "$TMPDIR/raw.out" | head -40
rm "$TMPDIR/raw.out"
```
An exception such as `Unexpected loadManifest(...) call!` in every request means the build itself is broken, not a route.

## 2. Identify the cause

1. Which deploys ran, and what did they do. A run can be green yet **skipped** ("Still main's tip?" step makes older runs skip everything else), so read the `Deploy` and smoke steps, not the run conclusion:
```bash
gh run list --workflow deploy-production.yml --branch main --limit 15 --json databaseId,headSha,conclusion,createdAt
gh run view <run-id> --json jobs --jq '.jobs[] | {name, steps: [.steps[] | {name, conclusion}]}'
gh api repos/aljobson/Veyrnox.ai/actions/jobs/<job-id>/logs > "$TMPDIR/job.log"   # `gh run view --log` can come back empty
```
2. Find the last sha whose deploy **and** smoke both succeeded (call it `GOOD`), and the first that failed (`BAD`). Compare what changed in the dependency set across them:
```bash
git diff GOOD BAD --stat -- package.json package-lock.json
for sha in GOOD BAD; do echo "== $sha"; git show $sha:package-lock.json \
  | jq -r '.packages | to_entries[] | select(.key | test("^node_modules/(next|react|@opennextjs/cloudflare|wrangler)$")) | "\(.key) \(.value.version)"'; done
```
3. Suspect the three bundler traps first (CLAUDE.md): `tsx`, `jose`, `@supabase/supabase-js`, plus any **mismatched `next` / `@opennextjs/cloudflare` pair** (a Next release that adds a manifest the OpenNext patch does not inline fails at runtime, not at build).
4. Reproduce on the commit before touching production: `npm ci --legacy-peer-deps && npm run build:worker`, then grep `.open-next` for the error string.

## 3. Roll back

Do this as soon as step 2 shows the live version is bad and a good one exists. A rollback restores the Worker code only: migrations stay applied, and `workers_dev` / `preview_urls` are not changed by it.

1. **OWNER** list what is live and what can be restored:
```bash
npx wrangler deployments list --name veyrnox-ai
npx wrangler versions list --name veyrnox-ai
```
2. **OWNER** restore a version that predates the break:
```bash
npx wrangler rollback <version-id> --name veyrnox-ai --message "rollback: <reason>, <sha>"
node scripts/check-site-health.mjs
```
3. **Old versions expire.** On 2026-10-19 the auto-rollback target was gone after hours of failed deploys and the rollback returned HTTP 400. So: whenever production is healthy and you are about to deploy, **write down the live version id** (`wrangler deployments list`) in the PR or the incident issue. If no listed version is good, go to step 4.
4. The workflow rolls back by itself after a failed smoke test only to the version it read before deploying. If that read already returned a bad version (consecutive failed deploys), it does not help; do it by hand.

## 4. Deploy a fix by hand (when deploy-production cannot run)

Use when the workflow refuses (for example it reads the live site first, or ci is red for an unrelated reason) and the owner has agreed. Build from the exact fixed commit, in a clean checkout.

1. Check out the fix and build the same way the workflow does:
```bash
git fetch origin && git checkout <fix-sha>
npm ci --legacy-peer-deps --no-audit --no-fund && npm run build:worker
```
2. Prove the bundle before it goes anywhere. The error string from section 2 must not be reachable, and the baked environment must be production:
```bash
npm run verify:baked-env -- production
```
3. **OWNER** deploy. This is what the workflow runs (it wraps `wrangler deploy` and uploads the cache assets):
```bash
npx opennextjs-cloudflare deploy
```
4. **OWNER** confirm the Worker is still private (ADR-0078). `workers_dev` and `preview_urls` must both be `false` in `wrangler.jsonc` on the commit you deployed; the check script reads the live setting back:
```bash
grep -nE '"(workers_dev|preview_urls)"' wrangler.jsonc    # both false
node scripts/check-workers-dev.mjs                         # exit 0 = off
```
5. Smoke test, retrying while the new version warms up:
```bash
node scripts/check-site-health.mjs
```
6. Then re-run `deploy-production` on `main` so main and production agree again: `gh workflow run deploy-production.yml --ref main`.

## 5. After the incident

1. Close or comment on the `deploy-failure` issue(s) with the cause, the bad and good shas, and the live version id now serving.
2. Record the good version id (step 3.3) and add an incident section below.
3. Check data is intact: a Worker outage leaves the ledger alone, but confirm the nightly reconciliation (`reconcile_balances()`, `reconcile_free_credits()`, `reconcile_top_ups()`) returned zero rows, and look for jobs stuck between debit and refund while the site was down.
4. Fix the gap that let it through (tests, a build-time check, a workflow guard) as its own PR, and write down which one is still open.
5. Rotate nothing unless a secret was exposed; an outage alone is not an exposure.

## Incident log

### 2026-10-19: next 16.4.2 with @opennextjs/cloudflare 1.20.8

- **Cause.** The dependabot bump #1311 moved `next` 16.3.8 to 16.4.2 while a follow-up commit pinned `@opennextjs/cloudflare` at 1.20.8 (1.20.12 failed two build-test query tests). Next 16.4's server calls `loadManifest(<distDir>/server/preview-props.json)` at startup; OpenNext 1.20.12 inlines that file, 1.20.8 does not. The Worker threw `Unexpected loadManifest(/.next/server/preview-props.json) call!` in the `NextNodeServer` constructor, so every page returned 500 / 1101. The build and unit tests passed; only the running Worker failed.
- **Timeline (UTC, 2026-10-19).** #1311 merged about 12:42. From then nine deploys built and went out, each failed smoke (`/` 500) and rolled back to version `2a41e9cd` (the last good build, from `4768d535`, 04:53). Several other runs were green only because they were skipped as not main's tip. That version expired; the next rollback got HTTP 400 and the broken build stayed live. The fix PR #1357 (revert of the bump) could not deploy because the workflow reads the live site first and the live site was down.
- **Recovery.** Revert to a consistent pair (next 16.3.8 / react 19.3.0). Fix PR: #1357.
- **Mitigations in sibling PRs.** A smoke test of the built Worker in CI (session `ci-worker-smoke`), a framework dependency policy so `next` and `@opennextjs/cloudflare` move together (`dependabot-framework`), and deploy workflow recovery so a down site and an expired rollback target no longer block a fix (`deploy-recovery`). This page is the manual fallback for all three.
- **Not the cause.** Cinema, i18n or app code: a docs-only commit failed the same way.
