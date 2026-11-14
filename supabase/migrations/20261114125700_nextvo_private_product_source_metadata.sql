-- NEXTVO Admin incremental migration: private source metadata and atomic product save.
-- Apply only after the existing Admin base schema (including nextvo_admin_product_details,
-- products, product_images, product_variants, and nextvo_inventory_history) is installed.
-- This migration intentionally does not alter RLS policies or table grants; confirm those
-- separately for the target project. The migration has not been applied to any live database.

DO $$
BEGIN
  IF to_regclass('public.nextvo_admin_product_details') IS NULL THEN
    RAISE EXCEPTION 'NEXTVO Admin base schema is missing: install the existing Admin setup before this migration';
  END IF;
END;
$$;

ALTER TABLE public.nextvo_admin_product_details
  ADD COLUMN IF NOT EXISTS local_sourcing_cost_ngn numeric(12,2)
  CHECK (local_sourcing_cost_ngn IS NULL OR local_sourcing_cost_ngn >= 0);
ALTER TABLE public.nextvo_admin_product_details
  ADD COLUMN IF NOT EXISTS source_data jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(source_data) = 'object');

-- Repair nullable legacy values before enforcing the current metadata contract.
ALTER TABLE public.nextvo_admin_product_details
  ALTER COLUMN source_data SET DEFAULT '{}'::jsonb;
UPDATE public.nextvo_admin_product_details
  SET source_data = '{}'::jsonb
  WHERE source_data IS NULL;
ALTER TABLE public.nextvo_admin_product_details
  ALTER COLUMN source_data SET NOT NULL;

-- IF NOT EXISTS on ADD COLUMN does not add constraints when a column already exists.
-- Use the same names PostgreSQL assigns to the inline checks in admin-setup.sql.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.nextvo_admin_product_details'::regclass
      AND conname = 'nextvo_admin_product_details_local_sourcing_cost_ngn_check'
  ) THEN
    ALTER TABLE public.nextvo_admin_product_details
      ADD CONSTRAINT nextvo_admin_product_details_local_sourcing_cost_ngn_check
      CHECK (local_sourcing_cost_ngn IS NULL OR local_sourcing_cost_ngn >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.nextvo_admin_product_details'::regclass
      AND conname = 'nextvo_admin_product_details_source_data_check'
  ) THEN
    ALTER TABLE public.nextvo_admin_product_details
      ADD CONSTRAINT nextvo_admin_product_details_source_data_check
      CHECK (jsonb_typeof(source_data) = 'object');
  END IF;
END;
$$;

-- Atomic catalogue save. Internal supplier cost/URL remains separate from public products.
create or replace function public.nextvo_admin_save_product(
  p_product jsonb,
  p_private jsonb,
  p_images jsonb default '[]'::jsonb,
  p_variants jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_status text := coalesce(p_private ->> 'status', 'draft');
  v_category_id uuid := nullif(p_product ->> 'category_id','')::uuid;
  v_stock integer := coalesce(nullif(p_product ->> 'stock_quantity','')::integer, 0);
  v_image jsonb;
  v_variant jsonb;
  v_variant_id uuid;
  v_old_stock integer := 0;
  v_old_variant_stock integer := 0;
begin
  if not public.nextvo_is_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  if v_status not in ('draft','published','unpublished','unavailable') then raise exception 'Invalid publishing state'; end if;
  if nullif(trim(p_product ->> 'name'),'') is null then raise exception 'Product name is required'; end if;
  if nullif(trim(p_product ->> 'slug'),'') is null then raise exception 'Product slug is required'; end if;
  if v_category_id is null then raise exception 'Choose a category'; end if;
  if coalesce((p_product ->> 'price_ngn')::numeric, -1) < 0 then raise exception 'Selling price cannot be negative'; end if;
  if v_stock < 0 then raise exception 'Stock cannot be negative'; end if;
  if nullif(p_private ->> 'local_sourcing_cost_ngn','') is not null and (p_private ->> 'local_sourcing_cost_ngn')::numeric < 0 then raise exception 'Local sourcing cost cannot be negative'; end if;
  if jsonb_typeof(coalesce(p_private -> 'source_data','{}'::jsonb)) <> 'object' then raise exception 'Original supplier source data must be an object'; end if;
  if jsonb_typeof(coalesce(p_private -> 'source_image_urls','[]'::jsonb)) <> 'array' then raise exception 'Image source metadata must be an array'; end if;

  if nullif(p_product ->> 'id','') is null then
    insert into public.products (category_id, subcategory_id, slug, name, description, brand, price_ngn, compare_at_price_ngn, currency_code, image_url, stock_quantity, featured, is_new_arrival, active, attributes, search_terms)
    values (
      v_category_id, nullif(p_product ->> 'subcategory_id','')::uuid, trim(p_product ->> 'slug'), trim(p_product ->> 'name'), coalesce(p_product ->> 'description',''), nullif(trim(p_product ->> 'brand'),''), (p_product ->> 'price_ngn')::numeric,
      nullif(p_product ->> 'compare_at_price_ngn','')::numeric, coalesce(nullif(p_product ->> 'currency_code',''),'NGN'), nullif(p_product ->> 'image_url',''), v_stock,
      coalesce((p_product ->> 'featured')::boolean,false), coalesce((p_product ->> 'is_new_arrival')::boolean,false), v_status = 'published', coalesce(p_product -> 'attributes','{}'::jsonb), coalesce(array(select jsonb_array_elements_text(coalesce(p_product -> 'search_terms','[]'::jsonb))), '{}'::text[])
    ) returning id into v_id;
  else
    v_id := (p_product ->> 'id')::uuid;
    select stock_quantity into v_old_stock from public.products where id=v_id for update;
    if not found then raise exception 'Product not found'; end if;
    update public.products set
      category_id = v_category_id,
      subcategory_id = nullif(p_product ->> 'subcategory_id','')::uuid,
      slug = trim(p_product ->> 'slug'), name = trim(p_product ->> 'name'), description = coalesce(p_product ->> 'description',''), brand = nullif(trim(p_product ->> 'brand'),''),
      price_ngn = (p_product ->> 'price_ngn')::numeric, compare_at_price_ngn = nullif(p_product ->> 'compare_at_price_ngn','')::numeric,
      currency_code = coalesce(nullif(p_product ->> 'currency_code',''),'NGN'), image_url = nullif(p_product ->> 'image_url',''), stock_quantity = v_stock,
      featured = coalesce((p_product ->> 'featured')::boolean,false), is_new_arrival = coalesce((p_product ->> 'is_new_arrival')::boolean,false), active = v_status = 'published',
      attributes = coalesce(p_product -> 'attributes','{}'::jsonb), search_terms = coalesce(array(select jsonb_array_elements_text(coalesce(p_product -> 'search_terms','[]'::jsonb))), '{}'::text[])
    where id = v_id;
  end if;

  if v_stock <> coalesce(v_old_stock,0) then
    insert into public.nextvo_inventory_history(product_id,previous_quantity,change_quantity,new_quantity,reason,adjusted_by)
    values(v_id,coalesce(v_old_stock,0),v_stock-coalesce(v_old_stock,0),v_stock,'Stock changed in product editor',auth.uid());
  end if;

  insert into public.nextvo_admin_product_details as current_details(product_id,short_description,supplier_name,supplier_product_url,supplier_price,supplier_currency,local_sourcing_cost_ngn,source_data,source_image_urls,status,updated_by,updated_at)
  values (v_id,coalesce(p_private ->> 'short_description',''),coalesce(p_private ->> 'supplier_name',''),coalesce(p_private ->> 'supplier_product_url',''),nullif(p_private ->> 'supplier_price','')::numeric,coalesce(nullif(p_private ->> 'supplier_currency',''),'NGN'),nullif(p_private ->> 'local_sourcing_cost_ngn','')::numeric,coalesce(p_private -> 'source_data','{}'::jsonb),coalesce(p_private -> 'source_image_urls','[]'::jsonb),v_status,auth.uid(),now())
  on conflict(product_id) do update set short_description=excluded.short_description,supplier_name=excluded.supplier_name,supplier_product_url=excluded.supplier_product_url,supplier_price=excluded.supplier_price,supplier_currency=excluded.supplier_currency,local_sourcing_cost_ngn=excluded.local_sourcing_cost_ngn,source_data=coalesce(p_private -> 'source_data',current_details.source_data),source_image_urls=coalesce(p_private -> 'source_image_urls',current_details.source_image_urls),status=excluded.status,updated_by=excluded.updated_by,updated_at=now();

  delete from public.product_images where product_id = v_id;
  for v_image in select value from jsonb_array_elements(coalesce(p_images,'[]'::jsonb)) loop
    if nullif(trim(v_image ->> 'image_url'),'') is not null then
      insert into public.product_images(product_id,image_url,alt_text,sort_order) values (v_id,trim(v_image ->> 'image_url'),coalesce(v_image ->> 'alt_text',trim(p_product ->> 'name')),coalesce((v_image ->> 'sort_order')::integer,0));
    end if;
  end loop;

  -- Preserve existing variant IDs (and any cart references); mark omitted variants inactive.
  update public.product_variants set active = false where product_id = v_id;
  for v_variant in select value from jsonb_array_elements(coalesce(p_variants,'[]'::jsonb)) loop
    v_variant_id := nullif(v_variant ->> 'id','')::uuid;
    if v_variant_id is not null and exists(select 1 from public.product_variants where id=v_variant_id and product_id=v_id) then
      select stock_quantity into v_old_variant_stock from public.product_variants where id=v_variant_id and product_id=v_id for update;
      update public.product_variants set sku=nullif(v_variant ->> 'sku',''), label=coalesce(nullif(v_variant ->> 'label',''),'Option'), options=coalesce(v_variant -> 'options','{}'::jsonb), price_ngn=nullif(v_variant ->> 'price_ngn','')::numeric, stock_quantity=coalesce(nullif(v_variant ->> 'stock_quantity','')::integer,0), active=true, updated_at=now() where id=v_variant_id and product_id=v_id;
      if coalesce(nullif(v_variant ->> 'stock_quantity','')::integer,0) <> coalesce(v_old_variant_stock,0) then
        insert into public.nextvo_inventory_history(product_id,variant_id,previous_quantity,change_quantity,new_quantity,reason,adjusted_by)
        values(v_id,v_variant_id,coalesce(v_old_variant_stock,0),coalesce(nullif(v_variant ->> 'stock_quantity','')::integer,0)-coalesce(v_old_variant_stock,0),coalesce(nullif(v_variant ->> 'stock_quantity','')::integer,0),'Variant stock changed in product editor',auth.uid());
      end if;
    else
      insert into public.product_variants(product_id,sku,label,options,price_ngn,stock_quantity,active)
      values(v_id,nullif(v_variant ->> 'sku',''),coalesce(nullif(v_variant ->> 'label',''),'Option'),coalesce(v_variant -> 'options','{}'::jsonb),nullif(v_variant ->> 'price_ngn','')::numeric,coalesce(nullif(v_variant ->> 'stock_quantity','')::integer,0),true) returning id into v_variant_id;
      if coalesce(nullif(v_variant ->> 'stock_quantity','')::integer,0) > 0 then
        insert into public.nextvo_inventory_history(product_id,variant_id,previous_quantity,change_quantity,new_quantity,reason,adjusted_by)
        values(v_id,v_variant_id,0,coalesce(nullif(v_variant ->> 'stock_quantity','')::integer,0),coalesce(nullif(v_variant ->> 'stock_quantity','')::integer,0),'Initial variant stock',auth.uid());
      end if;
    end if;
  end loop;
  return v_id;
end;
$$;
revoke all on function public.nextvo_admin_save_product(jsonb,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.nextvo_admin_save_product(jsonb,jsonb,jsonb,jsonb) to authenticated;
