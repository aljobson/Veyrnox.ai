# Video agent: staging runbook (owner runs these; written 2026-10-08)

Nothing here is done. Every command is yours to run, because each one touches an account, a database or a secret.
Staging means: Worker `veyrnox-ai-staging`, database `yrqzwqywxfesmbvhzjgj` ("veyrnox.ai staging"). Never the production
project (`xdxdzmsztyzbnzeforxx`) and never the two other look-alikes ("veyrnox-STAGING (not production)", "Veyrnox PRODUCTION (live)").

## 1. Migration 0227 on staging

Supabase dashboard, project `veyrnox.ai staging` (yrqzwqywxfesmbvhzjgj), SQL editor: paste the whole of
`packages/db/schema/supabase/0227_video_agent_steps.sql` and run it. Then tell me, and I verify read-only.

## 2. Fly app and the runner

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

## 3. Prove the firewall on the real machine

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

## 5. Worker side (staging) — the risky step

A secret edit deploys the newest uploaded version (memory: cloudflare-secret-edits-deploy-latest-upload). So:
1. Make sure the newest upload IS the version you want live on staging (main, with #618), then edit secrets.
2. Set, with `wrangler secret put <NAME> --env staging` from the repo root, typing or piping the value yourself:
   `MONTAGE_SIGNING_SECRET` (the same `$SECRET`), `MONTAGE_PLAN_SECRET` (a different `openssl rand -hex 32`),
   `MONTAGE_RUNNER_BASE` (`https://veyrnox-montage-runner-staging.fly.dev`).
3. Turn the flag on for staging only: edit `env.staging.vars.AGENT_VIDEO_ENABLED` to `"true"` in a PR, merge, let it deploy.
4. After: compare the live staging version's etag with the latest staging upload (`wrangler versions view <id> --json`). If they differ, redeploy.

## 6. Staging row and test credits

Activate `video-agent` on staging only, and grant the test account credits with a written reason (ADR-0022 style). I prepare the exact SQL when you get here.

## 7. The real test

I run it with you watching: plan, approve, a finished video in the Library; then stop the runner mid-run and confirm exactly one refund and a clean `reconcile_balances()`.
