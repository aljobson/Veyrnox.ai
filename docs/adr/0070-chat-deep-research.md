# ADR-0070 — Chat Deep research: a bounded, priced multi-step option

- **Status**: **Accepted 2026-10-05** (owner: "go with recommendation"). Nothing is built. Prices still need the live cost check below before any row offers it.
- **Related**: ADR-0067 (chat replies are jobs; a reply is one fixed price, safe because replies are capped), ADR-0067 amendment 2 (Thinking and Web search as priced options), ADR-0068 (image attachments), CLAUDE.md "Money & billing"

## Context

Syntx's LLM Studio has a **Deep research** toggle under the message box, and a capability flag for it per model (public UI and
front-end code). It turns one question into a researched, cited answer.

Our chat rests on one rule (ADR-0067): a reply has a **recorded worst-case cost**, so its price is a fixed number of Credits and the
margin floor holds. Web search already fits it: one OpenRouter web-plugin call, 3 results, a known fee and a capped input.

Deep research does not fit that rule as providers sell it. A single "research model" call can run many searches and a long hidden
chain of reasoning, and its bill varies with how much the model decides to read. A flat price is either a loss on hard questions or
a rip-off on easy ones, and there is no number to put in `*_extra_cost`.

## Decision (proposed)

Build Deep research **ourselves, out of bounded steps we already price**, instead of buying an open-ended research call.

1. **A fixed plan, run by the Worker.** One research reply is: (a) *plan* — the model writes up to **4 search queries**;
   (b) *search* — up to 4 web-plugin calls, each the exact shape and fee of today's Web search (3 results, capped input);
   (c) *write* — one final answer that cites the pages, with the same reply cap as the row's Thinking setting.
   The step counts are constants in code and in the catalog row, not model-chosen. The model cannot ask for a fifth search.
2. **The worst case is a sum we can record.** `chat_research_extra_cost` = 1 plan call + 4 × the Web search worst case + 1 write call
   at the row's rates. The row stores it, the table refuses a price under the margin floor, exactly like the other two options
   (`credits >= ceil(cost / 0.01796)`). A row offers Deep research only when all its columns are set.
3. **One job, one price, one refund.** It is a single `jobs` row through `ledger_debit` with an idempotency key; the price is the row's
   base plus the research extra (never both Web search and Deep research: research includes search). It ends `STORED`; **any step
   failing before the write returns the whole price**, as a failed reply does today. A user who stops it partway keeps what was
   produced and the price, like Stop on a normal reply, and the reply says which steps ran.
4. **Streaming and time.** Progress events ("Planning", "Searching 2 of 4", "Writing") ride the existing SSE stream so the connection
   never idles. A hard wall-clock ceiling (proposed 120 s) ends the run and refunds if no answer was written.
5. **Prompt-injection posture.** Search results are untrusted data. Page text goes to the model only as quoted context, the plan is
   fixed so a page cannot add steps, and no step has a tool that writes anything. Citations are shown as plain links with the host,
   rendered through the existing link rules (`http`/`https` only).
6. **Ships behind a flag** (`CHAT_RESEARCH_ENABLED`, `"false"` in production) and on staging first, like every chat option.

## Why not buy one

| Option | Why not |
|---|---|
| A provider "deep research" model | Cost not boundable per request, so no honest fixed price; refund and margin rules cannot hold. |
| Let the model loop until done | Same: unbounded steps mean unbounded cost and time. |
| Treat it as Web search with a bigger result count | Cheap, but it is not research: one pass, no plan. Mislabelling it is a product risk. |

## Must be verified live before any price is set (not assumed here)

- The worst-case cost of one plan call, one 3-result web-plugin call, and one write call on each model that will offer it. The Web
  search figure on record ($0.0200 fee plus up to 16,000 input tokens) is the only number reused; the rest is measured on staging.
- That a 4-search run fits the wall-clock ceiling on the Worker, including the slowest eligible model.
- Which models are good enough at planning to be worth offering it on.

## Consequences

- One migration (new `chat_research_*` columns, constraints, row updates with exact positive row counts per CLAUDE.md), an acceptance
  test for the margin check and for refund-on-failure at each step, and a chat-turn orchestration change in `lib/chatTurn.js`.
- Price is higher than Web search (several calls), and the UI shows it before Send like every option.
- More moving parts than one call, but every part is a thing we already measure.

## Owner's decisions (2026-10-05, "go with recommendation")

1. **Bounded 4-search research**, not an open-ended provider call. A fixed, priced price beats open-ended depth.
2. **The strongest two models only**: Claude Sonnet 5.5 and GPT-6 Luna, the two premium chat models already activated on staging.
3. **A normal chat reply only.** No document export in v1.
4. **A 120 s wall-clock ceiling**, ending the run and refunding if no answer was written. Background runs with notifications are a later decision.

Build order when this is picked up: measure the plan, search and write costs on staging for the two models, then the migration (`chat_research_*` columns, constraints, exact-row-count updates), then the orchestration in `lib/chatTurn.js` with a refund test at each step, then the UI. `CHAT_RESEARCH_ENABLED` ships `"false"` in production.
