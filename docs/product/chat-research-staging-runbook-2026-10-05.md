# Deep research on staging: apply 0208 and 0214, deploy with the flag, walk it (2026-10-05)

ADR-0070. Target: Supabase project `veyrnox.ai staging` (`yrqzwqywxfesmbvhzjgj`) and Worker `veyrnox-ai-staging`.
Production is untouched by this runbook. Every state below was read-only against staging on 2026-10-05.

## Where staging is now

- Applied migrations run to **`0212_chat_web_engine`**. That includes `0209_chat_folders`, `0210_chat_models_activate_premium`,
  `0211_chat_web_search_worst_case` and `0212_chat_web_engine`, which belong to another chat session's open PRs (#563, #565,
  #569, #570), not to this work. They are independent of research and need no action here.
- **None of the research or free-allowance migrations are applied** (`chat_research_*` and `free_allowance_*` columns do not exist).
- `chat-claude-sonnet-5.5` is active at 4 Credits, reply cap 4,096 tokens, reasoning `low`, Web search +2, Thinking +3.
  That is exactly what the research price assumed (the update asserts a 4,096-token cap and updates exactly one row).
- The research price migration is numbered **0214**, not 0209 (renumbered in #582 to clear the other session's 0209 to 0213).
  If #582 has not merged yet, the file on `main` is still `0209_chat_research_pricing.sql`: wait for it, or use that name once.

**Order matters: database first, then the deploy with the flag.** With `CHAT_RESEARCH_ENABLED` on, the Worker selects the research
columns; deployed before the SQL, the chat models list would fail on the missing columns.

## 1. Apply two migrations (SQL editor, in this order: 0208, then 0214)

Open https://supabase.com/dashboard/project/yrqzwqywxfesmbvhzjgj/sql/new and check the project name at the top left reads
`veyrnox.ai staging`.

```bash
cd ~/Documents/GitHub/Veyrnox.ai && git checkout main && git pull
pbcopy < packages/db/schema/supabase/0208_chat_research_columns.sql
```

Paste, Run, expect "Success. No rows returned". Then the same for the price:

```bash
pbcopy < packages/db/schema/supabase/0214_chat_research_pricing.sql
```

0208 adds three nullable columns with rules (no row changes). 0214 adds `chat_research_search_model`, widens the rule to four
columns, and prices **one** row. It raises an error, and changes nothing, unless it updates exactly one `chat-claude-sonnet-5.5`
row with a 4,096-token cap.

## 2. Check it (read-only; Claude can run this too)

```sql
select id, active, credits_5s, chat_research_extra_credits, chat_research_extra_cost, chat_research_write_max_tokens, chat_research_search_model
from public.model_catalog where chat_research_extra_credits is not null;
-- expect exactly one row: chat-claude-sonnet-5.5, 3, 0.0400, 4096, mistralai/mistral-small-2603

select count(*) from public.model_catalog where chat_research_extra_credits is null and chat_research_search_model is not null;  -- 0 (all or none)
select * from public.reconcile_balances();   -- zero rows
```

## 3. Deploy with the flag on

`wrangler deploy` ships whatever `.open-next` holds, so build a staging bundle first (the staging build lesson in
`chat-handoff-2026-10-05.md`), then deploy with the flag for this deploy only:

```bash
cd ~/Documents/GitHub/Veyrnox.ai && git checkout main && git pull
APP_ENV=staging SUPABASE_URL=https://yrqzwqywxfesmbvhzjgj.supabase.co \
NEXT_PUBLIC_SUPABASE_URL=https://yrqzwqywxfesmbvhzjgj.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging publishable key from wrangler.jsonc> \
PUBLIC_HOST=https://veyrnox-ai-staging.al-jobson.workers.dev npm run build:worker
npx wrangler deploy --env staging --var CHAT_RESEARCH_ENABLED:true
```

Staging chat uses the shared `OPENROUTER_API_KEY` on the Worker (the fallback in `lib/chat.js`), which is also how the probe ran.
Rollback: copy the current version id first (`npx wrangler deployments list --env staging`), then
`npx wrangler rollback <version-id> --env staging`. To turn research off without a rollback, redeploy without `--var`.

## 4. Walk it (needs your staging sign-in, and a balance of at least 20 Credits)

Hard-reload `/app/chat` (`localStorage.veyrnox_chat = '1'`). Pick **Claude Sonnet 5.5**. Note the balance.

- A third option appears: **Deep research +3 Credits**. Turn it on: the price line and Send button read **7 Credits**. Thinking and
  Web search become unavailable while it is on; turning either of those on turns research off.
- Attach an image with research on: the screen says research reads text only and Send is blocked. Remove it.
- Pick **GPT-6 Luna** or any other model: no research option (only Sonnet 5.5 is priced for it).
- Ask something current ("What changed in the latest stable Node.js release?"). The waiting reply walks through *Planning the
  research*, *Searching the web: n of 4 done*, *Writing the answer*. Expect about 25 to 45 seconds in all.
- The answer streams with a **Sources** list at the end. The balance drops by **7**. Reload: the thread and the reply, sources
  included, are still there, and the footer says 7 Credits.
- A plain reply on the same model is still 4 Credits, and Web search alone is still 6.
- Press Stop during the searching steps: nothing is charged (no text yet), and the message comes back to the box.

### Failure drill (proves the refund; undo it after)

```sql
update public.model_catalog set chat_research_search_model = 'nonexistent/model' where id = 'chat-claude-sonnet-5.5';
```

Send a research message. It should fail quickly with a "try again" message, the balance should be **unchanged**, and no reply is
stored. Then restore the real value:

```sql
update public.model_catalog set chat_research_search_model = 'mistralai/mistral-small-2603' where id = 'chat-claude-sonnet-5.5';
```

## 5. Check it in the database (read-only; Claude can run this too)

```sql
-- the research jobs: options record it, the debit is base + extra
select j.id, j.state, j.credits, j.inputs->'options' as options, j.error_code
from public.jobs j where j.inputs->>'kind' = 'chat' and (j.inputs->'options'->>'research') = 'true' order by j.created_at desc limit 10;
-- successful ones: state STORED, credits 7. The drill: FAILED or REFUNDED, with a refund row below.
select l.job_id, l.delta, l.reason from public.ledger_entries l
where l.job_id in (select id from public.jobs where (inputs->'options'->>'research') = 'true') order by l.created_at desc limit 20;
select * from public.reconcile_balances();   -- zero rows
select * from public.reconcile_free_credits();   -- zero rows
```

## 6. Know before you flip it anywhere else

- **Another session is changing Web search** (open PRs #570 `chat_web_engine`, #572 a capped web search of our own, #575 the flip,
  #579 naming the provider). Research's searches call OpenRouter's web plugin directly, on the cheap search model, so they do not go
  through that work, but both touch `lib/chatTurn.js`. Merge order matters; whoever merges second resolves the overlap.
- Measured cost per research run on Sonnet 5.5 + Mistral Small: $0.05 to $0.07 against a 7-Credit price. The migration comment and
  ADR-0070's addendum hold the evidence.
- Production is a separate decision after this passes: `0205` to `0208` and `0214` through `apply-migrations` with your approval, in
  that order, then `CHAT_RESEARCH_ENABLED`. Do not apply `0214` before `0208`.

## 7. Clean up

Remove the `apply_migration` allow rule from `.claude/settings.local.json` if you added one; it covers every Supabase project.
