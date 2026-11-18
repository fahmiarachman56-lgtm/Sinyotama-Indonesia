export type UserRole = 'operator' | 'admin';

export type NavView = 'opname' | 'master' | 'locations' | 'sessions' | 'settings';

export interface InventoryLocation {
  id: number;
  code: string;
  name: string;
  description: string;
  created_at: string;
  model_count?: number;
}

export interface ProductPart {
  id: number;
  product_id: number;
  sn_order: number;
  sap_code: string;
  parts_name: string;
  section: string;
  use_qty: number | null;
  created_at: string;
}

export interface Product {
  id: number;
  sap_code: string;
  model_name: string;
  location: string;
  section: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  parts: ProductPart[];
}

export interface OpnameSession {
  id: number;
  period_label: string;
  period_month: string;
  opname_date: string;
  status: 'active' | 'closed';
  prepared_by?: string;
  submitted_at?: string | null;
  notes: string;
  created_at: string;
  closed_at: string | null;
  total_items?: number;
  counted_items?: number;
  sum_qty_ok?: number;
  sum_qty_nc?: number;
  sum_total_qty?: number;
}

export interface OpnameEntry {
  id: number;
  session_id: number;
  product_id: number;
  part_id: number | null;
  sn_order: number;
  item_type: 'finished_good' | 'part';
  model_name: string;
  location: string;
  sap_code: string;
  parts_name: string;
  section: string;
  use_qty: number | null;
  qty_ok: number | null;
  qty_ok_2: number | null;
  qty_nc: number | null;
  total_qty: number | null;
  operator_name: string;
  notes: string;
  is_submitted?: number | boolean;
  submitted_at?: string | null;
  updated_at: string | null;
}
