# Video agent: staging runbook (owner runs these; written 2026-10-08)

Nothing here is done. Every command is yours to run, because each one touches an account, a database or a secret.
Staging means: Worker `veyrnox-ai-staging`, database `yrqzwqywxfesmbvhzjgj` ("veyrnox.ai staging"). Never the production
project (`xdxdzmsztyzbnzeforxx`) and never the two other look-alikes ("veyrnox-STAGING (not production)", "Veyrnox PRODUCTION (live)").

## 1. Migration 0227 on staging

Supabase dashboard, project `veyrnox.ai staging` (yrqzwqywxfesmbvhzjgj), SQL editor: paste the whole of
`packages/db/schema/supabase/0227_video_agent_steps.sql` and run it. Then tell me, and I verify read-only.

## 2. Fly app and the runner  (DONE 2026-10-08 — app created and deployed; the firewall check passes 15/15 on the real machine)

```bash
brew install flyctl
```
```bash
fly auth login
```
```bash
cd ~/Documents/GitHub/veyrnox-montage-runner && fly apps create veyrnox-montage-runner-staging
```
```bash
cd ~/Documents/GitHub/veyrnox-montage-runner && fly deploy --no-public-ips=false --ha=false
```
Do NOT set secrets yet: the first deploy runs without them and the container will stop (no signing secret). That is fine; we need the machine only to prove the firewall in step 3. If `fly deploy` refuses to start the machine, that is the answer to the NET_ADMIN question: stop and tell me.

## 3. Prove the firewall on the real machine  (DONE — and the first design failed there; see SPEC section 8)

```bash
cd ~/Documents/GitHub/veyrnox-montage-runner && scripts/verify-on-fly.sh veyrnox-montage-runner-staging
```
Expect `10 PASS`. Any FAIL: do not continue, paste the output.

## 4. Secrets (typed by you, never pasted into chat)

Generate one shared signing secret and keep it in your shell only:
```bash
SECRET=$(openssl rand -hex 32)
```
Runner side:
```bash
cd ~/Documents/GitHub/veyrnox-montage-runner && fly secrets set -a veyrnox-montage-runner-staging RUNNER_SIGNING_SECRET="$SECRET" RUNNER_CALLBACK_URL="https://veyrnox-ai-staging.al-jobson.workers.dev/api/webhook/montage"
```
```bash
cd ~/Documents/GitHub/veyrnox-montage-runner && read -s "ANTHROPIC_API_KEY?Anthropic key: " && echo && fly secrets set -a veyrnox-montage-runner-staging ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"; unset ANTHROPIC_API_KEY
```
```bash
cd ~/Documents/GitHub/veyrnox-montage-runner && read -s "FAL_KEY?fal montage-runner key: " && echo && fly secrets set -a veyrnox-montage-runner-staging FAL_KEY="$FAL_KEY"; unset FAL_KEY
```

## 5. Worker side (staging) — read this before running anything

Facts checked 2026-10-08 (read-only): the live staging version `b5d0d1fd` (uploaded 11:44) is also the newest upload, so a secret edit will
not roll staging back. It is **older than PR #618** (merged 14:45), so staging has no montage routes until it is redeployed from main.
Staging is deployed by hand (`npx wrangler deploy --env staging`, as in the other staging runbooks), never by a workflow.

Order, and why: secrets first (newest upload is live, so safe), then one deploy of current main that also carries the staging-only flag
and the runner address as `--var`s (no config PR, nothing changes for production). Rollback is `npx wrangler rollback <version-id> --env staging`;
copy the current version id first (`npx wrangler deployments list --env staging`).

1. Generate the shared signing secret in your shell, set it on the runner and on the Worker (you never type or see it):
   `SECRET=$(openssl rand -hex 32)`; `fly secrets set -a veyrnox-montage-runner-staging RUNNER_SIGNING_SECRET="$SECRET"`;
   `printf %s "$SECRET" | npx wrangler secret put MONTAGE_SIGNING_SECRET --env staging`.
2. A different value for the plan ticket secret, Worker only: `printf %s "$(openssl rand -hex 32)" | npx wrangler secret put MONTAGE_PLAN_SECRET --env staging`.
3. Deploy current main to staging with the flag and the runner address as vars (`npm run build:worker`, then `npx wrangler deploy --env staging --var AGENT_VIDEO_ENABLED:true --var MONTAGE_RUNNER_BASE:https://veyrnox-montage-runner-staging.fly.dev`).
4. Check: `npx wrangler deployments list --env staging` shows the new version at 100%.

## 6. Staging row and test credits

Activate `video-agent` on staging only, and grant the test account credits with a written reason (ADR-0022 style). I prepare the exact SQL when you get here.

## 7. The real test

I run it with you watching: plan, approve, a finished video in the Library; then stop the runner mid-run and confirm exactly one refund and a clean `reconcile_balances()`.
