import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'inventory.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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

export function initDatabase() {
  const prodCols = db.prepare('PRAGMA table_info(products)').all() as Array<{
    name: string;
  }>;
  if (prodCols.length > 0 && !prodCols.some((c) => c.name === 'sap_code')) {
    db.exec(`
      DROP TABLE IF EXISTS opname_entries;
      DROP TABLE IF EXISTS opname_sessions;
      DROP TABLE IF EXISTS product_parts;
      DROP TABLE IF EXISTS products;
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sap_code TEXT NOT NULL UNIQUE,
      model_name TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT 'ASSY',
      section TEXT NOT NULL DEFAULT 'SET',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      sn_order INTEGER NOT NULL DEFAULT 2,
      sap_code TEXT NOT NULL,
      parts_name TEXT NOT NULL,
      section TEXT NOT NULL DEFAULT 'part',
      use_qty REAL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS opname_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      part_id INTEGER,
      sn_order INTEGER NOT NULL DEFAULT 1,
      item_type TEXT NOT NULL,
      model_name TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT 'ASSY',
      sap_code TEXT NOT NULL,
      parts_name TEXT NOT NULL,
      section TEXT NOT NULL,
      use_qty REAL,
      qty_ok INTEGER,
      qty_ok_2 INTEGER,
      qty_nc INTEGER,
      total_qty INTEGER,
      operator_name TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      is_submitted INTEGER NOT NULL DEFAULT 0,
      submitted_at TEXT,
      updated_at TEXT,
      FOREIGN KEY (session_id) REFERENCES opname_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const sessionCols = db.prepare('PRAGMA table_info(opname_sessions)').all() as Array<{
    name: string;
  }>;
  if (!sessionCols.some((c) => c.name === 'prepared_by')) {
    db.exec("ALTER TABLE opname_sessions ADD COLUMN prepared_by TEXT NOT NULL DEFAULT ''");
  }
  if (!sessionCols.some((c) => c.name === 'submitted_at')) {
    db.exec('ALTER TABLE opname_sessions ADD COLUMN submitted_at TEXT');
  }

  const entryCols = db.prepare('PRAGMA table_info(opname_entries)').all() as Array<{
    name: string;
  }>;
  if (!entryCols.some((c) => c.name === 'is_submitted')) {
    db.exec('ALTER TABLE opname_entries ADD COLUMN is_submitted INTEGER NOT NULL DEFAULT 0');
  }
  if (!entryCols.some((c) => c.name === 'submitted_at')) {
    db.exec('ALTER TABLE opname_entries ADD COLUMN submitted_at TEXT');
  }

  const existingPin = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get('admin_pin_hash') as { value: string } | undefined;

  if (!existingPin) {
    const defaultPin = process.env.ADMIN_PIN || '1234';
    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(
      'admin_pin_hash',
      hashPin(defaultPin),
    );
  }

  const productCountRow = db
    .prepare('SELECT COUNT(*) as count FROM products')
    .get() as { count: number };

  if (productCountRow.count === 0) {
    seedInitialFishingRodData();
  }

  const locationCountRow = db
    .prepare('SELECT COUNT(*) as count FROM inventory_locations')
    .get() as { count: number };

  if (locationCountRow.count === 0) {
    const now = new Date().toISOString();
    const insertLoc = db.prepare(
      `INSERT OR IGNORE INTO inventory_locations (code, name, description, created_at)
       VALUES (?, ?, ?, ?)`,
    );
    const defaults = [
      ['ASSY', 'Assembly Line', 'Area perakitan joran pancing', now],
      ['BLANK', 'Blank Production', 'Area produksi dan stok blank carbon/fiber', now],
      ['FINISHING', 'Finishing & Wrapping', 'Area ring wrapping, resin & coating', now],
      ['WH', 'Warehouse Utama', 'Gudang penyimpanan material dan barang jadi', now],
    ] as const;
    for (const [code, name, desc, ts] of defaults) {
      insertLoc.run(code, name, desc, ts);
    }

    const existingProductLocs = db
      .prepare("SELECT DISTINCT location FROM products WHERE TRIM(location) != ''")
      .all() as Array<{ location: string }>;
    for (const row of existingProductLocs) {
      const code = row.location.trim().toUpperCase();
      insertLoc.run(code, code, 'Lokasi dari master model', now);
    }
  }
}

export function snapshotMasterToSession(sessionId: number): number {
  const activeProducts = db
    .prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY id ASC')
    .all() as ProductRow[];

  const getParts = db.prepare(
    'SELECT * FROM product_parts WHERE product_id = ? ORDER BY sn_order ASC, id ASC',
  );
  const checkExists = db.prepare(
    `SELECT id FROM opname_entries 
     WHERE session_id = ? AND product_id = ? AND item_type = ? AND COALESCE(part_id, -1) = COALESCE(?, -1)`,
  );
  const insertEntry = db.prepare(
    `INSERT INTO opname_entries (
      session_id, product_id, part_id, sn_order, item_type,
      model_name, location, sap_code, parts_name, section, use_qty,
      qty_ok, qty_ok_2, qty_nc, total_qty, operator_name, notes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, '', '', NULL)`,
  );

  let inserted = 0;

  const tx = db.transaction(() => {
    for (const prod of activeProducts) {
      const existingFg = checkExists.get(sessionId, prod.id, 'finished_good', null);
      if (!existingFg) {
        insertEntry.run(
          sessionId,
          prod.id,
          null,
          1,
          'finished_good',
          prod.model_name,
          '',
          prod.sap_code,
          prod.model_name,
          prod.section || 'SET',
          null,
        );
        inserted += 1;
      }

      const parts = getParts.all(prod.id) as ProductPartRow[];
      parts.forEach((part, idx) => {
        const existingPart = checkExists.get(sessionId, prod.id, 'part', part.id);
        if (!existingPart) {
          insertEntry.run(
            sessionId,
            prod.id,
            part.id,
            part.sn_order || idx + 2,
            'part',
            prod.model_name,
            '',
            part.sap_code,
            part.parts_name,
            part.section || 'part',
            part.use_qty,
          );
          inserted += 1;
        }
      });
    }
  });

  tx();
  return inserted;
}

export function createBlankDraftForProduct(
  sessionId: number,
  productId: number,
): boolean {
  const existingBlank = db
    .prepare(
      `SELECT id FROM opname_entries
       WHERE session_id = ? AND product_id = ? AND is_submitted = 0 AND location = ''
       LIMIT 1`,
    )
    .get(sessionId, productId);

  if (existingBlank) return false;

  const insertEntry = db.prepare(
    `INSERT INTO opname_entries (
      session_id, product_id, part_id, sn_order, item_type,
      model_name, location, sap_code, parts_name, section, use_qty,
      qty_ok, qty_ok_2, qty_nc, total_qty, operator_name, notes, is_submitted, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, NULL, NULL, NULL, NULL, '', '', 0, NULL)`,
  );

  const prod = db
    .prepare('SELECT * FROM products WHERE id = ?')
    .get(productId) as ProductRow | undefined;

  if (prod) {
    const parts = db
      .prepare('SELECT * FROM product_parts WHERE product_id = ? ORDER BY sn_order ASC, id ASC')
      .all(productId) as ProductPartRow[];

    db.transaction(() => {
      insertEntry.run(
        sessionId,
        prod.id,
        null,
        1,
        'finished_good',
        prod.model_name,
        prod.sap_code,
        prod.model_name,
        prod.section || 'SET',
        null,
      );
      parts.forEach((part, idx) => {
        insertEntry.run(
          sessionId,
          prod.id,
          part.id,
          part.sn_order || idx + 2,
          'part',
          prod.model_name,
          part.sap_code,
          part.parts_name,
          part.section || 'part',
          part.use_qty,
        );
      });
    })();
    return true;
  }

  const templateRows = db
    .prepare(
      `SELECT part_id, sn_order, item_type, model_name, sap_code, parts_name, section, use_qty
       FROM opname_entries
       WHERE session_id = ? AND product_id = ?
       GROUP BY item_type, COALESCE(part_id, -1), sap_code, parts_name
       ORDER BY CASE WHEN item_type = 'finished_good' THEN 0 ELSE 1 END ASC, sn_order ASC, id ASC`,
    )
    .all(sessionId, productId) as Array<{
    part_id: number | null;
    sn_order: number;
    item_type: 'finished_good' | 'part';
    model_name: string;
    sap_code: string;
    parts_name: string;
    section: string;
    use_qty: number | null;
  }>;

  if (templateRows.length === 0) return false;

  db.transaction(() => {
    for (const row of templateRows) {
      insertEntry.run(
        sessionId,
        productId,
        row.part_id,
        row.sn_order,
        row.item_type,
        row.model_name,
        row.sap_code,
        row.parts_name,
        row.section,
        row.use_qty,
      );
    }
  })();
  return true;
}

function seedInitialFishingRodData() {
  const now = new Date().toISOString();

  const insertProduct = db.prepare(
    `INSERT INTO products (sap_code, model_name, location, section, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  );
  const insertPart = db.prepare(
    `INSERT INTO product_parts (product_id, sn_order, sap_code, parts_name, section, use_qty, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const tx = db.transaction(() => {
    const p1 = insertProduct.run(
      '60033365',
      'LUCOZA 20LUNAMIS B80M SA',
      'ASSY',
      'SET',
      now,
      now,
    ).lastInsertRowid as number;

    const p1Parts = [
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
    ] as const;

    for (const [sn, sap, pname, sec, useQty] of p1Parts) {
      insertPart.run(p1, sn, sap, pname, sec, useQty, now);
    }

    const p2 = insertProduct.run(
      '60034102',
      'LUCOZA 22SEPHIA S86ML SA',
      'ASSY',
      'SET',
      now,
      now,
    ).lastInsertRowid as number;

    const p2Parts = [
      [2, '70240110', 'LUCOZA 22SEPHIA S86ML #01 BP1', 'blank', 1],
      [3, '70240111', 'LUCOZA 22SEPHIA S86ML #2V BP1', 'blank', 1],
      [4, '70219004', '7RACOZA F-GRIP SEPH-12', 'KIJI H.BODY', 1],
      [5, '70198201', 'T-KTSG4.5S', 'part', 4],
      [6, '70198205', 'T-KLSG16H', 'part', 1],
      [7, '70220190', '7GACOZA ENDPLUG SEPH-1', 'part', 1],
    ] as const;

    for (const [sn, sap, pname, sec, useQty] of p2Parts) {
      insertPart.run(p2, sn, sap, pname, sec, useQty, now);
    }

    const prevDate = new Date();
    prevDate.setMonth(prevDate.getMonth() - 1);
    const prevMonthStr = prevDate.toISOString().slice(0, 7);
    const prevLabel = formatIndonesianMonth(prevMonthStr);
    const prevShortDate = formatShortDotDate(prevDate);

    const currDate = new Date();
    const currMonthStr = currDate.toISOString().slice(0, 7);
    const currLabel = formatIndonesianMonth(currMonthStr);
    const currShortDate = formatShortDotDate(currDate);

    const closedAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 15).toISOString();

    const archivedSessionId = db
      .prepare(
        `INSERT INTO opname_sessions (period_label, period_month, opname_date, status, prepared_by, submitted_at, notes, created_at, closed_at)
         VALUES (?, ?, ?, 'closed', 'Helen', ?, ?, ?, ?)`,
      )
      .run(
        prevLabel,
        prevMonthStr,
        prevShortDate,
        closedAt,
        'Arsip stock opname akhir bulan sebelumnya',
        closedAt,
        closedAt,
      ).lastInsertRowid as number;

    snapshotMasterToSession(archivedSessionId);

    const archivedEntries = db
      .prepare('SELECT id, sn_order FROM opname_entries WHERE session_id = ?')
      .all(archivedSessionId) as Array<{ id: number; sn_order: number }>;

    const updateArchived = db.prepare(
      `UPDATE opname_entries
       SET qty_ok = ?, qty_ok_2 = ?, qty_nc = ?, total_qty = ?, operator_name = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
    );

    archivedEntries.forEach((entry) => {
      const ok = 25 + (entry.sn_order % 7) * 5;
      const ok2 = entry.sn_order % 4 === 0 ? 4 : 0;
      const nc = entry.sn_order % 6 === 0 ? 2 : 0;
      const total = ok + ok2 + nc;
      const note = nc > 0 ? 'Part lecet / reject QC' : '';
      updateArchived.run(ok, ok2, nc, total, 'Helen', note, closedAt, entry.id);
    });

    const activeSessionId = db
      .prepare(
        `INSERT INTO opname_sessions (period_label, period_month, opname_date, status, notes, created_at, closed_at)
         VALUES (?, ?, ?, 'active', ?, ?, NULL)`,
      )
      .run(
        currLabel,
        currMonthStr,
        currShortDate,
        'Stock opname bulanan berjalan',
        now,
      ).lastInsertRowid as number;

    snapshotMasterToSession(activeSessionId);
  });

  tx();
}

function formatIndonesianMonth(yyyyMm: string): string {
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

function formatShortDotDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}
