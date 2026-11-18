import { Pool, type PoolClient } from 'pg';
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

function createPgPool(connectionString: string): Pool {
  const isLocal =
    connectionString.includes('localhost') ||
    connectionString.includes('127.0.0.1');
  const disableSsl = connectionString.includes('sslmode=disable');

  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
    ssl: !isLocal && !disableSsl ? { rejectUnauthorized: false } : undefined,
  });
}

function normalizeProductRow(row: ProductRow): ProductWithPartsResponse & { parts: ProductPartRow[] } {
  return {
    id: Number(row.id),
    sap_code: row.sap_code,
    model_name: row.model_name,
    location: row.location,
    section: row.section,
    is_active: Boolean(Number(row.is_active)),
    created_at: row.created_at,
    updated_at: row.updated_at,
    parts: [],
  };
}

function normalizePartRow(row: ProductPartRow): ProductPartRow {
  return {
    id: Number(row.id),
    product_id: Number(row.product_id),
    sn_order: Number(row.sn_order),
    sap_code: row.sap_code,
    parts_name: row.parts_name,
    section: row.section,
    use_qty: row.use_qty === null || row.use_qty === undefined ? null : Number(row.use_qty),
    created_at: row.created_at,
  };
}

function normalizeEntryRow(row: OpnameEntryRow): OpnameEntryRow {
  return {
    ...row,
    id: Number(row.id),
    session_id: Number(row.session_id),
    product_id: Number(row.product_id),
    part_id: row.part_id === null || row.part_id === undefined ? null : Number(row.part_id),
    sn_order: Number(row.sn_order),
    use_qty: row.use_qty === null || row.use_qty === undefined ? null : Number(row.use_qty),
    qty_ok: row.qty_ok === null || row.qty_ok === undefined ? null : Number(row.qty_ok),
    qty_ok_2: row.qty_ok_2 === null || row.qty_ok_2 === undefined ? null : Number(row.qty_ok_2),
    qty_nc: row.qty_nc === null || row.qty_nc === undefined ? null : Number(row.qty_nc),
    total_qty: row.total_qty === null || row.total_qty === undefined ? null : Number(row.total_qty),
    is_submitted: Number(row.is_submitted),
  };
}

export class PostgresInventoryStore implements InventoryStore {
  readonly backend = 'supabase-postgres' as const;
  private pool: Pool;
  private initPromise: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.pool = createPgPool(connectionString);
  }

  private async ensureReady(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initializeSchemaAndSeed().catch((err) => {
        this.initPromise = null;
        throw err;
      });
    }
    await this.initPromise;
  }

  private async withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    await this.ensureReady();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  private async initializeSchemaAndSeed(): Promise<void> {
    const client = await this.pool.connect();
    let locked = false;
    try {
      await client.query('SELECT pg_advisory_lock(88421001)');
      locked = true;

      await client.query(`
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
      `);

      const pinCheck = await client.query<{ value: string }>(
        'SELECT value FROM app_settings WHERE key = $1',
        ['admin_pin_hash'],
      );
      if (pinCheck.rowCount === 0) {
        const defaultPin = process.env.ADMIN_PIN || '1234';
        await client.query(
          `INSERT INTO app_settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO NOTHING`,
          ['admin_pin_hash', hashPin(defaultPin)],
        );
      }

      const locCheck = await client.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM inventory_locations',
      );
      if ((locCheck.rows[0]?.count ?? 0) === 0) {
        const now = new Date().toISOString();
        for (const [code, name, desc] of DEFAULT_LOCATIONS) {
          await client.query(
            `INSERT INTO inventory_locations (code, name, description, created_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (code) DO NOTHING`,
            [code, name, desc, now],
          );
        }
      }

      const prodCheck = await client.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM products',
      );
      if ((prodCheck.rows[0]?.count ?? 0) === 0) {
        await client.query('BEGIN');
        try {
          await this.seedInitialDataTx(client);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        }
      }
    } finally {
      if (locked) {
        await client.query('SELECT pg_advisory_unlock(88421001)').catch(() => {});
      }
      client.release();
    }
  }

  private async seedInitialDataTx(client: PoolClient): Promise<void> {
    const now = new Date().toISOString();

    for (const seedProd of INITIAL_SEED_PRODUCTS) {
      const prodRes = await client.query<{ id: number }>(
        `INSERT INTO products (sap_code, model_name, location, section, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, $5, $6)
         RETURNING id`,
        [seedProd.sap_code, seedProd.model_name, seedProd.location, seedProd.section, now, now],
      );
      const pid = prodRes.rows[0].id;

      await this.insertPartsBatchTx(
        client,
        pid,
        seedProd.parts.map(([sn, sap, pname, sec, useQty]) => ({
          sn_order: sn,
          sap_code: sap,
          parts_name: pname,
          section: sec,
          use_qty: useQty,
        })),
        now,
      );
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

    const archivedRes = await client.query<{ id: number }>(
      `INSERT INTO opname_sessions (period_label, period_month, opname_date, status, prepared_by, submitted_at, notes, created_at, closed_at)
       VALUES ($1, $2, $3, 'closed', 'Helen', $4, $5, $6, $7)
       RETURNING id`,
      [
        prevLabel,
        prevMonthStr,
        prevShortDate,
        closedAt,
        'Arsip stock opname akhir bulan sebelumnya',
        closedAt,
        closedAt,
      ],
    );
    const archivedSessionId = archivedRes.rows[0].id;
    await this.snapshotMasterToSessionTx(client, archivedSessionId);

    const archivedEntries = await client.query<{ id: number; sn_order: number }>(
      'SELECT id, sn_order FROM opname_entries WHERE session_id = $1',
      [archivedSessionId],
    );
    for (const entry of archivedEntries.rows) {
      const sn = Number(entry.sn_order);
      const ok = 25 + (sn % 7) * 5;
      const ok2 = sn % 4 === 0 ? 4 : 0;
      const nc = sn % 6 === 0 ? 2 : 0;
      const total = ok + ok2 + nc;
      const note = nc > 0 ? 'Part lecet / reject QC' : '';
      await client.query(
        `UPDATE opname_entries
         SET qty_ok = $1, qty_ok_2 = $2, qty_nc = $3, total_qty = $4, operator_name = 'Helen', notes = $5, updated_at = $6
         WHERE id = $7`,
        [ok, ok2, nc, total, note, closedAt, entry.id],
      );
    }

    const activeRes = await client.query<{ id: number }>(
      `INSERT INTO opname_sessions (period_label, period_month, opname_date, status, notes, created_at, closed_at)
       VALUES ($1, $2, $3, 'active', $4, $5, NULL)
       RETURNING id`,
      [currLabel, currMonthStr, currShortDate, 'Stock opname bulanan berjalan', now],
    );
    await this.snapshotMasterToSessionTx(client, activeRes.rows[0].id);
  }

  private async insertPartsBatchTx(
    client: PoolClient,
    productId: number,
    parts: Array<{
      sn_order: number;
      sap_code: string;
      parts_name: string;
      section: string;
      use_qty: number | null;
    }>,
    createdAt: string,
  ): Promise<void> {
    if (parts.length === 0) return;

    const values: unknown[] = [];
    const placeholders: string[] = [];
    parts.forEach((part, idx) => {
      const base = idx * 7;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`,
      );
      values.push(
        productId,
        part.sn_order,
        part.sap_code,
        part.parts_name,
        part.section,
        part.use_qty,
        createdAt,
      );
    });

    await client.query(
      `INSERT INTO product_parts (product_id, sn_order, sap_code, parts_name, section, use_qty, created_at)
       VALUES ${placeholders.join(', ')}`,
      values,
    );
  }

  private async insertEntriesBatchTx(
    client: PoolClient,
    rows: Array<{
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
    }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    const chunkSize = 250;

    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      chunk.forEach((row, idx) => {
        const base = idx * 11;
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, NULL, NULL, NULL, NULL, '', '', 0, NULL)`,
        );
        values.push(
          row.session_id,
          row.product_id,
          row.part_id,
          row.sn_order,
          row.item_type,
          row.model_name,
          row.location,
          row.sap_code,
          row.parts_name,
          row.section,
          row.use_qty,
        );
      });

      await client.query(
        `INSERT INTO opname_entries (
          session_id, product_id, part_id, sn_order, item_type,
          model_name, location, sap_code, parts_name, section, use_qty,
          qty_ok, qty_ok_2, qty_nc, total_qty, operator_name, notes, is_submitted, updated_at
        ) VALUES ${placeholders.join(', ')}`,
        values,
      );
    }
  }

  private async snapshotMasterToSessionTx(
    client: PoolClient,
    sessionId: number,
  ): Promise<number> {
    const activeProducts = (
      await client.query<ProductRow>(
        'SELECT * FROM products WHERE is_active = 1 ORDER BY id ASC',
      )
    ).rows;
    if (activeProducts.length === 0) return 0;

    const allParts = (
      await client.query<ProductPartRow>(
        'SELECT * FROM product_parts ORDER BY product_id ASC, sn_order ASC, id ASC',
      )
    ).rows;
    const partsByProduct = new Map<number, ProductPartRow[]>();
    for (const part of allParts) {
      const list = partsByProduct.get(Number(part.product_id)) ?? [];
      list.push(part);
      partsByProduct.set(Number(part.product_id), list);
    }

    const existingRows = (
      await client.query<{
        product_id: number;
        item_type: string;
        part_id: number | null;
      }>(
        'SELECT product_id, item_type, part_id FROM opname_entries WHERE session_id = $1',
        [sessionId],
      )
    ).rows;

    const existingKeys = new Set<string>();
    for (const r of existingRows) {
      existingKeys.add(`${r.product_id}:${r.item_type}:${r.part_id ?? -1}`);
    }

    const toInsert: Array<{
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
    }> = [];

    for (const prod of activeProducts) {
      const pid = Number(prod.id);
      if (!existingKeys.has(`${pid}:finished_good:-1`)) {
        toInsert.push({
          session_id: sessionId,
          product_id: pid,
          part_id: null,
          sn_order: 1,
          item_type: 'finished_good',
          model_name: prod.model_name,
          location: '',
          sap_code: prod.sap_code,
          parts_name: prod.model_name,
          section: prod.section || 'SET',
          use_qty: null,
        });
      }

      const parts = partsByProduct.get(pid) ?? [];
      parts.forEach((part, idx) => {
        const partId = Number(part.id);
        if (!existingKeys.has(`${pid}:part:${partId}`)) {
          toInsert.push({
            session_id: sessionId,
            product_id: pid,
            part_id: partId,
            sn_order: Number(part.sn_order) || idx + 2,
            item_type: 'part',
            model_name: prod.model_name,
            location: '',
            sap_code: part.sap_code,
            parts_name: part.parts_name,
            section: part.section || 'part',
            use_qty: part.use_qty === null ? null : Number(part.use_qty),
          });
        }
      });
    }

    await this.insertEntriesBatchTx(client, toInsert);
    return toInsert.length;
  }

  private async createBlankDraftForProductTx(
    client: PoolClient,
    sessionId: number,
    productId: number,
  ): Promise<boolean> {
    const existingBlank = await client.query<{ id: number }>(
      `SELECT id FROM opname_entries
       WHERE session_id = $1 AND product_id = $2 AND is_submitted = 0 AND location = ''
       LIMIT 1`,
      [sessionId, productId],
    );
    if ((existingBlank.rowCount ?? 0) > 0) return false;

    const prodRes = await client.query<ProductRow>(
      'SELECT * FROM products WHERE id = $1',
      [productId],
    );
    const prod = prodRes.rows[0];

    if (prod) {
      const partsRes = await client.query<ProductPartRow>(
        'SELECT * FROM product_parts WHERE product_id = $1 ORDER BY sn_order ASC, id ASC',
        [productId],
      );

      const rows: Array<{
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
      }> = [
        {
          session_id: sessionId,
          product_id: Number(prod.id),
          part_id: null,
          sn_order: 1,
          item_type: 'finished_good',
          model_name: prod.model_name,
          location: '',
          sap_code: prod.sap_code,
          parts_name: prod.model_name,
          section: prod.section || 'SET',
          use_qty: null,
        },
        ...partsRes.rows.map((part, idx) => ({
          session_id: sessionId,
          product_id: Number(prod.id),
          part_id: Number(part.id),
          sn_order: Number(part.sn_order) || idx + 2,
          item_type: 'part' as const,
          model_name: prod.model_name,
          location: '',
          sap_code: part.sap_code,
          parts_name: part.parts_name,
          section: part.section || 'part',
          use_qty: part.use_qty === null ? null : Number(part.use_qty),
        })),
      ];

      await this.insertEntriesBatchTx(client, rows);
      return true;
    }

    const existingEntries = (
      await client.query<OpnameEntryRow>(
        `SELECT * FROM opname_entries
         WHERE session_id = $1 AND product_id = $2
         ORDER BY CASE WHEN item_type = 'finished_good' THEN 0 ELSE 1 END ASC, sn_order ASC, id ASC`,
        [sessionId, productId],
      )
    ).rows;

    if (existingEntries.length === 0) return false;

    const seen = new Set<string>();
    const templateRows: Array<{
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
    }> = [];

    for (const row of existingEntries) {
      const key = `${row.item_type}:${row.part_id ?? -1}:${row.sap_code}:${row.parts_name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      templateRows.push({
        session_id: sessionId,
        product_id: productId,
        part_id: row.part_id === null ? null : Number(row.part_id),
        sn_order: Number(row.sn_order),
        item_type: row.item_type,
        model_name: row.model_name,
        location: '',
        sap_code: row.sap_code,
        parts_name: row.parts_name,
        section: row.section,
        use_qty: row.use_qty === null ? null : Number(row.use_qty),
      });
    }

    await this.insertEntriesBatchTx(client, templateRows);
    return true;
  }

  async getAdminPinHash(): Promise<string | undefined> {
    await this.ensureReady();
    const res = await this.pool.query<{ value: string }>(
      'SELECT value FROM app_settings WHERE key = $1',
      ['admin_pin_hash'],
    );
    return res.rows[0]?.value;
  }

  async setAdminPinHash(hash: string): Promise<void> {
    await this.ensureReady();
    await this.pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('admin_pin_hash', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [hash],
    );
  }

  async listLocations(): Promise<LocationRow[]> {
    await this.ensureReady();
    const res = await this.pool.query<LocationRow>(
      `SELECT id, code, name, description, created_at
       FROM inventory_locations
       ORDER BY name ASC`,
    );
    return res.rows.map((r) => ({ ...r, id: Number(r.id) }));
  }

  async createLocation(input: {
    code: string;
    name: string;
    description: string;
  }): Promise<LocationRow> {
    return this.withTx(async (client) => {
      const dup = await client.query(
        'SELECT id FROM inventory_locations WHERE UPPER(name) = UPPER($1) OR UPPER(code) = UPPER($2)',
        [input.name, input.code],
      );
      if ((dup.rowCount ?? 0) > 0) {
        throw new StoreError(409, `Location "${input.name}" sudah terdaftar.`);
      }

      const now = new Date().toISOString();
      const inserted = await client.query<LocationRow>(
        `INSERT INTO inventory_locations (code, name, description, created_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id, code, name, description, created_at`,
        [input.code, input.name, input.description, now],
      );
      const created = inserted.rows[0];

      const activeSessions = await client.query<{ id: number }>(
        "SELECT id FROM opname_sessions WHERE status = 'active'",
      );
      for (const sess of activeSessions.rows) {
        const productRows = await client.query<{ product_id: number }>(
          'SELECT DISTINCT product_id FROM opname_entries WHERE session_id = $1',
          [sess.id],
        );
        for (const p of productRows.rows) {
          await this.createBlankDraftForProductTx(client, sess.id, Number(p.product_id));
        }
      }

      return { ...created, id: Number(created.id) };
    });
  }

  async updateLocation(
    id: number,
    input: { code?: string; name?: string; description?: string },
  ): Promise<LocationRow> {
    await this.ensureReady();
    const existingRes = await this.pool.query<LocationRow>(
      'SELECT * FROM inventory_locations WHERE id = $1',
      [id],
    );
    const existing = existingRes.rows[0];
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

    const dup = await this.pool.query(
      'SELECT id FROM inventory_locations WHERE id != $1 AND (UPPER(name) = UPPER($2) OR UPPER(code) = UPPER($3))',
      [id, name, code],
    );
    if ((dup.rowCount ?? 0) > 0) {
      throw new StoreError(409, `Location "${name}" sudah digunakan.`);
    }

    const updated = await this.pool.query<LocationRow>(
      `UPDATE inventory_locations
       SET code = $1, name = $2, description = $3
       WHERE id = $4
       RETURNING id, code, name, description, created_at`,
      [code, name, description, id],
    );
    const row = updated.rows[0];
    return { ...row, id: Number(row.id) };
  }

  async deleteLocation(id: number): Promise<void> {
    await this.ensureReady();
    const res = await this.pool.query('DELETE FROM inventory_locations WHERE id = $1', [id]);
    if ((res.rowCount ?? 0) === 0) {
      throw new StoreError(404, 'Location tidak ditemukan.');
    }
  }

  async listProducts(): Promise<ProductWithPartsResponse[]> {
    await this.ensureReady();
    const productsRes = await this.pool.query<ProductRow>(
      'SELECT * FROM products ORDER BY id ASC',
    );
    const partsRes = await this.pool.query<ProductPartRow>(
      'SELECT * FROM product_parts ORDER BY product_id ASC, sn_order ASC, id ASC',
    );

    const partsByProduct = new Map<number, ProductPartRow[]>();
    for (const part of partsRes.rows) {
      const normalized = normalizePartRow(part);
      const list = partsByProduct.get(normalized.product_id) ?? [];
      list.push(normalized);
      partsByProduct.set(normalized.product_id, list);
    }

    return productsRes.rows.map((p) => {
      const normalized = normalizeProductRow(p);
      return {
        ...normalized,
        parts: partsByProduct.get(normalized.id) ?? [],
      };
    });
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
      return await this.withTx(async (client) => {
        const prodRes = await client.query<ProductRow>(
          `INSERT INTO products (sap_code, model_name, location, section, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 1, $5, $6)
           RETURNING *`,
          [input.sap_code, input.model_name, input.location, input.section, now, now],
        );
        const product = normalizeProductRow(prodRes.rows[0]);

        const preparedParts: Array<{
          sn_order: number;
          sap_code: string;
          parts_name: string;
          section: string;
          use_qty: number | null;
        }> = [];
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
          preparedParts.push({
            sn_order: snOrder,
            sap_code: partSap,
            parts_name: partsName,
            section: partSection,
            use_qty: useQty,
          });
        }

        await this.insertPartsBatchTx(client, product.id, preparedParts, now);
        const partsRes = await client.query<ProductPartRow>(
          'SELECT * FROM product_parts WHERE product_id = $1 ORDER BY sn_order ASC, id ASC',
          [product.id],
        );
        return {
          ...product,
          parts: partsRes.rows.map(normalizePartRow),
        };
      });
    } catch (err: unknown) {
      if (err instanceof StoreError) throw err;
      const pgCode = typeof err === 'object' && err && 'code' in err ? String(err.code) : '';
      if (pgCode === '23505') {
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
    await this.ensureReady();
    const existingRes = await this.pool.query<ProductRow>(
      'SELECT * FROM products WHERE id = $1',
      [id],
    );
    const existing = existingRes.rows[0];
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
      input.is_active !== undefined ? (input.is_active ? 1 : 0) : Number(existing.is_active);
    const now = new Date().toISOString();

    try {
      const updatedRes = await this.pool.query<ProductRow>(
        `UPDATE products
         SET sap_code = $1, model_name = $2, location = $3, section = $4, is_active = $5, updated_at = $6
         WHERE id = $7
         RETURNING *`,
        [sapCode, modelName, location, section, isActive, now, id],
      );
      const partsRes = await this.pool.query<ProductPartRow>(
        'SELECT * FROM product_parts WHERE product_id = $1 ORDER BY sn_order ASC, id ASC',
        [id],
      );
      const product = normalizeProductRow(updatedRes.rows[0]);
      return { ...product, parts: partsRes.rows.map(normalizePartRow) };
    } catch (err: unknown) {
      const pgCode = typeof err === 'object' && err && 'code' in err ? String(err.code) : '';
      if (pgCode === '23505') {
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

    await this.withTx(async (client) => {
      const existingProducts = await client.query<{ id: number; sap_code: string }>(
        'SELECT id, sap_code FROM products',
      );
      const sapToId = new Map<string, number>();
      for (const row of existingProducts.rows) {
        sapToId.set(row.sap_code.toUpperCase(), Number(row.id));
      }

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

        const existingId = sapToId.get(sapCode);
        let productId: number;

        if (existingId) {
          if (mode === 'skip_existing') {
            skippedCount += 1;
            continue;
          }
          productId = existingId;
          await client.query(
            'UPDATE products SET model_name = $1, section = $2, updated_at = $3 WHERE id = $4',
            [modelName, section, now, productId],
          );
          await client.query('DELETE FROM product_parts WHERE product_id = $1', [productId]);
          updatedCount += 1;
        } else {
          const inserted = await client.query<{ id: number }>(
            `INSERT INTO products (sap_code, model_name, location, section, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, 1, $5, $6)
             RETURNING id`,
            [sapCode, modelName, location, section, now, now],
          );
          productId = Number(inserted.rows[0].id);
          sapToId.set(sapCode, productId);
          createdCount += 1;
        }

        const preparedParts: Array<{
          sn_order: number;
          sap_code: string;
          parts_name: string;
          section: string;
          use_qty: number | null;
        }> = [];
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

          preparedParts.push({
            sn_order: snOrder,
            sap_code: partSap,
            parts_name: partsName,
            section: partSection,
            use_qty: useQty,
          });
        }

        await this.insertPartsBatchTx(client, productId, preparedParts, now);
        partsCount += preparedParts.length;
      }
    });

    return { createdCount, updatedCount, skippedCount, partsCount };
  }

  async deleteProduct(id: number): Promise<void> {
    await this.ensureReady();
    const res = await this.pool.query('DELETE FROM products WHERE id = $1', [id]);
    if ((res.rowCount ?? 0) === 0) {
      throw new StoreError(404, 'Model tidak ditemukan.');
    }
  }

  async addPart(productId: number, part: PartInput): Promise<ProductPartRow> {
    await this.ensureReady();
    const prod = await this.pool.query('SELECT id FROM products WHERE id = $1', [productId]);
    if ((prod.rowCount ?? 0) === 0) {
      throw new StoreError(404, 'Model induk tidak ditemukan.');
    }

    const maxSnRes = await this.pool.query<{ max_sn: number }>(
      'SELECT COALESCE(MAX(sn_order), 1)::int AS max_sn FROM product_parts WHERE product_id = $1',
      [productId],
    );
    const snOrder =
      Number(part.sn_order) > 1 ? Number(part.sn_order) : (maxSnRes.rows[0]?.max_sn ?? 1) + 1;

    const now = new Date().toISOString();
    const created = await this.pool.query<ProductPartRow>(
      `INSERT INTO product_parts (product_id, sn_order, sap_code, parts_name, section, use_qty, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        productId,
        snOrder,
        part.sap_code,
        part.parts_name,
        part.section || 'part',
        part.use_qty === undefined ? 1 : part.use_qty,
        now,
      ],
    );

    return normalizePartRow(created.rows[0]);
  }

  async bulkAddParts(productId: number, rows: PartInput[]): Promise<{ added: number }> {
    return this.withTx(async (client) => {
      const prod = await client.query('SELECT id FROM products WHERE id = $1', [productId]);
      if ((prod.rowCount ?? 0) === 0) {
        throw new StoreError(404, 'Model induk tidak ditemukan.');
      }

      const maxSnRes = await client.query<{ max_sn: number }>(
        'SELECT COALESCE(MAX(sn_order), 1)::int AS max_sn FROM product_parts WHERE product_id = $1',
        [productId],
      );
      let nextSn = (maxSnRes.rows[0]?.max_sn ?? 1) + 1;
      const now = new Date().toISOString();

      const prepared: Array<{
        sn_order: number;
        sap_code: string;
        parts_name: string;
        section: string;
        use_qty: number | null;
      }> = [];

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
        prepared.push({
          sn_order: snOrder,
          sap_code: sapCode,
          parts_name: partsName,
          section,
          use_qty: useQty,
        });
      }

      await this.insertPartsBatchTx(client, productId, prepared, now);
      return { added: prepared.length };
    });
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
    await this.ensureReady();
    const existingRes = await this.pool.query<ProductPartRow>(
      'SELECT * FROM product_parts WHERE id = $1',
      [partId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new StoreError(404, 'Part tidak ditemukan.');
    }

    const snOrder =
      input.sn_order !== undefined
        ? Math.max(2, Number(input.sn_order) || Number(existing.sn_order))
        : Number(existing.sn_order);
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

    const updated = await this.pool.query<ProductPartRow>(
      `UPDATE product_parts
       SET sn_order = $1, sap_code = $2, parts_name = $3, section = $4, use_qty = $5
       WHERE id = $6
       RETURNING *`,
      [snOrder, sapCode, partsName, section, useQty, partId],
    );
    return normalizePartRow(updated.rows[0]);
  }

  async deletePart(partId: number): Promise<void> {
    await this.ensureReady();
    const res = await this.pool.query('DELETE FROM product_parts WHERE id = $1', [partId]);
    if ((res.rowCount ?? 0) === 0) {
      throw new StoreError(404, 'Part tidak ditemukan.');
    }
  }

  async listSessions(): Promise<OpnameSessionStatsRow[]> {
    await this.ensureReady();
    const res = await this.pool.query<OpnameSessionStatsRow>(
      `SELECT 
        s.*,
        COUNT(e.id)::int AS total_items,
        COALESCE(SUM(CASE WHEN e.total_qty IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS counted_items,
        COALESCE(SUM(COALESCE(e.qty_ok, 0) + COALESCE(e.qty_ok_2, 0)), 0)::int AS sum_qty_ok,
        COALESCE(SUM(COALESCE(e.qty_nc, 0)), 0)::int AS sum_qty_nc,
        COALESCE(SUM(COALESCE(e.total_qty, 0)), 0)::int AS sum_total_qty
       FROM opname_sessions s
       LEFT JOIN opname_entries e ON e.session_id = s.id
       GROUP BY s.id
       ORDER BY s.period_month DESC, s.id DESC`,
    );

    return res.rows.map((r) => ({
      ...r,
      id: Number(r.id),
      total_items: Number(r.total_items),
      counted_items: Number(r.counted_items),
      sum_qty_ok: Number(r.sum_qty_ok),
      sum_qty_nc: Number(r.sum_qty_nc),
      sum_total_qty: Number(r.sum_total_qty),
    }));
  }

  async createSession(input: {
    period_month: string;
    period_label: string;
    opname_date: string;
    notes: string;
  }): Promise<OpnameSessionRow> {
    return this.withTx(async (client) => {
      const activeCount = await client.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM products WHERE is_active = 1',
      );
      if ((activeCount.rows[0]?.count ?? 0) === 0) {
        throw new StoreError(
          400,
          'Belum ada Master Model aktif. Tambahkan minimal 1 model terlebih dahulu.',
        );
      }

      const now = new Date().toISOString();
      const createdRes = await client.query<OpnameSessionRow>(
        `INSERT INTO opname_sessions (period_label, period_month, opname_date, status, notes, created_at, closed_at)
         VALUES ($1, $2, $3, 'active', $4, $5, NULL)
         RETURNING *`,
        [input.period_label, input.period_month, input.opname_date, input.notes, now],
      );
      const created = createdRes.rows[0];
      await this.snapshotMasterToSessionTx(client, Number(created.id));
      return { ...created, id: Number(created.id) };
    });
  }

  async getSessionWithEntries(
    sessionId: number,
  ): Promise<{ session: OpnameSessionRow; entries: OpnameEntryRow[] }> {
    await this.ensureReady();
    const sessRes = await this.pool.query<OpnameSessionRow>(
      'SELECT * FROM opname_sessions WHERE id = $1',
      [sessionId],
    );
    const session = sessRes.rows[0];
    if (!session) {
      throw new StoreError(404, 'Sesi opname tidak ditemukan.');
    }

    const entriesRes = await this.pool.query<OpnameEntryRow>(
      `SELECT * FROM opname_entries
       WHERE session_id = $1
       ORDER BY product_id ASC, is_submitted DESC, location ASC, CASE WHEN item_type = 'finished_good' THEN 0 ELSE 1 END ASC, sn_order ASC, id ASC`,
      [sessionId],
    );

    return {
      session: { ...session, id: Number(session.id) },
      entries: entriesRes.rows.map(normalizeEntryRow),
    };
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
    await this.ensureReady();
    const sessRes = await this.pool.query<OpnameSessionRow>(
      'SELECT * FROM opname_sessions WHERE id = $1',
      [sessionId],
    );
    const session = sessRes.rows[0];
    if (!session) {
      throw new StoreError(404, 'Sesi opname tidak ditemukan.');
    }
    if (session.status !== 'active') {
      throw new StoreError(
        403,
        'Sesi opname sudah dikunci/selesai dan tidak dapat diubah lagi.',
      );
    }

    const existingRes = await this.pool.query<OpnameEntryRow>(
      'SELECT * FROM opname_entries WHERE id = $1 AND session_id = $2',
      [entryId, sessionId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new StoreError(404, 'Item opname tidak ditemukan.');
    }
    if (Number(existing.is_submitted)) {
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

    const qtyOk = parseNullableInt(
      input.qty_ok,
      existing.qty_ok === null ? null : Number(existing.qty_ok),
    );
    const qtyOk2 = parseNullableInt(
      input.qty_ok_2,
      existing.qty_ok_2 === null ? null : Number(existing.qty_ok_2),
    );
    const qtyNc = parseNullableInt(
      input.qty_nc,
      existing.qty_nc === null ? null : Number(existing.qty_nc),
    );

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

    const updatedRes = await this.pool.query<OpnameEntryRow>(
      `UPDATE opname_entries
       SET qty_ok = $1, qty_ok_2 = $2, qty_nc = $3, total_qty = $4, operator_name = $5, notes = $6, updated_at = $7
       WHERE id = $8 AND session_id = $9
       RETURNING *`,
      [qtyOk, qtyOk2, qtyNc, totalQty, operatorName, notes, updatedAt, entryId, sessionId],
    );

    return normalizeEntryRow(updatedRes.rows[0]);
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
    await this.withTx(async (client) => {
      const sessRes = await client.query<OpnameSessionRow>(
        'SELECT * FROM opname_sessions WHERE id = $1',
        [sessionId],
      );
      const session = sessRes.rows[0];
      if (!session) {
        throw new StoreError(404, 'Sesi opname tidak ditemukan.');
      }
      if (session.status !== 'active') {
        throw new StoreError(
          403,
          'Sesi opname sudah dikunci/selesai dan tidak dapat disubmit ulang.',
        );
      }

      const {
        operator_name: operatorName,
        location,
        source_location: sourceLocation,
        product_id: productId,
      } = input;

      if (productId && Number.isFinite(productId)) {
        const lockedRes = await client.query<{ c: number }>(
          `SELECT COUNT(*)::int AS c FROM opname_entries
           WHERE session_id = $1 AND product_id = $2 AND is_submitted = 1 AND LOWER(location) = LOWER($3)`,
          [sessionId, productId, location],
        );
        if ((lockedRes.rows[0]?.c ?? 0) > 0) {
          throw new StoreError(
            409,
            `Lokasi "${location}" untuk model ini sudah disubmit dan terkunci. Pilih lokasi lain.`,
          );
        }
      }

      const now = new Date().toISOString();

      if (productId && Number.isFinite(productId)) {
        const updated = await client.query(
          `UPDATE opname_entries
           SET operator_name = $1, location = $2, is_submitted = 1, submitted_at = $3, updated_at = COALESCE(updated_at, $4)
           WHERE session_id = $5 AND product_id = $6 AND is_submitted = 0 AND LOWER(location) = LOWER($7)`,
          [operatorName, location, now, now, sessionId, productId, sourceLocation],
        );

        if ((updated.rowCount ?? 0) === 0) {
          await client.query(
            `UPDATE opname_entries
             SET operator_name = $1, location = $2, is_submitted = 1, submitted_at = $3, updated_at = COALESCE(updated_at, $4)
             WHERE session_id = $5 AND product_id = $6 AND is_submitted = 0`,
            [operatorName, location, now, now, sessionId, productId],
          );
        }

        const totalLocRes = await client.query<{ c: number }>(
          'SELECT COUNT(*)::int AS c FROM inventory_locations',
        );
        const submittedLocRes = await client.query<{ loc: string }>(
          `SELECT DISTINCT LOWER(location) AS loc FROM opname_entries
           WHERE session_id = $1 AND product_id = $2 AND is_submitted = 1 AND location != ''`,
          [sessionId, productId],
        );
        const totalLocs = totalLocRes.rows[0]?.c ?? 0;

        if (totalLocs === 0 || submittedLocRes.rows.length < totalLocs) {
          await this.createBlankDraftForProductTx(client, sessionId, productId);
        }
      } else {
        await client.query(
          `UPDATE opname_entries
           SET operator_name = $1, is_submitted = 1, submitted_at = $2, updated_at = COALESCE(updated_at, $3)
           WHERE session_id = $4 AND total_qty IS NOT NULL`,
          [operatorName, now, now, sessionId],
        );
      }

      const submitters = await client.query<{ operator_name: string }>(
        `SELECT DISTINCT operator_name FROM opname_entries
         WHERE session_id = $1 AND is_submitted = 1 AND operator_name != ''`,
        [sessionId],
      );

      const preparedSummary =
        submitters.rows.length > 0
          ? submitters.rows.map((s) => s.operator_name).join(', ')
          : operatorName;

      await client.query(
        `UPDATE opname_sessions
         SET prepared_by = $1, submitted_at = $2
         WHERE id = $3`,
        [preparedSummary, now, sessionId],
      );
    });

    return this.getSessionWithEntries(sessionId);
  }

  async reopenModel(
    sessionId: number,
    productId: number,
    location: string,
  ): Promise<{ session: OpnameSessionRow; entries: OpnameEntryRow[] }> {
    await this.ensureReady();
    const sessRes = await this.pool.query<OpnameSessionRow>(
      'SELECT * FROM opname_sessions WHERE id = $1',
      [sessionId],
    );
    const session = sessRes.rows[0];
    if (!session) {
      throw new StoreError(404, 'Sesi opname tidak ditemukan.');
    }
    if (session.status !== 'active') {
      throw new StoreError(403, 'Sesi sudah dikunci/selesai.');
    }

    if (location) {
      await this.pool.query(
        `UPDATE opname_entries
         SET is_submitted = 0
         WHERE session_id = $1 AND product_id = $2 AND LOWER(location) = LOWER($3)`,
        [sessionId, productId, location],
      );
    } else {
      await this.pool.query(
        `UPDATE opname_entries
         SET is_submitted = 0
         WHERE session_id = $1 AND product_id = $2`,
        [sessionId, productId],
      );
    }

    return this.getSessionWithEntries(sessionId);
  }

  async syncSessionMaster(sessionId: number): Promise<{ addedCount: number }> {
    return this.withTx(async (client) => {
      const sessRes = await client.query<OpnameSessionRow>(
        'SELECT * FROM opname_sessions WHERE id = $1',
        [sessionId],
      );
      const session = sessRes.rows[0];
      if (!session) {
        throw new StoreError(404, 'Sesi opname tidak ditemukan.');
      }
      if (session.status !== 'active') {
        throw new StoreError(400, 'Hanya sesi berstatus Aktif yang bisa disinkronkan.');
      }

      const addedCount = await this.snapshotMasterToSessionTx(client, sessionId);
      return { addedCount };
    });
  }

  async closeSession(sessionId: number): Promise<{ ok: boolean; closed_at: string }> {
    await this.ensureReady();
    const closedAt = new Date().toISOString();
    const res = await this.pool.query(
      "UPDATE opname_sessions SET status = 'closed', closed_at = $1 WHERE id = $2",
      [closedAt, sessionId],
    );
    if ((res.rowCount ?? 0) === 0) {
      throw new StoreError(404, 'Sesi opname tidak ditemukan.');
    }
    return { ok: true, closed_at: closedAt };
  }

  async reopenSession(sessionId: number): Promise<{ ok: boolean }> {
    await this.ensureReady();
    const res = await this.pool.query(
      "UPDATE opname_sessions SET status = 'active', closed_at = NULL WHERE id = $1",
      [sessionId],
    );
    if ((res.rowCount ?? 0) === 0) {
      throw new StoreError(404, 'Sesi opname tidak ditemukan.');
    }
    return { ok: true };
  }

  async deleteSession(sessionId: number): Promise<void> {
    await this.ensureReady();
    const res = await this.pool.query('DELETE FROM opname_sessions WHERE id = $1', [sessionId]);
    if ((res.rowCount ?? 0) === 0) {
      throw new StoreError(404, 'Sesi opname tidak ditemukan.');
    }
  }
}
