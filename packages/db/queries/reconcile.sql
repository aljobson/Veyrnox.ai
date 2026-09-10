-- Reference specification. The runnable path is Ledger.reconcile in
-- packages/db/ledger.ts.
--
-- §6.6 Reconciliation: for every user, verify balance = SUM(delta). Called
-- nightly by a scheduled job. Any mismatch is a bug — the invariant is
-- supposed to be maintained by the debit/refund transactions themselves.
--
-- Returns rows for every user whose balance disagrees with the ledger sum.
-- If the result is empty, all balances are consistent.

SELECT
    cb.user_id,
    cb.balance      AS materialised_balance,
    COALESCE(SUM(le.delta), 0) AS ledger_sum,
    cb.balance - COALESCE(SUM(le.delta), 0) AS drift
FROM credit_balances cb
LEFT JOIN ledger_entries le ON le.user_id = cb.user_id
GROUP BY cb.user_id, cb.balance
HAVING cb.balance <> COALESCE(SUM(le.delta), 0);
