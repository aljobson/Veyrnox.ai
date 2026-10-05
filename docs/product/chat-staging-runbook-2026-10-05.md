# Chat on staging: apply 0196 and 0197, deploy, walk it (2026-10-05)

Target: Supabase project `veyrnox.ai staging` (`yrqzwqywxfesmbvhzjgj`) and Worker `veyrnox-ai-staging`.
The staging bundle in `.open-next` was built from branch `claude/chat-model-options` (commit `2a42f7b`) with
`APP_ENV=staging`; its client code names the staging project and carries `"apple,google"`. Production is untouched.

**Order matters: database first, deploy second.** The new Worker reads the 0196 and 0197 columns. Deployed before
the SQL, `/api/v1/chat/models` would fail on the missing columns and chat would show as unavailable.

Do not switch branches or run `npm run build:worker` before deploying: the deploy ships whatever `.open-next` holds.

## 1. Apply the two migrations (SQL editor, in this order)

Open https://supabase.com/dashboard/project/yrqzwqywxfesmbvhzjgj/sql/new and check the project name at the top
left reads `veyrnox.ai staging`.

```bash
cd ~/Documents/GitHub/Veyrnox.ai/.claude/worktrees/replica-skill-install-6d58ee
pbcopy < packages/db/schema/supabase/0196_chat_models_reasoning.sql
```

Paste into the editor, Run. Expect "Success. No rows returned". Then the same for 0197:

```bash
pbcopy < packages/db/schema/supabase/0197_chat_models_options.sql
```

0197 raises an error (and changes nothing) unless it updates exactly 3 live rows and 7 staged rows.

## 2. Check it (read-only; Claude can run this too)

```sql
select id, active, credits_5s, chat_max_reply_tokens, chat_reasoning_effort,
       chat_thinking_extra_credits, chat_web_extra_credits
from public.model_catalog where modality = 'text' order by active desc, id;
```

Expect 10 rows: the three live ones active with `chat_web_extra_credits = 2`, and seven inactive with both extras set.

## 3. Deploy

```bash
cd ~/Documents/GitHub/Veyrnox.ai/.claude/worktrees/replica-skill-install-6d58ee && npx wrangler deploy --env staging
```

Rollback if anything looks wrong (the version live before this deploy):

```bash
npx wrangler rollback 084322d6-8bea-4254-b00a-bfaf126da32b --env staging
```

## 4. Walk it (needs your staging sign-in)

Hard-reload `/app/chat` (`localStorage.veyrnox_chat = '1'` must be set in that browser).

- The model picker lists the three live models at 1 Credit each.
- A "Web search +2 Credits" toggle appears. Turn it on: the price line and send button read 3 Credits.
- Ask something current (a latest-version question). The reply streams, a "Sources" list ends it, and the balance drops by 3.
- With the toggle off: 1 Credit, no sources.
- Reload: the thread and the stored reply, sources included, are still there.
- Try Stop mid-reply; try a send with the balance too low (expect the top-up message).

After it, Claude can check read-only: the job rows (`inputs.options`), the ledger debit amounts, and the reconcile functions.

## 5. Clean up

Remove the `apply_migration` allow rule from `.claude/settings.local.json`; it covers every Supabase project on the account.
