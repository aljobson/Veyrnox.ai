-- Video agent, rollout step 5 (ADR-0074, docs/montage/RUNBOOK-production.md): the `video-agent` catalog row goes
-- active. 0227 added it inactive at 165 credits.
--
-- Nothing becomes reachable by this alone. AGENT_VIDEO_ENABLED is "false" in production, so the plan route answers
-- 404 and no plan ticket can be issued; a generation without a valid ticket is refused before the debit. The row is
-- held off the Create picker, the shelves and site search by its `plan_id` input (#697). What does change: the
-- public catalog lists it with its price, and refresh_recovery_health() (0229) starts expecting the `video_agent`
-- heartbeat, which the Worker's sweep has been sending since its secrets were set (rollout step 4).
--
-- Endpoint verified: `video-agent:v1` is our own runner, proven on staging and deployed for production at the same
-- image digest (gates G1 to G8). Price unchanged: 165 credits (owner, 2026-10-09).
--
-- Undo: a mirror migration setting active = false.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true, updated_at = now()
     WHERE id = 'video-agent' AND provider = 'veyrnox';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one video-agent/veyrnox row, updated %', affected;
    END IF;
END $$;
