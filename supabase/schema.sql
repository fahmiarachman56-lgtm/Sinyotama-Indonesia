-- Sinyotama Indonesia — Inventory Sistem
-- Skema Database PostgreSQL untuk Supabase
-- Catatan: Aplikasi juga otomatis membuat tabel dan data awal ini pada akses pertama
-- jika tabel belum tersedia di database Supabase Anda.

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  sap_code TEXT NOT NULL UNIQUE,
  model_name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT 'ASSY',
  section TEXT NOT NULL DEFAULT 'SET',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_parts (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sn_order INTEGER NOT NULL DEFAULT 2,
  sap_code TEXT NOT NULL,
  parts_name TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT 'part',
  use_qty DOUBLE PRECISION DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_product_parts_product_id
  ON product_parts(product_id, sn_order, id);

CREATE TABLE IF NOT EXISTS opname_sessions (
  id SERIAL PRIMARY KEY,
  period_label TEXT NOT NULL,
  period_month TEXT NOT NULL,
  opname_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  prepared_by TEXT NOT NULL DEFAULT '',
  submitted_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS opname_entries (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES opname_sessions(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  part_id INTEGER,
  sn_order INTEGER NOT NULL DEFAULT 1,
  item_type TEXT NOT NULL,
  model_name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  sap_code TEXT NOT NULL,
  parts_name TEXT NOT NULL,
  section TEXT NOT NULL,
  use_qty DOUBLE PRECISION,
  qty_ok INTEGER,
  qty_ok_2 INTEGER,
  qty_nc INTEGER,
  total_qty INTEGER,
  operator_name TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  is_submitted INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_opname_entries_session_product
  ON opname_entries(session_id, product_id, is_submitted, location);

CREATE TABLE IF NOT EXISTS inventory_locations (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
