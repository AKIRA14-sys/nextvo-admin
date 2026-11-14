-- NEXTVO Admin extension for the EXISTING storefront Supabase project.
-- Review before applying. This never creates a second database or a service-role browser key.
-- Administrator membership is read only from auth.users.app_metadata, which customers cannot edit.
-- Existing installations should apply supabase/migrations/20261114125700_nextvo_private_product_source_metadata.sql
-- before using the updated product editor. This file remains the full setup/bootstrap equivalent;
-- live schema/RLS compatibility has not been verified for any target project.

begin;

create or replace function public.nextvo_is_admin()
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select
    coalesce(auth.jwt() -> 'app_metadata' ->> 'is_admin', 'false') = 'true'
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in
      ('admin', 'super_admin')
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') in
      ('admin', 'super_admin');
$$;
revoke all on function public.nextvo_is_admin() from public, anon;
grant execute on function public.nextvo_is_admin() to authenticated;

create table if not exists public.nextvo_admin_product_details (
  product_id uuid primary key references public.products(id) on delete cascade,
  short_description text not null default '',
  supplier_name text not null default '',
  supplier_product_url text not null default '',
  supplier_price numeric(12,2) check (supplier_price is null or supplier_price >= 0),
  supplier_currency text not null default 'NGN',
  local_sourcing_cost_ngn numeric(12,2) check (local_sourcing_cost_ngn is null or local_sourcing_cost_ngn >= 0),
  source_data jsonb not null default '{}'::jsonb check (jsonb_typeof(source_data) = 'object'),
  source_image_urls jsonb not null default '[]'::jsonb check (jsonb_typeof(source_image_urls) = 'array'),
  status text not null default 'draft' check (status in ('draft','published','unpublished','unavailable')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.nextvo_admin_product_details
  add column if not exists source_image_urls jsonb not null default '[]'::jsonb;
alter table public.nextvo_admin_product_details
  add column if not exists local_sourcing_cost_ngn numeric(12,2) check (local_sourcing_cost_ngn is null or local_sourcing_cost_ngn >= 0);
alter table public.nextvo_admin_product_details
  add column if not exists source_data jsonb not null default '{}'::jsonb check (jsonb_typeof(source_data) = 'object');

create table if not exists public.nextvo_inventory_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  previous_quantity integer not null,
  change_quantity integer not null,
  new_quantity integer not null,
  reason text not null,
  adjusted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.nextvo_inventory_history add column if not exists variant_id uuid references public.product_variants(id) on delete set null;
create index if not exists nextvo_inventory_history_product_created_idx on public.nextvo_inventory_history(product_id, created_at desc);

create table if not exists public.nextvo_import_history (
  id uuid primary key default gen_random_uuid(),
  source_url text not null,
  supplier_host text not null,
  status text not null check (status in ('retrieved','failed','saved')),
  imported_title text not null default '',
  error_summary text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists nextvo_import_history_created_idx on public.nextvo_import_history(created_at desc);

-- Per-admin database-backed throttling for metadata and image imports. This is enforced
-- atomically across app instances and is required before the importer endpoints are enabled.
create table if not exists public.nextvo_import_rate_limits (
  admin_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0)
);

create or replace function public.nextvo_consume_import_rate_limit(p_window_seconds integer, p_max_requests integer)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
begin
  if not public.nextvo_is_admin() or auth.uid() is null then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_window_seconds is distinct from 60 or p_max_requests is distinct from 10 then
    raise exception 'Importer rate limit is fixed at 10 requests per minute';
  end if;

  insert into public.nextvo_import_rate_limits as limits(admin_id, window_started_at, request_count)
  values (auth.uid(), v_now, 1)
  on conflict (admin_id) do update set
    window_started_at = case
      when limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) then v_now
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) then 1
      else limits.request_count + 1
    end
  returning request_count into v_count;
  return v_count <= p_max_requests;
end;
$$;
revoke all on function public.nextvo_consume_import_rate_limit(integer,integer) from public, anon;
grant execute on function public.nextvo_consume_import_rate_limit(integer,integer) to authenticated;

create table if not exists public.nextvo_store_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists public.nextvo_verified_payments (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  payment_reference text not null,
  order_id uuid not null references public.orders(id) on delete restrict,
  amount numeric(12,2) not null check (amount >= 0),
  currency_code text not null default 'NGN',
  payment_method text not null default 'Not recorded',
  status text not null check (status in ('pending','verified','failed','refunded')),
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  unique(provider,payment_reference),
  check ((status = 'verified') = (verified_at is not null))
);
create index if not exists nextvo_verified_payments_order_idx on public.nextvo_verified_payments(order_id,created_at desc);
create index if not exists nextvo_verified_payments_verified_idx on public.nextvo_verified_payments(verified_at desc) where status='verified';

alter table public.nextvo_admin_product_details enable row level security;
alter table public.nextvo_inventory_history enable row level security;
alter table public.nextvo_import_history enable row level security;
alter table public.nextvo_import_rate_limits enable row level security;
alter table public.nextvo_store_settings enable row level security;
alter table public.nextvo_verified_payments enable row level security;

grant select, insert, update, delete on public.nextvo_admin_product_details, public.nextvo_inventory_history, public.nextvo_import_history, public.nextvo_store_settings to authenticated;
revoke all on public.nextvo_verified_payments from anon, authenticated;
grant select on public.nextvo_verified_payments to authenticated;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='nextvo_verified_payments' AND policyname='nextvo admin reads verified payments') THEN
    EXECUTE 'CREATE POLICY "nextvo admin reads verified payments" ON public.nextvo_verified_payments FOR SELECT TO authenticated USING (public.nextvo_is_admin())';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='nextvo_admin_product_details' AND policyname='nextvo admin manages private product details') THEN
    EXECUTE 'CREATE POLICY "nextvo admin manages private product details" ON public.nextvo_admin_product_details FOR ALL TO authenticated USING (public.nextvo_is_admin()) WITH CHECK (public.nextvo_is_admin())';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='nextvo_inventory_history' AND policyname='nextvo admin manages stock history') THEN
    EXECUTE 'CREATE POLICY "nextvo admin manages stock history" ON public.nextvo_inventory_history FOR ALL TO authenticated USING (public.nextvo_is_admin()) WITH CHECK (public.nextvo_is_admin())';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='nextvo_import_history' AND policyname='nextvo admin manages import history') THEN
    EXECUTE 'CREATE POLICY "nextvo admin manages import history" ON public.nextvo_import_history FOR ALL TO authenticated USING (public.nextvo_is_admin()) WITH CHECK (public.nextvo_is_admin())';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='nextvo_import_rate_limits' AND policyname='nextvo admin manages importer rate limits') THEN
    EXECUTE 'CREATE POLICY "nextvo admin manages importer rate limits" ON public.nextvo_import_rate_limits FOR ALL TO authenticated USING (public.nextvo_is_admin()) WITH CHECK (public.nextvo_is_admin())';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='nextvo_store_settings' AND policyname='nextvo admin manages store settings') THEN
    EXECUTE 'CREATE POLICY "nextvo admin manages store settings" ON public.nextvo_store_settings FOR ALL TO authenticated USING (public.nextvo_is_admin()) WITH CHECK (public.nextvo_is_admin())';
  END IF;
END $$;

-- Only authenticated users carrying a trusted app_metadata role can write catalogue data.
-- Public/anon reads continue to be governed by the storefront's existing active-only policies.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories','subcategories','products','product_images','product_variants'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='nextvo admin manages ' || t) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.nextvo_is_admin()) WITH CHECK (public.nextvo_is_admin())', 'nextvo admin manages ' || t, t);
    END IF;
  END LOOP;
END $$;

-- Keep existing public-read behavior and add a trusted-Admin write path. Review any broader policies first.
DO $$ BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='nextvo admins upload product images') THEN
      EXECUTE 'CREATE POLICY "nextvo admins upload product images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = ''product-images'' AND public.nextvo_is_admin())';
    END IF;
    -- Deletion only enables cleanup of temporary uploads after a failed atomic catalogue save.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='nextvo admins delete product images') THEN
      EXECUTE 'CREATE POLICY "nextvo admins delete product images" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = ''product-images'' AND public.nextvo_is_admin())';
    END IF;
  END IF;
END $$;

-- Give verified admins read-only access to customer records and order items. Order fulfilment
-- status can be updated; the payment_status column is never changed by this app.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','customer_addresses','orders','order_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='nextvo admin reads ' || t) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.nextvo_is_admin())', 'nextvo admin reads ' || t, t);
    END IF;
  END LOOP;
END $$;
REVOKE UPDATE ON public.orders FROM authenticated;
GRANT UPDATE (status) ON public.orders TO authenticated;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='orders' AND policyname='nextvo admin updates fulfilment status') THEN
    EXECUTE 'CREATE POLICY "nextvo admin updates fulfilment status" ON public.orders FOR UPDATE TO authenticated USING (public.nextvo_is_admin()) WITH CHECK (public.nextvo_is_admin())';
  END IF;
END $$;

-- Atomic catalogue save. Internal supplier cost/URL is stored separately from the public products row.
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

create or replace function public.nextvo_admin_set_product_status(p_product_id uuid, p_status text)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if not public.nextvo_is_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('draft','published','unpublished','unavailable') then raise exception 'Invalid publishing state'; end if;
  update public.products set active = p_status = 'published' where id = p_product_id;
  if not found then raise exception 'Product not found'; end if;
  insert into public.nextvo_admin_product_details(product_id,status,updated_by,updated_at)
  values (p_product_id,p_status,auth.uid(),now())
  on conflict (product_id) do update set status = excluded.status, updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke all on function public.nextvo_admin_set_product_status(uuid,text) from public, anon;
grant execute on function public.nextvo_admin_set_product_status(uuid,text) to authenticated;

create or replace function public.nextvo_admin_adjust_stock(p_product_id uuid,p_delta integer,p_reason text)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare v_old integer; v_new integer;
begin
  if not public.nextvo_is_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  if p_delta = 0 or nullif(trim(p_reason),'') is null then raise exception 'A non-zero adjustment and reason are required'; end if;
  select stock_quantity into v_old from public.products where id=p_product_id for update;
  if not found then raise exception 'Product not found'; end if;
  v_new := v_old + p_delta;
  if v_new < 0 then raise exception 'Adjustment cannot make stock negative'; end if;
  update public.products set stock_quantity=v_new where id=p_product_id;
  insert into public.nextvo_inventory_history(product_id,previous_quantity,change_quantity,new_quantity,reason,adjusted_by) values(p_product_id,v_old,p_delta,v_new,trim(p_reason),auth.uid());
  return v_new;
end;
$$;
revoke all on function public.nextvo_admin_adjust_stock(uuid,integer,text) from public, anon;
grant execute on function public.nextvo_admin_adjust_stock(uuid,integer,text) to authenticated;

-- This narrowly scoped definer RPC reads only customer directory fields; never exposes password/hash/token data.
create or replace function public.nextvo_admin_list_customers(p_query text default null,p_limit integer default 30,p_offset integer default 0)
returns table(id uuid,email text,full_name text,phone text,created_at timestamptz)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if not public.nextvo_is_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  return query
    select u.id,u.email,coalesce(p.full_name,''),p.phone,u.created_at
    from auth.users u left join public.profiles p on p.id=u.id
    where coalesce(p_query,'')='' or u.email ilike '%'||p_query||'%' or coalesce(p.full_name,'') ilike '%'||p_query||'%'
    order by u.created_at desc limit least(greatest(coalesce(p_limit,30),1),100) offset greatest(coalesce(p_offset,0),0);
end;
$$;
revoke all on function public.nextvo_admin_list_customers(text,integer,integer) from public, anon;
grant execute on function public.nextvo_admin_list_customers(text,integer,integer) to authenticated;

create or replace function public.nextvo_admin_verified_revenue(p_start timestamptz,p_end timestamptz)
returns numeric
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
begin
  if not public.nextvo_is_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  return coalesce((select sum(amount) from public.nextvo_verified_payments where status='verified' and currency_code='NGN' and verified_at >= p_start and verified_at < p_end),0);
end;
$$;
revoke all on function public.nextvo_admin_verified_revenue(timestamptz,timestamptz) from public, anon;
grant execute on function public.nextvo_admin_verified_revenue(timestamptz,timestamptz) to authenticated;

create or replace function public.nextvo_admin_verified_revenue_by_day(p_start timestamptz,p_end timestamptz)
returns table(revenue_date date,revenue_ngn numeric)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
begin
  if not public.nextvo_is_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  return query select (p.verified_at at time zone 'UTC')::date,sum(p.amount)::numeric
    from public.nextvo_verified_payments p
    where p.status='verified' and p.currency_code='NGN' and p.verified_at >= p_start and p.verified_at < p_end
    group by (p.verified_at at time zone 'UTC')::date order by 1;
end;
$$;
revoke all on function public.nextvo_admin_verified_revenue_by_day(timestamptz,timestamptz) from public, anon;
grant execute on function public.nextvo_admin_verified_revenue_by_day(timestamptz,timestamptz) to authenticated;

create or replace function public.nextvo_admin_customer_count()
returns bigint
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if not public.nextvo_is_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  return (select count(*) from auth.users);
end;
$$;
revoke all on function public.nextvo_admin_customer_count() from public, anon;
grant execute on function public.nextvo_admin_customer_count() to authenticated;

-- Realtime is best-effort: enable for the catalogue tables used by the admin and storefront.
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['products','categories','subcategories','product_images','product_variants'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
      END IF;
    END LOOP;
  END IF;
END $$;

commit;

-- Provision the first admin in Supabase Dashboard → Authentication → Users → select the user →
-- app_metadata: {"role":"super_admin"}. Do not set this in raw_user_meta_data or browser code.
