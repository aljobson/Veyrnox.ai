# ADR-0067 — Chat: a reply is a job, priced per reply from the catalog

- **Status**: **Accepted 2026-10-05.** Product owner approved as proposed, no changes. Ships `off`: `CHAT_ENABLED`
  is `"false"`, and no text model is active until its endpoint is verified live. The flag still needs its own
  yes per environment.
- **Date**: 2026-10-05
- **Deciders**: Product owner (sole)
- **Related**: [ADR-0014 — Floor pricing](0014-floor-pricing.md) (the margin a reply price must clear),
  [ADR-0013 — Credit expiry policy](0013-credit-expiry-policy.md), [ADR-0064 — Core subscriptions](0064-core-subscriptions.md)
  (the spend order a reply debit inherits), [ADR-0060 — CSP rendering decision](0060-csp-rendering-decision.md) (no change needed),
  `CONTEXT.md` ("Chat Thread", "Chat Reply"), `CLAUDE.md` ("Money & billing": the catalog is normative for
  pricing, every debit path has a refund path).

## Context

Veyrnox.ai sells images, video and audio. It has no text model. Competing aggregators (Syntx, Higgsfield) put
language models next to media tools, and a separate prototype of a multi-model chat was built against a
per-token meter. That meter breaks this repo's rule that **the catalog is normative for pricing and the app
layer never computes a price**, and it brings a second ledger. This ADR folds chat into the existing money
spine instead.

## Decision

1. **A Chat Reply is a job.** One user message produces one `jobs` row through the existing `ledger_debit`,
   so the Free / Subscription / Pack spend order, freezes, idempotency and the 10-per-60-seconds limit apply
   unchanged. No new ledger path, no new bucket.
2. **The price is a whole number of Credits per reply, read from `model_catalog`.** Text models use the
   existing `credits_5s` column as "Credits per reply" (the column name is historical; a reply is the unit).
   The price is shown before sending. Nothing is metered per token.
3. **The price is only safe because both ends are capped.** A reply is capped at `MAX_REPLY_TOKENS` (1,024)
   and the history sent is capped at `MAX_HISTORY_CHARS` (24,000). `provider_cost_per_unit` for a text row is
   the worst case at those caps, so the ADR-0014 margin floor holds for the most expensive reply a user can buy.
4. **Failure refunds, nothing else is clever.** The debit happens first. Nothing produced (provider refused,
   dropped, or the user stopped before the first character): `job_failed` and `ledger_refund`, no messages stored.
   Provider cut-off after partial text: the partial text is kept, the job fails and the Credits are refunded
   (a failed reply refunds, as everywhere). The user pressing Stop after text appeared keeps the text and is
   charged: they received the work and chose to end it.
5. **A chat job ends in `STORED`, never `SUCCEEDED`.** `sweep_stuck_jobs` turns a `SUCCEEDED` job with no row
   in `assets` into `FAILED` and refunds it after 60 minutes. A reply has no asset, so a new function,
   `chat_complete_turn`, writes both messages and moves the job `SUBMITTED` -> `STORED` in one transaction.
   A turn that dies mid-way is caught by the existing `SUBMITTED` sweep (120 minutes) and `DEBITED` sweep
   (15 minutes) like any other job.
6. **Chat data is reachable only through `SECURITY DEFINER` functions keyed by `p_auth_id`**, the pattern
   newer features use. Tables have RLS enabled and forced, no policies, and no grants to browser roles or the
   service role. A second user can read nothing because no read path accepts anyone else's id.
7. **The media route cannot run chat models and the chat route cannot run media models.** Text rows carry
   provider `openrouter-chat`; `/api/v1/generations` has no provider by that name (`provider_unsupported`),
   and the chat route requires `modality = 'text'`.
8. **Chat jobs stay out of the Library.** `list_user_jobs` excludes jobs whose `inputs.kind` is `chat`. The
   job row stores `{kind, thread_id}` and never the message text.
9. **Models ship inactive.** No text row is inserted by this migration. An operator adds rows with
   `active = false`, verifies the OpenRouter endpoint live, then activates them (CLAUDE.md: "a model is only
   `active = true` when its `provider_endpoint` has been verified").
10. **Web search is out of scope.** It costs extra per request, so it cannot sit inside a flat reply price.
    It would be a separate priced option under its own ADR.
11. **The model provider is never named to the user** (UI-UX.md section 8). The picker shows the model's
    name and its price per reply, never OpenRouter.
12. **Flag and preview.** `CHAT_ENABLED` (`wrangler.jsonc` vars, `"false"` in production) hides the route
    and the page. A per-browser preview switch, `localStorage.veyrnox_chat`, lets the owner see it on
    staging first, as with Social Cinema and Projects.

## Consequences

- No second ledger. The Free Credits, expiry, freeze, refund and reconcile machinery already covers chat.
- A cheap model's reply is priced at the 1-Credit floor, so the cheapest chat reply costs more than its
  token cost by design; the margin on a 1-Credit reply is high, and the owner may decide to sell it as a
  loss leader. That is a catalog decision, not code.
- Replies cannot be longer than the cap. Long-form output would need a second, higher-priced model row.
- A user who stops a reply early after text appeared is charged the full price. This is stated next to the
  Stop button's behaviour in the UI copy and is the one place a user can feel the flat price.
- `jobs` grows by one row per reply. At the 10-per-minute limit that is bounded, and the rows carry no text.
- The standalone prototype's per-token meter, cookie auth and separate Supabase project are not carried over.
  Its UI behaviour (streaming, search, pin, rename, delete, markdown) is ported onto the Veyrnox design system.

## Not decided here

- Which models, and their prices. Needs live endpoint checks and the margin validator.
- Attachments, voice input, assistants, sharing links. Each needs its own cost story.
- Whether Free Credits (10) should be spendable on chat. They are, because they are Credits; the owner may
  prefer to reserve them for media.
