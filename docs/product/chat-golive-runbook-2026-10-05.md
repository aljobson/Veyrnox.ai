# Chat: going live in production (2026-10-05)

State when this was written: the chat code, migrations 0193 to 0201 and the models are on production; five models are active
(Claude Sonnet 5.5, GPT-6 Luna, Llama 4 Maverick, Ministral 14B, Mistral Small). `CHAT_ENABLED` is not set there, so every chat
route answers "not open" and no user can reach it. Staging has run all of it end to end. Nothing below is done yet.

Order matters: key first, flag last.

## 1. Create a separate, capped OpenRouter key (you, in OpenRouter)

Create a key named `veyrnox-chat-production` with a **credit limit you can afford to lose in a day** (for example $20). Do not reuse
the video key: it has no cap, and chat would share its spend. Production needs this key: with only the shared key, chat reports "not
configured" instead of spending it (`chatApiKey` in `lib/chat.js`). Staging keeps using the shared key.

## 2. Put the key on the production Worker (you paste the value; nobody else enters it)

A Worker secret edit deploys the newest *uploaded* version, which can be a branch preview, so follow the safe order from the
2026-09-13 incident. From a checkout that has `wrangler.jsonc`:

```bash
gh workflow run deploy-production.yml --ref main
```

Wait for that run to finish green, then, straight away:

```bash
npx wrangler secret put OPENROUTER_CHAT_API_KEY
```

(no `--env`: that is the production Worker, `veyrnox-ai`). Paste the key at the hidden prompt. Then check production still runs main:
compare the live version with the deploy you just made, and if they differ run `gh workflow run deploy-production.yml --ref main` again.

## 3. Switch the flag on (a reviewed change)

Merge the pull request that sets `CHAT_ENABLED` to `"true"` in the production vars (it is held as a draft until step 2 is done). The
nav entry and the page still sit behind the per-browser preview switch (`localStorage.veyrnox_chat = '1'`), so only a browser that
sets it can see chat. That is the staged rollout.

## 4. Test it on production, as yourself

In the browser console on veyrnox.ai: `localStorage.veyrnox_chat = '1'`, reload, open Chat. Send one message on a 1-Credit model, then
the same with Web search on. Afterwards, read-only: the job rows (`inputs.options`), the ledger debits, and that
`reconcile_balances()` and `reconcile_free_credits()` return no rows.

## 5. Open it to everyone (separate change)

Remove the preview switch (`useChatPreview` and the nav entry) once step 4 is clean. Until then no other user can see chat.

## Rollback

Set `CHAT_ENABLED` back to `"false"` (a reviewed change; deploys in about three minutes) or `wrangler rollback <version>`. The
migrations stay applied and are harmless with the flag off.

## Decisions taken on 2026-10-05 (recommendations accepted)

- **Free Credits can pay for chat.** They are Credits, ten per account, and the signup gate already limits who gets them.
- **No per-user daily cap on web search.** The buyer pays the extra Credits (priced above the recorded worst case), the 10-per-minute
  limit already applies, and spend is bounded by the Credits an account holds. Revisit if abuse shows up.
- **Plain-text maths** is a platform line on every chat (ADR-0067 amendment 3).
