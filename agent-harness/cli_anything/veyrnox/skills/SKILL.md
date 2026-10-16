---
name: cli-anything-veyrnox
description: Use the Veyrnox.ai CLI to estimate, create, track, list, and download AI media generations through the OAuth-secured Developer API.
---

# Veyrnox CLI

Use `veyrnox --json ...` for agent-facing calls. Never print or request the saved OAuth tokens.

## Authentication

Run `veyrnox auth status`. If it reports signed out, ask the user to complete `veyrnox auth login`; it opens the Veyrnox OAuth consent page and receives the result on a loopback callback.

## Safe generation workflow

1. Inspect models with `veyrnox --json models list`.
2. Estimate with `veyrnox --json generations estimate --model MODEL_ID [--duration SECONDS]`.
3. Show the returned `maximum_credits` to the user.
4. Create with the exact value: `veyrnox --json generations create --model MODEL_ID --prompt TEXT --confirmed-credits N`.
5. Poll with `veyrnox --json generations wait JOB_ID`.
6. Download with `veyrnox --json generations download JOB_ID --output PATH`.

Never guess or reuse an old price. A `409 credit_confirmation_mismatch` means estimate again. Use `--dry-run` when the user wants validation without spending credits. Keep the generated idempotency key for retries; provide `--idempotency-key` explicitly when a workflow may resume across processes.

## Other commands

- `veyrnox --json balance`
- `veyrnox --json generations list --limit 24`
- `veyrnox --json generations get JOB_ID`
- `veyrnox --json openapi`
- `veyrnox auth logout`

Pass model-specific controls with repeated `--input KEY=JSON_VALUE`. For referenced media, use `--source-asset SLOT=ASSET_ID --consent` only after the user attests their rights.
