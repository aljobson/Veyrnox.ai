-- 0374 — Reordering a model's supplier routes (ADR-0256 phase 4a, decisions 3 and 4).
--
-- The owner approves every order change; nothing reorders itself. model_route_reorder takes
-- the full order of an offer's `active` routes, renumbers its routes (active ones 1..k in the
-- order given, the others after them), makes the new priority-1 route the offer's dispatch by
-- copying its supplier, endpoint and recorded cost onto the catalog row (until phase 6 the
-- catalog row is what dispatch reads), and writes one append-only line to
-- model_route_order_changes. One transaction; the offer's row is locked first.
--
-- What it refuses: an order that is not exactly the offer's active routes; a route without a
-- parity record or with an open breaker; an `unverified` route anywhere but last (ADR decision
-- 1); more than three routes in all; a note shorter than 3 characters. The catalog UPDATE passes
-- through the 0366 margin trigger, so a first route dearer than credits x 0.01796 is refused
-- there, and the customer's price is never touched.
--
-- It cannot know whether the code has an adapter and a capability record for the new first
-- route. The script that calls it (phase 4b) checks that first; a first route the Worker cannot
-- dispatch answers 501 provider_unsupported until it is reordered back.
--
-- Also widens model_routes.priority to 1..9 so a renumbering can pass through temporary values
-- under the UNIQUE (model_id, priority) key, and enforces "at most three routes per offer" with
-- a trigger instead. Service-role only; SECURITY DEFINER, search_path = ''.
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, constraints dropped and re-added.
-- Rollback: reorder back, then DROP FUNCTION and the table.

CREATE TABLE IF NOT EXISTS public.model_route_order_changes (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    model_id    TEXT        NOT NULL REFERENCES public.model_catalog(id) ON DELETE RESTRICT,
    old_order   UUID[]      NOT NULL,
    new_order   UUID[]      NOT NULL,
    note        TEXT        NOT NULL CHECK (length(note) BETWEEN 3 AND 400),
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_route_order_changes_model_idx ON public.model_route_order_changes (model_id, changed_at);
ALTER TABLE public.model_route_order_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_route_order_changes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_route_order_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.model_route_order_changes TO service_role;

CREATE OR REPLACE FUNCTION private.model_route_order_changes_append_only() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'model_route_order_changes is append-only';
END $$;
REVOKE ALL ON FUNCTION private.model_route_order_changes_append_only() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS model_route_order_changes_append_only ON public.model_route_order_changes;
CREATE TRIGGER model_route_order_changes_append_only
    BEFORE UPDATE OR DELETE ON public.model_route_order_changes
    FOR EACH ROW EXECUTE FUNCTION private.model_route_order_changes_append_only();
-- RLS does not cover TRUNCATE, and test-append-only.mjs requires every append-only table to refuse it
-- with the shared guard from 0177.
DROP TRIGGER IF EXISTS model_route_order_changes_no_truncate ON public.model_route_order_changes;
CREATE TRIGGER model_route_order_changes_no_truncate
    BEFORE TRUNCATE ON public.model_route_order_changes
    FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_no_truncate();

ALTER TABLE public.model_routes DROP CONSTRAINT IF EXISTS model_routes_priority_check;
ALTER TABLE public.model_routes ADD CONSTRAINT model_routes_priority_check CHECK (priority BETWEEN 1 AND 9);

CREATE OR REPLACE FUNCTION private.model_routes_max_three() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF (SELECT count(*) FROM public.model_routes WHERE model_id = NEW.model_id) >= 3 THEN
        RAISE EXCEPTION 'an offer has at most three supplier routes';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.model_routes_max_three() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS model_routes_max_three ON public.model_routes;
CREATE TRIGGER model_routes_max_three BEFORE INSERT ON public.model_routes
    FOR EACH ROW EXECUTE FUNCTION private.model_routes_max_three();

CREATE OR REPLACE FUNCTION public.model_route_reorder(
    p_model_id text, p_route_ids uuid[], p_note text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    m public.model_catalog%ROWTYPE;
    first_route public.model_routes%ROWTYPE;
    old_order uuid[];
    active_ids uuid[];
    others uuid[];
    rid uuid;
    pos integer;
    affected BIGINT;
BEGIN
    IF p_note IS NULL OR length(p_note) < 3 THEN RETURN jsonb_build_object('ok', false, 'code', 'note_required'); END IF;
    SELECT * INTO m FROM public.model_catalog WHERE id = p_model_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'model_not_found'); END IF;

    SELECT array_agg(id ORDER BY priority) INTO old_order FROM public.model_routes WHERE model_id = p_model_id;
    SELECT array_agg(id) INTO active_ids FROM public.model_routes WHERE model_id = p_model_id AND state = 'active';
    SELECT array_agg(id ORDER BY priority) INTO others FROM public.model_routes WHERE model_id = p_model_id AND state <> 'active';

    IF p_route_ids IS NULL OR cardinality(p_route_ids) < 1
       OR (SELECT count(DISTINCT x) FROM unnest(p_route_ids) x) <> cardinality(p_route_ids)
       OR active_ids IS NULL
       OR NOT (p_route_ids @> active_ids AND active_ids @> p_route_ids) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'order_must_list_every_active_route');
    END IF;
    IF cardinality(p_route_ids) + COALESCE(cardinality(others), 0) > 3 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'too_many_routes');
    END IF;
    IF EXISTS (SELECT 1 FROM public.model_routes WHERE id = ANY (p_route_ids)
               AND (parity_record IS NULL OR breaker_opened_at IS NOT NULL)) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'route_not_eligible');
    END IF;
    pos := 0;
    FOREACH rid IN ARRAY p_route_ids LOOP
        pos := pos + 1;
        IF pos < cardinality(p_route_ids)
           AND (SELECT provenance FROM public.model_routes WHERE id = rid) = 'unverified' THEN
            RETURN jsonb_build_object('ok', false, 'code', 'unverified_route_must_be_last');
        END IF;
    END LOOP;

    -- Renumber through temporary values so UNIQUE (model_id, priority) is never violated.
    UPDATE public.model_routes SET priority = priority + 3, updated_at = now() WHERE model_id = p_model_id;
    pos := 0;
    FOREACH rid IN ARRAY p_route_ids LOOP
        pos := pos + 1;
        UPDATE public.model_routes SET priority = pos WHERE id = rid;
    END LOOP;
    IF others IS NOT NULL THEN
        FOREACH rid IN ARRAY others LOOP
            pos := pos + 1;
            UPDATE public.model_routes SET priority = pos WHERE id = rid;
        END LOOP;
    END IF;

    -- The first route becomes the offer's dispatch (supplier, endpoint, cost) until phase 6.
    SELECT * INTO first_route FROM public.model_routes WHERE id = p_route_ids[1];
    UPDATE public.model_catalog
       SET provider = first_route.supplier, provider_endpoint = first_route.endpoint,
           provider_cost_per_unit = first_route.cost_per_unit, cost_unit = first_route.cost_unit,
           billing_seconds = first_route.billing_seconds, updated_at = now()
     WHERE id = p_model_id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one catalog row for %, updated %', p_model_id, affected;
    END IF;

    INSERT INTO public.model_route_order_changes (model_id, old_order, new_order, note)
    VALUES (p_model_id, old_order, (SELECT array_agg(id ORDER BY priority) FROM public.model_routes WHERE model_id = p_model_id), p_note);
    RETURN jsonb_build_object('ok', true, 'first_supplier', first_route.supplier, 'first_endpoint', first_route.endpoint);
END;
$$;

REVOKE ALL ON FUNCTION public.model_route_reorder(text, uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.model_route_reorder(text, uuid[], text) TO service_role;
