import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_LOCATIONS,
  INITIAL_SEED_PRODUCTS,
  StoreError,
  formatIndonesianMonth,
  formatShortDotDate,
  hashPin,
  type BulkImportModelInput,
  type BulkImportResult,
  type InventoryStore,
  type LocationRow,
  type OpnameEntryRow,
  type OpnameSessionRow,
  type OpnameSessionStatsRow,
  type PartInput,
  type ProductPartRow,
  type ProductRow,
  type ProductWithPartsResponse,
} from './types.ts';

function createDbInstance(): Database.Database {
  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = path.join(dataDir, 'inventory.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export class SqliteInventoryStore implements InventoryStore {
  readonly backend = 'sqlite' as const;
  private db: Database.Database;

  constructor() {
    this.db = createDbInstance();
    this.initDatabase();
  }

  private initDatabase() {
    const prodCols = this.db.prepare('PRAGMA table_info(products)').all() as Array<{
      name: string;
    }>;
    if (prodCols.length > 0 && !prodCols.some((c) => c.name === 'sap_code')) {
      this.db.exec(`
        DROP TABLE IF EXISTS opname_entries;
        DROP TABLE IF EXISTS opname_sessions;
        DROP TABLE IF EXISTS product_parts;
        DROP TABLE IF EXISTS products;
      `);
    }

    this.db.exec(`
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

    const sessionCols = this.db.prepare('PRAGMA table_info(opname_sessions)').all() as Array<{
      name: string;
    }>;
    if (!sessionCols.some((c) => c.name === 'prepared_by')) {
      this.db.exec("ALTER TABLE opname_sessions ADD COLUMN prepared_by TEXT NOT NULL DEFAULT ''");
    }
    if (!sessionCols.some((c) => c.name === 'submitted_at')) {
      this.db.exec('ALTER TABLE opname_sessions ADD COLUMN submitted_at TEXT');
    }

    const entryCols = this.db.prepare('PRAGMA table_info(opname_entries)').all() as Array<{
      name: string;
    }>;
    if (!entryCols.some((c) => c.name === 'is_submitted')) {
      this.db.exec('ALTER TABLE opname_entries ADD COLUMN is_submitted INTEGER NOT NULL DEFAULT 0');
    }
    if (!entryCols.some((c) => c.name === 'submitted_at')) {
      this.db.exec('ALTER TABLE opname_entries ADD COLUMN submitted_at TEXT');
    }

    const existingPin = this.db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get('admin_pin_hash') as { value: string } | undefined;

    if (!existingPin) {
      const defaultPin = process.env.ADMIN_PIN || '1234';
      this.db
        .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
        .run('admin_pin_hash', hashPin(defaultPin));
    }

    const productCountRow = this.db
      .prepare('SELECT COUNT(*) as count FROM products')
      .get() as { count: number };

    if (productCountRow.count === 0) {
      this.seedInitialFishingRodData();
    }

    const locationCountRow = this.db
      .prepare('SELECT COUNT(*) as count FROM inventory_locations')
      .get() as { count: number };

    if (locationCountRow.count === 0) {
      const now = new Date().toISOString();
      const insertLoc = this.db.prepare(
        `INSERT OR IGNORE INTO inventory_locations (code, name, description, created_at)
         VALUES (?, ?, ?, ?)`,
      );
      for (const [code, name, desc] of DEFAULT_LOCATIONS) {
        insertLoc.run(code, name, desc, now);
      }

      const existingProductLocs = this.db
        .prepare("SELECT DISTINCT location FROM products WHERE TRIM(location) != ''")
        .all() as Array<{ location: string }>;
      for (const row of existingProductLocs) {
        const code = row.location.trim().toUpperCase();
        insertLoc.run(code, code, 'Lokasi dari master model', now);
      }
    }
  }

  private snapshotMasterToSessionSync(sessionId: number): number {
    const activeProducts = this.db
      .prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY id ASC')
      .all() as ProductRow[];

    const getParts = this.db.prepare(
      'SELECT * FROM product_parts WHERE product_id = ? ORDER BY sn_order ASC, id ASC',
    );
    const checkExists = this.db.prepare(
      `SELECT id FROM opname_entries 
       WHERE session_id = ? AND product_id = ? AND item_type = ? AND COALESCE(part_id, -1) = COALESCE(?, -1)`,
    );
    const insertEntry = this.db.prepare(
      `INSERT INTO opname_entries (
        session_id, product_id, part_id, sn_order, item_type,
        model_name, location, sap_code, parts_name, section, use_qty,
        qty_ok, qty_ok_2, qty_nc, total_qty, operator_name, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, '', '', NULL)`,
    );

    let inserted = 0;

    const tx = this.db.transaction(() => {
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

  private createBlankDraftForProductSync(sessionId: number, productId: number): boolean {
    const existingBlank = this.db
      .prepare(
        `SELECT id FROM opname_entries
         WHERE session_id = ? AND product_id = ? AND is_submitted = 0 AND location = ''
         LIMIT 1`,
      )
      .get(sessionId, productId);

    if (existingBlank) return false;

    const insertEntry = this.db.prepare(
      `INSERT INTO opname_entries (
        session_id, product_id, part_id, sn_order, item_type,
        model_name, location, sap_code, parts_name, section, use_qty,
        qty_ok, qty_ok_2, qty_nc, total_qty, operator_name, notes, is_submitted, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, NULL, NULL, NULL, NULL, '', '', 0, NULL)`,
    );

    const prod = this.db
      .prepare('SELECT * FROM products WHERE id = ?')
      .get(productId) as ProductRow | undefined;

    if (prod) {
      const parts = this.db
        .prepare('SELECT * FROM product_parts WHERE product_id = ? ORDER BY sn_order ASC, id ASC')
        .all(productId) as ProductPartRow[];

      this.db.transaction(() => {
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

    const templateRows = this.db
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

    this.db.transaction(() => {
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

  private seedInitialFishingRodData() {
    const now = new Date().toISOString();

    const insertProduct = this.db.prepare(
      `INSERT INTO products (sap_code, model_name, location, section, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    );
    const insertPart = this.db.prepare(
      `INSERT INTO product_parts (product_id, sn_order, sap_code, parts_name, section, use_qty, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    const tx = this.db.transaction(() => {
      for (const seedProd of INITIAL_SEED_PRODUCTS) {
        const pid = insertProduct.run(
          seedProd.sap_code,
          seedProd.model_name,
          seedProd.location,
          seedProd.section,
          now,
          now,
        ).lastInsertRowid as number;

        for (const [sn, sap, pname, sec, useQty] of seedProd.parts) {
          insertPart.run(pid, sn, sap, pname, sec, useQty, now);
        }
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

      const archivedSessionId = this.db
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

      this.snapshotMasterToSessionSync(archivedSessionId);

      const archivedEntries = this.db
        .prepare('SELECT id, sn_order FROM opname_entries WHERE session_id = ?')
        .all(archivedSessionId) as Array<{ id: number; sn_order: number }>;

      const updateArchived = this.db.prepare(
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

      const activeSessionId = this.db
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

      this.snapshotMasterToSessionSync(activeSessionId);
    });

    tx();
  }

  async getAdminPinHash(): Promise<string | undefined> {
    const row = this.db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get('admin_pin_hash') as { value: string } | undefined;
    return row?.value;
  }

  async setAdminPinHash(hash: string): Promise<void> {
    this.db
      .prepare('UPDATE app_settings SET value = ? WHERE key = ?')
      .run(hash, 'admin_pin_hash');
  }

  async listLocations(): Promise<LocationRow[]> {
    return this.db
      .prepare(
        `SELECT id, code, name, description, created_at
         FROM inventory_locations
         ORDER BY name ASC`,
      )
      .all() as LocationRow[];
  }

  async createLocation(input: {
    code: string;
    name: string;
    description: string;
  }): Promise<LocationRow> {
    const dup = this.db
      .prepare(
        'SELECT id FROM inventory_locations WHERE UPPER(name) = UPPER(?) OR UPPER(code) = UPPER(?)',
      )
      .get(input.name, input.code);
    if (dup) {
      throw new StoreError(409, `Location "${input.name}" sudah terdaftar.`);
    }

    const now = new Date().toISOString();
    const info = this.db
      .prepare(
        `INSERT INTO inventory_locations (code, name, description, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(input.code, input.name, input.description, now);

    const created = this.db
      .prepare('SELECT id, code, name, description, created_at FROM inventory_locations WHERE id = ?')
      .get(info.lastInsertRowid) as LocationRow;

    const activeSessions = this.db
      .prepare("SELECT id FROM opname_sessions WHERE status = 'active'")
      .all() as Array<{ id: number }>;
    for (const sess of activeSessions) {
      const productRows = this.db
        .prepare('SELECT DISTINCT product_id FROM opname_entries WHERE session_id = ?')
        .all(sess.id) as Array<{ product_id: number }>;
      for (const p of productRows) {
        this.createBlankDraftForProductSync(sess.id, p.product_id);
      }
    }

    return created;
  }

  async updateLocation(
    id: number,
    input: { code?: string; name?: string; description?: string },
  ): Promise<LocationRow> {
    const existing = this.db
      .prepare('SELECT * FROM inventory_locations WHERE id = ?')
      .get(id) as LocationRow | undefined;

    if (!existing) {
      throw new StoreError(404, 'Location tidak ditemukan.');
    }

    const name = input.name && input.name.trim() ? input.name.trim() : existing.name;
    const code =
      input.code && input.code.trim()
        ? input.code.trim().toUpperCase()
        : name.toUpperCase();
    const description =
      input.description !== undefined ? input.description.trim() : existing.description;

    const dup = this.db
      .prepare(
        'SELECT id FROM inventory_locations WHERE id != ? AND (UPPER(name) = UPPER(?) OR UPPER(code) = UPPER(?))',
      )
      .get(id, name, code);
    if (dup) {
      throw new StoreError(409, `Location "${name}" sudah digunakan.`);
    }

    this.db
      .prepare('UPDATE inventory_locations SET code = ?, name = ?, description = ? WHERE id = ?')
      .run(code, name, description, id);

    return this.db
      .prepare('SELECT id, code, name, description, created_at FROM inventory_locations WHERE id = ?')
      .get(id) as LocationRow;
  }

  async deleteLocation(id: number): Promise<void> {
    const info = this.db.prepare('DELETE FROM inventory_locations WHERE id = ?').run(id);
    if (info.changes === 0) {
      throw new StoreError(404, 'Location tidak ditemukan.');
    }
  }

  async listProducts(): Promise<ProductWithPartsResponse[]> {
    const products = this.db
      .prepare('SELECT * FROM products ORDER BY id ASC')
      .all() as ProductRow[];
    const parts = this.db
      .prepare('SELECT * FROM product_parts ORDER BY product_id ASC, sn_order ASC, id ASC')
      .all() as ProductPartRow[];

    const partsByProduct = new Map<number, ProductPartRow[]>();
    for (const part of parts) {
      const list = partsByProduct.get(part.product_id) ?? [];
      list.push(part);
      partsByProduct.set(part.product_id, list);
    }

    return products.map((p) => ({
      ...p,
      is_active: Boolean(p.is_active),
      parts: partsByProduct.get(p.id) ?? [],
    }));
  }

  async createProduct(input: {
    sap_code: string;
    model_name: string;
    location: string;
    section: string;
    parts: PartInput[];
  }): Promise<ProductWithPartsResponse> {
    const now = new Date().toISOString();
    try {
      const createdId = this.db.transaction(() => {
        const info = this.db
          .prepare(
            `INSERT INTO products (sap_code, model_name, location, section, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, 1, ?, ?)`,
          )
          .run(input.sap_code, input.model_name, input.location, input.section, now, now);

        const productId = info.lastInsertRowid as number;
        const insertPart = this.db.prepare(
          `INSERT INTO product_parts (product_id, sn_order, sap_code, parts_name, section, use_qty, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );

        let snCounter = 2;
        for (const rawPart of input.parts) {
          const partSap =
            typeof rawPart?.sap_code === 'string'
              ? rawPart.sap_code.trim().toUpperCase()
              : '';
          const partsName =
            typeof rawPart?.parts_name === 'string' ? rawPart.parts_name.trim() : '';
          if (!partSap || !partsName) continue;
          const partSection =
            typeof rawPart?.section === 'string' && rawPart.section.trim()
              ? rawPart.section.trim()
              : 'part';
          const useQty =
            rawPart?.use_qty === null || rawPart?.use_qty === undefined
              ? null
              : Math.max(0, Number(rawPart?.use_qty) || 1);
          const snOrder = Number(rawPart?.sn_order) > 1 ? Number(rawPart.sn_order) : snCounter;
          snCounter = Math.max(snCounter + 1, snOrder + 1);
          insertPart.run(productId, snOrder, partSap, partsName, partSection, useQty, now);
        }
        return productId;
      })();

      const product = this.db
        .prepare('SELECT * FROM products WHERE id = ?')
        .get(createdId) as ProductRow;
      const parts = this.db
        .prepare('SELECT * FROM product_parts WHERE product_id = ? ORDER BY sn_order ASC, id ASC')
        .all(createdId) as ProductPartRow[];

      return { ...product, is_active: Boolean(product.is_active), parts };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('UNIQUE')) {
        throw new StoreError(409, `SAP CODE "${input.sap_code}" sudah terdaftar.`);
      }
      throw new StoreError(500, 'Gagal menyimpan master model.');
    }
  }

  async updateProduct(
    id: number,
    input: {
      sap_code?: string;
      model_name?: string;
      location?: string;
      section?: string;
      is_active?: boolean;
    },
  ): Promise<ProductWithPartsResponse> {
    const existing = this.db.prepare('SELECT * FROM products WHERE id = ?').get(id) as
      | ProductRow
      | undefined;
    if (!existing) {
      throw new StoreError(404, 'Model tidak ditemukan.');
    }

    const sapCode =
      input.sap_code && input.sap_code.trim()
        ? input.sap_code.trim().toUpperCase()
        : existing.sap_code;
    const modelName =
      input.model_name && input.model_name.trim()
        ? input.model_name.trim()
        : existing.model_name;
    const location =
      input.location && input.location.trim()
        ? input.location.trim().toUpperCase()
        : existing.location;
    const section =
      input.section && input.section.trim() ? input.section.trim() : existing.section;
    const isActive =
      input.is_active !== undefined ? (input.is_active ? 1 : 0) : existing.is_active;

    const now = new Date().toISOString();
    try {
      this.db
        .prepare(
          `UPDATE products
           SET sap_code = ?, model_name = ?, location = ?, section = ?, is_active = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(sapCode, modelName, location, section, isActive, now, id);

      const updated = this.db.prepare('SELECT * FROM products WHERE id = ?').get(id) as ProductRow;
      const parts = this.db
        .prepare('SELECT * FROM product_parts WHERE product_id = ? ORDER BY sn_order ASC, id ASC')
        .all(id) as ProductPartRow[];

      return { ...updated, is_active: Boolean(updated.is_active), parts };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('UNIQUE')) {
        throw new StoreError(409, `SAP CODE "${sapCode}" sudah digunakan model lain.`);
      }
      throw new StoreError(500, 'Gagal memperbarui master model.');
    }
  }

  async bulkImportProducts(
    mode: 'skip_existing' | 'replace_parts',
    rawModels: BulkImportModelInput[],
  ): Promise<BulkImportResult> {
    const now = new Date().toISOString();
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let partsCount = 0;

    const findProductBySap = this.db.prepare(
      'SELECT * FROM products WHERE UPPER(sap_code) = UPPER(?)',
    );
    const insertProduct = this.db.prepare(
      `INSERT INTO products (sap_code, model_name, location, section, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    );
    const updateProduct = this.db.prepare(
      'UPDATE products SET model_name = ?, section = ?, updated_at = ? WHERE id = ?',
    );
    const deletePartsByProduct = this.db.prepare(
      'DELETE FROM product_parts WHERE product_id = ?',
    );
    const insertPart = this.db.prepare(
      `INSERT INTO product_parts (product_id, sn_order, sap_code, parts_name, section, use_qty, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    this.db.transaction(() => {
      for (const rawModel of rawModels) {
        const sapCode =
          typeof rawModel?.sap_code === 'string'
            ? rawModel.sap_code.trim().toUpperCase()
            : '';
        const modelName =
          typeof rawModel?.model_name === 'string' ? rawModel.model_name.trim() : '';
        if (!sapCode || !modelName) continue;

        const location =
          typeof rawModel?.location === 'string' && rawModel.location.trim()
            ? rawModel.location.trim().toUpperCase()
            : 'ASSY';
        const section =
          typeof rawModel?.section === 'string' && rawModel.section.trim()
            ? rawModel.section.trim()
            : 'SET';
        const rawParts = Array.isArray(rawModel?.parts) ? rawModel.parts : [];

        const existing = findProductBySap.get(sapCode) as ProductRow | undefined;
        let productId: number;

        if (existing) {
          if (mode === 'skip_existing') {
            skippedCount += 1;
            continue;
          }
          productId = existing.id;
          updateProduct.run(modelName, section, now, productId);
          deletePartsByProduct.run(productId);
          updatedCount += 1;
        } else {
          const info = insertProduct.run(
            sapCode,
            modelName,
            location,
            section,
            now,
            now,
          );
          productId = info.lastInsertRowid as number;
          createdCount += 1;
        }

        let snCounter = 2;
        for (const rawPart of rawParts) {
          const partSap =
            typeof rawPart?.sap_code === 'string'
              ? rawPart.sap_code.trim().toUpperCase()
              : '';
          const partsName =
            typeof rawPart?.parts_name === 'string' ? rawPart.parts_name.trim() : '';
          if (!partSap || !partsName) continue;

          const partSection =
            typeof rawPart?.section === 'string' && rawPart.section.trim()
              ? rawPart.section.trim()
              : 'part';
          const useQty =
            rawPart?.use_qty === null || rawPart?.use_qty === undefined
              ? null
              : Math.max(0, Number(rawPart.use_qty) || 1);
          const snOrder =
            Number(rawPart?.sn_order) > 1 ? Number(rawPart.sn_order) : snCounter;
          snCounter = Math.max(snCounter + 1, snOrder + 1);

          insertPart.run(
            productId,
            snOrder,
            partSap,
            partsName,
            partSection,
            useQty,
            now,
          );
          partsCount += 1;
        }
      }
    })();

    return { createdCount, updatedCount, skippedCount, partsCount };
  }

  async deleteProduct(id: number): Promise<void> {
    const info = this.db.prepare('DELETE FROM products WHERE id = ?').run(id);
    if (info.changes === 0) {
      throw new StoreError(404, 'Model tidak ditemukan.');
    }
  }

  async addPart(productId: number, part: PartInput): Promise<ProductPartRow> {
    const product = this.db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
    if (!product) {
      throw new StoreError(404, 'Model induk tidak ditemukan.');
    }

    const maxSnRow = this.db
      .prepare('SELECT COALESCE(MAX(sn_order), 1) as max_sn FROM product_parts WHERE product_id = ?')
      .get(productId) as { max_sn: number };
    const snOrder = Number(part.sn_order) > 1 ? Number(part.sn_order) : maxSnRow.max_sn + 1;

    const now = new Date().toISOString();
    const info = this.db
      .prepare(
        `INSERT INTO product_parts (product_id, sn_order, sap_code, parts_name, section, use_qty, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        productId,
        snOrder,
        part.sap_code,
        part.parts_name,
        part.section || 'part',
        part.use_qty === undefined ? 1 : part.use_qty,
        now,
      );

    return this.db
      .prepare('SELECT * FROM product_parts WHERE id = ?')
      .get(info.lastInsertRowid) as ProductPartRow;
  }

  async bulkAddParts(productId: number, rows: PartInput[]): Promise<{ added: number }> {
    const product = this.db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
    if (!product) {
      throw new StoreError(404, 'Model induk tidak ditemukan.');
    }

    const maxSnRow = this.db
      .prepare('SELECT COALESCE(MAX(sn_order), 1) as max_sn FROM product_parts WHERE product_id = ?')
      .get(productId) as { max_sn: number };
    let nextSn = maxSnRow.max_sn + 1;

    const now = new Date().toISOString();
    const insertPart = this.db.prepare(
      `INSERT INTO product_parts (product_id, sn_order, sap_code, parts_name, section, use_qty, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    let added = 0;
    this.db.transaction(() => {
      for (const r of rows) {
        const sapCode =
          typeof r?.sap_code === 'string' ? r.sap_code.trim().toUpperCase() : '';
        const partsName =
          typeof r?.parts_name === 'string' ? r.parts_name.trim() : '';
        if (!sapCode || !partsName) continue;
        const section =
          typeof r?.section === 'string' && r.section.trim() ? r.section.trim() : 'part';
        const useQty =
          r?.use_qty === null || r?.use_qty === undefined
            ? null
            : Math.max(0, Number(r?.use_qty) || 1);
        const snOrder = Number(r?.sn_order) > 1 ? Number(r.sn_order) : nextSn;
        nextSn = Math.max(nextSn + 1, snOrder + 1);
        insertPart.run(productId, snOrder, sapCode, partsName, section, useQty, now);
        added += 1;
      }
    })();

    return { added };
  }

  async updatePart(
    partId: number,
    input: {
      sn_order?: number;
      sap_code?: string;
      parts_name?: string;
      section?: string;
      use_qty?: number | null;
    },
  ): Promise<ProductPartRow> {
    const existing = this.db
      .prepare('SELECT * FROM product_parts WHERE id = ?')
      .get(partId) as ProductPartRow | undefined;
    if (!existing) {
      throw new StoreError(404, 'Part tidak ditemukan.');
    }

    const snOrder =
      input.sn_order !== undefined
        ? Math.max(2, Number(input.sn_order) || existing.sn_order)
        : existing.sn_order;
    const sapCode =
      input.sap_code && input.sap_code.trim()
        ? input.sap_code.trim().toUpperCase()
        : existing.sap_code;
    const partsName =
      input.parts_name && input.parts_name.trim()
        ? input.parts_name.trim()
        : existing.parts_name;
    const section =
      input.section && input.section.trim() ? input.section.trim() : existing.section;
    const useQty =
      input.use_qty === undefined
        ? existing.use_qty
        : input.use_qty === null
          ? null
          : Math.max(0, Number(input.use_qty) || 0);

    this.db
      .prepare(
        `UPDATE product_parts
         SET sn_order = ?, sap_code = ?, parts_name = ?, section = ?, use_qty = ?
         WHERE id = ?`,
      )
      .run(snOrder, sapCode, partsName, section, useQty, partId);

    return this.db
      .prepare('SELECT * FROM product_parts WHERE id = ?')
      .get(partId) as ProductPartRow;
  }

  async deletePart(partId: number): Promise<void> {
    const info = this.db.prepare('DELETE FROM product_parts WHERE id = ?').run(partId);
    if (info.changes === 0) {
      throw new StoreError(404, 'Part tidak ditemukan.');
    }
  }

  async listSessions(): Promise<OpnameSessionStatsRow[]> {
    return this.db
      .prepare(
        `SELECT 
          s.*,
          COUNT(e.id) as total_items,
          SUM(CASE WHEN e.total_qty IS NOT NULL THEN 1 ELSE 0 END) as counted_items,
          COALESCE(SUM(COALESCE(e.qty_ok, 0) + COALESCE(e.qty_ok_2, 0)), 0) as sum_qty_ok,
          COALESCE(SUM(COALESCE(e.qty_nc, 0)), 0) as sum_qty_nc,
          COALESCE(SUM(COALESCE(e.total_qty, 0)), 0) as sum_total_qty
         FROM opname_sessions s
         LEFT JOIN opname_entries e ON e.session_id = s.id
         GROUP BY s.id
         ORDER BY s.period_month DESC, s.id DESC`,
      )
      .all() as OpnameSessionStatsRow[];
  }

  async createSession(input: {
    period_month: string;
    period_label: string;
    opname_date: string;
    notes: string;
  }): Promise<OpnameSessionRow> {
    const activeProducts = this.db
      .prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1')
      .get() as { count: number };

    if (activeProducts.count === 0) {
      throw new StoreError(
        400,
        'Belum ada Master Model aktif. Tambahkan minimal 1 model terlebih dahulu.',
      );
    }

    const now = new Date().toISOString();
    const sessionId = this.db.transaction(() => {
      const info = this.db
        .prepare(
          `INSERT INTO opname_sessions (period_label, period_month, opname_date, status, notes, created_at, closed_at)
           VALUES (?, ?, ?, 'active', ?, ?, NULL)`,
        )
        .run(input.period_label, input.period_month, input.opname_date, input.notes, now);

      const id = info.lastInsertRowid as number;
      this.snapshotMasterToSessionSync(id);
      return id;
    })();

    return this.db
      .prepare('SELECT * FROM opname_sessions WHERE id = ?')
      .get(sessionId) as OpnameSessionRow;
  }

  async getSessionWithEntries(
    sessionId: number,
  ): Promise<{ session: OpnameSessionRow; entries: OpnameEntryRow[] }> {
    const session = this.db
      .prepare('SELECT * FROM opname_sessions WHERE id = ?')
      .get(sessionId) as OpnameSessionRow | undefined;

    if (!session) {
      throw new StoreError(404, 'Sesi opname tidak ditemukan.');
    }

    const entries = this.db
      .prepare(
        `SELECT * FROM opname_entries
         WHERE session_id = ?
         ORDER BY product_id ASC, is_submitted DESC, location ASC, CASE WHEN item_type = 'finished_good' THEN 0 ELSE 1 END ASC, sn_order ASC, id ASC`,
      )
      .all(sessionId) as OpnameEntryRow[];

    return { session, entries };
  }

  async updateEntry(
    sessionId: number,
    entryId: number,
    input: {
      qty_ok?: unknown;
      qty_ok_2?: unknown;
      qty_nc?: unknown;
      operator_name?: string;
      notes?: string;
    },
  ): Promise<OpnameEntryRow> {
    const session = this.db
      .prepare('SELECT * FROM opname_sessions WHERE id = ?')
      .get(sessionId) as OpnameSessionRow | undefined;

    if (!session) {
      throw new StoreError(404, 'Sesi opname tidak ditemukan.');
    }
    if (session.status !== 'active') {
      throw new StoreError(
        403,
        'Sesi opname sudah dikunci/selesai dan tidak dapat diubah lagi.',
      );
    }

    const existing = this.db
      .prepare('SELECT * FROM opname_entries WHERE id = ? AND session_id = ?')
      .get(entryId, sessionId) as OpnameEntryRow | undefined;

    if (!existing) {
      throw new StoreError(404, 'Item opname tidak ditemukan.');
    }
    if (existing.is_submitted) {
      throw new StoreError(
        403,
        'Model ini sudah disubmit. Klik tombol Edit pada model untuk mengubah angka.',
      );
    }

    const parseNullableInt = (
      val: unknown,
      fallback: number | null,
    ): number | null => {
      if (val === undefined) return fallback;
      if (val === null || val === '') return null;
      const parsed = Number(val);
      if (!Number.isFinite(parsed) || parsed < 0) return NaN;
      return Math.round(parsed);
    };

    const qtyOk = parseNullableInt(input.qty_ok, existing.qty_ok);
    const qtyOk2 = parseNullableInt(input.qty_ok_2, existing.qty_ok_2);
    const qtyNc = parseNullableInt(input.qty_nc, existing.qty_nc);

    if (Number.isNaN(qtyOk) || Number.isNaN(qtyOk2) || Number.isNaN(qtyNc)) {
      throw new StoreError(400, 'Nilai QTY harus berupa angka 0 atau lebih.');
    }

    const hasAnyCount = qtyOk !== null || qtyOk2 !== null || qtyNc !== null;
    const totalQty = hasAnyCount
      ? (qtyOk ?? 0) + (qtyOk2 ?? 0) + (qtyNc ?? 0)
      : null;

    const operatorName =
      typeof input.operator_name === 'string'
        ? input.operator_name.trim().slice(0, 80)
        : existing.operator_name;
    const notes =
      typeof input.notes === 'string'
        ? input.notes.trim().slice(0, 240)
        : existing.notes;
    const updatedAt = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE opname_entries
         SET qty_ok = ?, qty_ok_2 = ?, qty_nc = ?, total_qty = ?, operator_name = ?, notes = ?, updated_at = ?
         WHERE id = ? AND session_id = ?`,
      )
      .run(qtyOk, qtyOk2, qtyNc, totalQty, operatorName, notes, updatedAt, entryId, sessionId);

    return this.db
      .prepare('SELECT * FROM opname_entries WHERE id = ?')
      .get(entryId) as OpnameEntryRow;
  }

  async submitSession(
    sessionId: number,
    input: {
      operator_name: string;
      location: string;
      source_location: string;
      product_id: number | null;
    },
  ): Promise<{ session: OpnameSessionRow; entries: OpnameEntryRow[] }> {
    const session = this.db
      .prepare('SELECT * FROM opname_sessions WHERE id = ?')
      .get(sessionId) as OpnameSessionRow | undefined;

    if (!session) {
      throw new StoreError(404, 'Sesi opname tidak ditemukan.');
    }
    if (session.status !== 'active') {
      throw new StoreError(
        403,
        'Sesi opname sudah dikunci/selesai dan tidak dapat disubmit ulang.',
      );
    }

    const { operator_name: operatorName, location, source_location: sourceLocation, product_id: productId } =
      input;

    if (productId && Number.isFinite(productId)) {
      const alreadyLocked = this.db
        .prepare(
          `SELECT COUNT(*) as c FROM opname_entries
           WHERE session_id = ? AND product_id = ? AND is_submitted = 1 AND LOWER(location) = LOWER(?)`,
        )
        .get(sessionId, productId, location) as { c: number };

      if (alreadyLocked.c > 0) {
        throw new StoreError(
          409,
          `Lokasi "${location}" untuk model ini sudah disubmit dan terkunci. Pilih lokasi lain.`,
        );
      }
    }

    const now = new Date().toISOString();

    this.db.transaction(() => {
      if (productId && Number.isFinite(productId)) {
        const updatedInfo = this.db
          .prepare(
            `UPDATE opname_entries
             SET operator_name = ?, location = ?, is_submitted = 1, submitted_at = ?, updated_at = COALESCE(updated_at, ?)
             WHERE session_id = ? AND product_id = ? AND is_submitted = 0 AND LOWER(location) = LOWER(?)`,
          )
          .run(operatorName, location, now, now, sessionId, productId, sourceLocation);

        if (updatedInfo.changes === 0) {
          this.db
            .prepare(
              `UPDATE opname_entries
               SET operator_name = ?, location = ?, is_submitted = 1, submitted_at = ?, updated_at = COALESCE(updated_at, ?)
               WHERE session_id = ? AND product_id = ? AND is_submitted = 0`,
            )
            .run(operatorName, location, now, now, sessionId, productId);
        }

        const totalLocationsRow = this.db
          .prepare('SELECT COUNT(*) as c FROM inventory_locations')
          .get() as { c: number };
        const submittedLocRows = this.db
          .prepare(
            `SELECT DISTINCT LOWER(location) as loc FROM opname_entries
             WHERE session_id = ? AND product_id = ? AND is_submitted = 1 AND location != ''`,
          )
          .all(sessionId, productId) as Array<{ loc: string }>;

        if (totalLocationsRow.c === 0 || submittedLocRows.length < totalLocationsRow.c) {
          this.createBlankDraftForProductSync(sessionId, productId);
        }
      } else {
        this.db
          .prepare(
            `UPDATE opname_entries
             SET operator_name = ?, is_submitted = 1, submitted_at = ?, updated_at = COALESCE(updated_at, ?)
             WHERE session_id = ? AND total_qty IS NOT NULL`,
          )
          .run(operatorName, now, now, sessionId);
      }

      const submitters = this.db
        .prepare(
          `SELECT DISTINCT operator_name FROM opname_entries
           WHERE session_id = ? AND is_submitted = 1 AND operator_name != ''`,
        )
        .all(sessionId) as Array<{ operator_name: string }>;

      const preparedSummary =
        submitters.length > 0
          ? submitters.map((s) => s.operator_name).join(', ')
          : operatorName;

      this.db
        .prepare(
          `UPDATE opname_sessions
           SET prepared_by = ?, submitted_at = ?
           WHERE id = ?`,
        )
        .run(preparedSummary, now, sessionId);
    })();

    return this.getSessionWithEntries(sessionId);
  }

  async reopenModel(
    sessionId: number,
    productId: number,
    location: string,
  ): Promise<{ session: OpnameSessionRow; entries: OpnameEntryRow[] }> {
    const session = this.db
      .prepare('SELECT * FROM opname_sessions WHERE id = ?')
      .get(sessionId) as OpnameSessionRow | undefined;

    if (!session) {
      throw new StoreError(404, 'Sesi opname tidak ditemukan.');
    }
    if (session.status !== 'active') {
      throw new StoreError(403, 'Sesi sudah dikunci/selesai.');
    }

    if (location) {
      this.db
        .prepare(
          `UPDATE opname_entries
           SET is_submitted = 0
           WHERE session_id = ? AND product_id = ? AND LOWER(location) = LOWER(?)`,
        )
        .run(sessionId, productId, location);
    } else {
      this.db
        .prepare(
          `UPDATE opname_entries
           SET is_submitted = 0
           WHERE session_id = ? AND product_id = ?`,
        )
        .run(sessionId, productId);
    }

    return this.getSessionWithEntries(sessionId);
  }

  async syncSessionMaster(sessionId: number): Promise<{ addedCount: number }> {
    const session = this.db
      .prepare('SELECT * FROM opname_sessions WHERE id = ?')
      .get(sessionId) as OpnameSessionRow | undefined;

    if (!session) {
      throw new StoreError(404, 'Sesi opname tidak ditemukan.');
    }
    if (session.status !== 'active') {
      throw new StoreError(400, 'Hanya sesi berstatus Aktif yang bisa disinkronkan.');
    }

    const addedCount = this.snapshotMasterToSessionSync(sessionId);
    return { addedCount };
  }

  async closeSession(sessionId: number): Promise<{ ok: boolean; closed_at: string }> {
    const session = this.db
      .prepare('SELECT * FROM opname_sessions WHERE id = ?')
      .get(sessionId) as OpnameSessionRow | undefined;

    if (!session) {
      throw new StoreError(404, 'Sesi opname tidak ditemukan.');
    }

    const closedAt = new Date().toISOString();
    this.db
      .prepare("UPDATE opname_sessions SET status = 'closed', closed_at = ? WHERE id = ?")
      .run(closedAt, sessionId);
    return { ok: true, closed_at: closedAt };
  }

  async reopenSession(sessionId: number): Promise<{ ok: boolean }> {
    const session = this.db
      .prepare('SELECT * FROM opname_sessions WHERE id = ?')
      .get(sessionId) as OpnameSessionRow | undefined;

    if (!session) {
      throw new StoreError(404, 'Sesi opname tidak ditemukan.');
    }

    this.db
      .prepare("UPDATE opname_sessions SET status = 'active', closed_at = NULL WHERE id = ?")
      .run(sessionId);
    return { ok: true };
  }

  async deleteSession(sessionId: number): Promise<void> {
    const info = this.db.prepare('DELETE FROM opname_sessions WHERE id = ?').run(sessionId);
    if (info.changes === 0) {
      throw new StoreError(404, 'Sesi opname tidak ditemukan.');
    }
  }
}
