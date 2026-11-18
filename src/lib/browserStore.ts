import type {
  InventoryLocation,
  OpnameEntry,
  OpnameSession,
  Product,
  ProductPart,
} from '../types.ts';

interface StoredProductRecord {
  id: number;
  sap_code: string;
  model_name: string;
  location: string;
  section: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface StoredState {
  version: number;
  adminPin: string;
  nextIds: {
    location: number;
    product: number;
    part: number;
    session: number;
    entry: number;
  };
  locations: InventoryLocation[];
  products: StoredProductRecord[];
  parts: ProductPart[];
  sessions: OpnameSession[];
  entries: OpnameEntry[];
}

const IDB_NAME = 'sinyotama_inventory_db';
const IDB_STORE = 'kv';
const IDB_KEY = 'app_state_v1';
const LS_FALLBACK_KEY = 'sinyotama_inventory_state_v1';
const ADMIN_TOKEN_TTL_MS = 1000 * 60 * 60 * 12;

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

function createInitialSeedState(): StoredState {
  const now = new Date().toISOString();

  const locations: InventoryLocation[] = [
    {
      id: 1,
      code: 'ASSY',
      name: 'Assembly Line',
      description: 'Area perakitan joran pancing',
      created_at: now,
    },
    {
      id: 2,
      code: 'BLANK',
      name: 'Blank Production',
      description: 'Area produksi dan stok blank carbon/fiber',
      created_at: now,
    },
    {
      id: 3,
      code: 'FINISHING',
      name: 'Finishing & Wrapping',
      description: 'Area ring wrapping, resin & coating',
      created_at: now,
    },
    {
      id: 4,
      code: 'WH',
      name: 'Warehouse Utama',
      description: 'Gudang penyimpanan material dan barang jadi',
      created_at: now,
    },
  ];

  const products: StoredProductRecord[] = [
    {
      id: 1,
      sap_code: '60033365',
      model_name: 'LUCOZA 20LUNAMIS B80M SA',
      location: 'ASSY',
      section: 'SET',
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: 2,
      sap_code: '60034102',
      model_name: 'LUCOZA 22SEPHIA S86ML SA',
      location: 'ASSY',
      section: 'SET',
      is_active: true,
      created_at: now,
      updated_at: now,
    },
  ];

  const rawP1Parts = [
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

  const rawP2Parts = [
    [2, '70240110', 'LUCOZA 22SEPHIA S86ML #01 BP1', 'blank', 1],
    [3, '70240111', 'LUCOZA 22SEPHIA S86ML #2V BP1', 'blank', 1],
    [4, '70219004', '7RACOZA F-GRIP SEPH-12', 'KIJI H.BODY', 1],
    [5, '70198201', 'T-KTSG4.5S', 'part', 4],
    [6, '70198205', 'T-KLSG16H', 'part', 1],
    [7, '70220190', '7GACOZA ENDPLUG SEPH-1', 'part', 1],
  ] as const;

  const parts: ProductPart[] = [];
  let partId = 1;
  for (const [sn, sap, pname, sec, useQty] of rawP1Parts) {
    parts.push({
      id: partId++,
      product_id: 1,
      sn_order: sn,
      sap_code: sap,
      parts_name: pname,
      section: sec,
      use_qty: useQty,
      created_at: now,
    });
  }
  for (const [sn, sap, pname, sec, useQty] of rawP2Parts) {
    parts.push({
      id: partId++,
      product_id: 2,
      sn_order: sn,
      sap_code: sap,
      parts_name: pname,
      section: sec,
      use_qty: useQty,
      created_at: now,
    });
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

  const sessions: OpnameSession[] = [
    {
      id: 1,
      period_label: prevLabel,
      period_month: prevMonthStr,
      opname_date: prevShortDate,
      status: 'closed',
      prepared_by: 'Helen',
      submitted_at: closedAt,
      notes: 'Arsip stock opname akhir bulan sebelumnya',
      created_at: closedAt,
      closed_at: closedAt,
    },
    {
      id: 2,
      period_label: currLabel,
      period_month: currMonthStr,
      opname_date: currShortDate,
      status: 'active',
      prepared_by: '',
      submitted_at: null,
      notes: 'Stock opname bulanan berjalan',
      created_at: now,
      closed_at: null,
    },
  ];

  const entries: OpnameEntry[] = [];
  let entryId = 1;

  // Archived session 1 entries with seeded counts
  for (const prod of products) {
    const prodParts = parts.filter((p) => p.product_id === prod.id);
    const addArchived = (
      partId: number | null,
      snOrder: number,
      itemType: 'finished_good' | 'part',
      sap: string,
      partsName: string,
      section: string,
      useQty: number | null,
    ) => {
      const ok = 25 + (snOrder % 7) * 5;
      const ok2 = snOrder % 4 === 0 ? 4 : 0;
      const nc = snOrder % 6 === 0 ? 2 : 0;
      entries.push({
        id: entryId++,
        session_id: 1,
        product_id: prod.id,
        part_id: partId,
        sn_order: snOrder,
        item_type: itemType,
        model_name: prod.model_name,
        location: '',
        sap_code: sap,
        parts_name: partsName,
        section,
        use_qty: useQty,
        qty_ok: ok,
        qty_ok_2: ok2,
        qty_nc: nc,
        total_qty: ok + ok2 + nc,
        operator_name: 'Helen',
        notes: nc > 0 ? 'Part lecet / reject QC' : '',
        is_submitted: 0,
        submitted_at: null,
        updated_at: closedAt,
      });
    };

    addArchived(null, 1, 'finished_good', prod.sap_code, prod.model_name, prod.section || 'SET', null);
    for (const part of prodParts) {
      addArchived(part.id, part.sn_order, 'part', part.sap_code, part.parts_name, part.section, part.use_qty);
    }
  }

  // Active session 2 blank entries
  for (const prod of products) {
    const prodParts = parts.filter((p) => p.product_id === prod.id);
    entries.push({
      id: entryId++,
      session_id: 2,
      product_id: prod.id,
      part_id: null,
      sn_order: 1,
      item_type: 'finished_good',
      model_name: prod.model_name,
      location: '',
      sap_code: prod.sap_code,
      parts_name: prod.model_name,
      section: prod.section || 'SET',
      use_qty: null,
      qty_ok: null,
      qty_ok_2: null,
      qty_nc: null,
      total_qty: null,
      operator_name: '',
      notes: '',
      is_submitted: 0,
      submitted_at: null,
      updated_at: null,
    });
    for (const part of prodParts) {
      entries.push({
        id: entryId++,
        session_id: 2,
        product_id: prod.id,
        part_id: part.id,
        sn_order: part.sn_order,
        item_type: 'part',
        model_name: prod.model_name,
        location: '',
        sap_code: part.sap_code,
        parts_name: part.parts_name,
        section: part.section || 'part',
        use_qty: part.use_qty,
        qty_ok: null,
        qty_ok_2: null,
        qty_nc: null,
        total_qty: null,
        operator_name: '',
        notes: '',
        is_submitted: 0,
        submitted_at: null,
        updated_at: null,
      });
    }
  }

  return {
    version: 1,
    adminPin: '1234',
    nextIds: {
      location: locations.length + 1,
      product: products.length + 1,
      part: partId,
      session: sessions.length + 1,
      entry: entryId,
    },
    locations,
    products,
    parts,
    sessions,
    entries,
  };
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

async function readPersistedState(): Promise<StoredState | null> {
  try {
    const db = await openIdb();
    const result = await new Promise<StoredState | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(IDB_KEY);
      req.onsuccess = () => resolve((req.result as StoredState | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (result) return result;
  } catch {
    // Fallback to localStorage
  }

  try {
    const raw = localStorage.getItem(LS_FALLBACK_KEY);
    if (raw) {
      return JSON.parse(raw) as StoredState;
    }
  } catch {
    // Ignore storage error
  }
  return null;
}

async function writePersistedState(state: StoredState): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req = store.put(state, IDB_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    db.close();
    return;
  } catch {
    // Fallback to localStorage
  }

  try {
    localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(state));
  } catch {
    throw new Error('Gagal menyimpan data ke penyimpanan browser.');
  }
}

let cachedState: StoredState | null = null;
let queue: Promise<unknown> = Promise.resolve();

function withState<T>(fn: (state: StoredState) => T | Promise<T>, mutate = false): Promise<T> {
  const run = async (): Promise<T> => {
    if (!cachedState) {
      const loaded = await readPersistedState();
      if (loaded) {
        cachedState = loaded;
      } else {
        cachedState = createInitialSeedState();
        await writePersistedState(cachedState);
      }
    }
    const result = await fn(cachedState);
    if (mutate) {
      await writePersistedState(cachedState);
    }
    return result;
  };

  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}

function sortEntries(entries: OpnameEntry[]): OpnameEntry[] {
  return [...entries].sort((a, b) => {
    if (a.product_id !== b.product_id) return a.product_id - b.product_id;
    const subA = Number(Boolean(a.is_submitted));
    const subB = Number(Boolean(b.is_submitted));
    if (subB !== subA) return subB - subA;
    if (a.location !== b.location) return a.location.localeCompare(b.location);
    const typeA = a.item_type === 'finished_good' ? 0 : 1;
    const typeB = b.item_type === 'finished_good' ? 0 : 1;
    if (typeA !== typeB) return typeA - typeB;
    if (a.sn_order !== b.sn_order) return a.sn_order - b.sn_order;
    return a.id - b.id;
  });
}

function snapshotMasterToSession(state: StoredState, sessionId: number): number {
  const activeProducts = state.products
    .filter((p) => p.is_active)
    .sort((a, b) => a.id - b.id);

  let inserted = 0;

  for (const prod of activeProducts) {
    const existingFg = state.entries.some(
      (e) =>
        e.session_id === sessionId &&
        e.product_id === prod.id &&
        e.item_type === 'finished_good' &&
        e.part_id === null,
    );
    if (!existingFg) {
      state.entries.push({
        id: state.nextIds.entry++,
        session_id: sessionId,
        product_id: prod.id,
        part_id: null,
        sn_order: 1,
        item_type: 'finished_good',
        model_name: prod.model_name,
        location: '',
        sap_code: prod.sap_code,
        parts_name: prod.model_name,
        section: prod.section || 'SET',
        use_qty: null,
        qty_ok: null,
        qty_ok_2: null,
        qty_nc: null,
        total_qty: null,
        operator_name: '',
        notes: '',
        is_submitted: 0,
        submitted_at: null,
        updated_at: null,
      });
      inserted += 1;
    }

    const parts = state.parts
      .filter((part) => part.product_id === prod.id)
      .sort((a, b) => a.sn_order - b.sn_order || a.id - b.id);

    parts.forEach((part, idx) => {
      const existingPart = state.entries.some(
        (e) =>
          e.session_id === sessionId &&
          e.product_id === prod.id &&
          e.item_type === 'part' &&
          e.part_id === part.id,
      );
      if (!existingPart) {
        state.entries.push({
          id: state.nextIds.entry++,
          session_id: sessionId,
          product_id: prod.id,
          part_id: part.id,
          sn_order: part.sn_order || idx + 2,
          item_type: 'part',
          model_name: prod.model_name,
          location: '',
          sap_code: part.sap_code,
          parts_name: part.parts_name,
          section: part.section || 'part',
          use_qty: part.use_qty,
          qty_ok: null,
          qty_ok_2: null,
          qty_nc: null,
          total_qty: null,
          operator_name: '',
          notes: '',
          is_submitted: 0,
          submitted_at: null,
          updated_at: null,
        });
        inserted += 1;
      }
    });
  }

  return inserted;
}

function createBlankDraftForProduct(
  state: StoredState,
  sessionId: number,
  productId: number,
): boolean {
  const hasBlank = state.entries.some(
    (e) =>
      e.session_id === sessionId &&
      e.product_id === productId &&
      !Number(e.is_submitted) &&
      e.location === '',
  );
  if (hasBlank) return false;

  const prod = state.products.find((p) => p.id === productId);
  if (prod) {
    const parts = state.parts
      .filter((p) => p.product_id === productId)
      .sort((a, b) => a.sn_order - b.sn_order || a.id - b.id);

    state.entries.push({
      id: state.nextIds.entry++,
      session_id: sessionId,
      product_id: prod.id,
      part_id: null,
      sn_order: 1,
      item_type: 'finished_good',
      model_name: prod.model_name,
      location: '',
      sap_code: prod.sap_code,
      parts_name: prod.model_name,
      section: prod.section || 'SET',
      use_qty: null,
      qty_ok: null,
      qty_ok_2: null,
      qty_nc: null,
      total_qty: null,
      operator_name: '',
      notes: '',
      is_submitted: 0,
      submitted_at: null,
      updated_at: null,
    });

    parts.forEach((part, idx) => {
      state.entries.push({
        id: state.nextIds.entry++,
        session_id: sessionId,
        product_id: prod.id,
        part_id: part.id,
        sn_order: part.sn_order || idx + 2,
        item_type: 'part',
        model_name: prod.model_name,
        location: '',
        sap_code: part.sap_code,
        parts_name: part.parts_name,
        section: part.section || 'part',
        use_qty: part.use_qty,
        qty_ok: null,
        qty_ok_2: null,
        qty_nc: null,
        total_qty: null,
        operator_name: '',
        notes: '',
        is_submitted: 0,
        submitted_at: null,
        updated_at: null,
      });
    });
    return true;
  }

  const existingEntries = state.entries
    .filter((e) => e.session_id === sessionId && e.product_id === productId)
    .sort((a, b) => {
      const typeA = a.item_type === 'finished_good' ? 0 : 1;
      const typeB = b.item_type === 'finished_good' ? 0 : 1;
      if (typeA !== typeB) return typeA - typeB;
      if (a.sn_order !== b.sn_order) return a.sn_order - b.sn_order;
      return a.id - b.id;
    });

  if (existingEntries.length === 0) return false;

  const seen = new Set<string>();
  for (const row of existingEntries) {
    const key = `${row.item_type}:${row.part_id ?? -1}:${row.sap_code}:${row.parts_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    state.entries.push({
      id: state.nextIds.entry++,
      session_id: sessionId,
      product_id: productId,
      part_id: row.part_id,
      sn_order: row.sn_order,
      item_type: row.item_type,
      model_name: row.model_name,
      location: '',
      sap_code: row.sap_code,
      parts_name: row.parts_name,
      section: row.section,
      use_qty: row.use_qty,
      qty_ok: null,
      qty_ok_2: null,
      qty_nc: null,
      total_qty: null,
      operator_name: '',
      notes: '',
      is_submitted: 0,
      submitted_at: null,
      updated_at: null,
    });
  }
  return true;
}

export const browserStore = {
  checkLocalAdminToken(token: string | null): boolean {
    if (!token || !token.startsWith('local:')) return false;
    const exp = Number(token.slice('local:'.length));
    return Number.isFinite(exp) && Date.now() <= exp;
  },

  verifyPin(pin: string): Promise<{ token: string; expiresAt: number }> {
    return withState((state) => {
      const trimmed = pin.trim();
      if (!trimmed) {
        throw new Error('PIN tidak boleh kosong.');
      }
      if (trimmed !== state.adminPin) {
        throw new Error('PIN Admin salah. Silakan coba lagi.');
      }
      const expiresAt = Date.now() + ADMIN_TOKEN_TTL_MS;
      return { token: `local:${expiresAt}`, expiresAt };
    });
  },

  changePin(currentPin: string, newPin: string): Promise<{ ok: boolean }> {
    return withState((state) => {
      const curr = currentPin.trim();
      const next = newPin.trim();
      if (!/^\d{4,8}$/.test(next)) {
        throw new Error('PIN baru harus berupa 4 hingga 8 digit angka.');
      }
      if (curr !== state.adminPin) {
        throw new Error('PIN lama tidak sesuai.');
      }
      state.adminPin = next;
      return { ok: true };
    }, true);
  },

  getLocations(): Promise<InventoryLocation[]> {
    return withState((state) =>
      [...state.locations].sort((a, b) => a.name.localeCompare(b.name)),
    );
  },

  createLocation(payload: {
    code?: string;
    name: string;
    description?: string;
  }): Promise<InventoryLocation> {
    return withState((state) => {
      const name = payload.name.trim();
      const code =
        payload.code && payload.code.trim()
          ? payload.code.trim().toUpperCase()
          : name.toUpperCase();
      const description = (payload.description ?? '').trim();

      if (!name) {
        throw new Error('Nama Location wajib diisi.');
      }

      const dup = state.locations.some(
        (l) => l.name.toUpperCase() === name.toUpperCase() || l.code.toUpperCase() === code,
      );
      if (dup) {
        throw new Error(`Location "${name}" sudah terdaftar.`);
      }

      const created: InventoryLocation = {
        id: state.nextIds.location++,
        code,
        name,
        description,
        created_at: new Date().toISOString(),
      };
      state.locations.push(created);

      for (const sess of state.sessions) {
        if (sess.status !== 'active') continue;
        const productIds = new Set(
          state.entries.filter((e) => e.session_id === sess.id).map((e) => e.product_id),
        );
        for (const pid of productIds) {
          createBlankDraftForProduct(state, sess.id, pid);
        }
      }

      return created;
    }, true);
  },

  updateLocation(
    id: number,
    payload: { code?: string; name?: string; description?: string },
  ): Promise<InventoryLocation> {
    return withState((state) => {
      const existing = state.locations.find((l) => l.id === id);
      if (!existing) {
        throw new Error('Location tidak ditemukan.');
      }

      const name = payload.name && payload.name.trim() ? payload.name.trim() : existing.name;
      const code =
        payload.code && payload.code.trim()
          ? payload.code.trim().toUpperCase()
          : name.toUpperCase();
      const description =
        payload.description !== undefined ? payload.description.trim() : existing.description;

      const dup = state.locations.some(
        (l) =>
          l.id !== id &&
          (l.name.toUpperCase() === name.toUpperCase() || l.code.toUpperCase() === code),
      );
      if (dup) {
        throw new Error(`Location "${name}" sudah digunakan.`);
      }

      existing.name = name;
      existing.code = code;
      existing.description = description;
      return { ...existing };
    }, true);
  },

  deleteLocation(id: number): Promise<{ ok: boolean }> {
    return withState((state) => {
      const idx = state.locations.findIndex((l) => l.id === id);
      if (idx === -1) {
        throw new Error('Location tidak ditemukan.');
      }
      state.locations.splice(idx, 1);
      return { ok: true };
    }, true);
  },

  getProducts(): Promise<Product[]> {
    return withState((state) => {
      return [...state.products]
        .sort((a, b) => a.id - b.id)
        .map((prod) => ({
          ...prod,
          parts: state.parts
            .filter((part) => part.product_id === prod.id)
            .sort((a, b) => a.sn_order - b.sn_order || a.id - b.id),
        }));
    });
  },

  createProduct(payload: {
    sap_code: string;
    model_name: string;
    location?: string;
    section?: string;
    parts?: Array<{
      sn_order?: number;
      sap_code: string;
      parts_name: string;
      section: string;
      use_qty: number | null;
    }>;
  }): Promise<Product> {
    return withState((state) => {
      const sapCode = payload.sap_code.trim().toUpperCase();
      const modelName = payload.model_name.trim();
      if (!sapCode || !modelName) {
        throw new Error('SAP CODE dan Nama Model wajib diisi.');
      }
      if (state.products.some((p) => p.sap_code.toUpperCase() === sapCode)) {
        throw new Error(`SAP CODE "${sapCode}" sudah terdaftar.`);
      }

      const now = new Date().toISOString();
      const createdProd: StoredProductRecord = {
        id: state.nextIds.product++,
        sap_code: sapCode,
        model_name: modelName,
        location: payload.location?.trim().toUpperCase() || 'ASSY',
        section: payload.section?.trim() || 'SET',
        is_active: true,
        created_at: now,
        updated_at: now,
      };
      state.products.push(createdProd);

      const createdParts: ProductPart[] = [];
      let snCounter = 2;
      for (const rawPart of payload.parts ?? []) {
        const partSap = rawPart.sap_code?.trim().toUpperCase() ?? '';
        const partsName = rawPart.parts_name?.trim() ?? '';
        if (!partSap || !partsName) continue;
        const partSection = rawPart.section?.trim() || 'part';
        const useQty =
          rawPart.use_qty === null || rawPart.use_qty === undefined
            ? null
            : Math.max(0, Number(rawPart.use_qty) || 1);
        const snOrder = Number(rawPart.sn_order) > 1 ? Number(rawPart.sn_order) : snCounter;
        snCounter = Math.max(snCounter + 1, snOrder + 1);

        const createdPart: ProductPart = {
          id: state.nextIds.part++,
          product_id: createdProd.id,
          sn_order: snOrder,
          sap_code: partSap,
          parts_name: partsName,
          section: partSection,
          use_qty: useQty,
          created_at: now,
        };
        state.parts.push(createdPart);
        createdParts.push(createdPart);
      }

      return { ...createdProd, parts: createdParts };
    }, true);
  },

  bulkImportProducts(payload: {
    mode: 'skip_existing' | 'replace_parts';
    models: Array<{
      sap_code: string;
      model_name: string;
      location?: string;
      section?: string;
      parts: Array<{
        sn_order?: number;
        sap_code: string;
        parts_name: string;
        section: string;
        use_qty: number | null;
      }>;
    }>;
  }): Promise<{
    createdCount: number;
    updatedCount: number;
    skippedCount: number;
    partsCount: number;
  }> {
    return withState((state) => {
      if (!payload.models || payload.models.length === 0) {
        throw new Error('Tidak ada data model yang akan diimpor.');
      }

      const now = new Date().toISOString();
      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let partsCount = 0;

      for (const rawModel of payload.models) {
        const sapCode = rawModel.sap_code?.trim().toUpperCase() ?? '';
        const modelName = rawModel.model_name?.trim() ?? '';
        if (!sapCode || !modelName) continue;

        const location = rawModel.location?.trim().toUpperCase() || 'ASSY';
        const section = rawModel.section?.trim() || 'SET';
        const existing = state.products.find((p) => p.sap_code.toUpperCase() === sapCode);

        let productId: number;
        if (existing) {
          if (payload.mode === 'skip_existing') {
            skippedCount += 1;
            continue;
          }
          productId = existing.id;
          existing.model_name = modelName;
          existing.section = section;
          existing.updated_at = now;
          state.parts = state.parts.filter((part) => part.product_id !== productId);
          updatedCount += 1;
        } else {
          const created: StoredProductRecord = {
            id: state.nextIds.product++,
            sap_code: sapCode,
            model_name: modelName,
            location,
            section,
            is_active: true,
            created_at: now,
            updated_at: now,
          };
          state.products.push(created);
          productId = created.id;
          createdCount += 1;
        }

        let snCounter = 2;
        for (const rawPart of rawModel.parts ?? []) {
          const partSap = rawPart.sap_code?.trim().toUpperCase() ?? '';
          const partsName = rawPart.parts_name?.trim() ?? '';
          if (!partSap || !partsName) continue;

          const partSection = rawPart.section?.trim() || 'part';
          const useQty =
            rawPart.use_qty === null || rawPart.use_qty === undefined
              ? null
              : Math.max(0, Number(rawPart.use_qty) || 1);
          const snOrder = Number(rawPart.sn_order) > 1 ? Number(rawPart.sn_order) : snCounter;
          snCounter = Math.max(snCounter + 1, snOrder + 1);

          state.parts.push({
            id: state.nextIds.part++,
            product_id: productId,
            sn_order: snOrder,
            sap_code: partSap,
            parts_name: partsName,
            section: partSection,
            use_qty: useQty,
            created_at: now,
          });
          partsCount += 1;
        }
      }

      return { createdCount, updatedCount, skippedCount, partsCount };
    }, true);
  },

  updateProduct(
    id: number,
    payload: Partial<{
      sap_code: string;
      model_name: string;
      location: string;
      section: string;
      is_active: boolean;
    }>,
  ): Promise<Product> {
    return withState((state) => {
      const existing = state.products.find((p) => p.id === id);
      if (!existing) {
        throw new Error('Model tidak ditemukan.');
      }

      const sapCode =
        payload.sap_code && payload.sap_code.trim()
          ? payload.sap_code.trim().toUpperCase()
          : existing.sap_code;

      if (
        state.products.some((p) => p.id !== id && p.sap_code.toUpperCase() === sapCode)
      ) {
        throw new Error(`SAP CODE "${sapCode}" sudah digunakan model lain.`);
      }

      existing.sap_code = sapCode;
      if (payload.model_name && payload.model_name.trim()) {
        existing.model_name = payload.model_name.trim();
      }
      if (payload.location && payload.location.trim()) {
        existing.location = payload.location.trim().toUpperCase();
      }
      if (payload.section && payload.section.trim()) {
        existing.section = payload.section.trim();
      }
      if (payload.is_active !== undefined) {
        existing.is_active = Boolean(payload.is_active);
      }
      existing.updated_at = new Date().toISOString();

      const parts = state.parts
        .filter((part) => part.product_id === id)
        .sort((a, b) => a.sn_order - b.sn_order || a.id - b.id);
      return { ...existing, parts };
    }, true);
  },

  deleteProduct(id: number): Promise<{ ok: boolean }> {
    return withState((state) => {
      const idx = state.products.findIndex((p) => p.id === id);
      if (idx === -1) {
        throw new Error('Model tidak ditemukan.');
      }
      state.products.splice(idx, 1);
      state.parts = state.parts.filter((part) => part.product_id !== id);
      return { ok: true };
    }, true);
  },

  addPart(
    productId: number,
    payload: {
      sn_order?: number;
      sap_code: string;
      parts_name: string;
      section: string;
      use_qty: number | null;
    },
  ): Promise<ProductPart> {
    return withState((state) => {
      const product = state.products.find((p) => p.id === productId);
      if (!product) {
        throw new Error('Model induk tidak ditemukan.');
      }

      const sapCode = payload.sap_code.trim().toUpperCase();
      const partsName = payload.parts_name.trim();
      if (!sapCode || !partsName) {
        throw new Error('SAP CODE dan PARTS NAME wajib diisi.');
      }

      const maxSn = state.parts
        .filter((p) => p.product_id === productId)
        .reduce((max, p) => Math.max(max, p.sn_order), 1);

      const snOrder = Number(payload.sn_order) > 1 ? Number(payload.sn_order) : maxSn + 1;
      const created: ProductPart = {
        id: state.nextIds.part++,
        product_id: productId,
        sn_order: snOrder,
        sap_code: sapCode,
        parts_name: partsName,
        section: payload.section?.trim() || 'part',
        use_qty:
          payload.use_qty === null || payload.use_qty === undefined
            ? null
            : Math.max(0, Number(payload.use_qty) || 1),
        created_at: new Date().toISOString(),
      };
      state.parts.push(created);
      return created;
    }, true);
  },

  bulkAddParts(
    productId: number,
    rows: Array<{
      sn_order?: number;
      sap_code: string;
      parts_name: string;
      section: string;
      use_qty: number | null;
    }>,
  ): Promise<{ added: number }> {
    return withState((state) => {
      const product = state.products.find((p) => p.id === productId);
      if (!product) {
        throw new Error('Model induk tidak ditemukan.');
      }
      if (!rows || rows.length === 0) {
        throw new Error('Tidak ada baris part yang dikirim.');
      }

      let nextSn =
        state.parts
          .filter((p) => p.product_id === productId)
          .reduce((max, p) => Math.max(max, p.sn_order), 1) + 1;

      const now = new Date().toISOString();
      let added = 0;

      for (const r of rows) {
        const sapCode = r.sap_code?.trim().toUpperCase() ?? '';
        const partsName = r.parts_name?.trim() ?? '';
        if (!sapCode || !partsName) continue;
        const section = r.section?.trim() || 'part';
        const useQty =
          r.use_qty === null || r.use_qty === undefined
            ? null
            : Math.max(0, Number(r.use_qty) || 1);
        const snOrder = Number(r.sn_order) > 1 ? Number(r.sn_order) : nextSn;
        nextSn = Math.max(nextSn + 1, snOrder + 1);
        state.parts.push({
          id: state.nextIds.part++,
          product_id: productId,
          sn_order: snOrder,
          sap_code: sapCode,
          parts_name: partsName,
          section,
          use_qty: useQty,
          created_at: now,
        });
        added += 1;
      }

      return { added };
    }, true);
  },

  updatePart(
    partId: number,
    payload: Partial<{
      sn_order: number;
      sap_code: string;
      parts_name: string;
      section: string;
      use_qty: number | null;
    }>,
  ): Promise<ProductPart> {
    return withState((state) => {
      const existing = state.parts.find((p) => p.id === partId);
      if (!existing) {
        throw new Error('Part tidak ditemukan.');
      }

      if (payload.sn_order !== undefined) {
        existing.sn_order = Math.max(2, Number(payload.sn_order) || existing.sn_order);
      }
      if (payload.sap_code && payload.sap_code.trim()) {
        existing.sap_code = payload.sap_code.trim().toUpperCase();
      }
      if (payload.parts_name && payload.parts_name.trim()) {
        existing.parts_name = payload.parts_name.trim();
      }
      if (payload.section && payload.section.trim()) {
        existing.section = payload.section.trim();
      }
      if (payload.use_qty !== undefined) {
        existing.use_qty =
          payload.use_qty === null ? null : Math.max(0, Number(payload.use_qty) || 0);
      }

      return { ...existing };
    }, true);
  },

  deletePart(partId: number): Promise<{ ok: boolean }> {
    return withState((state) => {
      const idx = state.parts.findIndex((p) => p.id === partId);
      if (idx === -1) {
        throw new Error('Part tidak ditemukan.');
      }
      state.parts.splice(idx, 1);
      return { ok: true };
    }, true);
  },

  getSessions(): Promise<OpnameSession[]> {
    return withState((state) => {
      return [...state.sessions]
        .sort((a, b) => {
          const cmp = b.period_month.localeCompare(a.period_month);
          return cmp !== 0 ? cmp : b.id - a.id;
        })
        .map((s) => {
          const sessEntries = state.entries.filter((e) => e.session_id === s.id);
          let countedItems = 0;
          let sumOk = 0;
          let sumNc = 0;
          let sumTotal = 0;
          for (const e of sessEntries) {
            if (e.total_qty !== null) countedItems += 1;
            sumOk += (e.qty_ok ?? 0) + (e.qty_ok_2 ?? 0);
            sumNc += e.qty_nc ?? 0;
            sumTotal += e.total_qty ?? 0;
          }
          return {
            ...s,
            total_items: sessEntries.length,
            counted_items: countedItems,
            sum_qty_ok: sumOk,
            sum_qty_nc: sumNc,
            sum_total_qty: sumTotal,
          };
        });
    });
  },

  createSession(payload: {
    period_month: string;
    period_label: string;
    opname_date?: string;
    notes: string;
  }): Promise<OpnameSession> {
    return withState((state) => {
      const periodMonth = payload.period_month.trim();
      const periodLabel = payload.period_label.trim();
      if (!periodMonth || !periodLabel) {
        throw new Error('Periode bulan dan nama sesi wajib diisi.');
      }

      if (!state.products.some((p) => p.is_active)) {
        throw new Error(
          'Belum ada Master Model aktif. Tambahkan minimal 1 model terlebih dahulu.',
        );
      }

      const opnameDate =
        payload.opname_date && payload.opname_date.trim()
          ? payload.opname_date.trim()
          : formatShortDotDate(new Date());

      const created: OpnameSession = {
        id: state.nextIds.session++,
        period_label: periodLabel,
        period_month: periodMonth,
        opname_date: opnameDate,
        status: 'active',
        prepared_by: '',
        submitted_at: null,
        notes: (payload.notes ?? '').trim(),
        created_at: new Date().toISOString(),
        closed_at: null,
      };
      state.sessions.push(created);
      snapshotMasterToSession(state, created.id);
      return { ...created };
    }, true);
  },

  getSessionEntries(
    sessionId: number,
  ): Promise<{ session: OpnameSession; entries: OpnameEntry[] }> {
    return withState((state) => {
      const session = state.sessions.find((s) => s.id === sessionId);
      if (!session) {
        throw new Error('Sesi opname tidak ditemukan.');
      }
      const entries = sortEntries(
        state.entries.filter((e) => e.session_id === sessionId),
      );
      return { session: { ...session }, entries };
    });
  },

  updateEntry(
    sessionId: number,
    entryId: number,
    payload: {
      qty_ok?: number | null;
      qty_ok_2?: number | null;
      qty_nc?: number | null;
      operator_name?: string;
      notes?: string;
    },
  ): Promise<OpnameEntry> {
    return withState((state) => {
      const session = state.sessions.find((s) => s.id === sessionId);
      if (!session) {
        throw new Error('Sesi opname tidak ditemukan.');
      }
      if (session.status !== 'active') {
        throw new Error('Sesi opname sudah dikunci/selesai dan tidak dapat diubah lagi.');
      }

      const existing = state.entries.find(
        (e) => e.id === entryId && e.session_id === sessionId,
      );
      if (!existing) {
        throw new Error('Item opname tidak ditemukan.');
      }
      if (Number(existing.is_submitted)) {
        throw new Error(
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

      const qtyOk = parseNullableInt(payload.qty_ok, existing.qty_ok);
      const qtyOk2 = parseNullableInt(payload.qty_ok_2, existing.qty_ok_2);
      const qtyNc = parseNullableInt(payload.qty_nc, existing.qty_nc);

      if (Number.isNaN(qtyOk) || Number.isNaN(qtyOk2) || Number.isNaN(qtyNc)) {
        throw new Error('Nilai QTY harus berupa angka 0 atau lebih.');
      }

      const hasAnyCount = qtyOk !== null || qtyOk2 !== null || qtyNc !== null;
      const totalQty = hasAnyCount
        ? (qtyOk ?? 0) + (qtyOk2 ?? 0) + (qtyNc ?? 0)
        : null;

      existing.qty_ok = qtyOk;
      existing.qty_ok_2 = qtyOk2;
      existing.qty_nc = qtyNc;
      existing.total_qty = totalQty;
      if (typeof payload.operator_name === 'string') {
        existing.operator_name = payload.operator_name.trim().slice(0, 80);
      }
      if (typeof payload.notes === 'string') {
        existing.notes = payload.notes.trim().slice(0, 240);
      }
      existing.updated_at = new Date().toISOString();

      return { ...existing };
    }, true);
  },

  submitSession(
    sessionId: number,
    operatorName: string,
    productId?: number,
    location?: string,
    sourceLocation?: string,
  ): Promise<{ session: OpnameSession; entries: OpnameEntry[] }> {
    return withState((state) => {
      const session = state.sessions.find((s) => s.id === sessionId);
      if (!session) {
        throw new Error('Sesi opname tidak ditemukan.');
      }
      if (session.status !== 'active') {
        throw new Error('Sesi opname sudah dikunci/selesai dan tidak dapat disubmit ulang.');
      }

      const cleanOperator = operatorName.trim().slice(0, 80);
      const cleanLocation = (location ?? '').trim().slice(0, 80);
      const cleanSourceLocation = (sourceLocation ?? '').trim().slice(0, 80);

      if (!cleanOperator) {
        throw new Error('Nama operator (PREPARED BY) wajib diisi.');
      }
      if (productId && Number.isFinite(productId) && !cleanLocation) {
        throw new Error('Pilih lokasi inventory terlebih dahulu.');
      }

      if (productId && Number.isFinite(productId)) {
        const alreadyLocked = state.entries.some(
          (e) =>
            e.session_id === sessionId &&
            e.product_id === productId &&
            Number(e.is_submitted) === 1 &&
            e.location.toLowerCase() === cleanLocation.toLowerCase(),
        );
        if (alreadyLocked) {
          throw new Error(
            `Lokasi "${cleanLocation}" untuk model ini sudah disubmit dan terkunci. Pilih lokasi lain.`,
          );
        }
      }

      const now = new Date().toISOString();

      if (productId && Number.isFinite(productId)) {
        let matchedCount = 0;
        for (const e of state.entries) {
          if (
            e.session_id === sessionId &&
            e.product_id === productId &&
            !Number(e.is_submitted) &&
            e.location.toLowerCase() === cleanSourceLocation.toLowerCase()
          ) {
            e.operator_name = cleanOperator;
            e.location = cleanLocation;
            e.is_submitted = 1;
            e.submitted_at = now;
            e.updated_at = e.updated_at ?? now;
            matchedCount += 1;
          }
        }

        if (matchedCount === 0) {
          for (const e of state.entries) {
            if (
              e.session_id === sessionId &&
              e.product_id === productId &&
              !Number(e.is_submitted)
            ) {
              e.operator_name = cleanOperator;
              e.location = cleanLocation;
              e.is_submitted = 1;
              e.submitted_at = now;
              e.updated_at = e.updated_at ?? now;
            }
          }
        }

        const totalLocations = state.locations.length;
        const submittedLocs = new Set(
          state.entries
            .filter(
              (e) =>
                e.session_id === sessionId &&
                e.product_id === productId &&
                Number(e.is_submitted) === 1 &&
                e.location !== '',
            )
            .map((e) => e.location.toLowerCase()),
        );

        if (totalLocations === 0 || submittedLocs.size < totalLocations) {
          createBlankDraftForProduct(state, sessionId, productId);
        }
      } else {
        for (const e of state.entries) {
          if (e.session_id === sessionId && e.total_qty !== null) {
            e.operator_name = cleanOperator;
            e.is_submitted = 1;
            e.submitted_at = now;
            e.updated_at = e.updated_at ?? now;
          }
        }
      }

      const submitters = Array.from(
        new Set(
          state.entries
            .filter(
              (e) =>
                e.session_id === sessionId &&
                Number(e.is_submitted) === 1 &&
                e.operator_name !== '',
            )
            .map((e) => e.operator_name),
        ),
      );

      session.prepared_by =
        submitters.length > 0 ? submitters.join(', ') : cleanOperator;
      session.submitted_at = now;

      const entries = sortEntries(
        state.entries.filter((e) => e.session_id === sessionId),
      );
      return { session: { ...session }, entries };
    }, true);
  },

  reopenModel(
    sessionId: number,
    productId: number,
    location?: string,
  ): Promise<{ session: OpnameSession; entries: OpnameEntry[] }> {
    return withState((state) => {
      const session = state.sessions.find((s) => s.id === sessionId);
      if (!session) {
        throw new Error('Sesi opname tidak ditemukan.');
      }
      if (session.status !== 'active') {
        throw new Error('Sesi sudah dikunci/selesai.');
      }
      if (!Number.isFinite(productId)) {
        throw new Error('ID model tidak valid.');
      }

      const cleanLoc = (location ?? '').trim().toLowerCase();
      for (const e of state.entries) {
        if (e.session_id === sessionId && e.product_id === productId) {
          if (!cleanLoc || e.location.toLowerCase() === cleanLoc) {
            e.is_submitted = 0;
          }
        }
      }

      const entries = sortEntries(
        state.entries.filter((e) => e.session_id === sessionId),
      );
      return { session: { ...session }, entries };
    }, true);
  },

  syncSessionMaster(sessionId: number): Promise<{ addedCount: number }> {
    return withState((state) => {
      const session = state.sessions.find((s) => s.id === sessionId);
      if (!session) {
        throw new Error('Sesi opname tidak ditemukan.');
      }
      if (session.status !== 'active') {
        throw new Error('Hanya sesi berstatus Aktif yang bisa disinkronkan.');
      }

      const addedCount = snapshotMasterToSession(state, sessionId);
      return { addedCount };
    }, true);
  },

  closeSession(sessionId: number): Promise<{ ok: boolean; closed_at: string }> {
    return withState((state) => {
      const session = state.sessions.find((s) => s.id === sessionId);
      if (!session) {
        throw new Error('Sesi opname tidak ditemukan.');
      }
      const closedAt = new Date().toISOString();
      session.status = 'closed';
      session.closed_at = closedAt;
      return { ok: true, closed_at: closedAt };
    }, true);
  },

  reopenSession(sessionId: number): Promise<{ ok: boolean }> {
    return withState((state) => {
      const session = state.sessions.find((s) => s.id === sessionId);
      if (!session) {
        throw new Error('Sesi opname tidak ditemukan.');
      }
      session.status = 'active';
      session.closed_at = null;
      return { ok: true };
    }, true);
  },

  deleteSession(sessionId: number): Promise<{ ok: boolean }> {
    return withState((state) => {
      const idx = state.sessions.findIndex((s) => s.id === sessionId);
      if (idx === -1) {
        throw new Error('Sesi opname tidak ditemukan.');
      }
      state.sessions.splice(idx, 1);
      state.entries = state.entries.filter((e) => e.session_id !== sessionId);
      return { ok: true };
    }, true);
  },
};
