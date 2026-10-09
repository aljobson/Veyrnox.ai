-- 0171: unique indexes behind the ledger's one-per rules
-- (docs/product/ISSUES.md S6).
--
-- These rules were enforced only by a probe under a row lock inside each
-- function. The probes stay; the indexes make a second row impossible even if
-- a future function forgets the probe or takes a different lock:
--
--   * one Credit Refund per job — ledger_refund (0037) probes
--     job_id + delta > 0 + reason LIKE 'refund:%'; every refund path (webhooks,
--     submit rejection, Clip Editor, Auto Short, the stuck-job sweeps) goes
--     through it. The index predicate is that probe, so it can also serve it.
--   * one signup grant per user — signup_grant (0127) and every earlier
--     version probe reason = 'grant:signup'.
--   * one Cinema unlock per ledger entry, and one reversal entry per unlock —
--     ledger_unlock and reverse_cinema_unlocks (0142) write one entry per row.
--
-- The ledger is append-only, so a duplicate already in the table cannot be
-- removed here. Each index is preceded by a check that stops the migration
-- with a readable message if one exists; nothing is created in that case
-- (the file runs in one transaction). Investigate with the query in the
-- message, then record a compensating decision — never delete ledger rows.
--
-- Not CONCURRENTLY: migrations run in a transaction. Each build briefly
-- blocks writes to its table; at current table sizes that is milliseconds.

DO $$
DECLARE n BIGINT;
BEGIN
    SELECT count(*) INTO n FROM (
        SELECT job_id FROM public.ledger_entries
        WHERE delta > 0 AND reason LIKE 'refund:%' AND job_id IS NOT NULL
        GROUP BY job_id HAVING count(*) > 1) d;
    IF n > 0 THEN
        RAISE EXCEPTION '0171: % job(s) already have more than one refund row', n
            USING HINT = 'SELECT job_id, count(*) FROM public.ledger_entries WHERE delta > 0 AND reason LIKE ''refund:%'' GROUP BY 1 HAVING count(*) > 1';
    END IF;

    SELECT count(*) INTO n FROM (
        SELECT user_id FROM public.ledger_entries WHERE reason = 'grant:signup'
        GROUP BY user_id HAVING count(*) > 1) d;
    IF n > 0 THEN
        RAISE EXCEPTION '0171: % user(s) already have more than one signup grant', n
            USING HINT = 'SELECT user_id, count(*) FROM public.ledger_entries WHERE reason = ''grant:signup'' GROUP BY 1 HAVING count(*) > 1';
    END IF;

    SELECT count(*) INTO n FROM (
        SELECT ledger_entry_id FROM public.cinema_unlocks GROUP BY 1 HAVING count(*) > 1) d;
    IF n > 0 THEN
        RAISE EXCEPTION '0171: % ledger entr(y/ies) back more than one Cinema unlock', n;
    END IF;

    SELECT count(*) INTO n FROM (
        SELECT reversal_entry_id FROM public.cinema_unlocks
        WHERE reversal_entry_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d;
    IF n > 0 THEN
        RAISE EXCEPTION '0171: % reversal entr(y/ies) back more than one Cinema unlock', n;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_one_refund_per_job
    ON public.ledger_entries (job_id)
    WHERE delta > 0 AND reason LIKE 'refund:%';

CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_one_signup_grant
    ON public.ledger_entries (user_id)
    WHERE reason = 'grant:signup';

CREATE UNIQUE INDEX IF NOT EXISTS cinema_unlocks_one_per_ledger_entry
    ON public.cinema_unlocks (ledger_entry_id);

CREATE UNIQUE INDEX IF NOT EXISTS cinema_unlocks_one_per_reversal_entry
    ON public.cinema_unlocks (reversal_entry_id)
    WHERE reversal_entry_id IS NOT NULL;
