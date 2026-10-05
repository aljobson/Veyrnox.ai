# Chat handoff (2026-10-05)

Branch `claude/replica-skill-install-6d58ee`. Nothing is pushed, nothing is applied to production, and the flag is off.
Design is ADR-0067 (Accepted 2026-10-05, as proposed). Read it first; this note is only state and next steps.

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
3. **Operator work, owner only**: three rows are staged inactive by migration 0194 (see "Candidate models" below). Still to do: verify each
   OpenRouter slug answers a live streamed request on staging, then activate (a row-count-asserted UPDATE migration, README pattern) and set
   `CHAT_ENABLED` to `"true"` on staging first. Premium models need adapter work first (below).
4. ~~ADR-0067 acceptance~~ done 2026-10-05.

## Candidate models

Prices from OpenRouter's public model list, read 2026-10-05; re-check before activating. Worst case per reply is 9,000 input tokens
(24,000 history + 4,000 instruction + 8,000 text characters) plus 1,024 output tokens. Floor: `credits >= ceil(cost / 0.01796)`
(`docs/pricing/50-percent-margin.md`). A typical reply is far cheaper, so real margin is higher than the floor.

**Staged by 0194 (no reasoning to manage):**

| Catalog id | OpenRouter slug | Context | Worst-case cost | Min Credits | Staged |
|---|---|---:|---:|---:|---:|
| `chat-llama-4-maverick` | `meta-llama/llama-4-maverick` | 1,048k | $0.0024 | 1 | 1 |
| `chat-ministral-14b` | `mistralai/ministral-14b-2512` | 262k | $0.0021 | 1 | 1 |
| `chat-mistral-small` | `mistralai/mistral-small-2603` | 262k | $0.0020 | 1 | 1 |

**Reasoning models: handled by migration 0196 (staged inactive, PR stacked on #529).** The text below explains why they were held back first.

**Held back: reasoning models.** The adapter sends no `reasoning` parameter and `max_tokens` (1,024) covers hidden reasoning too, so
a model that reasons by default can spend the whole cap thinking and return an empty reply (refunded, but a poor result). Before adding
any of these, the adapter needs to send a low-effort setting (OpenRouter's `reasoning` object; supported efforts differ per model) and
the reply cap needs a decision. Floors below use the same worst case, which still holds because `max_tokens` bounds reasoning:

| OpenRouter slug | Reasoning | Worst-case cost | Min Credits |
|---|---|---:|---:|
| `openai/gpt-6-luna` | optional, can be set to none | $0.0014 | 1 |
| `google/gemini-3.8-flash` | mandatory | $0.0106 | 1 |
| `deepseek/deepseek-v4.1-flash` | optional, on by default | $0.0039 | 1 |
| `qwen/qwen3.8-flash` | optional, on by default | $0.0018 | 1 |
| `anthropic/claude-sonnet-5.5` | mandatory | $0.0282 | 2 |
| `openai/gpt-6.1-sol` | mandatory | $0.0282 | 2 |
| `x-ai/grok-4.7` | mandatory | $0.0241 | 2 |
| `anthropic/claude-opus-5.5` | mandatory | $0.0565 | 4 |

Not priced: web search (the adapter has none) and image input.

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

## Staging builds (lesson, 2026-10-05)

`wrangler deploy` ships whatever `.open-next` already holds. A staging deploy needs a staging build first, with the
public staging values, or the browser code is built for local development and sign-in points at the wrong place:

```bash
APP_ENV=staging SUPABASE_URL=https://yrqzwqywxfesmbvhzjgj.supabase.co \
NEXT_PUBLIC_SUPABASE_URL=https://yrqzwqywxfesmbvhzjgj.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging publishable key from wrangler.jsonc> \
PUBLIC_HOST=https://veyrnox-ai-staging.al-jobson.workers.dev npm run build:worker
npx wrangler deploy --env staging
```

Check a build before deploying: its client chunks should name the staging project host and contain `"apple,google"`.
