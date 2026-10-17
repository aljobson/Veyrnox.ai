# Staging deploy: build, verify, deploy

Staging is deployed by hand. The one thing that goes wrong silently is the **build environment**.

## Why the guard exists
`next.config.mjs` inlines `APP_ENV`, `SUPABASE_URL` and the public Supabase settings into the bundle **at build time**. Without `APP_ENV=staging` the build targets local development and bakes in `http://127.0.0.1:54321`. Such a bundle deploys without any error, the website still loads, and then the Worker's own database calls go to a raw IP address, which Cloudflare refuses (error 1003). On 2026-10-17 this left staging's `top_up_backfill` red for about 21 hours ([#908](https://github.com/aljobson/Veyrnox.ai/issues/908)); it was found only after the failure log gained the target host.

## Steps
1. From a clean checkout of `main`:
```bash
git checkout main && git pull
```
2. Build with the **full** staging environment (the publishable key is the public one in `wrangler.jsonc` under `env.staging.vars`):
```bash
APP_ENV=staging SUPABASE_URL=https://yrqzwqywxfesmbvhzjgj.supabase.co \
NEXT_PUBLIC_SUPABASE_URL=https://yrqzwqywxfesmbvhzjgj.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging publishable key from wrangler.jsonc> \
PUBLIC_HOST=https://veyrnox-ai-staging.al-jobson.workers.dev npm run build:worker
```
3. **Verify** the bundle before deploying. Exit 0 means it matches staging; 1 means it does not (or cannot be checked), and it prints the rebuild command:
```bash
npm run verify:baked-env -- staging
```
4. Deploy:
```bash
npx wrangler deploy --env staging
```
5. Rollback if needed: `npx wrangler deployments list --env staging`, then `npx wrangler rollback <version-id> --env staging`.

## Notes
- The Worker may hold at most 128 text bindings (plain vars plus secrets); `tests/wranglerBindingBudget.test.mjs` warns before that limit.
- The check looks at what the build baked in: the client code must hold only staging's project, no server file may carry the quoted local address, and the middleware's baked environment must be `staging`. It fails closed: if a future bundler change hides the middleware pattern, it refuses and says so; update `scripts/verify-baked-environment.mjs`.
- The production build sets `APP_ENV: production` in `.github/workflows/deploy-production.yml`; `npm run verify:baked-env -- production` can check a production bundle the same way. It is not wired into that workflow yet.
