# Capped search: the order of work (ADR-0067 amendment 8)

Do these in order. Each step is safe on its own; skipping ahead is not.

1. **Merge the stack in order**: #563 (folders), #565 (picker and panel), #569 (Web search re-priced), #570 (`chat_web_engine`), then the code PR for the capped search. Retarget each to `main` as the one below it merges.
2. **Approve apply-migrations for 0211** and wait for it to finish. It adds the column with every row on `plugin`, so nothing a user sees changes. The code PR also tolerates the column being absent (it reads rows as `plugin`), so a merge before this step does not take chat down, but nothing can be flipped until it is applied.
3. **Create an Exa account and an API key** in your own name. Give it a spend limit.
4. **Set the key on staging first**, then production. Never paste the key into chat:
   ```bash
   npx wrangler secret put EXA_API_KEY --env staging
   npx wrangler secret put EXA_API_KEY            # production
   ```
   Setting a secret redeploys the Worker with the newest *uploaded* version. Before and after, check that what is live is `main`'s tip (your notes: a dashboard or CLI secret edit can put a branch preview live).
5. **Measure.** From a shell with the key, run the paid probe (a few cents):
   ```bash
   EXA_API_KEY=... node scripts/measure-capped-search.mjs --run
   ```
   It prints each search's cost from Exa itself, the fee bound (dearest search x 1.5), and a candidate price for every model. It writes nothing.
6. **The flip migration** (prepared after step 5, from those numbers): one statement per row sets `chat_web_engine = 'capped'` and the new Web search price together, pinned to the old values, with an exact row count. Until a row is flipped, nothing changes. After it, a capped row offers Web search only while `EXA_API_KEY` is set, and refuses it with nothing charged if the key is ever removed.
7. **Walk it on staging**: Web search on a capped model shows its new price before Send, sources are listed under the reply, a query Exa cannot answer says "No pages came back" with no Credits used, and removing the key hides Web search on capped rows.
8. **Privacy notice**: name Exa as the search service before the flip reaches production (the notice now says "a search service").

Rollback at any point after the flip is one statement setting `chat_web_engine = 'plugin'` and restoring the #569 prices. Do not set `plugin` without restoring the prices: the low price is only honest for the capped engine.
