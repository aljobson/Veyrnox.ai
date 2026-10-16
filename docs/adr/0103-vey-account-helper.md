# ADR-0103 — Vey explains the signed-in user's own recent charges, read-only

- **Status**: **Accepted 2026-10-16; built 2026-10-16**, behind `VEY_ACCOUNT_ENABLED` (off everywhere until the owner flips it on staging, then production).
- **Date**: 2026-10-16
- **Related**: [ADR-0067](0067-chat-replies-are-jobs.md) (the ledger and job rows a charge comes from), [ADR-0073](0073-studio-skills.md) (assistants prepare, never run), [ADR-0013](0013-credit-expiry-policy.md) (Free Credit expiry), `CLAUDE.md` ("Money & billing", "API gateway": identity comes only from the middleware headers, typed errors, no leaked DB messages)

## Context

Vey (`/api/v1/help`) explains how to use Veyrnox from reviewed articles and the live catalog. After the refund, expiry, pack and frozen-account articles (PR 1105) it answers the *rules* about charges, but not the question people actually ask: "Why was I charged 12 credits?" It cannot, because it has no access to the account. A support person would open the ledger. The ledger already has a safe per-user projection: `/api/v1/ledger` returns stable `kind` categories and never the operator's `reason`, and `/api/v1/balance` returns the balance and the Free Credit remainder.

The risks are the ones in the money spine: a model that is told it can see accounts can be talked into granting credits or refunds, can be pointed at someone else's account, and any account data placed in a prompt leaves for a model provider.

## Decision

1. **The server reads, the model does not.** The help route already has the verified identity (`x-veyrnox-auth-id`, set by middleware). When the question is about a charge or the balance, the route itself reads that one account's rows. There is no tool call, no id and no query the model can choose, so it cannot reach another account. A model-chosen account is not possible by construction.
2. **A deterministic answer, not a model answer.** In v1 the reply is built from the rows by a template ("Your last charge was 12 Credits on 14 Oct, a video generation on <model>; a failed job on 13 Oct was refunded") and the reviewed refund article. **No ledger or job row is sent to a model provider.** That keeps the privacy position unchanged: nothing new leaves the account's own tables for a third party. A free-form model explanation of the rows is a separate decision with its own ADR.
3. **What is read, and nothing more.** Balance, Free Credits and their expiry, and the latest 10 ledger entries as `kind`, `delta`, `free_delta`, time and, for generation and refund kinds, the job's model id and status, joined on the same user. Not read: email, payment methods or Stripe ids, prompts or outputs, operator reasons and notes, freeze or violation reasons, other users. The projection reuses the ledger route's `kind()` mapping rather than a second copy.
4. **Read-only is enforced, not promised.** The plan schema (`message`, `target`, `action`) gains no field that mutates anything, and no account RPC used here is a writer. Vey still cannot grant, refund, unfreeze or buy; a request to do so gets the existing "I cannot" answer and the support address. A test asserts the account context never contains a `reason` and that no `ledger_*`, `credit_*` or `unfreeze_*` function is called from the help path.
5. **Same gates as other account reads.** The route already spends one `consume_account_read_request` per call (rate limited, 429 with `Retry-After`). The ledger and balance reads add no new limit class. Reads are `Cache-Control: no-store`. Rows are never logged; a failed read logs one line with no data.
6. **Failure says so.** If the read fails or the account has no rows, Vey says it could not read the account and falls back to the reviewed articles and the support address. It never invents a charge.
7. **Flag.** `VEY_ACCOUNT_ENABLED`; off, the route behaves exactly as today. Staging first, then the owner's explicit yes for production. *As built:* the code needs the exact value `"true"`, so production leaves the var out (it has no spare Worker text binding; absence is off, as with the fal rollout controls) and `env.staging.vars` names it `"false"`. A test pins both.
8. **Intent gate.** A small pattern (`charged`, `charge`, `balance`, `why was`, `where did my credits go`, `refund` for a named job) decides whether to read at all, so ordinary how-to questions never touch the ledger.

## Not in this ADR

- Any action on the account: refunds, grants, unfreezing, cancelling a Pack or Pass.
- Explaining Stripe invoices or payment methods; Vey stays pointed at Stripe and the support address.
- A model summarising the rows (see decision 2), or reading other users' accounts, even for an administrator.
- Why a refund was *not* issued: that needs operator notes, which are never exposed.

## Consequences

- The most common billing question gets a real answer from the user's own data without a support email.
- The deterministic template cannot hallucinate a charge, and cannot be talked into one.
- Free-form questions about the rows get the template plus the articles, not a conversation. That is the price of keeping account data away from the model.
- One more read path to keep aligned with `/api/v1/ledger`; sharing `kind()` and the page projection keeps them from drifting.

## Tests required before it ships

- Identity: no `x-veyrnox-auth-id` gives 401 and no read; a header-less call never reads rows.
- Isolation: a request whose body names another account id reads only the header's account.
- Projection: the account context has no `reason`, email or payment field.
- Model: with the flag on, a charge question makes zero provider calls.
- Failure: a failed read produces the "could not read your account" answer and the support address.
- Flag off: identical behaviour and no ledger read.

## As built

`lib/veyAccount.js` (intent gate, read, template), `lib/ledgerKind.js` (the `kind()` mapping, now shared with `/api/v1/ledger`), and a branch in `app/api/v1/help/route.js` after the account-read rate limit. A failed read logs one constant line and answers from the reviewed articles with "I could not read your account just now". Tests: `tests/veyAccount.test.mjs`.
