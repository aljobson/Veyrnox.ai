-- 0321: brand-scoped Ads and Commerce workspaces.
-- These records are operational drafts. Provider launch/sync remains closed
-- until each provider grants the required app permissions and credentials.
BEGIN;

CREATE TABLE IF NOT EXISTS public.social_ad_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.social_brands(id) ON DELETE CASCADE,
  source_post_id UUID NULL REFERENCES public.social_posts(id) ON DELETE SET NULL,
  created_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  network TEXT NOT NULL CHECK (network IN ('meta','google','tiktok','linkedin','twitter')),
  mode TEXT NOT NULL CHECK (mode IN ('standalone','boost')),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  objective TEXT NOT NULL CHECK (objective IN ('awareness','traffic','engagement','leads','sales')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','paused','active','completed')),
  daily_budget_cents INTEGER NOT NULL CHECK (daily_budget_cents BETWEEN 100 AND 100000000),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  audience JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(audience)='object' AND pg_column_size(audience)<=16384),
  destination_url TEXT NULL CHECK (destination_url IS NULL OR destination_url ~ '^https://' AND char_length(destination_url)<=2048),
  lead_form_url TEXT NULL CHECK (lead_form_url IS NULL OR lead_form_url ~ '^https://' AND char_length(lead_form_url)<=2048),
  starts_at TIMESTAMPTZ NULL,
  ends_at TIMESTAMPTZ NULL,
  provider_campaign_id TEXT NULL CHECK (provider_campaign_id IS NULL OR char_length(provider_campaign_id)<=256),
  provider_state JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provider_state)='object' AND pg_column_size(provider_state)<=16384),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (mode='standalone' OR source_post_id IS NOT NULL),
  CHECK (ends_at IS NULL OR starts_at IS NOT NULL AND ends_at>starts_at)
);
CREATE INDEX IF NOT EXISTS social_ad_campaigns_brand_updated_idx ON public.social_ad_campaigns(brand_id,updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS social_ad_campaigns_source_post_idx ON public.social_ad_campaigns(source_post_id) WHERE source_post_id IS NOT NULL;
ALTER TABLE public.social_ad_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_ad_campaigns FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_ad_campaigns FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.social_commerce_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.social_brands(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','shopify','woocommerce')),
  external_id TEXT NULL CHECK (external_id IS NULL OR char_length(external_id) BETWEEN 1 AND 256),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  description TEXT NULL CHECK (description IS NULL OR char_length(description)<=5000),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  price_cents INTEGER NOT NULL CHECK (price_cents BETWEEN 0 AND 100000000),
  compare_at_price_cents INTEGER NULL CHECK (compare_at_price_cents IS NULL OR compare_at_price_cents>=0),
  inventory_quantity INTEGER NOT NULL DEFAULT 0 CHECK (inventory_quantity BETWEEN 0 AND 100000000),
  product_url TEXT NULL CHECK (product_url IS NULL OR product_url ~ '^https://' AND char_length(product_url)<=2048),
  image_url TEXT NULL CHECK (image_url IS NULL OR image_url ~ '^https://' AND char_length(image_url)<=2048),
  variants JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(variants)='array' AND jsonb_array_length(variants)<=100 AND pg_column_size(variants)<=65536),
  collections TEXT[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(collections)<=20),
  discount JSONB NULL CHECK (discount IS NULL OR jsonb_typeof(discount)='object' AND pg_column_size(discount)<=2048),
  synced_at TIMESTAMPTZ NULL,
  sync_error TEXT NULL CHECK (sync_error IS NULL OR char_length(sync_error)<=500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_commerce_products_brand_updated_idx ON public.social_commerce_products(brand_id,updated_at DESC,id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS social_commerce_products_external_idx ON public.social_commerce_products(brand_id,source,external_id) WHERE external_id IS NOT NULL;
ALTER TABLE public.social_commerce_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_commerce_products FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_commerce_products FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.list_social_ad_campaigns(p_auth_id TEXT,p_brand_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor','reviewer','analyst','viewer'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  RETURN jsonb_build_object('ok',true,'campaigns',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',c.id,'source_post_id',c.source_post_id,'network',c.network,'mode',c.mode,'name',c.name,'objective',c.objective,
    'status',c.status,'daily_budget_cents',c.daily_budget_cents,'currency',c.currency,'audience',c.audience,
    'destination_url',c.destination_url,'lead_form_url',c.lead_form_url,'starts_at',c.starts_at,'ends_at',c.ends_at,
    'provider_campaign_id',c.provider_campaign_id,'updated_at',c.updated_at) ORDER BY c.updated_at DESC,c.id DESC)
    FROM public.social_ad_campaigns c WHERE c.brand_id=p_brand_id),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.save_social_ad_campaign(
  p_auth_id TEXT,p_brand_id UUID,p_id UUID,p_source_post_id UUID,p_network TEXT,p_mode TEXT,p_name TEXT,p_objective TEXT,
  p_daily_budget_cents INTEGER,p_currency TEXT,p_audience JSONB,p_destination_url TEXT,p_lead_form_url TEXT,
  p_starts_at TIMESTAMPTZ,p_ends_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_id UUID;v_created BOOLEAN:=false;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;v_actor:=(v_context->>'actor_id')::UUID;
  p_name:=btrim(coalesce(p_name,''));p_currency:=upper(btrim(coalesce(p_currency,'')));
  p_destination_url:=nullif(btrim(coalesce(p_destination_url,'')),'');p_lead_form_url:=nullif(btrim(coalesce(p_lead_form_url,'')),'');
  IF p_network NOT IN ('meta','google','tiktok','linkedin','twitter') OR p_mode NOT IN ('standalone','boost')
    OR char_length(p_name) NOT BETWEEN 1 AND 120 OR p_objective NOT IN ('awareness','traffic','engagement','leads','sales')
    OR p_daily_budget_cents NOT BETWEEN 100 AND 100000000 OR p_currency !~ '^[A-Z]{3}$'
    OR coalesce(jsonb_typeof(p_audience),'')<>'object' OR pg_column_size(p_audience)>16384
    OR p_destination_url IS NOT NULL AND (p_destination_url !~ '^https://' OR char_length(p_destination_url)>2048)
    OR p_lead_form_url IS NOT NULL AND (p_lead_form_url !~ '^https://' OR char_length(p_lead_form_url)>2048)
    OR p_ends_at IS NOT NULL AND (p_starts_at IS NULL OR p_ends_at<=p_starts_at)
    OR p_mode='boost' AND p_source_post_id IS NULL
  THEN RETURN jsonb_build_object('ok',false,'code','INVALID_CAMPAIGN'); END IF;
  IF p_source_post_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.social_posts p WHERE p.id=p_source_post_id AND p.brand_id=p_brand_id) THEN
    RETURN jsonb_build_object('ok',false,'code','POST_NOT_FOUND'); END IF;
  IF p_id IS NULL THEN
    IF (SELECT count(*) FROM public.social_ad_campaigns c WHERE c.brand_id=p_brand_id)>=100 THEN RETURN jsonb_build_object('ok',false,'code','CAMPAIGN_LIMIT'); END IF;
    INSERT INTO public.social_ad_campaigns(brand_id,source_post_id,created_by_user_id,network,mode,name,objective,daily_budget_cents,currency,audience,destination_url,lead_form_url,starts_at,ends_at)
      VALUES(p_brand_id,p_source_post_id,v_actor,p_network,p_mode,p_name,p_objective,p_daily_budget_cents,p_currency,p_audience,p_destination_url,p_lead_form_url,p_starts_at,p_ends_at)
      RETURNING id INTO v_id;v_created:=true;
  ELSE
    UPDATE public.social_ad_campaigns SET source_post_id=p_source_post_id,network=p_network,mode=p_mode,name=p_name,objective=p_objective,
      daily_budget_cents=p_daily_budget_cents,currency=p_currency,audience=p_audience,destination_url=p_destination_url,
      lead_form_url=p_lead_form_url,starts_at=p_starts_at,ends_at=p_ends_at,updated_at=now()
      WHERE id=p_id AND brand_id=p_brand_id AND status='draft' RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','CAMPAIGN_NOT_EDITABLE'); END IF;
  END IF;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail)
    VALUES(v_actor,p_brand_id,CASE WHEN v_created THEN 'create_ad_campaign' ELSE 'update_ad_campaign' END,v_id,jsonb_build_object('network',p_network,'mode',p_mode));
  RETURN jsonb_build_object('ok',true,'campaign_id',v_id,'created',v_created);
END $$;

CREATE OR REPLACE FUNCTION public.delete_social_ad_campaign(p_auth_id TEXT,p_brand_id UUID,p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_id UUID;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;v_actor:=(v_context->>'actor_id')::UUID;
  DELETE FROM public.social_ad_campaigns WHERE id=p_id AND brand_id=p_brand_id AND status='draft' RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','CAMPAIGN_NOT_EDITABLE'); END IF;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id) VALUES(v_actor,p_brand_id,'delete_ad_campaign',v_id);
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.list_social_commerce_products(p_auth_id TEXT,p_brand_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor','reviewer','analyst','viewer'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;
  RETURN jsonb_build_object('ok',true,'products',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',p.id,'source',p.source,'external_id',p.external_id,'title',p.title,'description',p.description,'status',p.status,
    'currency',p.currency,'price_cents',p.price_cents,'compare_at_price_cents',p.compare_at_price_cents,
    'inventory_quantity',p.inventory_quantity,'product_url',p.product_url,'image_url',p.image_url,'variants',p.variants,
    'collections',to_jsonb(p.collections),'discount',p.discount,'synced_at',p.synced_at,'sync_error',p.sync_error,'updated_at',p.updated_at)
    ORDER BY p.updated_at DESC,p.id DESC) FROM public.social_commerce_products p WHERE p.brand_id=p_brand_id),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.save_social_commerce_product(
  p_auth_id TEXT,p_brand_id UUID,p_id UUID,p_title TEXT,p_description TEXT,p_currency TEXT,p_price_cents INTEGER,
  p_compare_at_price_cents INTEGER,p_inventory_quantity INTEGER,p_product_url TEXT,p_image_url TEXT,p_variants JSONB,
  p_collections TEXT[],p_discount JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_id UUID;v_created BOOLEAN:=false;v_variant JSONB;v_collections TEXT[];
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;v_actor:=(v_context->>'actor_id')::UUID;
  p_title:=btrim(coalesce(p_title,''));p_description:=nullif(btrim(coalesce(p_description,'')),'');p_currency:=upper(btrim(coalesce(p_currency,'')));
  p_product_url:=nullif(btrim(coalesce(p_product_url,'')),'');p_image_url:=nullif(btrim(coalesce(p_image_url,'')),'');
  IF char_length(p_title) NOT BETWEEN 1 AND 160 OR p_description IS NOT NULL AND char_length(p_description)>5000
    OR p_currency !~ '^[A-Z]{3}$' OR p_price_cents NOT BETWEEN 0 AND 100000000
    OR p_compare_at_price_cents IS NOT NULL AND p_compare_at_price_cents NOT BETWEEN 0 AND 100000000
    OR p_inventory_quantity NOT BETWEEN 0 AND 100000000 OR coalesce(jsonb_typeof(p_variants),'')<>'array'
    OR jsonb_array_length(p_variants)>100 OR pg_column_size(p_variants)>65536 OR cardinality(coalesce(p_collections,'{}'::text[]))>20
    OR p_product_url IS NOT NULL AND (p_product_url !~ '^https://' OR char_length(p_product_url)>2048)
    OR p_image_url IS NOT NULL AND (p_image_url !~ '^https://' OR char_length(p_image_url)>2048)
  THEN RETURN jsonb_build_object('ok',false,'code','INVALID_PRODUCT'); END IF;
  FOR v_variant IN SELECT value FROM jsonb_array_elements(p_variants) LOOP
    IF jsonb_typeof(v_variant)<>'object' OR char_length(btrim(coalesce(v_variant->>'title',''))) NOT BETWEEN 1 AND 120
      OR coalesce(v_variant->>'price_cents','') !~ '^[0-9]{1,9}$' OR (v_variant->>'price_cents')::INTEGER>100000000
      OR coalesce(v_variant->>'inventory_quantity','') !~ '^[0-9]{1,9}$' OR (v_variant->>'inventory_quantity')::INTEGER>100000000
      OR v_variant ? 'sku' AND char_length(v_variant->>'sku')>100
    THEN RETURN jsonb_build_object('ok',false,'code','INVALID_VARIANT'); END IF;
  END LOOP;
  IF p_discount IS NOT NULL AND (jsonb_typeof(p_discount)<>'object' OR coalesce(p_discount->>'type','') NOT IN ('percent','fixed')
    OR coalesce(p_discount->>'value','') !~ '^[0-9]{1,9}$' OR (p_discount->>'value')::INTEGER>100000000
    OR p_discount->>'type'='percent' AND (p_discount->>'value')::INTEGER>10000)
  THEN RETURN jsonb_build_object('ok',false,'code','INVALID_DISCOUNT'); END IF;
  SELECT coalesce(array_agg(name ORDER BY name),'{}'::text[]) INTO v_collections FROM (
    SELECT DISTINCT btrim(x) name FROM unnest(coalesce(p_collections,'{}'::text[])) x
    WHERE char_length(btrim(x)) BETWEEN 1 AND 80) q;
  IF cardinality(v_collections)<>cardinality(coalesce(p_collections,'{}'::text[])) THEN RETURN jsonb_build_object('ok',false,'code','INVALID_COLLECTIONS'); END IF;
  IF p_id IS NULL THEN
    IF (SELECT count(*) FROM public.social_commerce_products p WHERE p.brand_id=p_brand_id)>=1000 THEN RETURN jsonb_build_object('ok',false,'code','PRODUCT_LIMIT'); END IF;
    INSERT INTO public.social_commerce_products(brand_id,created_by_user_id,title,description,currency,price_cents,compare_at_price_cents,inventory_quantity,product_url,image_url,variants,collections,discount)
      VALUES(p_brand_id,v_actor,p_title,p_description,p_currency,p_price_cents,p_compare_at_price_cents,p_inventory_quantity,p_product_url,p_image_url,p_variants,v_collections,p_discount)
      RETURNING id INTO v_id;v_created:=true;
  ELSE
    UPDATE public.social_commerce_products SET title=p_title,description=p_description,currency=p_currency,price_cents=p_price_cents,
      compare_at_price_cents=p_compare_at_price_cents,inventory_quantity=p_inventory_quantity,product_url=p_product_url,image_url=p_image_url,
      variants=p_variants,collections=v_collections,discount=p_discount,updated_at=now()
      WHERE id=p_id AND brand_id=p_brand_id AND source='manual' AND status<>'archived' RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PRODUCT_NOT_EDITABLE'); END IF;
  END IF;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id,detail)
    VALUES(v_actor,p_brand_id,CASE WHEN v_created THEN 'create_product' ELSE 'update_product' END,v_id,jsonb_build_object('variants',jsonb_array_length(p_variants)));
  RETURN jsonb_build_object('ok',true,'product_id',v_id,'created',v_created);
END $$;

CREATE OR REPLACE FUNCTION public.archive_social_commerce_product(p_auth_id TEXT,p_brand_id UUID,p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_context JSONB;v_actor UUID;v_id UUID;
BEGIN
  v_context:=public.social_brand_role_context(p_auth_id,p_brand_id,ARRAY['owner','manager','editor'],true);
  IF NOT coalesce((v_context->>'ok')::BOOLEAN,false) THEN RETURN v_context; END IF;v_actor:=(v_context->>'actor_id')::UUID;
  UPDATE public.social_commerce_products SET status='archived',updated_at=now() WHERE id=p_id AND brand_id=p_brand_id AND status<>'archived' RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','PRODUCT_NOT_FOUND'); END IF;
  INSERT INTO public.social_account_actions(actor_id,brand_id,action,target_id) VALUES(v_actor,p_brand_id,'archive_product',v_id);
  RETURN jsonb_build_object('ok',true);
END $$;

DO $$ DECLARE fn TEXT;BEGIN FOREACH fn IN ARRAY ARRAY[
  'public.list_social_ad_campaigns(text,uuid)',
  'public.save_social_ad_campaign(text,uuid,uuid,uuid,text,text,text,text,integer,text,jsonb,text,text,timestamptz,timestamptz)',
  'public.delete_social_ad_campaign(text,uuid,uuid)',
  'public.list_social_commerce_products(text,uuid)',
  'public.save_social_commerce_product(text,uuid,uuid,text,text,text,integer,integer,integer,text,text,jsonb,text[],jsonb)',
  'public.archive_social_commerce_product(text,uuid,uuid)'
] LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||fn||' FROM PUBLIC,anon,authenticated';EXECUTE 'GRANT EXECUTE ON FUNCTION '||fn||' TO service_role';END LOOP;END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
