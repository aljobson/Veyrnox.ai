# Security incident response

The process a provider's Platform Customer terms ask for (BytePlus Service Specific
Terms 4.2.2, ADR-0058 decision 7) and the one we owe users and the ICO regardless.
Short on purpose: an incident is not the time to read.

## Owner and contacts

| Role | Who |
|---|---|
| Incident owner, on call | Product owner (Al Jobson). Sole admin; `users.is_admin`. |
| Data protection contact | The same person; UK ICO breach report within 72 hours of awareness where personal data is at risk. |
| Supabase (database, auth) | Dashboard support for project `xdxdzmsztyzbnzeforxx`; MCP `get_advisors` and `query_logs` for evidence. |
| Cloudflare (Worker, R2) | Dashboard account `fb18d9f7052afbea5a5e0eae69948af2`; `wrangler tail` for live logs, `wrangler rollback <version-id>` for break-glass. |
| Stripe (payments) | Dashboard, disputes queue; Stripe is Merchant of Record (ADR-0031). |
| Model providers | fal.ai support, kie.ai support, OpenRouter support, GrsAI support, BytePlus ModelArk support (console ticket). Report abuse of the API through their console, never by email with user data attached. |

## What counts as an incident

- Any provider, payment or database credential leaves the machine it belongs on
  (pasted, committed, logged, screenshotted). CLAUDE.md: rotate within 24 hours.
- A signed webhook or admin route accepts something it should have refused, or the
  ledger reconciliation cron (`veyrnox-reconcile-balances`) reports a non-zero row.
- Generated or uploaded content that depicts a real person without consent, sexual
  content involving minors (report to the NCA CEOP and the provider, do not store or
  forward), or a takedown request from a rights holder or a provider.
- A user account used for abuse at volume (looped sign-ups, prompt injection against
  providers, resale of our API).
- A provider tells us they have seen abuse from our account.

## Steps

1. **Contain within the hour.**
   - Credentials: rotate the secret with `wrangler secret put`, then invalidate the
     old one at the provider. Record the time. Never paste the new value anywhere but
     the prompt.
   - Account abuse: Freeze the account. A content takedown does this on the third
     strike automatically (`record_content_violation`); for anything faster, record a
     takedown on each offending job and, if the account must stop now, use the
     dispute path's Freeze through an operator RPC call with a `content:` reason.
   - Content: `POST /api/v1/admin/violations` with `tier: "takedown"` and the job id
     removes the asset rows and queues the R2 keys for the reaper immediately. The
     account_actions row is the record.
   - Code path: `wrangler rollback` to the last known-good version if the Worker is
     the problem.
2. **Preserve evidence before it ages out.** `jobs`, `assets`, `webhook_events`,
   `account_actions`, `ledger_entries` are append-only or retained; export the
   relevant rows with the service role and keep them with the incident note. R2
   objects are deleted by the reaper once queued, so copy anything the ICO or the
   provider may need first.
3. **Assess.** Which users, which data classes (prompts, uploads, emails, payment
   references), which providers, which window. Decide whether personal data is at
   risk; if so the 72-hour clock is running.
4. **Notify.** The provider through their abuse or support channel if their terms
   were breached. The ICO within 72 hours if personal data is at risk. Affected users
   without undue delay if the risk to them is high. Stripe if payment data is involved.
5. **Record.** One incident note under `docs/incidents/YYYY-MM-DD-<slug>.md` with
   timeline, scope, actions, notifications and the follow-up list. An ADR if the fix
   changes behaviour visible to users or auditors.
6. **Follow up within a week.** Close the follow-up list, and add the test that would
   have caught it.

## Tiered violation handling

| Tier | When | What happens | Record |
|---|---|---|---|
| Warning | First policy breach with no third-party harm | Nothing removed. User sees no change today; an email is the follow-up. | `account_actions.action = 'warning'` with `job_id` |
| Takedown | Content that breaches the AUP or a provider policy | The job's assets are deleted and queued for R2 deletion at once. | `account_actions.action = 'takedown'` with `job_id` |
| Freeze | Third takedown, or a chargeback, or immediate danger | Generating and buying stop. Sign-in, library and account deletion still work. `unfreeze_account` is the only way back. | `account_actions.action = 'freeze'`, reason `content:third_takedown` |

Operate it at `/app/admin/violations` (find the user by email, user id or job id, then
record a warning or a per-job takedown), or read the record with
`GET /api/v1/admin/violations?user_id=<uuid>`. Every row names the admin who acted, the
reason, the job and the time, and cannot be edited.
