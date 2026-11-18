-- ============================================================================
-- Sinyotama Indonesia — Inventory Sistem (Supabase SQL Schema & Seed)
-- Tempelkan seluruh script ini di Supabase Dashboard -> SQL Editor -> Run
-- ============================================================================

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_locations (
  id bigserial primary key,
  code text not null unique,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id bigserial primary key,
  sap_code text not null unique,
  model_name text not null,
  location text not null default '',
  section text not null default 'SET',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_parts (
  id bigserial primary key,
  product_id bigint not null references public.products(id) on delete cascade,
  sn_order integer not null default 2,
  sap_code text not null,
  parts_name text not null,
  section text not null default 'part',
  use_qty numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.opname_sessions (
  id bigserial primary key,
  period_label text not null,
  period_month text not null,
  opname_date text not null default '',
  status text not null default 'active' check (status in ('active', 'closed')),
  prepared_by text not null default '',
  submitted_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.opname_entries (
  id bigserial primary key,
  session_id bigint not null references public.opname_sessions(id) on delete cascade,
  product_id bigint not null references public.products(id) on delete cascade,
  part_id bigint,
  sn_order integer not null default 1,
  item_type text not null check (item_type in ('finished_good', 'part')),
  model_name text not null,
  location text not null default '',
  sap_code text not null,
  parts_name text not null,
  section text not null default '',
  use_qty numeric,
  qty_ok integer,
  qty_ok_2 integer,
  qty_nc integer,
  total_qty integer,
  operator_name text not null default '',
  notes text not null default '',
  is_submitted boolean not null default false,
  submitted_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_product_parts_product on public.product_parts(product_id);
create index if not exists idx_opname_entries_session on public.opname_entries(session_id);
create index if not exists idx_opname_entries_session_product on public.opname_entries(session_id, product_id);

-- Row Level Security (akses langsung tanpa layar login untuk operasional pabrik)
alter table public.app_settings enable row level security;
alter table public.inventory_locations enable row level security;
alter table public.products enable row level security;
alter table public.product_parts enable row level security;
alter table public.opname_sessions enable row level security;
alter table public.opname_entries enable row level security;

drop policy if exists "public_rw_app_settings" on public.app_settings;
create policy "public_rw_app_settings" on public.app_settings for all to anon, authenticated using (true) with check (true);

drop policy if exists "public_rw_locations" on public.inventory_locations;
create policy "public_rw_locations" on public.inventory_locations for all to anon, authenticated using (true) with check (true);

drop policy if exists "public_rw_products" on public.products;
create policy "public_rw_products" on public.products for all to anon, authenticated using (true) with check (true);

drop policy if exists "public_rw_parts" on public.product_parts;
create policy "public_rw_parts" on public.product_parts for all to anon, authenticated using (true) with check (true);

drop policy if exists "public_rw_sessions" on public.opname_sessions;
create policy "public_rw_sessions" on public.opname_sessions for all to anon, authenticated using (true) with check (true);

drop policy if exists "public_rw_entries" on public.opname_entries;
create policy "public_rw_entries" on public.opname_entries for all to anon, authenticated using (true) with check (true);

-- Aktifkan Supabase Realtime agar HP & PC update otomatis tanpa refresh
do $$ begin
  alter publication supabase_realtime add table public.inventory_locations;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.products;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.product_parts;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.opname_sessions;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.opname_entries;
exception when duplicate_object then null; end $$;

-- Seed PIN Admin default: 1234 (SHA-256 hex)
insert into public.app_settings (key, value)
values ('admin_pin_hash', '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4')
on conflict (key) do nothing;

-- Seed lokasi awal
insert into public.inventory_locations (code, name, description)
values
  ('ASSY', 'Assembly Line', 'Area perakitan joran pancing'),
  ('BLANK', 'Blank Production', 'Area produksi dan stok blank carbon/fiber'),
  ('FINISHING', 'Finishing & Wrapping', 'Area ring wrapping, resin & coating'),
  ('WH', 'Warehouse Utama', 'Gudang penyimpanan material dan barang jadi')
on conflict (code) do nothing;
