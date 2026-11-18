import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  createBlankDraftForProduct,
  db,
  hashPin,
  initDatabase,
  snapshotMasterToSession,
  verifyPinHash,
  type LocationRow,
  type OpnameEntryRow,
  type OpnameSessionRow,
  type ProductPartRow,
  type ProductRow,
} from './server/db.ts';

initDatabase();

const app = express();
app.use(express.json({ limit: '10mb' }));

const ADMIN_TOKEN_TTL_MS = 1000 * 60 * 60 * 12;
const adminTokens = new Map<string, number>();

function isValidAdminToken(token: string | undefined): boolean {
  if (!token) return false;
  const expiresAt = adminTokens.get(token);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    adminTokens.delete(token);
    return false;
  }
  return true;
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.header('x-admin-token');
  if (!isValidAdminToken(token)) {
    res.status(401).json({
      error: 'Akses Admin diperlukan. Silakan masukkan PIN Admin terlebih dahulu.',
    });
    return;
  }
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Admin PIN Auth
app.get('/api/auth/session', (req, res) => {
  const token = req.header('x-admin-token');
  res.json({ isAdmin: isValidAdminToken(token) });
});

app.post('/api/auth/verify-pin', (req, res) => {
  const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
  if (!pin) {
    res.status(400).json({ error: 'PIN tidak boleh kosong.' });
    return;
  }
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get('admin_pin_hash') as { value: string } | undefined;

  if (!row || !verifyPinHash(pin, row.value)) {
    res.status(401).json({ error: 'PIN Admin salah. Silakan coba lagi.' });
    return;
  }

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + ADMIN_TOKEN_TTL_MS;
  adminTokens.set(token, expiresAt);
  res.json({ token, expiresAt });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.header('x-admin-token');
  if (token) adminTokens.delete(token);
  res.json({ ok: true });
});

app.post('/api/auth/change-pin', requireAdmin, (req, res) => {
  const currentPin =
    typeof req.body?.currentPin === 'string' ? req.body.currentPin.trim() : '';
  const newPin = typeof req.body?.newPin === 'string' ? req.body.newPin.trim() : '';

  if (!/^\d{4,8}$/.test(newPin)) {
    res.status(400).json({ error: 'PIN baru harus berupa 4 hingga 8 digit angka.' });
    return;
  }

  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get('admin_pin_hash') as { value: string } | undefined;

  if (!row || !verifyPinHash(currentPin, row.value)) {
    res.status(401).json({ error: 'PIN lama tidak sesuai.' });
    return;
  }

  db.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run(
    hashPin(newPin),
    'admin_pin_hash',
  );
  res.json({ ok: true });
});

// Inventory Locations CRUD
app.get('/api/locations', (_req, res) => {
  const locations = db
    .prepare(
      `SELECT id, code, name, description, created_at
       FROM inventory_locations
       ORDER BY name ASC`,
    )
    .all();
  res.json(locations);
});

app.post('/api/locations', requireAdmin, (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const code =
    typeof req.body?.code === 'string' && req.body.code.trim()
      ? req.body.code.trim().toUpperCase()
      : name.toUpperCase();
  const description =
    typeof req.body?.description === 'string' ? req.body.description.trim() : '';

  if (!name) {
    res.status(400).json({ error: 'Nama Location wajib diisi.' });
    return;
  }

  const dup = db
    .prepare(
      'SELECT id FROM inventory_locations WHERE UPPER(name) = UPPER(?) OR UPPER(code) = UPPER(?)',
    )
    .get(name, code);
  if (dup) {
    res.status(409).json({ error: `Location "${name}" sudah terdaftar.` });
    return;
  }

  const now = new Date().toISOString();
  try {
    const info = db
      .prepare(
        `INSERT INTO inventory_locations (code, name, description, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(code, name, description, now);

    const created = db
      .prepare('SELECT id, code, name, description, created_at FROM inventory_locations WHERE id = ?')
      .get(info.lastInsertRowid) as LocationRow;

    const activeSessions = db
      .prepare("SELECT id FROM opname_sessions WHERE status = 'active'")
      .all() as Array<{ id: number }>;
    for (const sess of activeSessions) {
      const productRows = db
        .prepare('SELECT DISTINCT product_id FROM opname_entries WHERE session_id = ?')
        .all(sess.id) as Array<{ product_id: number }>;
      for (const p of productRows) {
        createBlankDraftForProduct(sess.id, p.product_id);
      }
    }

    res.status(201).json(created);
  } catch {
    res.status(500).json({ error: 'Gagal menambahkan location inventory.' });
  }
});

app.put('/api/locations/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db
    .prepare('SELECT * FROM inventory_locations WHERE id = ?')
    .get(id) as LocationRow | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Location tidak ditemukan.' });
    return;
  }

  const name =
    typeof req.body?.name === 'string' && req.body.name.trim()
      ? req.body.name.trim()
      : existing.name;
  const code =
    typeof req.body?.code === 'string' && req.body.code.trim()
      ? req.body.code.trim().toUpperCase()
      : name.toUpperCase();
  const description =
    typeof req.body?.description === 'string'
      ? req.body.description.trim()
      : existing.description;

  const dup = db
    .prepare(
      'SELECT id FROM inventory_locations WHERE id != ? AND (UPPER(name) = UPPER(?) OR UPPER(code) = UPPER(?))',
    )
    .get(id, name, code);
  if (dup) {
    res.status(409).json({ error: `Location "${name}" sudah digunakan.` });
    return;
  }

  try {
    db.prepare(
      `UPDATE inventory_locations SET code = ?, name = ?, description = ? WHERE id = ?`,
    ).run(code, name, description, id);

    const updated = db
      .prepare('SELECT id, code, name, description, created_at FROM inventory_locations WHERE id = ?')
      .get(id);
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Gagal memperbarui location inventory.' });
  }
});

app.delete('/api/locations/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM inventory_locations WHERE id = ?').run(id);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Location tidak ditemukan.' });
    return;
  }
  res.json({ ok: true });
});

// Master Models & Parts CRUD
app.get('/api/products', (_req, res) => {
  const products = db
    .prepare('SELECT * FROM products ORDER BY id ASC')
    .all() as ProductRow[];
  const parts = db
    .prepare('SELECT * FROM product_parts ORDER BY product_id ASC, sn_order ASC, id ASC')
    .all() as ProductPartRow[];

  const partsByProduct = new Map<number, ProductPartRow[]>();
  for (const part of parts) {
    const list = partsByProduct.get(part.product_id) ?? [];
    list.push(part);
    partsByProduct.set(part.product_id, list);
  }

  const result = products.map((p) => ({
    ...p,
    is_active: Boolean(p.is_active),
    parts: partsByProduct.get(p.id) ?? [],
  }));

  res.json(result);
});

app.post('/api/products', requireAdmin, (req, res) => {
  const sapCode =
    typeof req.body?.sap_code === 'string' ? req.body.sap_code.trim().toUpperCase() : '';
  const modelName =
    typeof req.body?.model_name === 'string' ? req.body.model_name.trim() : '';
  const location =
    typeof req.body?.location === 'string' && req.body.location.trim()
      ? req.body.location.trim().toUpperCase()
      : 'ASSY';
  const section =
    typeof req.body?.section === 'string' && req.body.section.trim()
      ? req.body.section.trim()
      : 'SET';
  const initialParts = Array.isArray(req.body?.parts) ? req.body.parts : [];

  if (!sapCode || !modelName) {
    res.status(400).json({ error: 'SAP CODE dan Nama Model wajib diisi.' });
    return;
  }

  const now = new Date().toISOString();
  try {
    const createdId = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO products (sap_code, model_name, location, section, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(sapCode, modelName, location, section, now, now);

      const productId = info.lastInsertRowid as number;
      const insertPart = db.prepare(
        `INSERT INTO product_parts (product_id, sn_order, sap_code, parts_name, section, use_qty, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );

      let snCounter = 2;
      for (const rawPart of initialParts) {
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
          rawPart?.use_qty === null || rawPart?.use_qty === ''
            ? null
            : Math.max(0, Number(rawPart?.use_qty) || 1);
        const snOrder = Number(rawPart?.sn_order) > 1 ? Number(rawPart.sn_order) : snCounter;
        snCounter = Math.max(snCounter + 1, snOrder + 1);
        insertPart.run(productId, snOrder, partSap, partsName, partSection, useQty, now);
      }
      return productId;
    })();

    const product = db
      .prepare('SELECT * FROM products WHERE id = ?')
      .get(createdId) as ProductRow;
    const parts = db
      .prepare('SELECT * FROM product_parts WHERE product_id = ? ORDER BY sn_order ASC, id ASC')
      .all(createdId) as ProductPartRow[];

    res.status(201).json({ ...product, is_active: Boolean(product.is_active), parts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UNIQUE')) {
      res.status(409).json({ error: `SAP CODE "${sapCode}" sudah terdaftar.` });
      return;
    }
    res.status(500).json({ error: 'Gagal menyimpan master model.' });
  }
});

app.put('/api/products/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as
    | ProductRow
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Model tidak ditemukan.' });
    return;
  }

  const sapCode =
    typeof req.body?.sap_code === 'string' && req.body.sap_code.trim()
      ? req.body.sap_code.trim().toUpperCase()
      : existing.sap_code;
  const modelName =
    typeof req.body?.model_name === 'string' && req.body.model_name.trim()
      ? req.body.model_name.trim()
      : existing.model_name;
  const location =
    typeof req.body?.location === 'string' && req.body.location.trim()
      ? req.body.location.trim().toUpperCase()
      : existing.location;
  const section =
    typeof req.body?.section === 'string' && req.body.section.trim()
      ? req.body.section.trim()
      : existing.section;
  const isActive =
    req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active;

  const now = new Date().toISOString();
  try {
    db.prepare(
      `UPDATE products
       SET sap_code = ?, model_name = ?, location = ?, section = ?, is_active = ?, updated_at = ?
       WHERE id = ?`,
    ).run(sapCode, modelName, location, section, isActive, now, id);

    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as ProductRow;
    const parts = db
      .prepare('SELECT * FROM product_parts WHERE product_id = ? ORDER BY sn_order ASC, id ASC')
      .all(id) as ProductPartRow[];

    res.json({ ...updated, is_active: Boolean(updated.is_active), parts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UNIQUE')) {
      res.status(409).json({ error: `SAP CODE "${sapCode}" sudah digunakan model lain.` });
      return;
    }
    res.status(500).json({ error: 'Gagal memperbarui master model.' });
  }
});

app.post('/api/products/bulk-import', requireAdmin, (req, res) => {
  const mode =
    req.body?.mode === 'replace_parts' ? 'replace_parts' : 'skip_existing';
  const rawModels = Array.isArray(req.body?.models) ? req.body.models : [];

  if (rawModels.length === 0) {
    res.status(400).json({ error: 'Tidak ada data model yang akan diimpor.' });
    return;
  }

  const now = new Date().toISOString();
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let partsCount = 0;

  const findProductBySap = db.prepare(
    'SELECT * FROM products WHERE UPPER(sap_code) = UPPER(?)',
  );
  const insertProduct = db.prepare(
    `INSERT INTO products (sap_code, model_name, location, section, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  );
  const updateProduct = db.prepare(
    `UPDATE products SET model_name = ?, section = ?, updated_at = ? WHERE id = ?`,
  );
  const deletePartsByProduct = db.prepare(
    'DELETE FROM product_parts WHERE product_id = ?',
  );
  const insertPart = db.prepare(
    `INSERT INTO product_parts (product_id, sn_order, sap_code, parts_name, section, use_qty, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  db.transaction(() => {
    for (const rawModel of rawModels) {
      const sapCode =
        typeof rawModel?.sap_code === 'string'
          ? rawModel.sap_code.trim().toUpperCase()
          : '';
      const modelName =
        typeof rawModel?.model_name === 'string'
          ? rawModel.model_name.trim()
          : '';
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
          typeof rawPart?.parts_name === 'string'
            ? rawPart.parts_name.trim()
            : '';
        if (!partSap || !partsName) continue;

        const partSection =
          typeof rawPart?.section === 'string' && rawPart.section.trim()
            ? rawPart.section.trim()
            : 'part';
        const useQty =
          rawPart?.use_qty === null ||
          rawPart?.use_qty === undefined ||
          rawPart?.use_qty === ''
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

  res.status(201).json({
    createdCount,
    updatedCount,
    skippedCount,
    partsCount,
  });
});

app.delete('/api/products/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM products WHERE id = ?').run(id);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Model tidak ditemukan.' });
    return;
  }
  res.json({ ok: true });
});

// Product Parts CRUD (single & bulk paste from Excel)
app.post('/api/products/:id/parts', requireAdmin, (req, res) => {
  const productId = Number(req.params.id);
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  if (!product) {
    res.status(404).json({ error: 'Model induk tidak ditemukan.' });
    return;
  }

  const sapCode =
    typeof req.body?.sap_code === 'string' ? req.body.sap_code.trim().toUpperCase() : '';
  const partsName =
    typeof req.body?.parts_name === 'string' ? req.body.parts_name.trim() : '';
  const section =
    typeof req.body?.section === 'string' && req.body.section.trim()
      ? req.body.section.trim()
      : 'part';
  const useQty =
    req.body?.use_qty === null || req.body?.use_qty === ''
      ? null
      : Math.max(0, Number(req.body?.use_qty) || 1);

  if (!sapCode || !partsName) {
    res.status(400).json({ error: 'SAP CODE dan PARTS NAME wajib diisi.' });
    return;
  }

  const maxSnRow = db
    .prepare('SELECT COALESCE(MAX(sn_order), 1) as max_sn FROM product_parts WHERE product_id = ?')
    .get(productId) as { max_sn: number };
  const snOrder =
    Number(req.body?.sn_order) > 1 ? Number(req.body.sn_order) : maxSnRow.max_sn + 1;

  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO product_parts (product_id, sn_order, sap_code, parts_name, section, use_qty, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(productId, snOrder, sapCode, partsName, section, useQty, now);

  const created = db
    .prepare('SELECT * FROM product_parts WHERE id = ?')
    .get(info.lastInsertRowid) as ProductPartRow;
  res.status(201).json(created);
});

app.post('/api/products/:id/parts/bulk', requireAdmin, (req, res) => {
  const productId = Number(req.params.id);
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  if (!product) {
    res.status(404).json({ error: 'Model induk tidak ditemukan.' });
    return;
  }

  const rows = Array.isArray(req.body?.parts) ? req.body.parts : [];
  if (rows.length === 0) {
    res.status(400).json({ error: 'Tidak ada baris part yang dikirim.' });
    return;
  }

  const maxSnRow = db
    .prepare('SELECT COALESCE(MAX(sn_order), 1) as max_sn FROM product_parts WHERE product_id = ?')
    .get(productId) as { max_sn: number };
  let nextSn = maxSnRow.max_sn + 1;

  const now = new Date().toISOString();
  const insertPart = db.prepare(
    `INSERT INTO product_parts (product_id, sn_order, sap_code, parts_name, section, use_qty, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  let added = 0;
  db.transaction(() => {
    for (const r of rows) {
      const sapCode =
        typeof r?.sap_code === 'string' ? r.sap_code.trim().toUpperCase() : '';
      const partsName =
        typeof r?.parts_name === 'string' ? r.parts_name.trim() : '';
      if (!sapCode || !partsName) continue;
      const section =
        typeof r?.section === 'string' && r.section.trim() ? r.section.trim() : 'part';
      const useQty =
        r?.use_qty === null || r?.use_qty === ''
          ? null
          : Math.max(0, Number(r?.use_qty) || 1);
      const snOrder = Number(r?.sn_order) > 1 ? Number(r.sn_order) : nextSn;
      nextSn = Math.max(nextSn + 1, snOrder + 1);
      insertPart.run(productId, snOrder, sapCode, partsName, section, useQty, now);
      added += 1;
    }
  })();

  res.status(201).json({ added });
});

app.put('/api/parts/:partId', requireAdmin, (req, res) => {
  const partId = Number(req.params.partId);
  const existing = db
    .prepare('SELECT * FROM product_parts WHERE id = ?')
    .get(partId) as ProductPartRow | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Part tidak ditemukan.' });
    return;
  }

  const snOrder =
    req.body?.sn_order !== undefined
      ? Math.max(2, Number(req.body.sn_order) || existing.sn_order)
      : existing.sn_order;
  const sapCode =
    typeof req.body?.sap_code === 'string' && req.body.sap_code.trim()
      ? req.body.sap_code.trim().toUpperCase()
      : existing.sap_code;
  const partsName =
    typeof req.body?.parts_name === 'string' && req.body.parts_name.trim()
      ? req.body.parts_name.trim()
      : existing.parts_name;
  const section =
    typeof req.body?.section === 'string' && req.body.section.trim()
      ? req.body.section.trim()
      : existing.section;
  const useQty =
    req.body?.use_qty === undefined
      ? existing.use_qty
      : req.body.use_qty === null || req.body.use_qty === ''
        ? null
        : Math.max(0, Number(req.body.use_qty) || 0);

  db.prepare(
    `UPDATE product_parts
     SET sn_order = ?, sap_code = ?, parts_name = ?, section = ?, use_qty = ?
     WHERE id = ?`,
  ).run(snOrder, sapCode, partsName, section, useQty, partId);

  const updated = db
    .prepare('SELECT * FROM product_parts WHERE id = ?')
    .get(partId) as ProductPartRow;
  res.json(updated);
});

app.delete('/api/parts/:partId', requireAdmin, (req, res) => {
  const partId = Number(req.params.partId);
  const info = db.prepare('DELETE FROM product_parts WHERE id = ?').run(partId);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Part tidak ditemukan.' });
    return;
  }
  res.json({ ok: true });
});

// Opname Sessions & Entries
app.get('/api/sessions', (_req, res) => {
  const sessions = db
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
    .all();

  res.json(sessions);
});

app.post('/api/sessions', requireAdmin, (req, res) => {
  const periodMonth =
    typeof req.body?.period_month === 'string' ? req.body.period_month.trim() : '';
  const periodLabel =
    typeof req.body?.period_label === 'string' ? req.body.period_label.trim() : '';
  const opnameDate =
    typeof req.body?.opname_date === 'string' && req.body.opname_date.trim()
      ? req.body.opname_date.trim()
      : (() => {
          const d = new Date();
          return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(-2)}`;
        })();
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';

  if (!periodMonth || !periodLabel) {
    res.status(400).json({ error: 'Periode bulan dan nama sesi wajib diisi.' });
    return;
  }

  const activeProducts = db
    .prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1')
    .get() as { count: number };

  if (activeProducts.count === 0) {
    res.status(400).json({
      error: 'Belum ada Master Model aktif. Tambahkan minimal 1 model terlebih dahulu.',
    });
    return;
  }

  const now = new Date().toISOString();
  const sessionId = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO opname_sessions (period_label, period_month, opname_date, status, notes, created_at, closed_at)
         VALUES (?, ?, ?, 'active', ?, ?, NULL)`,
      )
      .run(periodLabel, periodMonth, opnameDate, notes, now);

    const id = info.lastInsertRowid as number;
    snapshotMasterToSession(id);
    return id;
  })();

  const created = db
    .prepare('SELECT * FROM opname_sessions WHERE id = ?')
    .get(sessionId) as OpnameSessionRow;
  res.status(201).json(created);
});

app.get('/api/sessions/:id/entries', (req, res) => {
  const sessionId = Number(req.params.id);
  const session = db
    .prepare('SELECT * FROM opname_sessions WHERE id = ?')
    .get(sessionId) as OpnameSessionRow | undefined;

  if (!session) {
    res.status(404).json({ error: 'Sesi opname tidak ditemukan.' });
    return;
  }

  const entries = db
    .prepare(
      `SELECT * FROM opname_entries
       WHERE session_id = ?
       ORDER BY product_id ASC, is_submitted DESC, location ASC, CASE WHEN item_type = 'finished_good' THEN 0 ELSE 1 END ASC, sn_order ASC, id ASC`,
    )
    .all(sessionId) as OpnameEntryRow[];

  res.json({ session, entries });
});

app.patch('/api/sessions/:id/entries/:entryId', (req, res) => {
  const sessionId = Number(req.params.id);
  const entryId = Number(req.params.entryId);

  const session = db
    .prepare('SELECT * FROM opname_sessions WHERE id = ?')
    .get(sessionId) as OpnameSessionRow | undefined;

  if (!session) {
    res.status(404).json({ error: 'Sesi opname tidak ditemukan.' });
    return;
  }

  if (session.status !== 'active') {
    res.status(403).json({
      error: 'Sesi opname sudah dikunci/selesai dan tidak dapat diubah lagi.',
    });
    return;
  }

  const existing = db
    .prepare('SELECT * FROM opname_entries WHERE id = ? AND session_id = ?')
    .get(entryId, sessionId) as OpnameEntryRow | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Item opname tidak ditemukan.' });
    return;
  }

  if (existing.is_submitted) {
    res.status(403).json({
      error: 'Model ini sudah disubmit. Klik tombol Edit pada model untuk mengubah angka.',
    });
    return;
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

  const qtyOk = parseNullableInt(req.body?.qty_ok, existing.qty_ok);
  const qtyOk2 = parseNullableInt(req.body?.qty_ok_2, existing.qty_ok_2);
  const qtyNc = parseNullableInt(req.body?.qty_nc, existing.qty_nc);

  if (Number.isNaN(qtyOk) || Number.isNaN(qtyOk2) || Number.isNaN(qtyNc)) {
    res.status(400).json({ error: 'Nilai QTY harus berupa angka 0 atau lebih.' });
    return;
  }

  const hasAnyCount = qtyOk !== null || qtyOk2 !== null || qtyNc !== null;
  const totalQty = hasAnyCount
    ? (qtyOk ?? 0) + (qtyOk2 ?? 0) + (qtyNc ?? 0)
    : null;

  const operatorName =
    typeof req.body?.operator_name === 'string'
      ? req.body.operator_name.trim().slice(0, 80)
      : existing.operator_name;
  const notes =
    typeof req.body?.notes === 'string'
      ? req.body.notes.trim().slice(0, 240)
      : existing.notes;
  const updatedAt = new Date().toISOString();

  db.prepare(
    `UPDATE opname_entries
     SET qty_ok = ?, qty_ok_2 = ?, qty_nc = ?, total_qty = ?, operator_name = ?, notes = ?, updated_at = ?
     WHERE id = ? AND session_id = ?`,
  ).run(qtyOk, qtyOk2, qtyNc, totalQty, operatorName, notes, updatedAt, entryId, sessionId);

  const updated = db
    .prepare('SELECT * FROM opname_entries WHERE id = ?')
    .get(entryId) as OpnameEntryRow;
  res.json(updated);
});

app.post('/api/sessions/:id/submit', (req, res) => {
  const sessionId = Number(req.params.id);
  const session = db
    .prepare('SELECT * FROM opname_sessions WHERE id = ?')
    .get(sessionId) as OpnameSessionRow | undefined;

  if (!session) {
    res.status(404).json({ error: 'Sesi opname tidak ditemukan.' });
    return;
  }

  if (session.status !== 'active') {
    res.status(403).json({
      error: 'Sesi opname sudah dikunci/selesai dan tidak dapat disubmit ulang.',
    });
    return;
  }

  const operatorName =
    typeof req.body?.operator_name === 'string'
      ? req.body.operator_name.trim().slice(0, 80)
      : '';
  const location =
    typeof req.body?.location === 'string'
      ? req.body.location.trim().slice(0, 80)
      : '';
  const sourceLocation =
    typeof req.body?.source_location === 'string'
      ? req.body.source_location.trim().slice(0, 80)
      : '';
  const productId =
    req.body?.product_id !== undefined && req.body?.product_id !== null
      ? Number(req.body.product_id)
      : null;

  if (!operatorName) {
    res.status(400).json({ error: 'Nama operator (PREPARED BY) wajib diisi.' });
    return;
  }
  if (productId && Number.isFinite(productId) && !location) {
    res.status(400).json({ error: 'Pilih lokasi inventory terlebih dahulu.' });
    return;
  }

  if (productId && Number.isFinite(productId)) {
    const alreadyLocked = db
      .prepare(
        `SELECT COUNT(*) as c FROM opname_entries
         WHERE session_id = ? AND product_id = ? AND is_submitted = 1 AND LOWER(location) = LOWER(?)`,
      )
      .get(sessionId, productId, location) as { c: number };

    if (alreadyLocked.c > 0) {
      res.status(409).json({
        error: `Lokasi "${location}" untuk model ini sudah disubmit dan terkunci. Pilih lokasi lain.`,
      });
      return;
    }
  }

  const now = new Date().toISOString();

  db.transaction(() => {
    if (productId && Number.isFinite(productId)) {
      const updatedInfo = db
        .prepare(
          `UPDATE opname_entries
           SET operator_name = ?, location = ?, is_submitted = 1, submitted_at = ?, updated_at = COALESCE(updated_at, ?)
           WHERE session_id = ? AND product_id = ? AND is_submitted = 0 AND LOWER(location) = LOWER(?)`,
        )
        .run(operatorName, location, now, now, sessionId, productId, sourceLocation);

      // Fallback if sourceLocation didn't match due to legacy state
      if (updatedInfo.changes === 0) {
        db.prepare(
          `UPDATE opname_entries
           SET operator_name = ?, location = ?, is_submitted = 1, submitted_at = ?, updated_at = COALESCE(updated_at, ?)
           WHERE session_id = ? AND product_id = ? AND is_submitted = 0`,
        ).run(operatorName, location, now, now, sessionId, productId);
      }

      // Check if there are still other master locations not yet submitted for this model
      const totalLocationsRow = db
        .prepare('SELECT COUNT(*) as c FROM inventory_locations')
        .get() as { c: number };
      const submittedLocRows = db
        .prepare(
          `SELECT DISTINCT LOWER(location) as loc FROM opname_entries
           WHERE session_id = ? AND product_id = ? AND is_submitted = 1 AND location != ''`,
        )
        .all(sessionId, productId) as Array<{ loc: string }>;

      if (
        totalLocationsRow.c === 0 ||
        submittedLocRows.length < totalLocationsRow.c
      ) {
        createBlankDraftForProduct(sessionId, productId);
      }
    } else {
      db.prepare(
        `UPDATE opname_entries
         SET operator_name = ?, is_submitted = 1, submitted_at = ?, updated_at = COALESCE(updated_at, ?)
         WHERE session_id = ? AND total_qty IS NOT NULL`,
      ).run(operatorName, now, now, sessionId);
    }

    const submitters = db
      .prepare(
        `SELECT DISTINCT operator_name FROM opname_entries
         WHERE session_id = ? AND is_submitted = 1 AND operator_name != ''`,
      )
      .all(sessionId) as Array<{ operator_name: string }>;

    const preparedSummary =
      submitters.length > 0
        ? submitters.map((s) => s.operator_name).join(', ')
        : operatorName;

    db.prepare(
      `UPDATE opname_sessions
       SET prepared_by = ?, submitted_at = ?
       WHERE id = ?`,
    ).run(preparedSummary, now, sessionId);
  })();

  const updatedSession = db
    .prepare('SELECT * FROM opname_sessions WHERE id = ?')
    .get(sessionId) as OpnameSessionRow;
  const entries = db
    .prepare(
      `SELECT * FROM opname_entries
       WHERE session_id = ?
       ORDER BY product_id ASC, is_submitted DESC, location ASC, CASE WHEN item_type = 'finished_good' THEN 0 ELSE 1 END ASC, sn_order ASC, id ASC`,
    )
    .all(sessionId) as OpnameEntryRow[];

  res.json({ session: updatedSession, entries });
});

app.post('/api/sessions/:id/reopen-model', (req, res) => {
  const sessionId = Number(req.params.id);
  const productId = Number(req.body?.product_id);
  const location =
    typeof req.body?.location === 'string' ? req.body.location.trim() : '';

  const session = db
    .prepare('SELECT * FROM opname_sessions WHERE id = ?')
    .get(sessionId) as OpnameSessionRow | undefined;

  if (!session) {
    res.status(404).json({ error: 'Sesi opname tidak ditemukan.' });
    return;
  }
  if (session.status !== 'active') {
    res.status(403).json({ error: 'Sesi sudah dikunci/selesai.' });
    return;
  }
  if (!Number.isFinite(productId)) {
    res.status(400).json({ error: 'ID model tidak valid.' });
    return;
  }

  if (location) {
    db.prepare(
      `UPDATE opname_entries
       SET is_submitted = 0
       WHERE session_id = ? AND product_id = ? AND LOWER(location) = LOWER(?)`,
    ).run(sessionId, productId, location);
  } else {
    db.prepare(
      `UPDATE opname_entries
       SET is_submitted = 0
       WHERE session_id = ? AND product_id = ?`,
    ).run(sessionId, productId);
  }

  const entries = db
    .prepare(
      `SELECT * FROM opname_entries
       WHERE session_id = ?
       ORDER BY product_id ASC, is_submitted DESC, location ASC, CASE WHEN item_type = 'finished_good' THEN 0 ELSE 1 END ASC, sn_order ASC, id ASC`,
    )
    .all(sessionId) as OpnameEntryRow[];

  res.json({ session, entries });
});

app.post('/api/sessions/:id/sync-master', requireAdmin, (req, res) => {
  const sessionId = Number(req.params.id);
  const session = db
    .prepare('SELECT * FROM opname_sessions WHERE id = ?')
    .get(sessionId) as OpnameSessionRow | undefined;

  if (!session) {
    res.status(404).json({ error: 'Sesi opname tidak ditemukan.' });
    return;
  }
  if (session.status !== 'active') {
    res.status(400).json({ error: 'Hanya sesi berstatus Aktif yang bisa disinkronkan.' });
    return;
  }

  const addedCount = snapshotMasterToSession(sessionId);
  res.json({ addedCount });
});

app.post('/api/sessions/:id/close', requireAdmin, (req, res) => {
  const sessionId = Number(req.params.id);
  const session = db
    .prepare('SELECT * FROM opname_sessions WHERE id = ?')
    .get(sessionId) as OpnameSessionRow | undefined;

  if (!session) {
    res.status(404).json({ error: 'Sesi opname tidak ditemukan.' });
    return;
  }

  const closedAt = new Date().toISOString();
  db.prepare("UPDATE opname_sessions SET status = 'closed', closed_at = ? WHERE id = ?").run(
    closedAt,
    sessionId,
  );
  res.json({ ok: true, closed_at: closedAt });
});

app.post('/api/sessions/:id/reopen', requireAdmin, (req, res) => {
  const sessionId = Number(req.params.id);
  const session = db
    .prepare('SELECT * FROM opname_sessions WHERE id = ?')
    .get(sessionId) as OpnameSessionRow | undefined;

  if (!session) {
    res.status(404).json({ error: 'Sesi opname tidak ditemukan.' });
    return;
  }

  db.prepare("UPDATE opname_sessions SET status = 'active', closed_at = NULL WHERE id = ?").run(
    sessionId,
  );
  res.json({ ok: true });
});

app.delete('/api/sessions/:id', requireAdmin, (req, res) => {
  const sessionId = Number(req.params.id);
  const info = db.prepare('DELETE FROM opname_sessions WHERE id = ?').run(sessionId);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Sesi opname tidak ditemukan.' });
    return;
  }
  res.json({ ok: true });
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server berjalan pada http://0.0.0.0:${port}`);
  });
}

startServer();
