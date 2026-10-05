-- 0173: project_assets is written only through its RPCs
-- (docs/product/ISSUES.md S8).
--
-- 0141 granted service_role SELECT, INSERT and UPDATE on project_assets
-- directly, unlike every other money/media table, where writes go only
-- through SECURITY DEFINER functions. Nothing uses the direct writes: the two
-- writers, private.reserve_project_asset and
-- public.record_project_asset_inspection, are definer functions and run as the
-- table owner; the cleanup cron calls claim/finish_project_asset_cleanup; the
-- Worker's reads go through the user's JWT (tenant-client). The guard trigger
-- was the only thing standing between a stray service-role write and the
-- one-way state machine.
--
-- INSERT and UPDATE are revoked. SELECT stays (reads are not the rule). DELETE
-- and TRUNCATE were never granted.

REVOKE INSERT, UPDATE ON public.project_assets FROM service_role;
