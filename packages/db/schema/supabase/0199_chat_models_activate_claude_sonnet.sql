-- Activate Claude Sonnet 5.5 for chat (ADR-0067), the first premium model. It was checked live on 2026-10-05
-- through the repository's own adapter and message builder: a streamed reply with reasoning effort low and a
-- 4,096-token cap, an answer from a picture, and (on staging) Web search and an image through the real routes.
-- Base 4 Credits per reply; Thinking +3, Web search +3, Images +3 (0197, 0198).
-- Apply only through the owner-approved workflow. CHAT_ENABLED stays "false" in production vars until the owner
-- flips it, so activating the row alone exposes nothing. The predicate pins the slug and price: a repriced or
-- edited row fails loudly instead of activating something nobody approved.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true, updated_at = now()
     WHERE id = 'chat-claude-sonnet-5.5' AND provider = 'openrouter-chat'
       AND provider_endpoint = 'anthropic/claude-sonnet-5.5' AND modality = 'text'
       AND credits_5s = 4 AND provider_cost_per_unit = 0.0590 AND gated_flag = false;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one verified Claude Sonnet 5.5 chat row, updated %', affected;
    END IF;
END $$;
