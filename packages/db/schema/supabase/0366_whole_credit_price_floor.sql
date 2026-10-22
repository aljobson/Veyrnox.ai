-- 0366 — Price fourteen catalog rows at their whole-credit floor, and make the
-- per-row margin floor a standing database rule (ADR-0037, amendment 2).
--
-- ADR-0037 sets the target: after an 8% + $0.30 fee, a credit sold at the
-- $129/3000 pack ($0.043) can carry at most $0.01796 of provider cost and
-- still leave half of gross. 0121 checked every active row against that once,
-- inside its own run. The weekly fal watcher and the older catalog rows still
-- used the stricter $0.033 reference of ADR-0014, so fourteen rows sit one to
-- six credits above the cap:
--
--   row                      cost      credits  floor   price at $0.043
--   elevenlabs-tts-turbo     $0.0500    4 -> 3          $0.172 -> $0.129
--   elevenlabs-dialogue      $0.1000    7 -> 6          $0.301 -> $0.258
--   minimax-speech-2.6-hd    $0.1000    7 -> 6          $0.301 -> $0.258
--   nano-banana-pro-edit     $0.1500   10 -> 9          $0.430 -> $0.387
--   veo-3.1-lite-kie         $0.1500   10 -> 9          $0.430 -> $0.387
--   latentsync               $0.2000   13 -> 12         $0.559 -> $0.516
--   kling-2.6-pro-kie        $0.2750   17 -> 16         $0.731 -> $0.688
--   veo-3.1-fast-kie         $0.3000   19 -> 17         $0.817 -> $0.731
--   wan-2.5-kie              $0.3000   19 -> 17         $0.817 -> $0.731
--   kling-3.0-i2v-kie        $0.4500   28 -> 26         $1.204 -> $1.118
--   seedance-2.0-fast        $0.4536   28 -> 26         $1.204 -> $1.118
--   kling-3.0-i2v            $0.5600   34 -> 32         $1.462 -> $1.376
--   kling-avatar-v2          $0.5620   35 -> 32         $1.505 -> $1.376
--   veo-3.1-kie              $1.2500   76 -> 70         $3.268 -> $3.010
--
-- Each credits value is ceil(cost / 0.01796), the smallest whole-credit price
-- that keeps 50% for the worst-costed credit. At the entry packs the margin is
-- higher. Recorded costs were checked on 2026-10-22: fal rows against the
-- weekly watcher (2026-10-19: "20 of 20 match fal's billing"), kie rows
-- against kie's public rate card, and Seedance 2.0 Fast against OpenRouter's
-- listed $4.20 per million video tokens (108,000 tokens for a 5 s 720p clip).
--
-- Each UPDATE names the row's exact identity (provider, endpoint, recorded
-- cost, unit) and accepts the old or the new price, so a replay is a no-op and
-- drift in any recorded cost stops the migration instead of repricing a
-- different offer. Existing jobs keep the credits they were debited.
--
-- After the cuts, model_catalog gains a trigger: an active row cannot be
-- written with a recorded cost above credits * 0.01796 (a clip-edit row stores
-- cost per second and is counted for five). Then every active row is checked
-- once more, so a hidden violator fails this migration loudly.
--
-- Idempotent: absolute assignments, CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- Rollback: a forward migration setting the old credits back.

BEGIN;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog SET credits_5s = 3, updated_at = now()
     WHERE id = 'elevenlabs-tts-turbo' AND provider = 'fal' AND provider_endpoint = 'fal-ai/elevenlabs/tts/turbo-v2.5'
       AND provider_cost_per_unit = 0.0500 AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND active AND credits_5s IN (4, 3);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one elevenlabs-tts-turbo row at $0.05, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog SET credits_5s = 6, updated_at = now()
     WHERE id = 'elevenlabs-dialogue' AND provider = 'fal' AND provider_endpoint = 'fal-ai/elevenlabs/text-to-dialogue/eleven-v3'
       AND provider_cost_per_unit = 0.1000 AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND active AND credits_5s IN (7, 6);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one elevenlabs-dialogue row at $0.10, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog SET credits_5s = 6, updated_at = now()
     WHERE id = 'minimax-speech-2.6-hd' AND provider = 'fal' AND provider_endpoint = 'fal-ai/minimax/speech-2.6-hd'
       AND provider_cost_per_unit = 0.1000 AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND active AND credits_5s IN (7, 6);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one minimax-speech-2.6-hd row at $0.10, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog SET credits_5s = 9, updated_at = now()
     WHERE id = 'nano-banana-pro-edit' AND provider = 'fal' AND provider_endpoint = 'fal-ai/nano-banana-pro/edit'
       AND provider_cost_per_unit = 0.1500 AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND active AND credits_5s IN (10, 9);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one nano-banana-pro-edit row at $0.15, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog SET credits_5s = 9, updated_at = now()
     WHERE id = 'veo-3.1-lite-kie' AND provider = 'kie' AND provider_endpoint = 'veo:veo3_lite'
       AND provider_cost_per_unit = 0.1500 AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND active AND credits_5s IN (10, 9);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one veo-3.1-lite-kie row at $0.15, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog SET credits_5s = 12, updated_at = now()
     WHERE id = 'latentsync' AND provider = 'fal' AND provider_endpoint = 'fal-ai/latentsync'
       AND provider_cost_per_unit = 0.2000 AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND active AND credits_5s IN (13, 12);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one latentsync row at $0.20, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog SET credits_5s = 16, updated_at = now()
     WHERE id = 'kling-2.6-pro-kie' AND provider = 'kie' AND provider_endpoint = 'market:kling-2.6/text-to-video'
       AND provider_cost_per_unit = 0.2750 AND cost_unit = 'per_second' AND billing_seconds = 5
       AND active AND credits_5s IN (17, 16);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one kling-2.6-pro-kie row at $0.275, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog SET credits_5s = 17, updated_at = now()
     WHERE id = 'veo-3.1-fast-kie' AND provider = 'kie' AND provider_endpoint = 'veo:veo3_fast'
       AND provider_cost_per_unit = 0.3000 AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND active AND credits_5s IN (19, 17);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one veo-3.1-fast-kie row at $0.30, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog SET credits_5s = 17, updated_at = now()
     WHERE id = 'wan-2.5-kie' AND provider = 'kie' AND provider_endpoint = 'market:wan/2-5-text-to-video'
       AND provider_cost_per_unit = 0.3000 AND cost_unit = 'per_second' AND billing_seconds = 5
       AND active AND credits_5s IN (19, 17);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one wan-2.5-kie row at $0.30, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog SET credits_5s = 26, updated_at = now()
     WHERE id = 'kling-3.0-i2v-kie' AND provider = 'kie' AND provider_endpoint = 'market:kling-3.0/video'
       AND provider_cost_per_unit = 0.4500 AND cost_unit = 'per_second' AND billing_seconds = 5
       AND active AND credits_5s IN (28, 26);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one kling-3.0-i2v-kie row at $0.45, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog SET credits_5s = 26, updated_at = now()
     WHERE id = 'seedance-2.0-fast' AND provider = 'openrouter' AND provider_endpoint = 'bytedance/seedance-2.0-fast'
       AND provider_cost_per_unit = 0.4536 AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND active AND credits_5s IN (28, 26);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one seedance-2.0-fast row at $0.4536, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog SET credits_5s = 32, updated_at = now()
     WHERE id = 'kling-3.0-i2v' AND provider = 'fal' AND provider_endpoint = 'fal-ai/kling-video/v3/pro/image-to-video'
       AND provider_cost_per_unit = 0.5600 AND cost_unit = 'per_second' AND billing_seconds = 5
       AND active AND credits_5s IN (34, 32);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one kling-3.0-i2v row at $0.56, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog SET credits_5s = 32, updated_at = now()
     WHERE id = 'kling-avatar-v2' AND provider = 'fal' AND provider_endpoint = 'fal-ai/kling-video/ai-avatar/v2/standard'
       AND provider_cost_per_unit = 0.5620 AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND active AND credits_5s IN (35, 32);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one kling-avatar-v2 row at $0.562, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog SET credits_5s = 70, updated_at = now()
     WHERE id = 'veo-3.1-kie' AND provider = 'kie' AND provider_endpoint = 'veo:veo3'
       AND provider_cost_per_unit = 1.2500 AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND active AND credits_5s IN (76, 70);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one veo-3.1-kie row at $1.25, updated %', affected;
    END IF;
END $$;

-- ── The standing rule ────────────────────────────────────────────────────
-- An active row's recorded cost may not exceed credits * 0.01796 (ADR-0037:
-- $129/3000, 8% + $0.30 fee, 50% of gross). Written as an integer test:
-- cost * 100000 <= credits * 1796. clip-edit stores a cost per second and is
-- counted for five seconds, as 0121 did. Only writes that touch the price,
-- the cost or the active flag are checked, so an unrelated update cannot be
-- blocked by an older row.
CREATE OR REPLACE FUNCTION public.model_catalog_margin_floor()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF NEW.active THEN
        IF NEW.provider_cost_per_unit IS NULL OR NEW.provider_cost_per_unit < 0
           OR NEW.credits_5s IS NULL OR NEW.credits_5s <= 0 THEN
            RAISE EXCEPTION 'Active catalog row % needs a recorded cost and a positive credit price', NEW.id
                USING ERRCODE = 'check_violation';
        END IF;
        IF (CASE WHEN NEW.id = 'clip-edit' THEN NEW.provider_cost_per_unit * 5 ELSE NEW.provider_cost_per_unit END) * 100000
           > NEW.credits_5s::numeric * 1796 THEN
            RAISE EXCEPTION 'Active catalog row % is priced below the 50 percent floor: cost % needs at least % credits, has %',
                NEW.id, NEW.provider_cost_per_unit,
                ceil((CASE WHEN NEW.id = 'clip-edit' THEN NEW.provider_cost_per_unit * 5 ELSE NEW.provider_cost_per_unit END) * 100000 / 1796),
                NEW.credits_5s
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.model_catalog_margin_floor() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS model_catalog_margin_floor ON public.model_catalog;
CREATE TRIGGER model_catalog_margin_floor
    BEFORE INSERT OR UPDATE OF active, credits_5s, provider_cost_per_unit, id ON public.model_catalog
    FOR EACH ROW EXECUTE FUNCTION public.model_catalog_margin_floor();

-- Every active row, once, so a violator that was never touched fails here.
DO $$
DECLARE breach TEXT;
BEGIN
    SELECT string_agg(id || ' (' || credits_5s || ' credits, cost ' || provider_cost_per_unit || ')', ', ')
      INTO breach
      FROM public.model_catalog
     WHERE active AND (
        provider_cost_per_unit IS NULL OR provider_cost_per_unit < 0 OR credits_5s IS NULL OR credits_5s <= 0
        OR (CASE WHEN id = 'clip-edit' THEN provider_cost_per_unit * 5 ELSE provider_cost_per_unit END) * 100000
           > credits_5s::numeric * 1796);
    IF breach IS NOT NULL THEN
        RAISE EXCEPTION 'Active catalog rows below the 50 percent floor: %', breach;
    END IF;
END $$;

COMMIT;
