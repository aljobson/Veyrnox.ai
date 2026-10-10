# Infrastructure records

Files here record settings that live outside the repo (Cloudflare dashboard or `wrangler`), so a change is reviewed like code.

## R2 bucket CORS

`r2-cors-veyrnox-ai-media.json` is the intended CORS rule for the production media bucket `veyrnox-ai-media` (EU jurisdiction).
Read the live rule with `npx wrangler r2 bucket cors list veyrnox-ai-media --jurisdiction eu`; apply with
`npx wrangler r2 bucket cors set veyrnox-ai-media --jurisdiction eu --file docs/infra/r2-cors-veyrnox-ai-media.json`
(production: the owner's word first; ADR-0028 amendment 2). The staging bucket `veyrnox-ai-staging-media` already carries the same
rule for its own origin.
