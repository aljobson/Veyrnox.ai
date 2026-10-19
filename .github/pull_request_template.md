## What and why

<!-- One or two sentences. Link the issue or ADR. -->

## Checks

- [ ] `npm run lint && npm run typecheck && npm test` pass locally
- [ ] New user path is behind a `*_ENABLED` flag that ships `"false"`
- [ ] No secrets, `.env*` or service-role keys in the diff

## Touches the money spine? (ledger, jobs, webhooks, billing)

- [ ] Not applicable
- [ ] Mutations go through an RPC (no raw `ledger_entries` / `credit_balances` writes), with an idempotency key and a matching refund path
- [ ] ADR added or updated for any user-visible change

## Touches the database?

- [ ] Not applicable
- [ ] Migration numbered after the latest on `main` and open PRs; idempotent
- [ ] RLS on and forced; new functions `REVOKE`/`GRANT` by full signature; `SET search_path = ''` on SECURITY DEFINER
- [ ] Catalog UPDATEs assert an exact ROW_COUNT

## Touches auth, middleware, CSP or a route outside `/api/v1`?

- [ ] Not applicable
- [ ] Entry added to `tests/routesOutsideGate.test.mjs` (new route outside the gate)
- [ ] CSP host additions have an ADR

## Visible copy changed?

- [ ] Not applicable
- [ ] `e2e/` specs that pin the wording are updated (they run daily against staging, not on PRs)
- [ ] Docs edits: `npm run sync:vey-knowledge` run
