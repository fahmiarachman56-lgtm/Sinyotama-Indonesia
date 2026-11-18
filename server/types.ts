import crypto from 'node:crypto';

export interface LocationRow {
  id: number;
  code: string;
  name: string;
  description: string;
  created_at: string;
}

export interface ProductRow {
  id: number;
  sap_code: string;
  model_name: string;
  location: string;
  section: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ProductPartRow {
  id: number;
  product_id: number;
  sn_order: number;
  sap_code: string;
  parts_name: string;
  section: string;
  use_qty: number | null;
  created_at: string;
}

export interface ProductWithPartsResponse {
  id: number;
  sap_code: string;
  model_name: string;
  location: string;
  section: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  parts: ProductPartRow[];
}

export interface OpnameSessionRow {
  id: number;
  period_label: string;
  period_month: string;
  opname_date: string;
  status: 'active' | 'closed';
  prepared_by: string;
  submitted_at: string | null;
  notes: string;
  created_at: string;
  closed_at: string | null;
}

export interface OpnameSessionStatsRow extends OpnameSessionRow {
  total_items: number;
  counted_items: number;
  sum_qty_ok: number;
  sum_qty_nc: number;
  sum_total_qty: number;
}

export interface OpnameEntryRow {
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
  is_submitted: number;
  submitted_at: string | null;
  updated_at: string | null;
}

export interface PartInput {
  sn_order?: number;
  sap_code: string;
  parts_name: string;
  section?: string;
  use_qty?: number | null;
}

export interface BulkImportModelInput {
  sap_code: string;
  model_name: string;
  location?: string;
  section?: string;
  parts: PartInput[];
}

export interface BulkImportResult {
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  partsCount: number;
}

export class StoreError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export interface InventoryStore {
  readonly backend: 'sqlite' | 'supabase-postgres';

  getAdminPinHash(): Promise<string | undefined>;
  setAdminPinHash(hash: string): Promise<void>;

  listLocations(): Promise<LocationRow[]>;
  createLocation(input: {
    code: string;
    name: string;
    description: string;
  }): Promise<LocationRow>;
  updateLocation(
    id: number,
    input: { code?: string; name?: string; description?: string },
  ): Promise<LocationRow>;
  deleteLocation(id: number): Promise<void>;

  listProducts(): Promise<ProductWithPartsResponse[]>;
  createProduct(input: {
    sap_code: string;
    model_name: string;
    location: string;
    section: string;
    parts: PartInput[];
  }): Promise<ProductWithPartsResponse>;
  updateProduct(
    id: number,
    input: {
      sap_code?: string;
      model_name?: string;
      location?: string;
      section?: string;
      is_active?: boolean;
    },
  ): Promise<ProductWithPartsResponse>;
  bulkImportProducts(
    mode: 'skip_existing' | 'replace_parts',
    models: BulkImportModelInput[],
  ): Promise<BulkImportResult>;
  deleteProduct(id: number): Promise<void>;

  addPart(productId: number, part: PartInput): Promise<ProductPartRow>;
  bulkAddParts(productId: number, parts: PartInput[]): Promise<{ added: number }>;
  updatePart(
    partId: number,
    input: {
      sn_order?: number;
      sap_code?: string;
      parts_name?: string;
      section?: string;
      use_qty?: number | null;
    },
  ): Promise<ProductPartRow>;
  deletePart(partId: number): Promise<void>;

  listSessions(): Promise<OpnameSessionStatsRow[]>;
  createSession(input: {
    period_month: string;
    period_label: string;
    opname_date: string;
    notes: string;
  }): Promise<OpnameSessionRow>;
  getSessionWithEntries(
    sessionId: number,
  ): Promise<{ session: OpnameSessionRow; entries: OpnameEntryRow[] }>;
  updateEntry(
    sessionId: number,
    entryId: number,
    input: {
      qty_ok?: unknown;
      qty_ok_2?: unknown;
      qty_nc?: unknown;
      operator_name?: string;
      notes?: string;
    },
  ): Promise<OpnameEntryRow>;
  submitSession(
    sessionId: number,
    input: {
      operator_name: string;
      location: string;
      source_location: string;
      product_id: number | null;
    },
  ): Promise<{ session: OpnameSessionRow; entries: OpnameEntryRow[] }>;
  reopenModel(
    sessionId: number,
    productId: number,
    location: string,
  ): Promise<{ session: OpnameSessionRow; entries: OpnameEntryRow[] }>;
  syncSessionMaster(sessionId: number): Promise<{ addedCount: number }>;
  closeSession(sessionId: number): Promise<{ ok: boolean; closed_at: string }>;
  reopenSession(sessionId: number): Promise<{ ok: boolean }>;
  deleteSession(sessionId: number): Promise<void>;
}

export function hashPin(pin: string, existingSalt?: string): string {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(pin, salt, 32).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPinHash(pin: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, hashHex] = parts;
  const derivedHex = crypto.scryptSync(pin, salt, 32).toString('hex');
  const a = Buffer.from(hashHex, 'hex');
  const b = Buffer.from(derivedHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function formatIndonesianMonth(yyyyMm: string): string {
  const months = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];
  const [year, monthStr] = yyyyMm.split('-');
  const idx = Number(monthStr) - 1;
  return `${months[idx] ?? monthStr} ${year}`;
}

export function formatShortDotDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

export const INITIAL_SEED_PRODUCTS = [
  {
    sap_code: '60033365',
    model_name: 'LUCOZA 20LUNAMIS B80M SA',
    location: 'ASSY',
    section: 'SET',
    parts: [
      [2, '70172148', '7KSAOPY RING COPY-41', 'part', 1],
      [3, '70220338', '7KSAOZA NUTRING COZA-21', 'KIJI H.BODY', 1],
      [4, '70220339', '7KSAOZA NUTRING COZA-22', 'KIJI H.BODY', 1],
      [5, '70231491', '7KSAOZA RING COZA-34', 'part', 1],
      [6, '70231493', '7KSCOZA W-CHECK COZA-24', 'part', 1],
      [7, '70231497', '7R4E912 U-CORE 14.9-12.1-095', 'part', 1],
      [8, '70231499', '7R7N012 E-CORE 22.0-12.7-004', 'KIJI H.BODY', 1],
      [9, '70220368', '7RACOZA F-GRIP COZA-21', 'KIJI H.BODY', 1],
      [10, '70231501', '7RACOZA S-GRIP COZA-24', 'part', 1],
      [11, '70171518', '7RADJBN NUT COJB 16 RM L26.3(CT39) CTNP', 'KIJI H.BODY', 1],
      [12, '70220366', '7RAOZAD HNDLBDY CGJD(CT10) COZA CTPA', 'KIJI H.BODY', 1],
      [13, '70220367', '7RAOZAS SLIDEHOOD CGJY 16 RM COZA PA', 'KIJI H.BODY', 1],
      [14, '70167814', 'HKM10W', 'part', 1],
      [15, '70198552', 'T-KGST5.5-1.8', 'part', 1],
      [16, '70197847', 'T-KTSG6S', 'part', 1],
      [17, '70197848', 'T-KTSG7S', 'part', 1],
      [18, '70198169', 'T-KTSG8S', 'part', 1],
      [19, '70198170', 'T-KTSG5.5S', 'part', 3],
      [20, '70197861', 'T-KWSG10S', 'part', 1],
      [21, '70197862', 'T-KWSG12S', 'part', 1],
      [22, '70231763', 'LUCOZA 20LUNAMIS B80M #01 BP1', 'blank', 1],
      [23, '70231766', 'LUCOZA 20LUNAMIS B80M #2V BP1', 'blank', 1],
      [24, '70231759', 'LUCOZA 20LUNAMIS B80ML #2X BP1', 'blank', 1],
      [25, '70218998', '7MPCOZA 3D B-SEAL COZA-1', 'B-SEAL', 1],
      [26, '70012671', '7GE0001 EVAPLG 5.2-10', 'part', 1],
      [27, '70119662', '7G1IOMD I-RUBBER COMD', 'part', 1],
      [28, '70133735', '7MNCOMM SEATSEAL COMM-1', 'part', 1],
      [29, '70220050', '7GACOZA ENDPLUG COZA-1', 'part', 1],
      [30, '70220082', '7WLCOZA BADGE COZA-A ALM', 'part', 1],
    ] as const,
  },
  {
    sap_code: '60034102',
    model_name: 'LUCOZA 22SEPHIA S86ML SA',
    location: 'ASSY',
    section: 'SET',
    parts: [
      [2, '70240110', 'LUCOZA 22SEPHIA S86ML #01 BP1', 'blank', 1],
      [3, '70240111', 'LUCOZA 22SEPHIA S86ML #2V BP1', 'blank', 1],
      [4, '70219004', '7RACOZA F-GRIP SEPH-12', 'KIJI H.BODY', 1],
      [5, '70198201', 'T-KTSG4.5S', 'part', 4],
      [6, '70198205', 'T-KLSG16H', 'part', 1],
      [7, '70220190', '7GACOZA ENDPLUG SEPH-1', 'part', 1],
    ] as const,
  },
] as const;

export const DEFAULT_LOCATIONS = [
  ['ASSY', 'Assembly Line', 'Area perakitan joran pancing'],
  ['BLANK', 'Blank Production', 'Area produksi dan stok blank carbon/fiber'],
  ['FINISHING', 'Finishing & Wrapping', 'Area ring wrapping, resin & coating'],
  ['WH', 'Warehouse Utama', 'Gudang penyimpanan material dan barang jadi'],
] as const;
