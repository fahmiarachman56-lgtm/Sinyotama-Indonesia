import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import crypto from 'node:crypto';
import { getStore } from './store.ts';
import { StoreError, hashPin, verifyPinHash } from './types.ts';

export const app = express();
app.use(express.json({ limit: '10mb' }));

const ADMIN_TOKEN_TTL_MS = 1000 * 60 * 60 * 12;

function getTokenSecret(): string {
  return (
    process.env.ADMIN_TOKEN_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    'sinyotama-indonesia-inventory-secret-2026'
  );
}

function signAdminToken(expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt, v: 1 }), 'utf8').toString(
    'base64url',
  );
  const sig = crypto
    .createHmac('sha256', getTokenSecret())
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function isValidAdminToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  if (!payload || !sig) return false;

  const expectedSig = crypto
    .createHmac('sha256', getTokenSecret())
    .update(payload)
    .digest('base64url');

  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return false;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as { exp?: number };
    return typeof decoded.exp === 'number' && Date.now() <= decoded.exp;
  } catch {
    return false;
  }
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

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch((err) => {
      if (err instanceof StoreError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('API error:', err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Terjadi kesalahan pada server.';
      res.status(500).json({ error: message });
    });
  };
}

app.get(
  '/api/health',
  asyncHandler(async (_req, res) => {
    const store = await getStore();
    await store.listLocations();
    res.json({ ok: true, backend: store.backend });
  }),
);

// Admin PIN Auth
app.get('/api/auth/session', (req, res) => {
  const token = req.header('x-admin-token');
  res.json({ isAdmin: isValidAdminToken(token) });
});

app.post(
  '/api/auth/verify-pin',
  asyncHandler(async (req, res) => {
    const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
    if (!pin) {
      res.status(400).json({ error: 'PIN tidak boleh kosong.' });
      return;
    }

    const store = await getStore();
    const storedHash = await store.getAdminPinHash();

    if (!storedHash || !verifyPinHash(pin, storedHash)) {
      res.status(401).json({ error: 'PIN Admin salah. Silakan coba lagi.' });
      return;
    }

    const expiresAt = Date.now() + ADMIN_TOKEN_TTL_MS;
    const token = signAdminToken(expiresAt);
    res.json({ token, expiresAt });
  }),
);

app.post('/api/auth/logout', (_req, res) => {
  res.json({ ok: true });
});

app.post(
  '/api/auth/change-pin',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const currentPin =
      typeof req.body?.currentPin === 'string' ? req.body.currentPin.trim() : '';
    const newPin = typeof req.body?.newPin === 'string' ? req.body.newPin.trim() : '';

    if (!/^\d{4,8}$/.test(newPin)) {
      res.status(400).json({ error: 'PIN baru harus berupa 4 hingga 8 digit angka.' });
      return;
    }

    const store = await getStore();
    const storedHash = await store.getAdminPinHash();

    if (!storedHash || !verifyPinHash(currentPin, storedHash)) {
      res.status(401).json({ error: 'PIN lama tidak sesuai.' });
      return;
    }

    await store.setAdminPinHash(hashPin(newPin));
    res.json({ ok: true });
  }),
);

// Inventory Locations CRUD
app.get(
  '/api/locations',
  asyncHandler(async (_req, res) => {
    const store = await getStore();
    const locations = await store.listLocations();
    res.json(locations);
  }),
);

app.post(
  '/api/locations',
  requireAdmin,
  asyncHandler(async (req, res) => {
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

    const store = await getStore();
    const created = await store.createLocation({ code, name, description });
    res.status(201).json(created);
  }),
);

app.put(
  '/api/locations/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const store = await getStore();
    const updated = await store.updateLocation(id, {
      name: typeof req.body?.name === 'string' ? req.body.name : undefined,
      code: typeof req.body?.code === 'string' ? req.body.code : undefined,
      description:
        typeof req.body?.description === 'string' ? req.body.description : undefined,
    });
    res.json(updated);
  }),
);

app.delete(
  '/api/locations/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const store = await getStore();
    await store.deleteLocation(id);
    res.json({ ok: true });
  }),
);

// Master Models & Parts CRUD
app.get(
  '/api/products',
  asyncHandler(async (_req, res) => {
    const store = await getStore();
    const products = await store.listProducts();
    res.json(products);
  }),
);

app.post(
  '/api/products',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const sapCode =
      typeof req.body?.sap_code === 'string'
        ? req.body.sap_code.trim().toUpperCase()
        : '';
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

    const store = await getStore();
    const created = await store.createProduct({
      sap_code: sapCode,
      model_name: modelName,
      location,
      section,
      parts: initialParts,
    });
    res.status(201).json(created);
  }),
);

app.put(
  '/api/products/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const store = await getStore();
    const updated = await store.updateProduct(id, {
      sap_code: typeof req.body?.sap_code === 'string' ? req.body.sap_code : undefined,
      model_name:
        typeof req.body?.model_name === 'string' ? req.body.model_name : undefined,
      location: typeof req.body?.location === 'string' ? req.body.location : undefined,
      section: typeof req.body?.section === 'string' ? req.body.section : undefined,
      is_active:
        req.body?.is_active !== undefined ? Boolean(req.body.is_active) : undefined,
    });
    res.json(updated);
  }),
);

app.post(
  '/api/products/bulk-import',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const mode =
      req.body?.mode === 'replace_parts' ? 'replace_parts' : 'skip_existing';
    const rawModels = Array.isArray(req.body?.models) ? req.body.models : [];

    if (rawModels.length === 0) {
      res.status(400).json({ error: 'Tidak ada data model yang akan diimpor.' });
      return;
    }

    const store = await getStore();
    const result = await store.bulkImportProducts(mode, rawModels);
    res.status(201).json(result);
  }),
);

app.delete(
  '/api/products/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const store = await getStore();
    await store.deleteProduct(id);
    res.json({ ok: true });
  }),
);

// Product Parts CRUD (single & bulk paste from Excel)
app.post(
  '/api/products/:id/parts',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const productId = Number(req.params.id);
    const sapCode =
      typeof req.body?.sap_code === 'string'
        ? req.body.sap_code.trim().toUpperCase()
        : '';
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

    const store = await getStore();
    const created = await store.addPart(productId, {
      sn_order: Number(req.body?.sn_order) || undefined,
      sap_code: sapCode,
      parts_name: partsName,
      section,
      use_qty: useQty,
    });
    res.status(201).json(created);
  }),
);

app.post(
  '/api/products/:id/parts/bulk',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const productId = Number(req.params.id);
    const rows = Array.isArray(req.body?.parts) ? req.body.parts : [];
    if (rows.length === 0) {
      res.status(400).json({ error: 'Tidak ada baris part yang dikirim.' });
      return;
    }

    const store = await getStore();
    const result = await store.bulkAddParts(productId, rows);
    res.status(201).json(result);
  }),
);

app.put(
  '/api/parts/:partId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const partId = Number(req.params.partId);
    const store = await getStore();
    const updated = await store.updatePart(partId, {
      sn_order:
        req.body?.sn_order !== undefined ? Number(req.body.sn_order) : undefined,
      sap_code: typeof req.body?.sap_code === 'string' ? req.body.sap_code : undefined,
      parts_name:
        typeof req.body?.parts_name === 'string' ? req.body.parts_name : undefined,
      section: typeof req.body?.section === 'string' ? req.body.section : undefined,
      use_qty:
        req.body?.use_qty === undefined
          ? undefined
          : req.body.use_qty === null || req.body.use_qty === ''
            ? null
            : Math.max(0, Number(req.body.use_qty) || 0),
    });
    res.json(updated);
  }),
);

app.delete(
  '/api/parts/:partId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const partId = Number(req.params.partId);
    const store = await getStore();
    await store.deletePart(partId);
    res.json({ ok: true });
  }),
);

// Opname Sessions & Entries
app.get(
  '/api/sessions',
  asyncHandler(async (_req, res) => {
    const store = await getStore();
    const sessions = await store.listSessions();
    res.json(sessions);
  }),
);

app.post(
  '/api/sessions',
  requireAdmin,
  asyncHandler(async (req, res) => {
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

    const store = await getStore();
    const created = await store.createSession({
      period_month: periodMonth,
      period_label: periodLabel,
      opname_date: opnameDate,
      notes,
    });
    res.status(201).json(created);
  }),
);

app.get(
  '/api/sessions/:id/entries',
  asyncHandler(async (req, res) => {
    const sessionId = Number(req.params.id);
    const store = await getStore();
    const result = await store.getSessionWithEntries(sessionId);
    res.json(result);
  }),
);

app.patch(
  '/api/sessions/:id/entries/:entryId',
  asyncHandler(async (req, res) => {
    const sessionId = Number(req.params.id);
    const entryId = Number(req.params.entryId);
    const store = await getStore();
    const updated = await store.updateEntry(sessionId, entryId, {
      qty_ok: req.body?.qty_ok,
      qty_ok_2: req.body?.qty_ok_2,
      qty_nc: req.body?.qty_nc,
      operator_name:
        typeof req.body?.operator_name === 'string'
          ? req.body.operator_name
          : undefined,
      notes: typeof req.body?.notes === 'string' ? req.body.notes : undefined,
    });
    res.json(updated);
  }),
);

app.post(
  '/api/sessions/:id/submit',
  asyncHandler(async (req, res) => {
    const sessionId = Number(req.params.id);
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

    const store = await getStore();
    const result = await store.submitSession(sessionId, {
      operator_name: operatorName,
      location,
      source_location: sourceLocation,
      product_id: productId,
    });
    res.json(result);
  }),
);

app.post(
  '/api/sessions/:id/reopen-model',
  asyncHandler(async (req, res) => {
    const sessionId = Number(req.params.id);
    const productId = Number(req.body?.product_id);
    const location =
      typeof req.body?.location === 'string' ? req.body.location.trim() : '';

    if (!Number.isFinite(productId)) {
      res.status(400).json({ error: 'ID model tidak valid.' });
      return;
    }

    const store = await getStore();
    const result = await store.reopenModel(sessionId, productId, location);
    res.json(result);
  }),
);

app.post(
  '/api/sessions/:id/sync-master',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const sessionId = Number(req.params.id);
    const store = await getStore();
    const result = await store.syncSessionMaster(sessionId);
    res.json(result);
  }),
);

app.post(
  '/api/sessions/:id/close',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const sessionId = Number(req.params.id);
    const store = await getStore();
    const result = await store.closeSession(sessionId);
    res.json(result);
  }),
);

app.post(
  '/api/sessions/:id/reopen',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const sessionId = Number(req.params.id);
    const store = await getStore();
    const result = await store.reopenSession(sessionId);
    res.json(result);
  }),
);

app.delete(
  '/api/sessions/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const sessionId = Number(req.params.id);
    const store = await getStore();
    await store.deleteSession(sessionId);
    res.json({ ok: true });
  }),
);
