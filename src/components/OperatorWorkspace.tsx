import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Download,
  Loader2,
  Lock,
  MapPin,
  Maximize2,
  Pencil,
  Search,
  Send,
  User,
  X,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import { exportSessionToExcel } from '../lib/excelExport.ts';
import type {
  InventoryLocation,
  OpnameEntry,
  OpnameSession,
  UserRole,
} from '../types.ts';

interface OperatorWorkspaceProps {
  sessions: OpnameSession[];
  locations: InventoryLocation[];
  selectedSessionId: number | null;
  onSelectSession: (id: number) => void;
  role: UserRole;
  onOpenAdminSessions: () => void;
  onEntriesUpdated: () => void;
}

type EntryFilter = 'all' | 'uncounted' | 'counted' | 'has_nc';

interface ModelLocationSheet {
  key: string;
  location: string;
  isSubmitted: boolean;
  operatorName: string;
  entries: OpnameEntry[];
}

interface ModelGroup {
  productId: number;
  modelName: string;
  sapCode: string;
  sheets: ModelLocationSheet[];
  submittedLocations: string[];
  hasOpenDraft: boolean;
}

interface DraftRowValues {
  qty_ok: string;
  qty_ok_2: string;
  qty_nc: string;
  notes: string;
}

export function OperatorWorkspace({
  sessions,
  locations,
  selectedSessionId,
  onSelectSession,
  role,
  onOpenAdminSessions,
  onEntriesUpdated,
}: OperatorWorkspaceProps) {
  const [session, setSession] = useState<OpnameSession | null>(null);
  const [entries, setEntries] = useState<OpnameEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocationFilter, setSelectedLocationFilter] = useState<string>('all');
  const [selectedModelFilter, setSelectedModelFilter] = useState<string>('all');
  const [filter, setFilter] = useState<EntryFilter>('all');

  // Active opened model modal & active location tab within that modal
  const [activeModalProductId, setActiveModalProductId] = useState<number | null>(null);
  const [activeSheetKey, setActiveSheetKey] = useState<string>('draft:');

  const [drafts, setDrafts] = useState<Record<number, DraftRowValues>>({});
  const [saveState, setSaveState] = useState<
    Record<number, 'saving' | 'saved' | 'error'>
  >({});

  // Per-model + per-location submit modal state
  const [submitTarget, setSubmitTarget] = useState<{
    group: ModelGroup;
    sheet: ModelLocationSheet;
  } | null>(null);
  const [submitLocation, setSubmitLocation] = useState('');
  const [submitName, setSubmitName] = useState('');
  const [submitConfirmed, setSubmitConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reopeningKey, setReopeningKey] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitBanner, setSubmitBanner] = useState<string | null>(null);

  const timersRef = useRef<Record<number, number>>({});
  const pendingPayloadsRef = useRef<Record<number, DraftRowValues>>({});

  useEffect(() => {
    if (!selectedSessionId) {
      setSession(null);
      setEntries([]);
      setActiveModalProductId(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSubmitBanner(null);
    setActiveModalProductId(null);

    const applyEntriesData = (res: { session: OpnameSession; entries: OpnameEntry[] }) => {
      if (cancelled) return;
      setSession(res.session);
      setEntries(res.entries);
      setDrafts((prevDrafts) => {
        const map: Record<number, DraftRowValues> = {};
        for (const item of res.entries) {
          // Preserve in-flight local edits while typing
          if (pendingPayloadsRef.current[item.id] && prevDrafts[item.id]) {
            map[item.id] = prevDrafts[item.id];
          } else {
            map[item.id] = {
              qty_ok: item.qty_ok !== null ? String(item.qty_ok) : '',
              qty_ok_2: item.qty_ok_2 !== null ? String(item.qty_ok_2) : '',
              qty_nc: item.qty_nc !== null ? String(item.qty_nc) : '',
              notes: item.notes || '',
            };
          }
        }
        return map;
      });
    };

    api
      .getSessionEntries(selectedSessionId)
      .then((res) => {
        applyEntriesData(res);
        if (!cancelled) setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : 'Gagal memuat daftar form opname.',
        );
        setLoading(false);
      });

    const unsubscribe = api.subscribeSessionEntries(selectedSessionId, () => {
      api
        .getSessionEntries(selectedSessionId)
        .then(applyEntriesData)
        .catch(() => {
          // Keep current view if background realtime refresh transiently fails
        });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [selectedSessionId]);

  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach((timerId) =>
        window.clearTimeout(timerId),
      );
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (submitTarget) {
          setSubmitTarget(null);
        } else if (activeModalProductId !== null) {
          setActiveModalProductId(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [submitTarget, activeModalProductId]);

  const persistRow = async (entryId: number, draft: DraftRowValues) => {
    if (!session || session.status !== 'active') return;
    setSaveState((prev) => ({ ...prev, [entryId]: 'saving' }));

    const toNullableNum = (s: string): number | null => {
      const trimmed = s.trim();
      if (trimmed === '') return null;
      const n = Math.round(Number(trimmed));
      return Number.isFinite(n) && n >= 0 ? n : null;
    };

    try {
      const updated = await api.updateEntry(session.id, entryId, {
        qty_ok: toNullableNum(draft.qty_ok),
        qty_ok_2: toNullableNum(draft.qty_ok_2),
        qty_nc: toNullableNum(draft.qty_nc),
        notes: draft.notes,
      });
      delete pendingPayloadsRef.current[entryId];
      setEntries((prev) => prev.map((e) => (e.id === entryId ? updated : e)));
      setSaveState((prev) => ({ ...prev, [entryId]: 'saved' }));
      onEntriesUpdated();
    } catch {
      setSaveState((prev) => ({ ...prev, [entryId]: 'error' }));
    }
  };

  const updateDraftField = (
    entry: OpnameEntry,
    field: keyof DraftRowValues,
    value: string,
  ) => {
    if (!session || session.status !== 'active' || entry.is_submitted) return;
    if (field !== 'notes' && value !== '' && !/^\d+$/.test(value)) return;

    const prevRow = drafts[entry.id] ?? {
      qty_ok: entry.qty_ok !== null ? String(entry.qty_ok) : '',
      qty_ok_2: entry.qty_ok_2 !== null ? String(entry.qty_ok_2) : '',
      qty_nc: entry.qty_nc !== null ? String(entry.qty_nc) : '',
      notes: entry.notes || '',
    };

    const nextRow: DraftRowValues = { ...prevRow, [field]: value };
    setDrafts((prev) => ({ ...prev, [entry.id]: nextRow }));
    pendingPayloadsRef.current[entry.id] = nextRow;

    if (timersRef.current[entry.id]) {
      window.clearTimeout(timersRef.current[entry.id]);
    }
    setSaveState((prev) => ({ ...prev, [entry.id]: 'saving' }));
    timersRef.current[entry.id] = window.setTimeout(() => {
      void persistRow(entry.id, nextRow);
    }, 350);
  };

  const getRowSummary = (entry: OpnameEntry) => {
    const d = drafts[entry.id];
    const okStr = d ? d.qty_ok : entry.qty_ok !== null ? String(entry.qty_ok) : '';
    const ok2Str = d
      ? d.qty_ok_2
      : entry.qty_ok_2 !== null
        ? String(entry.qty_ok_2)
        : '';
    const ncStr = d ? d.qty_nc : entry.qty_nc !== null ? String(entry.qty_nc) : '';

    const hasAny = okStr !== '' || ok2Str !== '' || ncStr !== '';
    const ok = okStr !== '' ? Number(okStr) : 0;
    const ok2 = ok2Str !== '' ? Number(ok2Str) : 0;
    const nc = ncStr !== '' ? Number(ncStr) : 0;
    const total = hasAny ? ok + ok2 + nc : null;

    return { okStr, ok2Str, ncStr, hasAny, ok, ok2, nc, total };
  };

  // Group all entries by Model -> Location Sheets (submitted locked sheets + open draft sheets)
  const allModelsMap = useMemo(() => {
    const rawByModel = new Map<number, OpnameEntry[]>();
    for (const e of entries) {
      const list = rawByModel.get(e.product_id) ?? [];
      list.push(e);
      rawByModel.set(e.product_id, list);
    }

    const result = new Map<number, ModelGroup>();

    rawByModel.forEach((modelEntries, productId) => {
      const fg = modelEntries.find((e) => e.item_type === 'finished_good');
      const modelName = fg?.model_name || modelEntries[0]?.model_name || '';
      const sapCode = fg?.sap_code || '';

      const sheetsMap = new Map<string, ModelLocationSheet>();
      for (const e of modelEntries) {
        const isSub = Boolean(e.is_submitted);
        const loc = e.location || '';
        const key = `${isSub ? 'locked' : 'draft'}:${loc}`;
        const existingSheet = sheetsMap.get(key);
        if (existingSheet) {
          existingSheet.entries.push(e);
          if (!existingSheet.operatorName && e.operator_name) {
            existingSheet.operatorName = e.operator_name;
          }
        } else {
          sheetsMap.set(key, {
            key,
            location: loc,
            isSubmitted: isSub,
            operatorName: e.operator_name || '',
            entries: [e],
          });
        }
      }

      // Sort sheets: editable open/reopened sheets first, then locked submitted sheets alphabetically
      const sheets = Array.from(sheetsMap.values()).sort((a, b) => {
        if (a.isSubmitted !== b.isSubmitted) return a.isSubmitted ? 1 : -1;
        if (a.location === '' && b.location !== '') return -1;
        if (a.location !== '' && b.location === '') return 1;
        return a.location.localeCompare(b.location);
      });

      const submittedLocations = sheets
        .filter((s) => s.isSubmitted && s.location)
        .map((s) => s.location);
      const hasOpenDraft = sheets.some((s) => !s.isSubmitted);

      result.set(productId, {
        productId,
        modelName,
        sapCode,
        sheets,
        submittedLocations,
        hasOpenDraft,
      });
    });

    return result;
  }, [entries]);

  const locationOptions = useMemo(() => {
    const set = new Set<string>();
    allModelsMap.forEach((group) => {
      for (const loc of group.submittedLocations) {
        set.add(loc);
      }
    });
    return Array.from(set).sort();
  }, [allModelsMap]);

  const modelOptions = useMemo(() => {
    const set = new Set<string>();
    allModelsMap.forEach((group) => {
      if (
        selectedLocationFilter !== 'all' &&
        !group.submittedLocations.includes(selectedLocationFilter)
      ) {
        return;
      }
      set.add(group.modelName);
    });
    return Array.from(set);
  }, [allModelsMap, selectedLocationFilter]);

  const stats = useMemo(() => {
    let totalRows = 0;
    let counted = 0;
    let sumOk = 0;
    let sumNc = 0;
    let sumTotal = 0;

    allModelsMap.forEach((group) => {
      const hasAnySubmitted = group.submittedLocations.length > 0;
      for (const sheet of group.sheets) {
        const sheetHasCount = sheet.entries.some((item) => getRowSummary(item).hasAny);
        // Ignore completely empty placeholder sheets waiting for other locations once >=1 location is submitted
        if (!sheet.isSubmitted && !sheet.location && !sheetHasCount && hasAnySubmitted) {
          continue;
        }
        for (const item of sheet.entries) {
          totalRows += 1;
          const s = getRowSummary(item);
          if (s.hasAny) {
            counted += 1;
            sumOk += s.ok + s.ok2;
            sumNc += s.nc;
            sumTotal += s.total ?? 0;
          }
        }
      }
    });

    const pct = totalRows > 0 ? Math.round((counted / totalRows) * 100) : 0;
    return { totalRows, counted, sumOk, sumNc, sumTotal, pct };
  }, [allModelsMap, drafts]);

  const groupedModels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const result: ModelGroup[] = [];

    allModelsMap.forEach((group) => {
      if (
        selectedLocationFilter !== 'all' &&
        !group.submittedLocations.includes(selectedLocationFilter)
      ) {
        return;
      }
      if (selectedModelFilter !== 'all' && group.modelName !== selectedModelFilter) {
        return;
      }

      const relevantEntries = group.sheets.flatMap((s) => s.entries);
      const hasMatchingEntry = relevantEntries.some((entry) => {
        const rowSum = getRowSummary(entry);
        if (filter === 'uncounted' && (entry.is_submitted || rowSum.hasAny)) {
          return false;
        }
        if (filter === 'counted' && !rowSum.hasAny && !entry.is_submitted) {
          return false;
        }
        if (filter === 'has_nc' && rowSum.nc <= 0) {
          return false;
        }

        if (query) {
          const haystack = [
            entry.model_name,
            entry.location,
            entry.sap_code,
            entry.parts_name,
            entry.section,
          ]
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      });

      if (hasMatchingEntry) {
        result.push(group);
      }
    });

    return result;
  }, [
    allModelsMap,
    drafts,
    selectedLocationFilter,
    selectedModelFilter,
    filter,
    searchQuery,
  ]);

  const activeModalGroup = useMemo(() => {
    if (activeModalProductId === null) return null;
    return allModelsMap.get(activeModalProductId) ?? null;
  }, [allModelsMap, activeModalProductId]);

  const activeSheet = useMemo(() => {
    if (!activeModalGroup) return null;
    return (
      activeModalGroup.sheets.find((s) => s.key === activeSheetKey) ??
      activeModalGroup.sheets[0] ??
      null
    );
  }, [activeModalGroup, activeSheetKey]);

  const openModelModal = (group: ModelGroup, preferredSheetKey?: string) => {
    let targetKey = preferredSheetKey;
    if (!targetKey && selectedLocationFilter !== 'all') {
      const match = group.sheets.find(
        (s) => s.location === selectedLocationFilter,
      );
      if (match) targetKey = match.key;
    }
    if (!targetKey) {
      targetKey = group.sheets[0]?.key ?? 'draft:';
    }
    setActiveSheetKey(targetKey);
    setActiveModalProductId(group.productId);
  };

  const openSubmitDialog = (group: ModelGroup, sheet: ModelLocationSheet) => {
    setSubmitError(null);
    setSubmitConfirmed(false);
    setSubmitName(sheet.operatorName || '');
    // If editing a previously submitted & reopened location, default to that location; otherwise force explicit pick
    setSubmitLocation(sheet.location || '');
    setSubmitTarget({ group, sheet });
  };

  const handleConfirmSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !submitTarget) return;

    const { group, sheet } = submitTarget;

    if (!submitConfirmed) {
      setSubmitError(
        'Centang pernyataan konfirmasi untuk memastikan data sudah sesuai perhitungan.',
      );
      return;
    }

    const cleanedLocation = submitLocation.trim();
    if (!cleanedLocation) {
      setSubmitError('Pilih lokasi inventory barang ini terlebih dahulu.');
      return;
    }

    const isLockedElsewhere = group.sheets.some(
      (s) =>
        s.isSubmitted &&
        s.location.toLowerCase() === cleanedLocation.toLowerCase(),
    );
    if (isLockedElsewhere) {
      setSubmitError(
        `Lokasi "${cleanedLocation}" untuk model ini sudah disubmit dan terkunci. Pilih lokasi lain.`,
      );
      return;
    }

    const cleanedName = submitName.trim();
    if (!cleanedName) {
      setSubmitError('Masukkan nama Anda untuk kolom PREPARED BY.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      // Flush any debounced unsaved rows belonging to this sheet before submitting
      const sheetEntryIds = new Set(sheet.entries.map((item) => item.id));
      const pendingIds = Object.keys(pendingPayloadsRef.current)
        .map(Number)
        .filter((id) => sheetEntryIds.has(id));

      for (const id of pendingIds) {
        if (timersRef.current[id]) {
          window.clearTimeout(timersRef.current[id]);
          delete timersRef.current[id];
        }
        const payload = pendingPayloadsRef.current[id];
        if (payload) {
          await persistRow(id, payload);
        }
      }

      const res = await api.submitSession(
        session.id,
        cleanedName,
        group.productId,
        cleanedLocation,
        sheet.location,
      );
      setSession(res.session);
      setEntries(res.entries);

      // Sync drafts map cleanly so the new blank sheet (if opened for other locations) starts blank
      const nextDrafts: Record<number, DraftRowValues> = {};
      for (const item of res.entries) {
        nextDrafts[item.id] = {
          qty_ok: item.qty_ok !== null ? String(item.qty_ok) : '',
          qty_ok_2: item.qty_ok_2 !== null ? String(item.qty_ok_2) : '',
          qty_nc: item.qty_nc !== null ? String(item.qty_nc) : '',
          notes: item.notes || '',
        };
      }
      setDrafts(nextDrafts);

      setSubmitBanner(
        `Model "${group.modelName}" berhasil disubmit untuk lokasi ${cleanedLocation} (terkunci) · Terbuka untuk lokasi lain.`,
      );
      setSubmitTarget(null);
      setActiveModalProductId(null);
      onEntriesUpdated();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Gagal mengirim data model.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleReopenLocation = async (
    group: ModelGroup,
    locationName: string,
  ) => {
    if (!session || session.status !== 'active') return;
    const lockKey = `${group.productId}:${locationName}`;
    setReopeningKey(lockKey);
    try {
      const res = await api.reopenModel(
        session.id,
        group.productId,
        locationName,
      );
      setSession(res.session);
      setEntries(res.entries);
      setActiveSheetKey(`draft:${locationName}`);
      setActiveModalProductId(group.productId);
      setSubmitBanner(
        `Mode edit dibuka untuk model "${group.modelName}" lokasi ${locationName}. Klik Submit kembali setelah selesai mengubah.`,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Gagal membuka mode edit lokasi.',
      );
    } finally {
      setReopeningKey(null);
    }
  };

  const targetModalStats = useMemo(() => {
    if (!submitTarget) return { counted: 0, totalRows: 0, sumOk: 0, sumNc: 0 };
    const sheetEntries = submitTarget.sheet.entries;
    let counted = 0;
    let sumOk = 0;
    let sumNc = 0;
    for (const item of sheetEntries) {
      const s = getRowSummary(item);
      if (s.hasAny) {
        counted += 1;
        sumOk += s.ok + s.ok2;
        sumNc += s.nc;
      }
    }
    return { counted, totalRows: sheetEntries.length, sumOk, sumNc };
  }, [submitTarget, drafts]);

  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
        <h2 className="text-lg font-semibold text-slate-900">
          Belum Ada Sesi Stock Opname
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
          Admin perlu membuka sesi opname bulanan terlebih dahulu agar form daftar
          model dan part siap diisi operator.
        </p>
        {role === 'admin' && (
          <button
            type="button"
            onClick={onOpenAdminSessions}
            className="mt-5 inline-flex h-10 items-center rounded-lg bg-blue-700 px-4 text-sm font-medium text-white transition hover:bg-blue-800 whitespace-nowrap shrink-0"
          >
            Buka Sesi Opname Bulanan
          </button>
        )}
      </div>
    );
  }

  const isSessionReadOnly = session?.status !== 'active';

  return (
    <div className="space-y-6">
      {/* Header Sheet Metadata & Progress */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 lg:max-w-2xl">
            <div>
              <label
                htmlFor="session-select"
                className="block text-xs font-medium text-slate-600"
              >
                Periode Sesi Opname
              </label>
              <select
                id="session-select"
                value={selectedSessionId ?? ''}
                onChange={(e) => {
                  setSelectedLocationFilter('all');
                  setSelectedModelFilter('all');
                  setActiveModalProductId(null);
                  onSelectSession(Number(e.target.value));
                }}
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.period_label} —{' '}
                    {s.status === 'active' ? 'Aktif (Bisa Diisi)' : 'Terkunci (Arsip)'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="block text-xs font-medium text-slate-600">DATE</div>
              <div className="mt-1.5 flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-sm text-slate-800">
                <Calendar className="h-4 w-4 text-slate-400" />
                <span>{session?.opname_date || '-'}</span>
              </div>
            </div>
          </div>

          {session && role === 'admin' && entries.length > 0 && (
            <button
              type="button"
              onClick={() => exportSessionToExcel(session, entries)}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Download className="h-4 w-4" />
              Export Excel (.xlsx)
            </button>
          )}
        </div>

        {/* Progress & Summary Metrics */}
        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <span>
              Progres Pengisian:{' '}
              <strong className="font-mono tabular-nums text-slate-900">
                {stats.counted}
              </strong>{' '}
              dari{' '}
              <strong className="font-mono tabular-nums text-slate-900">
                {stats.totalRows}
              </strong>{' '}
              baris (SET &amp; Part)
            </span>
            <span className="font-mono font-semibold tabular-nums text-slate-900">
              {stats.pct}%
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-blue-700 transition-all duration-300"
              style={{ width: `${stats.pct}%` }}
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
              <p className="text-xs text-slate-500">Baris Terisi</p>
              <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-slate-900">
                {stats.counted}/{stats.totalRows}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
              <p className="text-xs text-slate-500">Total QTY OK (1+2)</p>
              <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-emerald-700">
                {stats.sumOk}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
              <p className="text-xs text-slate-500">Total QTY NC</p>
              <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-red-700">
                {stats.sumNc}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
              <p className="text-xs text-slate-500">Grand Total</p>
              <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-blue-700">
                {stats.sumTotal}
              </p>
            </div>
          </div>
        </div>
      </div>

      {submitBanner && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{submitBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setSubmitBanner(null)}
            className="rounded p-1 hover:bg-emerald-100"
            aria-label="Tutup pemberitahuan"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Filter & Model Search Bar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-2.5 sm:flex-row">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari Model, SAP Code, Parts Name..."
              className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          {locationOptions.length > 0 && (
            <select
              value={selectedLocationFilter}
              onChange={(e) => {
                setSelectedLocationFilter(e.target.value);
                setSelectedModelFilter('all');
              }}
              aria-label="Filter berdasarkan Location"
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-600"
            >
              <option value="all">Semua Location ({locationOptions.length})</option>
              {locationOptions.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          )}

          {modelOptions.length > 1 && (
            <select
              value={selectedModelFilter}
              onChange={(e) => setSelectedModelFilter(e.target.value)}
              aria-label="Filter berdasarkan Model"
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-600"
            >
              <option value="all">Semua Model ({modelOptions.length})</option>
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="inline-flex items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-100 p-1">
          {(
            [
              ['all', 'Semua'],
              ['uncounted', 'Belum Diisi'],
              ['counted', 'Sudah Diisi'],
              ['has_nc', 'Ada QTY NC'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition whitespace-nowrap shrink-0 ${
                filter === key
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Clickable Model Cards Grid (Click to open zoomed modal) */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {[1, 2, 3, 4].map((skeleton) => (
            <div
              key={skeleton}
              className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white"
            />
          ))}
        </div>
      ) : error ? (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : groupedModels.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-slate-900">
            Tidak ada baris item yang cocok dengan pencarian atau filter.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {groupedModels.map((group) => {
            // Primary sheet shown on card progress: first open sheet, or first submitted sheet
            const primarySheet = group.sheets[0];
            const filledCount = primarySheet
              ? primarySheet.entries.filter((e) => getRowSummary(e).hasAny).length
              : 0;
            const totalSheetRows = primarySheet ? primarySheet.entries.length : 0;
            const pct =
              totalSheetRows > 0
                ? Math.round((filledCount / totalSheetRows) * 100)
                : 0;
            const submittedSheets = group.sheets.filter((s) => s.isSubmitted);

            return (
              <div
                key={group.productId}
                onClick={() => openModelModal(group)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openModelModal(group);
                  }
                }}
                className="group flex cursor-pointer flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-blue-400 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2">
                      {group.sapCode && (
                        <>
                          <span className="font-mono text-xs font-semibold text-blue-700">
                            {group.sapCode}
                          </span>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                        </>
                      )}
                      <h3 className="truncate text-sm font-semibold text-slate-900 group-hover:text-blue-700">
                        {group.modelName}
                      </h3>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                      <span className="font-mono tabular-nums text-slate-700">
                        {filledCount}/{totalSheetRows} terisi ({pct}%)
                      </span>
                      {submittedSheets.length > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                            <Lock className="h-3 w-3" />
                            Terkunci:{' '}
                            {submittedSheets
                              .map((s) => `${s.location} (${s.operatorName})`)
                              .join(', ')}
                          </span>
                        </>
                      )}
                      {group.hasOpenDraft ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-blue-700 font-medium">
                            {submittedSheets.length > 0
                              ? 'Terbuka untuk lokasi lain'
                              : 'Belum disubmit'}
                          </span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-emerald-700">
                            Semua lokasi selesai
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div
                    className="flex shrink-0 items-center gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => openModelModal(group)}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-700 transition group-hover:border-blue-200 group-hover:bg-blue-50 group-hover:text-blue-700 whitespace-nowrap"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                      Buka
                    </button>
                  </div>
                </div>

                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      submittedSheets.length > 0 && !group.hasOpenDraft
                        ? 'bg-emerald-600'
                        : 'bg-blue-700'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Zoom-In Model Sheet Modal (Scale from small to full size + X close button) */}
      <AnimatePresence>
        {activeModalGroup && activeSheet && (
          <motion.div
            key="model-sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setActiveModalProductId(null)}
            className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4 lg:p-6 backdrop-blur-[1px]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="model-modal-title"
          >
            <motion.div
              key={`model-sheet-${activeModalGroup.productId}`}
              initial={{ opacity: 0, scale: 0.86, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 8 }}
              transition={{
                type: 'spring',
                stiffness: 360,
                damping: 28,
                mass: 0.75,
              }}
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
            >
              {/* Modal Top Header with Prominent X Close Button */}
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3.5 sm:px-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-sm">
                    {activeModalGroup.sapCode && (
                      <>
                        <span className="font-mono text-xs font-semibold text-blue-700">
                          {activeModalGroup.sapCode}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                      </>
                    )}
                    <h3
                      id="model-modal-title"
                      className="text-base font-semibold text-slate-900"
                    >
                      {activeModalGroup.modelName}
                    </h3>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                    <span className="font-mono tabular-nums text-slate-700">
                      {
                        activeSheet.entries.filter((e) => getRowSummary(e).hasAny)
                          .length
                      }
                      /{activeSheet.entries.length} baris terisi
                    </span>
                    {activeSheet.isSubmitted ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                          <Lock className="h-3 w-3" />
                          Lokasi Terkunci: {activeSheet.location} · PREPARED BY:{' '}
                          {activeSheet.operatorName || '-'}
                        </span>
                      </>
                    ) : activeSheet.location ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium text-blue-700">
                          Mode Edit Lokasi: {activeSheet.location}
                        </span>
                      </>
                    ) : (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Input untuk lokasi baru yang belum disubmit</span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveModalProductId(null)}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                  aria-label="Tutup model"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Per-Location Sheet Switcher (shows locked submitted locations + open location slot) */}
              {activeModalGroup.sheets.length > 1 && (
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5 sm:px-5">
                  <span className="text-xs font-medium text-slate-500">
                    Sheet Lokasi:
                  </span>
                  {activeModalGroup.sheets.map((sheet) => {
                    const isSelected = sheet.key === activeSheet.key;
                    return (
                      <button
                        key={sheet.key}
                        type="button"
                        onClick={() => setActiveSheetKey(sheet.key)}
                        className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition whitespace-nowrap ${
                          isSelected
                            ? sheet.isSubmitted
                              ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                              : 'border-blue-700 bg-blue-50 text-blue-800'
                            : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {sheet.isSubmitted ? (
                          <>
                            <Lock className="h-3 w-3" />
                            <span>
                              {sheet.location} ({sheet.operatorName})
                            </span>
                          </>
                        ) : sheet.location ? (
                          <span>Edit: {sheet.location}</span>
                        ) : (
                          <span>+ Input Lokasi Lain</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Scrollable Sheet Table */}
              <div className="flex-1 overflow-auto">
                {(() => {
                  const modelLocked =
                    isSessionReadOnly || activeSheet.isSubmitted;
                  return (
                    <table className="w-full min-w-[1020px] border-collapse text-left text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-[#234886] text-xs font-semibold text-white">
                          <th className="w-12 px-3 py-2.5 text-center">S/N</th>
                          <th className="w-28 px-3 py-2.5">SAP CODE</th>
                          <th className="px-3 py-2.5">PARTS NAME</th>
                          <th className="w-28 px-3 py-2.5">SECTION</th>
                          <th className="w-16 px-3 py-2.5 text-center">USE</th>
                          <th className="w-24 px-2 py-2.5 text-center">QTY OK</th>
                          <th className="w-24 px-2 py-2.5 text-center">QTY OK 2</th>
                          <th className="w-24 px-2 py-2.5 text-center">QTY NC</th>
                          <th className="w-20 px-3 py-2.5 text-right">TOTAL</th>
                          <th className="w-44 px-3 py-2.5">CATATAN</th>
                          <th className="w-24 px-3 py-2.5 text-right">STATUS</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {activeSheet.entries.map((entry) => {
                          const rowSum = getRowSummary(entry);
                          const rowDraft = drafts[entry.id];
                          const noteStr = rowDraft ? rowDraft.notes : entry.notes || '';
                          const rowState = saveState[entry.id];
                          const isSetRow = entry.item_type === 'finished_good';

                          return (
                            <tr
                              key={entry.id}
                              className={`transition hover:bg-slate-50 ${
                                isSetRow ? 'bg-blue-50/45 font-medium' : 'bg-white'
                              }`}
                            >
                              <td className="px-3 py-2 text-center font-mono text-xs tabular-nums text-slate-600">
                                {entry.sn_order}
                              </td>

                              <td className="px-3 py-2 font-mono text-xs text-slate-800 whitespace-nowrap">
                                {entry.sap_code}
                              </td>

                              <td className="px-3 py-2 text-sm text-slate-900">
                                {entry.parts_name}
                              </td>

                              <td className="px-3 py-2 text-xs text-slate-700 whitespace-nowrap">
                                {entry.section}
                              </td>

                              <td className="px-3 py-2 text-center font-mono text-xs tabular-nums text-slate-700">
                                {entry.use_qty !== null ? entry.use_qty : ''}
                              </td>

                              <td className="px-1.5 py-1.5">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  disabled={modelLocked}
                                  value={rowSum.okStr}
                                  onChange={(e) =>
                                    updateDraftField(entry, 'qty_ok', e.target.value)
                                  }
                                  placeholder="0"
                                  aria-label={`QTY OK ${entry.parts_name}`}
                                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-right font-mono text-sm tabular-nums text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-600"
                                />
                              </td>

                              <td className="px-1.5 py-1.5">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  disabled={modelLocked}
                                  value={rowSum.ok2Str}
                                  onChange={(e) =>
                                    updateDraftField(entry, 'qty_ok_2', e.target.value)
                                  }
                                  placeholder="0"
                                  aria-label={`QTY OK 2 ${entry.parts_name}`}
                                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-right font-mono text-sm tabular-nums text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-600"
                                />
                              </td>

                              <td className="px-1.5 py-1.5">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  disabled={modelLocked}
                                  value={rowSum.ncStr}
                                  onChange={(e) =>
                                    updateDraftField(entry, 'qty_nc', e.target.value)
                                  }
                                  placeholder="0"
                                  aria-label={`QTY NC ${entry.parts_name}`}
                                  className={`h-9 w-full rounded-md border px-2 text-right font-mono text-sm tabular-nums outline-none focus:ring-2 disabled:bg-slate-50 ${
                                    rowSum.nc > 0
                                      ? 'border-red-300 bg-red-50/40 text-red-800 focus:border-red-600 focus:ring-red-600/15'
                                      : 'border-slate-300 bg-white text-slate-900 focus:border-blue-600 focus:ring-blue-600/15'
                                  }`}
                                />
                              </td>

                              <td className="px-3 py-2 text-right font-mono text-sm font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                                {rowSum.total !== null ? rowSum.total : '—'}
                              </td>

                              <td className="px-2 py-1.5">
                                <input
                                  type="text"
                                  disabled={modelLocked}
                                  value={noteStr}
                                  onChange={(e) =>
                                    updateDraftField(entry, 'notes', e.target.value)
                                  }
                                  placeholder="Catatan..."
                                  aria-label={`Catatan ${entry.parts_name}`}
                                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-500"
                                />
                              </td>

                              <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
                                {rowState === 'saving' ? (
                                  <span className="inline-flex items-center gap-1 text-blue-700">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Simpan
                                  </span>
                                ) : rowState === 'error' ? (
                                  <span className="font-medium text-red-700">Gagal</span>
                                ) : activeSheet.isSubmitted ? (
                                  <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                                    <Check className="h-3.5 w-3.5" />
                                    Disubmit
                                  </span>
                                ) : rowSum.hasAny ? (
                                  <span className="inline-flex items-center gap-1 font-medium text-slate-600">
                                    <Check className="h-3.5 w-3.5" />
                                    Draft
                                  </span>
                                ) : (
                                  <span className="text-slate-400">Kosong</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  );
                })()}
              </div>

              {/* Modal Footer */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
                <div className="text-xs text-slate-600">
                  {isSessionReadOnly ? (
                    <span>Sesi opname ini sudah dikunci/diarsipkan.</span>
                  ) : activeSheet.isSubmitted ? (
                    <span>
                      Lokasi <strong className="text-slate-900">{activeSheet.location}</strong>{' '}
                      sudah disubmit oleh{' '}
                      <strong className="text-slate-900">
                        {activeSheet.operatorName}
                      </strong>{' '}
                      dan terkunci.
                    </span>
                  ) : (
                    <span>
                      Angka tersimpan otomatis. Pilih lokasi yang akan disubmit saat
                      menekan Submit.
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setActiveModalProductId(null)}
                    className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                  >
                    Tutup
                  </button>

                  {!isSessionReadOnly &&
                    (activeSheet.isSubmitted ? (
                      <button
                        type="button"
                        disabled={
                          reopeningKey ===
                          `${activeModalGroup.productId}:${activeSheet.location}`
                        }
                        onClick={() =>
                          handleReopenLocation(
                            activeModalGroup,
                            activeSheet.location,
                          )
                        }
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-800 transition hover:bg-slate-100 disabled:opacity-60 whitespace-nowrap"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {reopeningKey ===
                        `${activeModalGroup.productId}:${activeSheet.location}`
                          ? 'Membuka...'
                          : 'Edit Lokasi Ini'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          openSubmitDialog(activeModalGroup, activeSheet)
                        }
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-700 px-4 text-xs font-semibold text-white transition hover:bg-blue-800 whitespace-nowrap"
                      >
                        <Send className="h-3.5 w-3.5" />
                        Submit Model Ini
                      </button>
                    ))}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Small Verification, Location Choice (with Locked Locations) & PREPARED BY Name Form Modal */}
      <AnimatePresence>
        {submitTarget && session && (
          <motion.div
            key="submit-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[1px]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="submit-modal-title"
          >
            <motion.div
              key="submit-modal-panel"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
                <div>
                  <h3
                    id="submit-modal-title"
                    className="text-base font-semibold text-slate-900"
                  >
                    Konfirmasi Submit Model
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {submitTarget.group.modelName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSubmitTarget(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Tutup dialog"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleConfirmSubmit} className="mt-4 space-y-4">
                {/* Quick Summary Box for This Model Sheet */}
                <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                  <div>
                    <div className="text-xs text-slate-500">Baris Terisi</div>
                    <div className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                      {targetModalStats.counted}/{targetModalStats.totalRows}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">QTY OK</div>
                    <div className="font-mono text-sm font-semibold tabular-nums text-emerald-700">
                      {targetModalStats.sumOk}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">QTY NC</div>
                    <div className="font-mono text-sm font-semibold tabular-nums text-red-700">
                      {targetModalStats.sumNc}
                    </div>
                  </div>
                </div>

                {/* Confirmation Sentence */}
                <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3.5 text-xs leading-relaxed text-slate-800">
                  <p className="font-medium text-slate-900">
                    Pastikan kembali seluruh angka QTY OK, QTY OK 2, dan QTY NC pada
                    model ini sudah sesuai dengan hasil perhitungan fisik di lapangan.
                  </p>
                  <label className="mt-3 flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={submitConfirmed}
                      onChange={(e) => setSubmitConfirmed(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                    />
                    <span className="font-semibold text-blue-900">
                      Ya, saya memastikan data sudah sesuai dengan perhitungan.
                    </span>
                  </label>
                </div>

                {/* Location Inventory Selection with Locked Indicator for Already-Submitted Locations */}
                <div>
                  <label
                    htmlFor="submit-location-select"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Pilih Location Inventory *
                  </label>
                  <div className="relative mt-1.5">
                    <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    {locations.length > 0 ? (
                      <select
                        id="submit-location-select"
                        required
                        value={submitLocation}
                        onChange={(e) => setSubmitLocation(e.target.value)}
                        className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm font-medium text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
                      >
                        <option value="">-- Pilih Lokasi yang Akan Disubmit --</option>
                        {locations.map((loc) => {
                          const isLocked = submitTarget.group.sheets.some(
                            (s) =>
                              s.isSubmitted &&
                              s.location.toLowerCase() === loc.name.toLowerCase(),
                          );
                          return (
                            <option
                              key={loc.id}
                              value={loc.name}
                              disabled={isLocked}
                            >
                              {isLocked
                                ? `${loc.name} (Sudah Disubmit — Terkunci)`
                                : loc.name}
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      <input
                        id="submit-location-select"
                        type="text"
                        required
                        value={submitLocation}
                        onChange={(e) => setSubmitLocation(e.target.value)}
                        placeholder="Masukkan nama lokasi..."
                        className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm font-medium text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
                      />
                    )}
                  </div>
                  {submitTarget.group.submittedLocations.length > 0 && (
                    <p className="mt-1.5 flex items-center gap-1 text-xs text-slate-500">
                      <Lock className="h-3 w-3 shrink-0 text-emerald-700" />
                      <span>
                        Lokasi terkunci:{' '}
                        <strong className="text-slate-700">
                          {submitTarget.group.submittedLocations.join(', ')}
                        </strong>
                      </span>
                    </p>
                  )}
                </div>

                {/* Operator Name Input -> Output PREPARED BY */}
                <div>
                  <label
                    htmlFor="prepared-by-name-input"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Masukkan Nama Operator (Output PREPARED BY) *
                  </label>
                  <div className="relative mt-1.5">
                    <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="prepared-by-name-input"
                      type="text"
                      required
                      value={submitName}
                      onChange={(e) => setSubmitName(e.target.value)}
                      placeholder="Contoh: Helen"
                      className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm font-medium text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
                    />
                  </div>
                </div>

                {submitError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                    {submitError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setSubmitTarget(null)}
                    className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:opacity-60"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {submitting ? 'Mengirim...' : 'Konfirmasi & Submit'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
