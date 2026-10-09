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

Storage follows the chat tables: `chat_folders` (0210) has forced RLS and no table grants, is reached only through five
`service_role`-only definer functions keyed by the verified auth id, and goes with the account (`ON DELETE CASCADE`).
`chat_threads.folder_id` is `ON DELETE SET NULL`, and `chat_list_threads` now returns it. Moving is `PATCH /threads/:id` with
`{folder_id}` alone (null unfiles); folders are `/api/v1/chat/folders`. No money path is touched: a folder name is never sent to
a model and never read by a turn. The screen hides every folder control when the folders endpoint is unavailable, so the code can
deploy before the migration without affecting chat. The data-export query includes each chat's folder name.

## Amendment 6 2026-10-05: the five premium models, a two-level picker and a settings panel

Status: **Proposed**. The owner accepts it by merging the change.

**Models.** Migration 0211 turns on the five rows staged since 0196: DeepSeek V4.1 Flash (1 Credit), Gemini 3.8 Flash (2), Grok 4.7 (3),
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

## Amendment 7 2026-10-05: Web search worst cases, re-measured

Status: **Proposed**, and a price change the owner decides. It is held as a draft.

Amendment 2 recorded a Web search extra as a $0.02 search fee plus 16,000 input tokens at the row's rate. A live probe the same day
(12 searches on Claude Sonnet 5.5 and GPT-6 Luna) broke both numbers. The web plugin injected 12,417 to 49,862 input tokens per
search, and OpenRouter's documentation offers no setting that caps the injected text (it is billed as ordinary prompt tokens). The
plugin's own fee was not fixed either: $0.01 to $0.05 per search, in steps of $0.01, on both models. Sonnet searches cost $0.043 to
$0.161 against a recorded $0.0520, and Luna $0.022 to $0.033 against $0.0216. No reply lost money in that range, because the base
price also pays, but the extra alone fell below the 50% margin floor on heavy pages.

Migration 0212 records a new worst case for all ten rows: a **$0.06 fee** (the observed maximum plus 20%) plus **64,000 input
tokens** (the observed maximum plus about 28%) at each model's input rate, with Credits at the margin floor. It is a planning bound
from measurement, not a guarantee: the search text cannot be capped through the plugin, so a search that reads more than that is the
one case the flat price does not cover. Capping the text ourselves (our own search call, with each result cut to a fixed length)
would make the bound real and is the route for Deep research (ADR-0070), which cannot be priced honestly until then.

The Web search extra becomes: Opus 18, Sonnet 11, GPT-6.1 Sol 11, Grok 11, Gemini 7, DeepSeek 5, Llama 5, Ministral 5, Luna 4,
Mistral Small 4 (from 5, 3, 3, 3, 2, 2, 2, 2, 2, 2). A Luna reply with Web search goes from 3 to 5 Credits; a Sonnet one from 7 to 15.
The price still shows before Send. The alternative the owner may prefer is fewer results per search (two, not three), which lowers the
typical text but, being uncapped, not the bound.

## Amendment 8 2026-10-05: a capped search of our own

Status: **Proposed**. The owner accepts it by merging. Amendment 7 re-prices the OpenRouter web plugin from measured worst cases and
says the real fix is to cap the search text ourselves; this is that fix, in three steps that must land in order.

**Design.** Web search can run two ways, recorded per catalog row in `chat_web_engine`: `plugin` (today) and `capped`. The capped way
makes one call to Exa (`POST https://api.exa.ai/search`, a constant URL; the key is the Worker secret `EXA_API_KEY`) for the user's
message, asking for 3 results and at most 2,000 characters of text each (`contents.text.maxCharacters`), cuts the text again on our
side, and puts it after the user's message in that turn only, as untrusted quoted data with its source links, with a standing rule in
the system message (amended 2026-10-07: it began in the system message, where web text would carry system authority; Deep research always
kept it in the user turn). Nothing the page says can add a step or change
the price: the model gets a bounded block of text and answers. The worst case is then real: one search fee (read from Exa's own
`costDollars.total` on every call and kept on the job as `search_cost_usd`) plus at most 7,000 injected tokens at the model's rate
(7,000 characters at one token per character, the ceiling for any language), so the Web search extra falls back to 1 to 3 Credits.
Measured 2026-10-05 with the real key: Exa charged a flat $0.007 per search (3 results, about 6,000 characters), so the fee bound is
$0.011 (the dearest search x 1.5, rounded up).

**The search runs before the debit.** If the search fails or the key is missing, the answer is a typed error with nothing charged;
a reply is never charged for a search it did not get. The sources listed under the reply are the results the model was given.

**Price and engine change together.** `chat_web_engine` defaults to `plugin` everywhere (0213, additive: the release before it keeps
working). A later migration flips a row to `capped` and re-prices it in one statement, only after the capped search is live and its
cost measured with a key. A `capped` row with no search key configured does not offer Web search at all and refuses it before any
Credits move, so a low price can never be charged for the uncapped plugin. The code that reads the column ships only after 0213 is
applied in that environment.

**Order.** (1) 0213, (2) the code, (3) set `EXA_API_KEY`, measure, then the flip migration. Deep research (ADR-0070) builds on the
capped search and is not priced until step 3 has real numbers.

**Privacy.** The user's message text goes to Exa as the search query, as it already goes to the plugin's search engine through
OpenRouter. The privacy notice says Web search sends the question to a search service; it should name Exa before the flip.

## Amendment 10 2026-10-09: a reader who leaves is a Stop, and the turn is still finished

Status: **Proposed**. The owner accepts it by merging, after the staging check below. (Amendment 9 is the change in pull request 686.)

Point 4 says a reply stopped after text appeared is kept and charged. On the Worker that ending did not run as written. Pressing Stop
or closing the tab ends the response, but the Worker was not told: Cloudflare reports a disconnect only through `request.signal`, and
only when the `enable_request_signal` [compatibility flag](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)
is set. The response stream's `cancel()` is not called. So the turn went on as if the reader were still there, and finishing it leaned
on the time the platform allows a request after its reader has gone
([`ctx.waitUntil`](https://developers.cloudflare.com/workers/runtime-apis/context/), which OpenNext claims for every request).

Three changes make the stated ending the real one:

- `wrangler.jsonc` sets `enable_request_signal`, for every environment. The chat route already passes `req.signal` to the turn, so a
  disconnect now stops the provider and the turn finishes at once: text so far kept and charged, or nothing produced and refunded.
- The turn's work is handed to the request's own `waitUntil` (`lib/requestWaitUntil.js`). The save and the charge no longer depend on
  the response being open or on the framework holding the request. Finishing after a Stop is two or three database calls, well inside
  the platform's 30 seconds.
- A reader who had already left when the reply was about to start is treated as a Stop before the provider is called: no reply is
  asked for, no messages are stored and the Credits come back.

No ending changes. A database outage still leaves the job `SUBMITTED` for the sweep, as before. The flag is platform-wide: every
route's `request.signal` now fires on a disconnect. Only the chat turn and the bounded body readers listen to it; other handlers run
to their end as they did.

The Worker cannot tell a pressed Stop from a lost connection or a phone that suspends the tab. Each is a disconnect, and each now
ends the reply where it was: the reader keeps the text they had received, at the same price. Before, such a reply went on being
written unseen. Treating them alike is the decision the owner makes by merging; telling them apart would need the screen to say
which it was.

Checked on the local Worker runtime with the provider and the database faked (2026-10-09). Without the flag, a reader leaving 2
seconds into a 20-second reply was not noticed and the whole reply was saved as `complete`. With it, the provider stopped within 0.3
seconds and the text so far was saved as `canceled`; a reader who stayed saw no difference. Before merging: deploy the branch to
staging, send a message, press Stop after text appears, and confirm the reply is stored as `canceled` and its job is `STORED` within a
few seconds.

Not changed: the screen reloads the chat the moment Stop is pressed and can be a moment ahead of the save. A short retry there is a
screen change with its own browser check.

## Not decided here

- Which models, and their prices. Needs live endpoint checks and the margin validator. (Three were chosen
  and priced on 2026-10-05; seven premium rows are staged inactive by 0196 awaiting owner prices.)
- Attachments, voice input, assistants, sharing links. Each needs its own cost story.
- ~~Whether Free Credits (10) should be spendable on chat.~~ Decided 2026-10-05: they are, because they are Credits.
- ~~A per-user daily cap on web search.~~ Decided 2026-10-05: none. The buyer pays the extra Credits, which are priced above the
  recorded worst case, the 10-per-minute limit applies, and spend is bounded by the account's Credits.
