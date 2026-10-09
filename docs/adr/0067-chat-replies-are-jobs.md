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
   (Amendment 9 adds: a reply that was delivered is charged even when it cannot be stored.)
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

## Amendment 9 2026-10-09: a delivered reply is charged, stored or not

Status: **Proposed**. The owner accepts it by merging the change. Found by the 2026-10-09 audit (finding M-01).

Point 4 charges for text the user received. One case did not follow it: the reply had streamed to the screen, but
`chat_complete_turn` answered that the messages could not be stored, and the turn ended uncharged. The rule is now the same
everywhere: **text that was delivered is charged. Deleting the chat does not undo the charge.**

- When `chat_complete_turn` answers that the messages cannot be stored (the chat no longer exists, or the text is refused), the
  turn calls `chat_settle_unsaved_turn` (migration 0233). It moves the job `SUBMITTED` -> `STORED`, writes no message and no
  ledger row (the debit was taken when the turn started), and records `error_code = 'reply_not_saved'` on the job so the
  record shows why a charged reply has no messages. Replaying it changes nothing. `ledger_refund` refuses a `STORED` job and
  the sweep does not select one, so the charge stays.
- The stream ends with `error: reply_not_saved` and `credits_charged` equal to the price, and the screen says the Credits were used.
- A reply longer than a stored message (32,000 characters) is delivered in full and stored cut to that length, instead of
  failing to save.
- A message containing a character the database cannot hold, or nothing but whitespace and control characters, is refused
  (`invalid_text`) before any Credits move. Characters that cannot be held are taken out of the stored copy of a reply, and
  a reply with nothing left after that counts as nothing produced (refunded).
- A reply that used a free allowance (ADR-0069) follows the same rule: it is settled at 0 Credits and the allowance stays used.

Unchanged: nothing produced is refunded; a reply the provider cut off is refunded and is never settled this way; and when the
database gives no answer at all (an outage, or the request cut short) the job stays `SUBMITTED` and the 120-minute sweep
refunds it, which is the safe direction for the user when the fault is ours.

**Order.** The Worker may deploy before 0233 is applied: the settle call then fails and that turn ends as it did before this
amendment. The rule takes effect once the migration is applied through the `apply-migrations` workflow. The stored-reply cut
and the message check need no migration and apply as soon as the Worker deploys.

## Amendment 10 2026-10-09: a reader who leaves is a Stop, and the turn is still finished

Status: **Accepted 2026-10-09**, the owner merged it (pull request 693). The staging check below was run the same day.

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
seconds and the text so far was saved as `canceled`; a reader who stayed saw no difference.

Checked on staging with this change deployed (2026-10-09), using the screen's own Stop button. A short reply stopped at its first
words and a long reply stopped a second and a half into its text were each stored as `canceled` with the text so far, their jobs
`STORED` and charged, 0.3 and 0.1 seconds after Stop.

Not changed: the screen reloads the chat the moment Stop is pressed and can be a moment ahead of the save. A short retry there is a
screen change with its own browser check.

## Amendment 11 2026-10-09: a send can be asked about by its own key, and closed

Status: **Accepted 2026-10-09**, the owner merged it (pull request 774). Migration 0242 was applied to production the same day
through `apply-migrations`, and `CHAT_SEND_CLOSE_ENABLED` was set to `"true"` in production that day on the owner's word, without
the 24-hour wait between a migration and its flag. Staging followed the same evening: 0242 applied there, then the switch.

The chat screen keeps a warning when a message ended with its turn not settled ("If a reply is still saved, it will show in this
chat and use Credits"). Since pull request 764 it keeps the reply's job id with the warning and reads that job when the chat is
opened. Two warnings could still not be settled, and stayed long after their turns had in fact been refunded:

1. **Stop before `start`.** No job id ever reached the browser. Reading the chat cannot settle it either: a chat that does not
   show the turn cannot tell "refunded" from "still running" or "charged, not stored".
2. **One warning for two turns.** A chat keeps one warning. A second message that also ended unsettled takes the first one's
   place, and one job cannot answer for both, so no job was kept with it.

**What the browser has.** The send's idempotency key. It is made in the browser before any request, the debit is unique on
`(user_id, idempotency_key)`, and the debit is what makes the job. The key is now kept with the warning when there is no job id.

**What "no job for this key" means.** Nothing, on its own. A request the browser gave up on can still be debited a moment later,
so "no job" can stop being true. No time limit makes it final either: the Worker waits 8 seconds for a database call and a call
that answers later is not seen, so there is no bound the server can promise. It is final only when the database says so in the
same step that makes it so:

- `chat_close_send(auth id, key)` (migration 0242), behind `POST /api/v1/chat/sends/close`. It returns the job that send made,
  in the shape of the job read. Or, when the send made none, it records the key in `chat_closed_sends` and answers
  `closed: true`.
- From then on the database refuses to make a chat job for that person and key. A `BEFORE INSERT` trigger on `jobs` raises,
  which undoes the whole debit that was making the job: `ledger_debit` and `submit_free_job` insert the job before they write
  anything else. Nothing is charged, no allowance is used, and the turn answers `409 send_closed` to a reader who has gone.
- The close and the debit take the same per-key advisory lock and hold it to the end of their transaction, so for one key
  exactly one of them wins: a debit that came first is found by the close, and a close that came first is seen by the trigger.
  This rests on READ COMMITTED, the level the API runs every call in and the one the ledger's lock-then-read functions are
  written for. `chat_close_send` answers nothing under any other level, and a database test fails if a function on this path
  is given one.

Closing is what the person asked for: a key with no job id is only ever kept for a message they stopped.

The trigger is in the database and not in the Worker, so the rule holds whichever version of the Worker makes the debit. It
refuses only a chat reply's job (`inputs.kind = 'chat'`, as 0193 and 0233 read it). `chat_close_send` closes only a key in the
shape the browser makes (`vx-` and a UUID), so no key the server derives for its own jobs can be closed. A replay of a send that
made a job never reaches the insert and is unchanged.

**Several turns under one warning.** The warning keeps every turn it stands for, each as a job id or a key, four at most. Past
four it keeps none, is never asked about, and stays until a later message is saved, as before this amendment: dropping the
oldest would let the listed four settle a warning that still stands for a fifth. The same when it takes the place of a warning
that had nothing to ask by. Every turn is asked about each time the chat is opened, and nothing changes until all of them have a
final answer. (A later message from the chat that is saved still forgets the warning, as it always has. Keys kept with it are
then not closed.)

One turn is stored in the notice itself, as pull request 764 stored it. Several are stored in a record of their own beside the
notice, and the notice carries only a tag the record repeats. A page still running pull request 764's code reads a notice of 120
characters at most: with the list inside the notice it would read nothing, show no warning and forget it at the next send. Kept
this way it reads the same warning with nothing to ask by, which is what that code kept for two messages itself.

| All of them together | The warning | The box |
|---|---|---|
| None used Credits (refunded, or closed) | removed, nothing said | unchanged |
| One was charged and could not be stored | becomes "We could not save that reply to the chat..." | emptied only of a message that is now in the chat |
| Some were saved, and a saved message had been given back to the box | replaced by a notice (below) | emptied only while it still holds exactly a saved message |
| Some were saved, none of them given back | removed, nothing said: the chat shows each reply and its price | unchanged |

For one turn the notice is the one pull request 764 added. For several it is: "Some messages here ended before we knew if they
were saved. Each reply that was saved now shows in this chat with its price. A message that does not show here used no Credits."
It does not say "you do not need to send that message again", because the box can then hold a message that was not saved.

**Limits.** The route is counted against the shared job-read quota (0115) inside the database call. A closed key is kept for 30
days and at most 200 are kept per person; past that, closing is refused and the warning stays. Thirty days is longer than any
request can wait: it carries an access token the gateway refuses once expired (Supabase allows at most 7 days), and the turn's
steps before the debit are bounded in seconds.

**Not chosen.** Sending the job id before the debit (the debit makes the id, and Stop can come before any response). A read of a
job by key with a waiting time after Stop (not final, as above). The check inside `ledger_debit`, or a wrapper the chat turn calls
in its place (the first rewrites the function every debit goes through, which two other changes replaced on 2026-10-09; the
second holds only for Workers that call the wrapper). A placeholder row in `jobs` for a closed key (it would show in job lists,
counts and the 10-per-minute limit).

**Order.** The Worker may deploy before 0242 is applied. The route then answers `503 send_close_not_open` (the switch is
`"false"`), the screen reads that as no answer, and a warning for a message stopped before its reply started stays as it did.
After the migration is applied through the `apply-migrations` workflow, the switch is turned on by a change to `wrangler.jsonc`.
The trigger refuses nothing until a key is closed, and nothing closes a key while the switch is off.

The switch covers only asking by key. A warning for several messages that each have a job id needs no migration: it is settled
by job reads, as one message has been since pull request 764, from the moment the Worker deploys.

Unchanged: every ending of a turn, the price, the refund paths and the sweep. A dropped connection before `start` (as opposed to
Stop) still gives the message back as "not sent" and keeps no warning. (Amendment 12 changes that.)

## Amendment 12 2026-10-09: a send that got no answer before `start` is asked about at once, and warned about when the server cannot say

Status: **Proposed**. The owner accepts it by merging the change. Browser only: no server change and no migration. It asks
through the route of amendment 11, whose switch has been on in production and staging since 2026-10-09.

Amendment 11 left one ending as it was: a connection that drops before `start`, when the person did not press Stop. The screen
ended it as a message that never started. The text went back to the box with an ordinary notice, and a chat made for the message
was deleted. But the request can be at the server all the same. The server takes a reader that has gone as Stop (amendment 10):
it debits, usually finds no text and refunds, and in a narrow window saves text and charges. The person then held the same
message in the box with nothing on screen saying that its first send may still be charged. And when a chat had been made for the
message, deleting it turned a reply that was saved a moment later into one that was charged and not stored.

**Which failures can mean the request is at the server.** Only what happens to the message's own request, once it has gone out:

| What the browser saw | May the server hold the send? |
|---|---|
| The request failed with no answer (`fetch` rejected) | Yes. The browser cannot tell "never left" from "arrived, and the answer was lost" |
| A reply stream began and broke, or ended with no event of ours that could be read in it | Yes: the server answers with a stream only after the debit |
| An answer with no `error` of ours and a status that is not 4xx (an edge or proxy error page, a Worker that failed) | Yes: nothing in it says the turn did not run |
| A refusal that names itself (`error` in the body), whatever its status | No. No reply runs after one. Two come after the debit (`provider_submit_failed`, `debit_failed`): the turn has ended, and the refund or the sweep returns the Credits |
| A 4xx with no `error` | No: made in front of the turn (the edge, a proxy, no such route, body too large) |
| No session, an image that could not be read or uploaded, a chat that could not be made, a key that could not be made | No: the message's request never went out, even when that step itself failed with no answer |
| Stop, wherever in the request it lands | Its own ending (amendment 11). That now includes Stop while an answer that is not a stream is still being read, which was the general refusal |

`sendTurn` raises the first three as one error, `send_unanswered`. Before `start`, that error alone starts what follows. After
`start` it is the stream that broke, as before.

**What the screen does.** It asks the server about the send by its key, at once, with the route of amendment 11 and the limit of
the ask made when a chat is opened (2 seconds). The button says Checking meanwhile.

| The server says | The ending |
|---|---|
| The send made no job, and its key is now closed | The turn never started and never can: the ending it always had. The text goes back, a chat made for it is deleted, and the notice is the general one |
| The job the send made, and the turn settles within the look (3.5 seconds) | The Credits moved. It ends exactly as a stream that broke after `start` does: saved (the chat shows it and its price), charged and not stored, or nothing kept (text back, "no Credits were used") |
| Nothing final: the browser is still offline, the route refuses (the limit on closed keys, its switch off), no answer in 2 seconds, or the job it named is not settled when the look ends | The message goes back to the box **with** the warning "The connection dropped before the reply finished. It may have used Credits. Check this chat before you send again.", kept beside the text with the send's key. A chat made for the message stays |

The third row is Stop before `start`'s ending with a dropped connection's words. Its warning is settled when the chat is next
opened, as amendment 11 settles a stopped send: closed or refunded removes it and leaves the text; saved shows the reply and its
price, takes the unchanged message out of the box and leaves "The connection dropped before the reply finished. This chat shows
what was saved and the Credits it used."; anything not final changes nothing. No new words were written.

A job that is found and not settled is in that row too, kept by the send's key and not by the job. Nothing of the reply was
ever on screen, and such a job may end saved or refunded: left on screen as sent, a refunded message would be in neither the
chat nor the box. The key finds the same job when the chat is opened. The send counts as not over from the moment the server
is asked until it says "closed", so anything that goes wrong while it is asked ends in that row as well.

If the chat page was left before the send ended, the message is stored in its chat's draft beside the warning. (Stop before
`start` drops the text of a page that was left. That was decided before a notice could be stored, and is not changed here.)

**Closing a key the person did not stop.** Amendment 11 closed a key only for a message the person stopped. Here the screen
closes the key of a send whose request got no answer and made no job. That is what makes "That didn't work. Try again." true:
if the request arrives late, the database refuses its job and nothing is charged. Without the close the screen could only say
"may".

**What is kept.** The warning's code is `connection_lost`, which pages on older code already read as a warning. A mark of the
message's text is kept with it only when it is kept by the send's key, with no job id: that is the ending above, the one where
a dropped connection puts the message back. Kept by a job id, the message was left on screen as sent, as before. A page still
on the code of amendment 11 reads the same warning and asks by the same key, without the mark: if that send turns out saved,
that page removes the warning and leaves the message in the box beside the saved reply. It needs two tabs across the deploy.

**Cost.** When the server cannot be asked, the warning is said for every send whose request got no answer. That includes the
common case where the device was offline and the message never left it: the browser cannot tell those apart. It is settled when
the chat is next opened with the network back (no job, the key closed: the warning goes and the text stays), or it goes when a
later message from that chat is saved, as any warning does. Were the route's switch turned off again, every such send would end
with the warning and none would be settled by its key.

A chat made for the message stays, empty, whenever the server can say nothing final. The limit of amendment 11 (200 closed keys
per person in 30 days) now also counts sends nobody stopped; past it closing is refused and such warnings stay until keys age
out. And a warning lists four turns at most: a fifth send in one chat that the server cannot be asked about leaves a warning
that is never asked about, and stays until a later message from that chat is saved.

**Not chosen.** Keeping the warning without asking (it would warn of Credits after every blip on a working network, and keep an
empty chat each time, when the server can say at once that nothing was sent). Storing the text and the warning before the ask
and correcting them from the answer (a saved turn would then have its text in the box until the correction lands). A new
warning code with words of its own (a page still on older code would read it as an ordinary notice
and forget it at the next send). Reading `navigator.onLine` to decide the message never left (it is false by the time a request
that did leave is seen to fail).

Unchanged: a stream that breaks after `start`, every refusal, the price, the refund paths and the sweep. Two endings are left
as they were and are the same kind of gap. A replay (the browser resends a request whose connection died, and the resend is
answered `replay: true` while the first copy runs with no reader) still reads the chat again, says nothing, and forgets a
warning kept for the message before. And a reply stream that ends cleanly after `start` with no `done` still ends as a reply
that was sent. Until the look for the turn has ended (up to 5.5 seconds here, as after Stop) nothing is stored, so a page
reloaded in that time keeps neither the message nor a warning; and text typed into the box in that time is replaced when the
message goes back, as after Stop.

## Not decided here

- Which models, and their prices. Needs live endpoint checks and the margin validator. (Three were chosen
  and priced on 2026-10-05; seven premium rows are staged inactive by 0196 awaiting owner prices.)
- Attachments, voice input, assistants, sharing links. Each needs its own cost story.
- ~~Whether Free Credits (10) should be spendable on chat.~~ Decided 2026-10-05: they are, because they are Credits.
- ~~A per-user daily cap on web search.~~ Decided 2026-10-05: none. The buyer pays the extra Credits, which are priced above the
  recorded worst case, the 10-per-minute limit applies, and spend is bounded by the account's Credits.
