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
    (Superseded by amendment 4: the preview switch is gone and `CHAT_ENABLED` is the only control.)

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

## Amendment 2026-10-05: a row may set its own reply cap and reasoning effort

Status: **Accepted 2026-10-05**, owner approved in chat, including the seven staged rows' prices. Ships with migration 0196; every staged row stays inactive until its own activation migration.

A live check against OpenRouter showed that every model accepts a `reasoning: {effort}` setting, that
reasoning arrives in separate stream fields (`reasoning`, `reasoning_details`) and never in `content`, and
that reasoning tokens are billed and count toward `max_tokens`. With the fixed 1,024-token cap a model that
thinks can spend the whole cap and return nothing. So:

- `model_catalog` gains `chat_max_reply_tokens` (256 to 8,192) and `chat_reasoning_effort` (`none`,
  `minimal`, `low`, `medium`, `high`), both NULL by default. NULL keeps today's behaviour: a 1,024-token cap
  and no reasoning setting. Both are only allowed on `text` rows (a CHECK constraint).
- The price stays flat per reply. `provider_cost_per_unit` is the worst case of one reply: 9,000 input tokens
  plus the row's full cap. Real replies cost far less, so margin on a typical reply is higher than the floor.
- The adapter sends `reasoning` only when the row sets a valid effort; the turn runner and the models route
  read the cap through one function, `replyBudget`, which falls back to the defaults on anything out of range.
  Reasoning text is never shown or stored.
- Seven premium rows are staged inactive. Their prices are the owner's decision.

## Amendment 2 2026-10-05: Thinking and Web search are priced options

Status: **Accepted 2026-10-05**, owner approved in chat, including the extra prices on the three live and seven staged rows. Ships with migration 0197.

The price stays flat per reply and still comes only from `model_catalog`. A row now carries an extra price for
each option it offers, and a reply costs the row's base Credits plus the extra for each option the user turns on.
The app looks these numbers up and adds them; it never derives a price from cost or tokens.

- **Thinking**: effort `high` and a larger reply cap (up to 8,192 tokens). The extra covers the added output.
- **Web search**: OpenRouter's web plugin, 3 results. A live check showed a $0.0200 search fee and about 12,700
  extra input tokens. The extra covers the fee plus 16,000 input tokens at the model's rate.
- A row offers an option only when all of its columns are set; asking for one it does not offer is refused
  (`option_unavailable`, 409) before any money moves. Both options can be on together; the extras add.
- Each extra has its own recorded worst-case cost, and a CHECK refuses an extra priced under the margin floor
  (`credits >= ceil(cost / 0.01796)`). Recorded costs round up.
- The job records the options chosen (`inputs.options`), never message text. A failed reply refunds the full
  price including the extras, as before.
- Pages a web search used are appended to the stored reply as a short list of http(s) links (at most eight),
  skipped on a stopped reply or if they would exceed the stored-reply limit. Reasoning text is never shown or stored.
- Not decided here: Free Credits on options (they are Credits, so they apply), per-user daily caps on web search.

## Amendment 3 2026-10-05: one platform line at the head of every chat

Status: **Accepted 2026-10-05**, owner took the recommendation.

The reply screen shows plain text and markdown, not typeset maths. GPT models write working in LaTeX, so it appeared as raw
symbols. Every chat now starts with one system line, `PLATFORM_INSTRUCTION` in `lib/chat.js`: "Write mathematics in plain text.
Do not use LaTeX or dollar-sign delimiters." It is joined, in a single system message, to the user's own thread instructions
when they have any (a single message because not every provider accepts several). The user's text comes after it, so their
instructions still apply: a live check with "Answer in French" was obeyed. The line is about 20 tokens, inside the rounding
already in the recorded worst-case costs, and a test caps its length. It is not shown to the user and not stored in the thread.

## Amendment 4 2026-10-05: open to every signed-in user

Status: **Proposed**, held until the owner opens chat. The owner accepts it by merging that change.

The per-browser preview switch (`localStorage.veyrnox_chat`, `useChatPreview`) is removed. Chat is a normal tab, like Explore,
Create and Library, for every signed-in user, and `CHAT_ENABLED` is the single control. With the flag off the API answers
`chat_not_open` and the workspace says "Chat is not open yet", so turning chat off is one reviewed change to the production vars
and a deploy (about three minutes), with no per-browser state to chase. Before this merges: the privacy notice covers chat and
images (draft in `docs/product/chat-privacy-wording-draft.md`), the OpenRouter key is confirmed separate and capped, and the owner
has used chat on production.

## Amendment 5 2026-10-05: folders

Status: **Proposed**. The owner accepts it by merging the change.

A person can group chats into folders, as Syntx's Projects tab does, without the heavier idea of a project: a folder has a name and
nothing else (no shared instructions, no files). Up to 50 per person, names unique ignoring case, 1 to 60 characters. Deleting a
folder keeps its chats and unfiles them. Moving a chat does not change its place in the recency order. They are called folders, not
projects, because Veyrnox.ai already has Projects (tenant workspaces for assets, ADR-0051) and the two are unrelated.

Storage follows the chat tables: `chat_folders` (0209) has forced RLS and no table grants, is reached only through five
`service_role`-only definer functions keyed by the verified auth id, and goes with the account (`ON DELETE CASCADE`).
`chat_threads.folder_id` is `ON DELETE SET NULL`, and `chat_list_threads` now returns it. Moving is `PATCH /threads/:id` with
`{folder_id}` alone (null unfiles); folders are `/api/v1/chat/folders`. No money path is touched: a folder name is never sent to
a model and never read by a turn. The screen hides every folder control when the folders endpoint is unavailable, so the code can
deploy before the migration without affecting chat. The data-export query includes each chat's folder name.

## Amendment 6 2026-10-05: the five premium models, a two-level picker and a settings panel

Status: **Proposed**. The owner accepts it by merging the change.

**Models.** Migration 0210 turns on the five rows staged since 0196: DeepSeek V4.1 Flash (1 Credit), Gemini 3.8 Flash (2), Grok 4.7 (3),
GPT-6.1 Sol (4) and Claude Opus 5.5 (7). Each was checked live on 2026-10-05 through the repository's adapter on its own row settings,
plain and with Thinking: every reply non-empty, and the Thinking answer to a sums puzzle correct on all five. The migration pins slug,
price, recorded cost, reply cap and reasoning effort, and fails unless exactly five rows change. Gemini 3.8 Flash took about 14 s to
start a Thinking reply, which is why Thinking stays optional. A new chat now opens on the cheapest model, ties settled by family
order, instead of the first by name (which would have been Opus).

**Picker.** Two levels, family then model, with a cost filter. The family is derived server side from the endpoint's prefix and only
the family comes back (`maker`, `maker_label`); the endpoint, cost and provider name never do. A cost tier is the base price per
reply: 1 Credit Low, 2 to 3 Medium, 4 and over High. The model in use always stays listed, whatever the filter.

**Settings panel.** The model controls, Thinking and Web search, and the instructions move out of the header and composer into a
right-hand panel of collapsible sections (a drawer below 1280 px) with Reset all and Open all, and an About panel that states the
price, reply length and the extra Credits for each option. Instructions can be written before the first message and are saved onto
the chat when it is created. The panel lists Code interpreter, Shell, Files, Charts and Deep research as "Not available yet": they
need a sandbox and agent runs and are not built.

No money path changes: prices, options and the ledger are untouched.

## Not decided here

- Which models, and their prices. Needs live endpoint checks and the margin validator. (Three were chosen
  and priced on 2026-10-05; seven premium rows are staged inactive by 0196 awaiting owner prices.)
- Attachments, voice input, assistants, sharing links. Each needs its own cost story.
- ~~Whether Free Credits (10) should be spendable on chat.~~ Decided 2026-10-05: they are, because they are Credits.
- ~~A per-user daily cap on web search.~~ Decided 2026-10-05: none. The buyer pays the extra Credits, which are priced above the
  recorded worst case, the 10-per-minute limit applies, and spend is bounded by the account's Credits.
