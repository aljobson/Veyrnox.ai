# Environment setup

Use only these existing Supabase projects:

| APP_ENV | Project ID | Region |
| --- | --- | --- |
| staging | yrqzwqywxfesmbvhzjgj | us-east-2 |
| production | xdxdzmsztyzbnzeforxx | eu-central-1 |

The other two Veyrnox databases belong to another product and must not be touched. `packages/security/environments.js` is the public identity allowlist. Publishable keys are safe client configuration; backend keys remain separate secrets. `readConfig` rejects mismatched project/key/issuer settings and remote Supabase URLs in development. Custom Supabase domains require a reviewed allowlist change.

Development: `npm run dev` defaults to local identity at `http://127.0.0.1:54321`; set matching SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and PUBLIC_HOST for a real local Auth instance. The fallback public key is deliberately non-functional, so an unconfigured local build cannot sign in against a remote project.

Production: the existing protected workflow builds with APP_ENV=production and deploys the unchanged default `veyrnox-ai` target. Its existing provider/R2/payment secrets and feature flags are preserved. A manual/offline production build is `APP_ENV=production npm run build`; this builds code only and contacts no database. Ensure any secondary Workers Builds configuration also sets APP_ENV=production before adopting this commit.

Staging: build with APP_ENV=staging and PUBLIC_HOST set to the actual staging HTTPS origin, then use the named staging target for the same build. The repository does not invent a deployed staging URL. Supply staging-only provider, R2, callback and backend secrets. Cron is disabled in the staging config. Do not reuse production payment keys, provider keys, R2 credentials or bucket. Verify the bucket identity and public-access settings before enabling uploads.

New project APIs remain disabled until TENANT_PROJECTS_ENABLED=true after migration 0134 and checks. The local integration runner accepts only localhost/loopback and a disposable database named `rebuild_check` or ending in `_test`; it cannot address any Supabase project.

Environment selection covers identity and deployment configuration. It cannot prove that an operator pasted the right R2/provider/payment secret. Deployment verification must validate those resources and prevent reuse; no claim is made that this source change provisioned or audited them.
