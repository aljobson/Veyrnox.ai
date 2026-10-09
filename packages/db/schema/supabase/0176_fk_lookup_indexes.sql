-- 0176: indexes behind foreign keys and lookups (docs/product/ISSUES.md S12).
--
-- Nine single-column foreign keys had no index with that column first, so a
-- lookup by the key — and every RESTRICT check when a parent row is deleted —
-- scanned the child table. admin_lookup_user (0148) matches
-- lower(u.email), which the plain users_email_idx cannot serve.
-- (cinema_unlocks.ledger_entry_id / reversal_entry_id are covered by 0171.)
--
-- Plain btree, IF NOT EXISTS. Not CONCURRENTLY: migrations run in a
-- transaction; at current table sizes each build is milliseconds.

CREATE INDEX IF NOT EXISTS cinema_unlock_reversals_content_idx  ON public.cinema_unlock_reversals (content_id);
CREATE INDEX IF NOT EXISTS cinema_passes_plan_idx               ON public.cinema_passes (plan_id);
CREATE INDEX IF NOT EXISTS cinema_pass_events_pass_idx          ON public.cinema_pass_events (pass_id);
CREATE INDEX IF NOT EXISTS cinema_pass_plays_user_idx           ON public.cinema_pass_plays (user_id);
CREATE INDEX IF NOT EXISTS cinema_moderation_actions_content_idx ON public.cinema_moderation_actions (content_id);
CREATE INDEX IF NOT EXISTS social_account_actions_actor_idx     ON public.social_account_actions (actor_id);
CREATE INDEX IF NOT EXISTS social_posts_created_by_idx          ON public.social_posts (created_by_user_id);
CREATE INDEX IF NOT EXISTS social_post_media_source_job_idx     ON public.social_post_media (source_job_id);
CREATE INDEX IF NOT EXISTS social_post_targets_account_idx      ON public.social_post_targets (account_id);
CREATE INDEX IF NOT EXISTS users_email_lower_idx                ON public.users (lower(email));
