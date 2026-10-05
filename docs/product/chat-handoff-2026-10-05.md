# Chat handoff (2026-10-05)

Branch `claude/replica-skill-install-6d58ee`. Nothing is pushed, nothing is applied to production, and the flag is off.
Design is ADR-0067 (Proposed). Read it first; this note is only state and next steps.

## Where it came from

A standalone prototype of a multi-model chat was built in `~/Documents/GitHub/veyrnox-ai-chat` (its own Next app,
its own Supabase project "veyrnox.ai studio staging", $10/month, ref `lxudnkzlnhlwqehaidkj`, its own ledger and
Stripe wiring). It was merged INTO this repo instead of shipped beside it: one ledger, one auth, one Stripe.
Only its UI behaviour is ported. The prototype's per-token meter, cookie auth and Supabase project are not carried over.
The prototype was built from public sources only (no logged-in walkthrough of Syntx or Higgsfield; their terms forbid it).

## Done and committed

| commit | what |
| --- | --- |
| `06afc56` | ADR-0067, migration `0193_chat.sql` (tables, 8 definer functions, `list_user_jobs` excludes chat), `scripts/test-chat-turns.mjs`, wired into `ledger-tests.yml` |
| UI commit (this one) | `/app/chat` screen, `lib/chatMarkdown.js` (safe reader, no dependency, no raw HTML), nav entry behind the preview switch, `CONTEXT.md` glossary, `CHANGELOG.md`, this note |
| `ad64499` | `lib/chat.js`, `lib/chatTurn.js`, `lib/chatRoute.js`, `packages/adapters/openrouterChat.js`, routes under `app/api/v1/chat/`, `CHAT_ENABLED` in `wrangler.jsonc`, text models excluded from `lib/publicCatalog.js`, 38 tests |

Verified: the full CI chain (26 existing `scripts/test-*.mjs` plus the new one) passes on a fresh 183-migration replay; the repo's
whole `node --test` suite passes (1,348 tests, 0 failures); `npm run lint` has 0 errors; `next build` and `opennextjs-cloudflare build`
both succeed (no dependency was added).
Not done: the screen has not been exercised in a browser against a signed-in session, there is no Playwright e2e for it, and no real
provider call has been made (no text model is active).

## Not done

1. **The screen is built; it still needs a browser pass.** Sign in on staging, set `localStorage.veyrnox_chat = '1'`, set `CHAT_ENABLED`
   to `"true"` in the staging env, activate one text row, then walk: send, stop, refund on failure, pin/rename/delete/search, instructions,
   copy, mobile drawer. Built as: `app/veyrnox/app/chat/` (page + layout), components under `app/veyrnox/_components/chat/`, in the `vx-*` design
   system (see `credits/page.js` for the conventions), signed in through `getFreshAccessToken` (streaming needs the raw token, so it
   cannot use `gatewayFetch`; copy its 401 handling). A nav entry in `NavBar.js` behind the preview switch `localStorage.veyrnox_chat === '1'`
   (pattern: `useProjectsPreview`). Markdown: a small safe renderer (paragraphs, fenced code with copy, inline code, bold, lists), no new
   dependency and no raw HTML (the CI grep gate forbids it). Behaviour to port from the prototype: streaming with Stop, pin/rename/delete/
   search, per-chat instructions, copy reply, cost shown in Credits before sending, "No Credits used" after a failed reply.
2. **Docs**: `CONTEXT.md` glossary (Chat Thread, Chat Reply; avoid "token" for Credits), `CHANGELOG.md`, `docs/product/APP-FLOW.md`/`UI-UX.md` rows.
3. **Operator work, owner only**: choose text models, insert catalog rows with `active = false`, verify each OpenRouter slug live,
   price `credits_5s` so `provider_cost_per_unit` (worst case at 1,024 reply tokens and 24,000 history characters) clears the ADR-0014
   margin floor (`packages/catalog/margin-validator`), then activate and set `CHAT_ENABLED` to `"true"` on staging first.
4. **ADR-0067 acceptance** by the owner.

## Re-running the database checks locally (no Docker)

See the memory note "local-postgres-for-acceptance-tests". Short version: embedded Postgres with `-c timezone=UTC` and a short socket dir,
`pg@8.13.0` and `tsx@4.19.2` installed in a scratch directory with its own `package.json`, a fresh database each time, then
`DATABASE_URL=... node scripts/replay-migrations.mjs` and `node scripts/test-chat-turns.mjs`. Running `replay-migrations` twice on
the same database fails ("cannot change return type of existing function"): drop and recreate it first.

## Owner decisions this surfaced

- **Credit economics differ from the prototype.** Veyrnox.ai prices a reply as whole Credits from the catalog (about 1.5 cents of
  provider spend per Credit), so a cheap reply costs 1 Credit; the prototype's 0.1-cent Credit and 100 Free Credits do not apply.
- **Free Credits (10, expiring in 90 days) are spendable on chat.** Reserve them for media instead if you prefer.
- **The prototype's Supabase project** ($10/month) is no longer needed once this ships. Pausing or deleting it is the owner's call.
- **Naming the model's maker** in the picker versus "the provider is never named to the user" (UI-UX.md section 8): the ADR says
  model name and price only.
