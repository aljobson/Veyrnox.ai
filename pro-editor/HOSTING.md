# Hosting the Pro editor child origin (ADR-0358)

Nothing here runs by itself and nothing is deployed from CI. These are the steps for the person
with the Cloudflare account. The agent that wrote this could not do them: Wrangler on the
development machine has an expired login, and creating DNS records is an owner action.

What gets created, and what it costs in blast radius:

| Thing | Name | Effect |
|---|---|---|
| R2 bucket | `veyrnox-pro-editor-site` | holds the built site (about 55 MB) |
| Worker | `veyrnox-pro-editor` | read-only server for that bucket; own name, no secrets, no bindings besides the bucket |
| DNS record | `pro-editor.veyrnox.ai` | created automatically by the Worker's custom-domain route in `pro-editor-host/wrangler.jsonc` |

It does not touch the main `veyrnox-ai` Worker, its routes, its Cloudflare Access rules or any
CSP. Until the app has a route and flag that frames it, the new hostname is only a static site
that refuses to run when opened directly.

## Steps

1. Log in (the stored token is from August and has expired):

   ```bash
   npx wrangler login
   ```

2. Build the site from the pinned zip. `--parents` must equal `ALLOWED_PARENTS` in
   `pro-editor-host/wrangler.jsonc` (the Worker refuses to serve if they differ):

   ```bash
   node scripts/build-pro-editor.mjs --zip /path/to/filmcraft-web-0.20.1.zip --out .pro-editor-dist --parents https://veyrnox.ai
   ```

3. Create the bucket, then see what would be uploaded (a dry run), then upload:

   ```bash
   npx wrangler r2 bucket create veyrnox-pro-editor-site
   node scripts/upload-pro-editor.mjs --dist .pro-editor-dist --bucket veyrnox-pro-editor-site
   node scripts/upload-pro-editor.mjs --dist .pro-editor-dist --bucket veyrnox-pro-editor-site --apply
   ```

4. Deploy the serving Worker. This is the step that creates the DNS record for
   `pro-editor.veyrnox.ai` and its certificate:

   ```bash
   cd pro-editor-host && npx wrangler deploy
   ```

5. Check it (the page must refuse to run when opened directly, and the headers must be ours):

   ```bash
   curl -sI https://pro-editor.veyrnox.ai/host.html | grep -i -E "^HTTP|content-security-policy|x-frame"
   curl -sI https://pro-editor.veyrnox.ai/fc/filmcraft_web_bg.wasm | grep -i -E "^HTTP|content-type|cache-control"
   curl -s -o /dev/null -w "%{http_code}\n" https://pro-editor.veyrnox.ai/manifest.json   # expect 404
   ```

   Expect: `host.html` has `frame-ancestors https://veyrnox.ai` and no `X-Frame-Options`; the wasm is
   `application/wasm` with an immutable cache; the manifest is not public.

## Updating or rolling back

A new FilmCraft release means a new pinned zip (update `pro-editor/pins.json` through a reviewed
change), then steps 2 and 3. The Worker reads `manifest.json` (cached for 60 s) and serves only
what it lists, so uploading files first and `manifest.json` last publishes the new build in one
step. To roll back, re-upload the previous build's `manifest.json`, or remove the Worker's route.

## Staging

The staging app host is a `workers.dev` address, which this child origin should not be framed
from. A staging child needs its own hostname and its own `ALLOWED_PARENTS`; do that when a staging
route for the Pro editor exists.
