# ADR-0045 — Authoritative account credit statement

Date: 2026-09-24
Status: Proposed

## Decision

Credits gains a read-only, paginated statement sourced from ledger_entries.
The authenticated gateway resolves the owner using the middleware-verified
identity, then filters every read by that internal user ID. Request parameters
cannot select another account. The existing account-read quota runs before
lookups, every response is no-store, and queries fetch at most 26 rows.

Charges, refunds, signup grants, free-credit expiry, Top-ups and adjustments
remain separate entries with their actual signed delta. Raw operator reason
strings are mapped to stable public categories. No balance is reconstructed
from the current page and no ledger row is changed. Existing recent-generation
history remains a convenience view rather than the account statement.

Top-up history also gains keyset pagination. Both lists order by timestamp
and UUID together, preserve timestamp microseconds, and use an extra row to
prove another page exists. Strict cursor validation prevents arbitrary
PostgREST expressions. The UI deduplicates repeated rows and rejects stale
responses during overlapping reloads/unmount.

No database migration is needed; the existing ledger user/time index supports
the owner-scoped range. Deploy alongside ADR-0042's account boundary so identity
changes remount all billing UI and discard old-account gateway responses.

## Verification

Route tests cover owner selection, quota denial, separate debit/refund rows,
internal-reason redaction and strict cursor handling. Browser QA uses mocked
account responses, never purchases or a real credit mutation.
