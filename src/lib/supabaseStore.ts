import { supabase } from './supabase.ts';
import type {
  InventoryLocation,
  OpnameEntry,
  OpnameSession,
  Product,
  ProductPart,
} from '../types.ts';

const DEFAULT_PIN = '1234';

function getClient() {
  if (!supabase) {
    throw new Error('Konfigurasi Supabase belum diisi.');
  }
  return supabase;
}

function handleSbError(error: { message?: string; code?: string } | null, fallback: string): never {
  const msg = error?.message || fallback;
  if (
    error?.code === '42P01' ||
    msg.toLowerCase().includes('does not exist') ||
    msg.toLowerCase().includes('could not find the table')
  ) {
    throw new Error(
      'Tabel database di Supabase belum dibuat. Jalankan skrip SQL (supabase/schema.sql) di SQL Editor Supabase terlebih dahulu.',
    );
  }
  throw new Error(msg);
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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

function sortEntries(list: OpnameEntry[]): OpnameEntry[] {
  return [...list].sort((a, b) => {
    const prodCmp = a.product_id - b.product_id;
    if (prodCmp !== 0) return prodCmp;
    const subCmp = Number(Boolean(a.is_submitted)) - Number(Boolean(b.is_submitted));
    if (subCmp !== 0) return subCmp;
    const locCmp = a.location.localeCompare(b.location);
    if (locCmp !== 0) return locCmp;
    const snCmp = a.sn_order - b.sn_order;
    return snCmp !== 0 ? snCmp : a.id - b.id;
  });
}

function mapEntryRow(row: Record<string, unknown>): OpnameEntry {
  return {
    id: Number(row.id),
    session_id: Number(row.session_id),
    product_id: Number(row.product_id),
    part_id: row.part_id === null || row.part_id === undefined ? null : Number(row.part_id),
    sn_order: Number(row.sn_order),
    item_type: row.item_type === 'part' ? 'part' : 'finished_good',
    model_name: String(row.model_name ?? ''),
    location: String(row.location ?? ''),
    sap_code: String(row.sap_code ?? ''),
    parts_name: String(row.parts_name ?? ''),
    section: String(row.section ?? ''),
    use_qty: row.use_qty === null || row.use_qty === undefined ? null : Number(row.use_qty),
    qty_ok: row.qty_ok === null || row.qty_ok === undefined ? null : Number(row.qty_ok),
    qty_ok_2: row.qty_ok_2 === null || row.qty_ok_2 === undefined ? null : Number(row.qty_ok_2),
    qty_nc: row.qty_nc === null || row.qty_nc === undefined ? null : Number(row.qty_nc),
    total_qty: row.total_qty === null || row.total_qty === undefined ? null : Number(row.total_qty),
    operator_name: String(row.operator_name ?? ''),
    notes: String(row.notes ?? ''),
    is_submitted: Boolean(row.is_submitted),
    submitted_at: row.submitted_at ? String(row.submitted_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
  };
}

let seedPromise: Promise<void> | null = null;

export async function ensureSupabaseSeeded(): Promise<void> {
  if (!supabase) return;
  if (seedPromise) return seedPromise;

  seedPromise = (async () => {
    const client = getClient();
    const { data: existingProds, error: checkErr } = await client
      .from('products')
      .select('id')
      .limit(1);
    if (checkErr) handleSbError(checkErr, 'Gagal memeriksa tabel products.');
    if (existingProds && existingProds.length > 0) return;

    // Seed default PIN
    const defaultPinHash = await sha256Hex(DEFAULT_PIN);
    await client
      .from('app_settings')
      .upsert({ key: 'admin_pin_hash', value: defaultPinHash }, { onConflict: 'key' });

    // Seed locations
    await client.from('inventory_locations').upsert(
      [
        { code: 'ASSY', name: 'Assembly Line', description: 'Area perakitan joran pancing' },
        { code: 'BLANK', name: 'Blank Production', description: 'Area produksi dan stok blank carbon/fiber' },
        { code: 'FINISHING', name: 'Finishing & Wrapping', description: 'Area ring wrapping, resin & coating' },
        { code: 'WH', name: 'Warehouse Utama', description: 'Gudang penyimpanan material dan barang jadi' },
      ],
      { onConflict: 'code', ignoreDuplicates: true },
    );

    // Seed products
    const { data: insertedProds, error: prodErr } = await client
      .from('products')
      .upsert(
        [
          {
            sap_code: '60033365',
            model_name: 'LUCOZA 20LUNAMIS B80M SA',
            location: 'ASSY',
            section: 'SET',
            is_active: true,
          },
          {
            sap_code: '60034102',
            model_name: 'LUCOZA 22SEPHIA S86ML SA',
            location: 'ASSY',
            section: 'SET',
            is_active: true,
          },
        ],
        { onConflict: 'sap_code' },
      )
      .select('*');
    if (prodErr) handleSbError(prodErr, 'Gagal menambahkan model awal.');

    const p1 = insertedProds?.find((p) => p.sap_code === '60033365');
    const p2 = insertedProds?.find((p) => p.sap_code === '60034102');

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

    const partRows: Array<Record<string, unknown>> = [];
    if (p1) {
      for (const [sn, sap, pname, sec, useQty] of rawP1Parts) {
        partRows.push({
          product_id: p1.id,
          sn_order: sn,
          sap_code: sap,
          parts_name: pname,
          section: sec,
          use_qty: useQty,
        });
      }
    }
    if (p2) {
      for (const [sn, sap, pname, sec, useQty] of rawP2Parts) {
        partRows.push({
          product_id: p2.id,
          sn_order: sn,
          sap_code: sap,
          parts_name: pname,
          section: sec,
          use_qty: useQty,
        });
      }
    }

    const { data: insertedParts } = await client
      .from('product_parts')
      .insert(partRows)
      .select('*');

    const { data: existingSess } = await client
      .from('opname_sessions')
      .select('id')
      .limit(1);
    if (existingSess && existingSess.length > 0) return;

    const prevDate = new Date();
    prevDate.setMonth(prevDate.getMonth() - 1);
    const prevMonthStr = prevDate.toISOString().slice(0, 7);
    const prevLabel = formatIndonesianMonth(prevMonthStr);
    const prevShortDate = formatShortDotDate(prevDate);
    const closedAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 15).toISOString();

    const currDate = new Date();
    const currMonthStr = currDate.toISOString().slice(0, 7);
    const currLabel = formatIndonesianMonth(currMonthStr);
    const currShortDate = formatShortDotDate(currDate);

    const { data: insertedSessions } = await client
      .from('opname_sessions')
      .insert([
        {
          period_label: prevLabel,
          period_month: prevMonthStr,
          opname_date: prevShortDate,
          status: 'closed',
          prepared_by: 'Helen',
          submitted_at: closedAt,
          notes: 'Arsip stock opname akhir bulan sebelumnya',
          closed_at: closedAt,
        },
        {
          period_label: currLabel,
          period_month: currMonthStr,
          opname_date: currShortDate,
          status: 'active',
          prepared_by: '',
          submitted_at: null,
          notes: 'Stock opname bulanan berjalan',
          closed_at: null,
        },
      ])
      .select('*');

    const archivedSess = insertedSessions?.find((s) => s.status === 'closed');
    const activeSess = insertedSessions?.find((s) => s.status === 'active');
    const allProds = [p1, p2].filter(Boolean) as Array<Record<string, unknown>>;
    const allParts = (insertedParts ?? []) as Array<Record<string, unknown>>;

    const entryRows: Array<Record<string, unknown>> = [];
    if (archivedSess) {
      for (const prod of allProds) {
        const prodParts = allParts.filter((pt) => pt.product_id === prod.id);
        const addArch = (
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
          entryRows.push({
            session_id: archivedSess.id,
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
            is_submitted: false,
            submitted_at: null,
            updated_at: closedAt,
          });
        };
        addArch(
          null,
          1,
          'finished_good',
          String(prod.sap_code),
          String(prod.model_name),
          String(prod.section || 'SET'),
          null,
        );
        for (const pt of prodParts) {
          addArch(
            Number(pt.id),
            Number(pt.sn_order),
            'part',
            String(pt.sap_code),
            String(pt.parts_name),
            String(pt.section || 'part'),
            pt.use_qty === null ? null : Number(pt.use_qty),
          );
        }
      }
    }

    if (activeSess) {
      for (const prod of allProds) {
        const prodParts = allParts.filter((pt) => pt.product_id === prod.id);
        entryRows.push({
          session_id: activeSess.id,
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
          is_submitted: false,
          submitted_at: null,
        });
        for (const pt of prodParts) {
          entryRows.push({
            session_id: activeSess.id,
            product_id: prod.id,
            part_id: pt.id,
            sn_order: pt.sn_order,
            item_type: 'part',
            model_name: prod.model_name,
            location: '',
            sap_code: pt.sap_code,
            parts_name: pt.parts_name,
            section: pt.section || 'part',
            use_qty: pt.use_qty,
            qty_ok: null,
            qty_ok_2: null,
            qty_nc: null,
            total_qty: null,
            operator_name: '',
            notes: '',
            is_submitted: false,
            submitted_at: null,
          });
        }
      }
    }

    if (entryRows.length > 0) {
      await client.from('opname_entries').insert(entryRows);
    }
  })();

  try {
    await seedPromise;
  } catch (err) {
    seedPromise = null;
    throw err;
  }
}

export const supabaseStore = {
  subscribeWorkspace(onUpdate: () => void): () => void {
    const client = supabase;
    if (!client) return () => {};
    const channel = client
      .channel(`workspace_sync_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'inventory_locations' },
        () => onUpdate(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products' },
        () => onUpdate(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_parts' },
        () => onUpdate(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'opname_sessions' },
        () => onUpdate(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'opname_entries' },
        () => onUpdate(),
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  },

  subscribeSessionEntries(sessionId: number, onUpdate: () => void): () => void {
    const client = supabase;
    if (!client) return () => {};
    const channel = client
      .channel(`session_entries_${sessionId}_${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'opname_entries',
          filter: `session_id=eq.${sessionId}`,
        },
        () => onUpdate(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'opname_sessions',
          filter: `id=eq.${sessionId}`,
        },
        () => onUpdate(),
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  },

  async verifyPin(pin: string): Promise<{ token: string; expiresAt: number }> {
    const client = getClient();
    const { data, error } = await client
      .from('app_settings')
      .select('value')
      .eq('key', 'admin_pin_hash')
      .maybeSingle();
    if (error) handleSbError(error, 'Gagal memverifikasi PIN Admin.');

    const expectedHash = data?.value || (await sha256Hex(DEFAULT_PIN));
    const inputHash = await sha256Hex(pin.trim());
    if (inputHash !== expectedHash) {
      throw new Error('PIN Admin salah.');
    }
    return {
      token: `sb_admin_${Date.now()}`,
      expiresAt: Date.now() + 1000 * 60 * 60 * 12,
    };
  },

  async changePin(currentPin: string, newPin: string): Promise<{ ok: boolean }> {
    if (!/^\d{4,8}$/.test(newPin)) {
      throw new Error('PIN baru harus terdiri dari 4 sampai 8 digit angka.');
    }
    const client = getClient();
    const { data, error } = await client
      .from('app_settings')
      .select('value')
      .eq('key', 'admin_pin_hash')
      .maybeSingle();
    if (error) handleSbError(error, 'Gagal membaca PIN Admin.');

    const expectedHash = data?.value || (await sha256Hex(DEFAULT_PIN));
    const currHash = await sha256Hex(currentPin.trim());
    if (currHash !== expectedHash) {
      throw new Error('PIN saat ini tidak sesuai.');
    }

    const nextHash = await sha256Hex(newPin);
    const { error: upsertErr } = await client
      .from('app_settings')
      .upsert(
        {
          key: 'admin_pin_hash',
          value: nextHash,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      );
    if (upsertErr) handleSbError(upsertErr, 'Gagal menyimpan PIN baru.');
    return { ok: true };
  },

  async getLocations(): Promise<InventoryLocation[]> {
    const client = getClient();
    const [{ data: locs, error: locErr }, { data: submittedRows, error: entErr }] =
      await Promise.all([
        client.from('inventory_locations').select('*').order('code', { ascending: true }),
        client
          .from('opname_entries')
          .select('product_id, location')
          .eq('is_submitted', true),
      ]);

    if (locErr) handleSbError(locErr, 'Gagal memuat daftar lokasi.');
    if (entErr) handleSbError(entErr, 'Gagal memuat ringkasan lokasi.');

    return (locs ?? []).map((loc) => {
      const codeLower = String(loc.code).toLowerCase();
      const productSet = new Set(
        (submittedRows ?? [])
          .filter((e) => String(e.location ?? '').toLowerCase() === codeLower)
          .map((e) => Number(e.product_id)),
      );
      return {
        id: Number(loc.id),
        code: String(loc.code),
        name: String(loc.name),
        description: String(loc.description ?? ''),
        created_at: String(loc.created_at),
        model_count: productSet.size,
      };
    });
  },

  async createLocation(payload: {
    code?: string;
    name: string;
    description?: string;
  }): Promise<InventoryLocation> {
    const client = getClient();
    const name = payload.name.trim();
    if (!name) throw new Error('Nama lokasi wajib diisi.');
    const code = (payload.code?.trim() || name)
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '');
    if (!code) throw new Error('Kode lokasi harus berisi huruf atau angka.');

    const { data, error } = await client
      .from('inventory_locations')
      .insert({
        code,
        name,
        description: (payload.description ?? '').trim(),
      })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new Error(`Kode lokasi "${code}" sudah terdaftar.`);
      }
      handleSbError(error, 'Gagal menambahkan lokasi.');
    }
    return {
      id: Number(data.id),
      code: String(data.code),
      name: String(data.name),
      description: String(data.description ?? ''),
      created_at: String(data.created_at),
      model_count: 0,
    };
  },

  async updateLocation(
    id: number,
    payload: { code?: string; name?: string; description?: string },
  ): Promise<InventoryLocation> {
    const client = getClient();
    const updates: Record<string, unknown> = {};
    if (payload.code !== undefined && payload.code.trim()) {
      updates.code = payload.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    }
    if (payload.name !== undefined && payload.name.trim()) {
      updates.name = payload.name.trim();
    }
    if (payload.description !== undefined) {
      updates.description = payload.description.trim();
    }

    const { data, error } = await client
      .from('inventory_locations')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();
    if (error) handleSbError(error, 'Gagal memperbarui lokasi.');

    return {
      id: Number(data.id),
      code: String(data.code),
      name: String(data.name),
      description: String(data.description ?? ''),
      created_at: String(data.created_at),
    };
  },

  async deleteLocation(id: number): Promise<{ ok: boolean }> {
    const client = getClient();
    const { error } = await client.from('inventory_locations').delete().eq('id', id);
    if (error) handleSbError(error, 'Gagal menghapus lokasi.');
    return { ok: true };
  },

  async getProducts(): Promise<Product[]> {
    const client = getClient();
    const [{ data: prods, error: pErr }, { data: parts, error: ptErr }] =
      await Promise.all([
        client.from('products').select('*').order('model_name', { ascending: true }),
        client
          .from('product_parts')
          .select('*')
          .order('sn_order', { ascending: true })
          .order('id', { ascending: true }),
      ]);
    if (pErr) handleSbError(pErr, 'Gagal memuat master model.');
    if (ptErr) handleSbError(ptErr, 'Gagal memuat master part.');

    const partsByProduct = new Map<number, ProductPart[]>();
    for (const row of parts ?? []) {
      const part: ProductPart = {
        id: Number(row.id),
        product_id: Number(row.product_id),
        sn_order: Number(row.sn_order),
        sap_code: String(row.sap_code),
        parts_name: String(row.parts_name),
        section: String(row.section ?? ''),
        use_qty: row.use_qty === null ? null : Number(row.use_qty),
        created_at: String(row.created_at),
      };
      const arr = partsByProduct.get(part.product_id) ?? [];
      arr.push(part);
      partsByProduct.set(part.product_id, arr);
    }

    return (prods ?? []).map((p) => ({
      id: Number(p.id),
      sap_code: String(p.sap_code),
      model_name: String(p.model_name),
      location: String(p.location ?? ''),
      section: String(p.section ?? 'SET'),
      is_active: Boolean(p.is_active),
      created_at: String(p.created_at),
      updated_at: String(p.updated_at),
      parts: partsByProduct.get(Number(p.id)) ?? [],
    }));
  },

  async createProduct(payload: {
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
    const client = getClient();
    const sapCode = payload.sap_code.trim().toUpperCase();
    const modelName = payload.model_name.trim();
    if (!sapCode || !modelName) {
      throw new Error('SAP Code dan Nama Model wajib diisi.');
    }

    const { data: prod, error: prodErr } = await client
      .from('products')
      .insert({
        sap_code: sapCode,
        model_name: modelName,
        location: (payload.location ?? '').trim(),
        section: (payload.section ?? 'SET').trim() || 'SET',
        is_active: true,
      })
      .select('*')
      .single();
    if (prodErr) {
      if (prodErr.code === '23505') {
        throw new Error(`SAP Code "${sapCode}" sudah terdaftar.`);
      }
      handleSbError(prodErr, 'Gagal menambahkan model.');
    }

    let createdParts: ProductPart[] = [];
    const partInputs = (payload.parts ?? []).filter(
      (p) => p.sap_code?.trim() && p.parts_name?.trim(),
    );
    if (partInputs.length > 0) {
      let sn = 2;
      const rows = partInputs.map((p) => {
        const snOrder = Number(p.sn_order) > 1 ? Number(p.sn_order) : sn;
        sn = Math.max(sn + 1, snOrder + 1);
        return {
          product_id: prod.id,
          sn_order: snOrder,
          sap_code: p.sap_code.trim().toUpperCase(),
          parts_name: p.parts_name.trim(),
          section: p.section?.trim() || 'part',
          use_qty:
            p.use_qty === null || p.use_qty === undefined
              ? null
              : Math.max(0, Number(p.use_qty) || 1),
        };
      });
      const { data: partsData, error: partsErr } = await client
        .from('product_parts')
        .insert(rows)
        .select('*');
      if (partsErr) handleSbError(partsErr, 'Gagal menambahkan part model.');
      createdParts = (partsData ?? []).map((row) => ({
        id: Number(row.id),
        product_id: Number(row.product_id),
        sn_order: Number(row.sn_order),
        sap_code: String(row.sap_code),
        parts_name: String(row.parts_name),
        section: String(row.section ?? ''),
        use_qty: row.use_qty === null ? null : Number(row.use_qty),
        created_at: String(row.created_at),
      }));
    }

    return {
      id: Number(prod.id),
      sap_code: String(prod.sap_code),
      model_name: String(prod.model_name),
      location: String(prod.location ?? ''),
      section: String(prod.section ?? 'SET'),
      is_active: Boolean(prod.is_active),
      created_at: String(prod.created_at),
      updated_at: String(prod.updated_at),
      parts: createdParts,
    };
  },

  async bulkImportProducts(payload: {
    mode: 'skip_existing' | 'replace_parts';
    models: Array<{
      sap_code: string;
      model_name: string;
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
    const client = getClient();
    const existingList = await this.getProducts();
    const existingMap = new Map(existingList.map((p) => [p.sap_code.toLowerCase(), p]));

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let partsCount = 0;

    for (const m of payload.models) {
      const sapCode = m.sap_code?.trim().toUpperCase() ?? '';
      const modelName = m.model_name?.trim() ?? '';
      if (!sapCode || !modelName) continue;
      const section = m.section?.trim() || 'SET';
      const existing = existingMap.get(sapCode.toLowerCase());

      if (existing) {
        if (payload.mode === 'skip_existing') {
          skippedCount += 1;
          continue;
        }
        await client
          .from('products')
          .update({
            model_name: modelName,
            section,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
        await client.from('product_parts').delete().eq('product_id', existing.id);

        const validParts = (m.parts ?? []).filter(
          (p) => p.sap_code?.trim() && p.parts_name?.trim(),
        );
        if (validParts.length > 0) {
          let sn = 2;
          const rows = validParts.map((p) => {
            const snOrder = Number(p.sn_order) > 1 ? Number(p.sn_order) : sn;
            sn = Math.max(sn + 1, snOrder + 1);
            return {
              product_id: existing.id,
              sn_order: snOrder,
              sap_code: p.sap_code.trim().toUpperCase(),
              parts_name: p.parts_name.trim(),
              section: p.section?.trim() || 'part',
              use_qty:
                p.use_qty === null || p.use_qty === undefined
                  ? null
                  : Math.max(0, Number(p.use_qty) || 1),
            };
          });
          await client.from('product_parts').insert(rows);
          partsCount += rows.length;
        }
        updatedCount += 1;
      } else {
        const created = await this.createProduct({
          sap_code: sapCode,
          model_name: modelName,
          location: 'ASSY',
          section,
          parts: m.parts,
        });
        partsCount += created.parts.length;
        createdCount += 1;
      }
    }

    return { createdCount, updatedCount, skippedCount, partsCount };
  },

  async updateProduct(
    id: number,
    payload: Partial<{
      sap_code: string;
      model_name: string;
      location: string;
      section: string;
      is_active: boolean;
    }>,
  ): Promise<Product> {
    const client = getClient();
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (payload.sap_code !== undefined && payload.sap_code.trim()) {
      updates.sap_code = payload.sap_code.trim().toUpperCase();
    }
    if (payload.model_name !== undefined && payload.model_name.trim()) {
      updates.model_name = payload.model_name.trim();
    }
    if (payload.location !== undefined) {
      updates.location = payload.location.trim();
    }
    if (payload.section !== undefined && payload.section.trim()) {
      updates.section = payload.section.trim();
    }
    if (payload.is_active !== undefined) {
      updates.is_active = Boolean(payload.is_active);
    }

    const { data, error } = await client
      .from('products')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();
    if (error) handleSbError(error, 'Gagal memperbarui model.');

    const { data: parts } = await client
      .from('product_parts')
      .select('*')
      .eq('product_id', id)
      .order('sn_order', { ascending: true });

    return {
      id: Number(data.id),
      sap_code: String(data.sap_code),
      model_name: String(data.model_name),
      location: String(data.location ?? ''),
      section: String(data.section ?? 'SET'),
      is_active: Boolean(data.is_active),
      created_at: String(data.created_at),
      updated_at: String(data.updated_at),
      parts: (parts ?? []).map((row) => ({
        id: Number(row.id),
        product_id: Number(row.product_id),
        sn_order: Number(row.sn_order),
        sap_code: String(row.sap_code),
        parts_name: String(row.parts_name),
        section: String(row.section ?? ''),
        use_qty: row.use_qty === null ? null : Number(row.use_qty),
        created_at: String(row.created_at),
      })),
    };
  },

  async deleteProduct(id: number): Promise<{ ok: boolean }> {
    const client = getClient();
    const { error } = await client.from('products').delete().eq('id', id);
    if (error) handleSbError(error, 'Gagal menghapus model.');
    return { ok: true };
  },

  async addPart(
    productId: number,
    payload: {
      sn_order?: number;
      sap_code: string;
      parts_name: string;
      section: string;
      use_qty: number | null;
    },
  ): Promise<ProductPart> {
    const client = getClient();
    const sapCode = payload.sap_code.trim().toUpperCase();
    const partsName = payload.parts_name.trim();
    if (!sapCode || !partsName) {
      throw new Error('SAP Code dan Nama Part wajib diisi.');
    }

    const { data: existingParts } = await client
      .from('product_parts')
      .select('sn_order')
      .eq('product_id', productId);
    const maxSn = (existingParts ?? []).reduce(
      (m, r) => Math.max(m, Number(r.sn_order) || 1),
      1,
    );
    const snOrder =
      payload.sn_order && Number(payload.sn_order) > 1
        ? Number(payload.sn_order)
        : maxSn + 1;

    const { data, error } = await client
      .from('product_parts')
      .insert({
        product_id: productId,
        sn_order: snOrder,
        sap_code: sapCode,
        parts_name: partsName,
        section: payload.section?.trim() || 'part',
        use_qty:
          payload.use_qty === null || payload.use_qty === undefined
            ? null
            : Math.max(0, Number(payload.use_qty) || 1),
      })
      .select('*')
      .single();
    if (error) handleSbError(error, 'Gagal menambahkan part.');

    return {
      id: Number(data.id),
      product_id: Number(data.product_id),
      sn_order: Number(data.sn_order),
      sap_code: String(data.sap_code),
      parts_name: String(data.parts_name),
      section: String(data.section ?? ''),
      use_qty: data.use_qty === null ? null : Number(data.use_qty),
      created_at: String(data.created_at),
    };
  },

  async bulkAddParts(
    productId: number,
    parts: Array<{
      sn_order?: number;
      sap_code: string;
      parts_name: string;
      section: string;
      use_qty: number | null;
    }>,
  ): Promise<{ added: number }> {
    const client = getClient();
    const { data: existingParts } = await client
      .from('product_parts')
      .select('sn_order')
      .eq('product_id', productId);
    let nextSn =
      (existingParts ?? []).reduce((m, r) => Math.max(m, Number(r.sn_order) || 1), 1) + 1;

    const valid = parts.filter((r) => r.sap_code?.trim() && r.parts_name?.trim());
    if (valid.length === 0) return { added: 0 };

    const rows = valid.map((r) => {
      const snOrder = Number(r.sn_order) > 1 ? Number(r.sn_order) : nextSn;
      nextSn = Math.max(nextSn + 1, snOrder + 1);
      return {
        product_id: productId,
        sn_order: snOrder,
        sap_code: r.sap_code.trim().toUpperCase(),
        parts_name: r.parts_name.trim(),
        section: r.section?.trim() || 'part',
        use_qty:
          r.use_qty === null || r.use_qty === undefined
            ? null
            : Math.max(0, Number(r.use_qty) || 1),
      };
    });

    const { error } = await client.from('product_parts').insert(rows);
    if (error) handleSbError(error, 'Gagal mengimpor part.');
    return { added: rows.length };
  },

  async updatePart(
    partId: number,
    payload: Partial<{
      sn_order: number;
      sap_code: string;
      parts_name: string;
      section: string;
      use_qty: number | null;
    }>,
  ): Promise<ProductPart> {
    const client = getClient();
    const updates: Record<string, unknown> = {};
    if (payload.sn_order !== undefined) {
      updates.sn_order = Math.max(2, Number(payload.sn_order) || 2);
    }
    if (payload.sap_code && payload.sap_code.trim()) {
      updates.sap_code = payload.sap_code.trim().toUpperCase();
    }
    if (payload.parts_name && payload.parts_name.trim()) {
      updates.parts_name = payload.parts_name.trim();
    }
    if (payload.section && payload.section.trim()) {
      updates.section = payload.section.trim();
    }
    if (payload.use_qty !== undefined) {
      updates.use_qty =
        payload.use_qty === null ? null : Math.max(0, Number(payload.use_qty) || 0);
    }

    const { data, error } = await client
      .from('product_parts')
      .update(updates)
      .eq('id', partId)
      .select('*')
      .single();
    if (error) handleSbError(error, 'Gagal memperbarui part.');

    return {
      id: Number(data.id),
      product_id: Number(data.product_id),
      sn_order: Number(data.sn_order),
      sap_code: String(data.sap_code),
      parts_name: String(data.parts_name),
      section: String(data.section ?? ''),
      use_qty: data.use_qty === null ? null : Number(data.use_qty),
      created_at: String(data.created_at),
    };
  },

  async deletePart(partId: number): Promise<{ ok: boolean }> {
    const client = getClient();
    const { error } = await client.from('product_parts').delete().eq('id', partId);
    if (error) handleSbError(error, 'Gagal menghapus part.');
    return { ok: true };
  },

  async getSessions(): Promise<OpnameSession[]> {
    const client = getClient();
    const [{ data: sessions, error: sErr }, { data: entries, error: eErr }] =
      await Promise.all([
        client
          .from('opname_sessions')
          .select('*')
          .order('period_month', { ascending: false })
          .order('id', { ascending: false }),
        client
          .from('opname_entries')
          .select('session_id, qty_ok, qty_ok_2, qty_nc, total_qty'),
      ]);
    if (sErr) handleSbError(sErr, 'Gagal memuat sesi opname.');
    if (eErr) handleSbError(eErr, 'Gagal memuat statistik sesi.');

    const bySession = new Map<
      number,
      { total: number; counted: number; ok: number; nc: number; grand: number }
    >();
    for (const row of entries ?? []) {
      const sid = Number(row.session_id);
      const agg = bySession.get(sid) ?? {
        total: 0,
        counted: 0,
        ok: 0,
        nc: 0,
        grand: 0,
      };
      agg.total += 1;
      if (row.total_qty !== null) agg.counted += 1;
      agg.ok += Number(row.qty_ok ?? 0) + Number(row.qty_ok_2 ?? 0);
      agg.nc += Number(row.qty_nc ?? 0);
      agg.grand += Number(row.total_qty ?? 0);
      bySession.set(sid, agg);
    }

    return (sessions ?? []).map((s) => {
      const agg = bySession.get(Number(s.id)) ?? {
        total: 0,
        counted: 0,
        ok: 0,
        nc: 0,
        grand: 0,
      };
      return {
        id: Number(s.id),
        period_label: String(s.period_label),
        period_month: String(s.period_month),
        opname_date: String(s.opname_date ?? ''),
        status: s.status === 'closed' ? 'closed' : 'active',
        prepared_by: String(s.prepared_by ?? ''),
        submitted_at: s.submitted_at ? String(s.submitted_at) : null,
        notes: String(s.notes ?? ''),
        created_at: String(s.created_at),
        closed_at: s.closed_at ? String(s.closed_at) : null,
        total_items: agg.total,
        counted_items: agg.counted,
        sum_qty_ok: agg.ok,
        sum_qty_nc: agg.nc,
        sum_total_qty: agg.grand,
      };
    });
  },

  async createSession(payload: {
    period_month: string;
    period_label: string;
    opname_date?: string;
    notes: string;
  }): Promise<OpnameSession> {
    const client = getClient();
    const periodMonth = payload.period_month.trim();
    const periodLabel = payload.period_label.trim();
    if (!periodMonth || !periodLabel) {
      throw new Error('Periode bulan dan nama sesi wajib diisi.');
    }

    const products = await this.getProducts();
    const active = products.filter((p) => p.is_active);
    if (active.length === 0) {
      throw new Error(
        'Belum ada Master Model aktif. Tambahkan minimal 1 model terlebih dahulu.',
      );
    }

    const opnameDate =
      payload.opname_date && payload.opname_date.trim()
        ? payload.opname_date.trim()
        : formatShortDotDate(new Date());

    const { data: session, error: sErr } = await client
      .from('opname_sessions')
      .insert({
        period_label: periodLabel,
        period_month: periodMonth,
        opname_date: opnameDate,
        status: 'active',
        prepared_by: '',
        notes: (payload.notes ?? '').trim(),
      })
      .select('*')
      .single();
    if (sErr) handleSbError(sErr, 'Gagal membuat sesi opname.');

    const entryRows: Array<Record<string, unknown>> = [];
    for (const prod of active) {
      entryRows.push({
        session_id: session.id,
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
        operator_name: '',
        notes: '',
        is_submitted: false,
      });
      for (const part of prod.parts) {
        entryRows.push({
          session_id: session.id,
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
          operator_name: '',
          notes: '',
          is_submitted: false,
        });
      }
    }

    if (entryRows.length > 0) {
      const { error: eErr } = await client.from('opname_entries').insert(entryRows);
      if (eErr) handleSbError(eErr, 'Gagal membuat daftar form opname.');
    }

    return {
      id: Number(session.id),
      period_label: String(session.period_label),
      period_month: String(session.period_month),
      opname_date: String(session.opname_date ?? ''),
      status: 'active',
      prepared_by: '',
      submitted_at: null,
      notes: String(session.notes ?? ''),
      created_at: String(session.created_at),
      closed_at: null,
    };
  },

  async getSessionEntries(
    sessionId: number,
  ): Promise<{ session: OpnameSession; entries: OpnameEntry[] }> {
    const client = getClient();
    const [{ data: sess, error: sErr }, { data: entries, error: eErr }] =
      await Promise.all([
        client.from('opname_sessions').select('*').eq('id', sessionId).single(),
        client.from('opname_entries').select('*').eq('session_id', sessionId),
      ]);

    if (sErr || !sess) handleSbError(sErr, 'Sesi opname tidak ditemukan.');
    if (eErr) handleSbError(eErr, 'Gagal memuat entri opname.');

    return {
      session: {
        id: Number(sess.id),
        period_label: String(sess.period_label),
        period_month: String(sess.period_month),
        opname_date: String(sess.opname_date ?? ''),
        status: sess.status === 'closed' ? 'closed' : 'active',
        prepared_by: String(sess.prepared_by ?? ''),
        submitted_at: sess.submitted_at ? String(sess.submitted_at) : null,
        notes: String(sess.notes ?? ''),
        created_at: String(sess.created_at),
        closed_at: sess.closed_at ? String(sess.closed_at) : null,
      },
      entries: sortEntries((entries ?? []).map(mapEntryRow)),
    };
  },

  async updateEntry(
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
    const client = getClient();
    const { data: existing, error: fErr } = await client
      .from('opname_entries')
      .select('*')
      .eq('id', entryId)
      .eq('session_id', sessionId)
      .single();
    if (fErr || !existing) throw new Error('Item opname tidak ditemukan.');
    if (existing.is_submitted) {
      throw new Error(
        'Model ini sudah disubmit. Klik tombol Edit pada model untuk mengubah angka.',
      );
    }

    const parseNullableInt = (val: unknown, fallback: number | null): number | null => {
      if (val === undefined) return fallback;
      if (val === null || val === '') return null;
      const parsed = Number(val);
      if (!Number.isFinite(parsed) || parsed < 0) return NaN;
      return Math.round(parsed);
    };

    const qtyOk = parseNullableInt(
      payload.qty_ok,
      existing.qty_ok === null ? null : Number(existing.qty_ok),
    );
    const qtyOk2 = parseNullableInt(
      payload.qty_ok_2,
      existing.qty_ok_2 === null ? null : Number(existing.qty_ok_2),
    );
    const qtyNc = parseNullableInt(
      payload.qty_nc,
      existing.qty_nc === null ? null : Number(existing.qty_nc),
    );
    if (Number.isNaN(qtyOk) || Number.isNaN(qtyOk2) || Number.isNaN(qtyNc)) {
      throw new Error('Nilai QTY harus berupa angka 0 atau lebih.');
    }

    const hasAnyCount = qtyOk !== null || qtyOk2 !== null || qtyNc !== null;
    const totalQty = hasAnyCount ? (qtyOk ?? 0) + (qtyOk2 ?? 0) + (qtyNc ?? 0) : null;

    const updates: Record<string, unknown> = {
      qty_ok: qtyOk,
      qty_ok_2: qtyOk2,
      qty_nc: qtyNc,
      total_qty: totalQty,
      updated_at: new Date().toISOString(),
    };
    if (typeof payload.operator_name === 'string') {
      updates.operator_name = payload.operator_name.trim().slice(0, 80);
    }
    if (typeof payload.notes === 'string') {
      updates.notes = payload.notes.trim().slice(0, 240);
    }

    const { data: updated, error: uErr } = await client
      .from('opname_entries')
      .update(updates)
      .eq('id', entryId)
      .select('*')
      .single();
    if (uErr) handleSbError(uErr, 'Gagal menyimpan baris opname.');

    return mapEntryRow(updated);
  },

  async submitSession(
    sessionId: number,
    operatorName: string,
    productId?: number,
    location?: string,
    sourceLocation?: string,
  ): Promise<{ session: OpnameSession; entries: OpnameEntry[] }> {
    const client = getClient();
    const { session, entries } = await this.getSessionEntries(sessionId);
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
      const alreadyLocked = entries.some(
        (e) =>
          e.product_id === productId &&
          Boolean(e.is_submitted) &&
          e.location.toLowerCase() === cleanLocation.toLowerCase(),
      );
      if (alreadyLocked) {
        throw new Error(
          `Lokasi "${cleanLocation}" untuk model ini sudah disubmit dan terkunci. Pilih lokasi lain.`,
        );
      }
    }

    const nowIso = new Date().toISOString();

    if (productId && Number.isFinite(productId)) {
      let targetRows = entries.filter(
        (e) =>
          e.product_id === productId &&
          !Boolean(e.is_submitted) &&
          e.location.toLowerCase() === cleanSourceLocation.toLowerCase(),
      );
      if (targetRows.length === 0) {
        targetRows = entries.filter(
          (e) => e.product_id === productId && !Boolean(e.is_submitted),
        );
      }

      const targetIds = targetRows.map((r) => r.id);
      if (targetIds.length > 0) {
        const { error: uErr } = await client
          .from('opname_entries')
          .update({
            operator_name: cleanOperator,
            location: cleanLocation,
            is_submitted: true,
            submitted_at: nowIso,
            updated_at: nowIso,
          })
          .in('id', targetIds);
        if (uErr) handleSbError(uErr, 'Gagal mengunci hasil opname.');
      }

      const [{ data: locs }, products] = await Promise.all([
        client.from('inventory_locations').select('id'),
        this.getProducts(),
      ]);
      const totalLocations = locs?.length ?? 0;
      const submittedLocs = new Set(
        entries
          .filter((e) => e.product_id === productId && Boolean(e.is_submitted) && e.location)
          .map((e) => e.location.toLowerCase()),
      );
      submittedLocs.add(cleanLocation.toLowerCase());

      if (totalLocations === 0 || submittedLocs.size < totalLocations) {
        const prod = products.find((p) => p.id === productId);
        if (prod) {
          const blankRows: Array<Record<string, unknown>> = [
            {
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
              operator_name: '',
              notes: '',
              is_submitted: false,
            },
            ...prod.parts.map((part) => ({
              session_id: sessionId,
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
              operator_name: '',
              notes: '',
              is_submitted: false,
            })),
          ];
          await client.from('opname_entries').insert(blankRows);
        }
      }
    }

    const updatedResult = await this.getSessionEntries(sessionId);
    const submitters = Array.from(
      new Set(
        updatedResult.entries
          .filter((e) => Boolean(e.is_submitted) && e.operator_name !== '')
          .map((e) => e.operator_name),
      ),
    );

    const preparedBy = submitters.length > 0 ? submitters.join(', ') : cleanOperator;
    await client
      .from('opname_sessions')
      .update({ prepared_by: preparedBy, submitted_at: nowIso })
      .eq('id', sessionId);

    return this.getSessionEntries(sessionId);
  },

  async reopenModel(
    sessionId: number,
    productId: number,
    location?: string,
  ): Promise<{ session: OpnameSession; entries: OpnameEntry[] }> {
    const client = getClient();
    const { session } = await this.getSessionEntries(sessionId);
    if (session.status !== 'active') {
      throw new Error('Sesi sudah dikunci/selesai.');
    }

    let q = client
      .from('opname_entries')
      .update({ is_submitted: false })
      .eq('session_id', sessionId)
      .eq('product_id', productId);

    if (location && location.trim()) {
      q = q.ilike('location', location.trim());
    }
    const { error } = await q;
    if (error) handleSbError(error, 'Gagal membuka ulang form model.');

    return this.getSessionEntries(sessionId);
  },

  async syncSessionMaster(sessionId: number): Promise<{ addedCount: number }> {
    const client = getClient();
    const { session, entries } = await this.getSessionEntries(sessionId);
    if (session.status !== 'active') {
      throw new Error('Hanya sesi berstatus Aktif yang bisa disinkronkan.');
    }

    const products = await this.getProducts();
    const active = products.filter((p) => p.is_active);
    const existingKeys = new Set(
      entries.map((e) => `${e.product_id}:${e.part_id ?? 'fg'}`),
    );

    const newRows: Array<Record<string, unknown>> = [];
    for (const prod of active) {
      if (!existingKeys.has(`${prod.id}:fg`)) {
        newRows.push({
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
          operator_name: '',
          notes: '',
          is_submitted: false,
        });
      }
      for (const part of prod.parts) {
        if (!existingKeys.has(`${prod.id}:${part.id}`)) {
          newRows.push({
            session_id: sessionId,
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
            operator_name: '',
            notes: '',
            is_submitted: false,
          });
        }
      }
    }

    if (newRows.length > 0) {
      const { error } = await client.from('opname_entries').insert(newRows);
      if (error) handleSbError(error, 'Gagal menyinkronkan master ke sesi.');
    }
    return { addedCount: newRows.length };
  },

  async closeSession(sessionId: number): Promise<{ ok: boolean; closed_at: string }> {
    const client = getClient();
    const closedAt = new Date().toISOString();
    const { error } = await client
      .from('opname_sessions')
      .update({ status: 'closed', closed_at: closedAt })
      .eq('id', sessionId);
    if (error) handleSbError(error, 'Gagal mengunci sesi.');
    return { ok: true, closed_at: closedAt };
  },

  async reopenSession(sessionId: number): Promise<{ ok: boolean }> {
    const client = getClient();
    const { error } = await client
      .from('opname_sessions')
      .update({ status: 'active', closed_at: null })
      .eq('id', sessionId);
    if (error) handleSbError(error, 'Gagal membuka ulang sesi.');
    return { ok: true };
  },

  async deleteSession(sessionId: number): Promise<{ ok: boolean }> {
    const client = getClient();
    const { error } = await client
      .from('opname_sessions')
      .delete()
      .eq('id', sessionId);
    if (error) handleSbError(error, 'Gagal menghapus sesi.');
    return { ok: true };
  },
};
