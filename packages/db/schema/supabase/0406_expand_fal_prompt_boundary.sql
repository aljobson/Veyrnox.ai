-- Allow the advertised 30,000-character prompt through the durable FAL
-- admission/outbox boundary. JSONB text is measured in UTF-8 bytes here, so
-- reserve the full 4-byte Unicode case plus bounded companion fields.
ALTER TABLE public.fal_dispatch
    DROP CONSTRAINT IF EXISTS fal_dispatch_payload_check;

DO $constraints$
DECLARE
    stale_constraint RECORD;
BEGIN
    FOR stale_constraint IN
        SELECT constraint_row.conname
        FROM pg_constraint AS constraint_row
        JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
        JOIN pg_namespace AS schema_row ON schema_row.oid = table_row.relnamespace
        WHERE schema_row.nspname = 'public'
          AND table_row.relname = 'fal_dispatch'
          AND constraint_row.contype = 'c'
          AND pg_get_constraintdef(constraint_row.oid) LIKE '%payload%'
          AND pg_get_constraintdef(constraint_row.oid) LIKE '%16384%'
    LOOP
        EXECUTE format('ALTER TABLE public.fal_dispatch DROP CONSTRAINT %I', stale_constraint.conname);
    END LOOP;
END
$constraints$;

ALTER TABLE public.fal_dispatch
    ADD CONSTRAINT fal_dispatch_payload_check
    CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 262144);

DO $constraints$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint AS constraint_row
        JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
        JOIN pg_namespace AS schema_row ON schema_row.oid = table_row.relnamespace
        WHERE schema_row.nspname = 'public'
          AND table_row.relname = 'fal_dispatch'
          AND constraint_row.contype = 'c'
          AND pg_get_constraintdef(constraint_row.oid) LIKE '%payload%'
          AND pg_get_constraintdef(constraint_row.oid) LIKE '%16384%'
    ) THEN
        RAISE EXCEPTION 'fal_dispatch retained an old payload boundary';
    END IF;
END
$constraints$;

DO $migration$
DECLARE
    current_definition TEXT;
    expanded_definition TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.admit_fal_dispatch(uuid,text,text,jsonb,jsonb,text,boolean)'::regprocedure
    ) INTO current_definition;

    IF current_definition ~ 'octet_length\(\(?p_inputs\)?::text\)[[:space:]]*>[[:space:]]*16384'
       OR current_definition ~ 'octet_length\(\(?p_payload\)?::text\)[[:space:]]*>[[:space:]]*16384' THEN
        expanded_definition := regexp_replace(
            current_definition,
            'octet_length\(\(?p_inputs\)?::text\)[[:space:]]*>[[:space:]]*16384',
            'octet_length(p_inputs::text) > 262144'
        );
        expanded_definition := regexp_replace(
            expanded_definition,
            'octet_length\(\(?p_payload\)?::text\)[[:space:]]*>[[:space:]]*16384',
            'octet_length(p_payload::text) > 262144',
            'g'
        );
        IF expanded_definition ~ 'octet_length\(\(?p_(inputs|payload)\)?::text\)[[:space:]]*>[[:space:]]*16384'
           OR expanded_definition !~ 'octet_length\(\(?p_inputs\)?::text\)[[:space:]]*>[[:space:]]*262144'
           OR expanded_definition !~ 'octet_length\(\(?p_payload\)?::text\)[[:space:]]*>[[:space:]]*262144' THEN
            RAISE EXCEPTION 'admit_fal_dispatch boundaries were not fully updated';
        END IF;
        EXECUTE expanded_definition;
    ELSIF current_definition !~ 'octet_length\(\(?p_inputs\)?::text\)[[:space:]]*>[[:space:]]*262144'
       OR current_definition !~ 'octet_length\(\(?p_payload\)?::text\)[[:space:]]*>[[:space:]]*262144' THEN
        RAISE EXCEPTION 'admit_fal_dispatch has an unknown inputs or payload boundary';
    END IF;

    SELECT pg_get_functiondef(
        'public.provider_spend_admit_model(uuid,text,text,jsonb,integer)'::regprocedure
    ) INTO current_definition;

    IF current_definition ~ 'octet_length\(\(?p_inputs\)?::text\)[[:space:]]*>[[:space:]]*16384' THEN
        expanded_definition := regexp_replace(
            current_definition,
            'octet_length\(\(?p_inputs\)?::text\)[[:space:]]*>[[:space:]]*16384',
            'octet_length(p_inputs::text) > 262144'
        );
        IF expanded_definition ~ 'octet_length\(\(?p_inputs\)?::text\)[[:space:]]*>[[:space:]]*16384'
           OR expanded_definition !~ 'octet_length\(\(?p_inputs\)?::text\)[[:space:]]*>[[:space:]]*262144' THEN
            RAISE EXCEPTION 'provider_spend_admit_model inputs boundary was not updated';
        END IF;
        EXECUTE expanded_definition;
    ELSIF current_definition !~ 'octet_length\(\(?p_inputs\)?::text\)[[:space:]]*>[[:space:]]*262144' THEN
        RAISE EXCEPTION 'provider_spend_admit_model has an unknown inputs boundary';
    END IF;
END
$migration$;
