import React, { useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import { exportSessionToExcel } from '../lib/excelExport.ts';
import type { OpnameSession } from '../types.ts';

interface AdminSessionsViewProps {
  sessions: OpnameSession[];
  onRefresh: () => Promise<void>;
  onOpenSessionInOpname: (sessionId: number) => void;
}

const MONTH_NAMES = [
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

function suggestPeriodLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-');
  const idx = Number(m) - 1;
  if (idx >= 0 && idx < 12) return `${MONTH_NAMES[idx]} ${y}`;
  return yyyyMm;
}

function getTodayDotDate(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(-2)}`;
}

export function AdminSessionsView({
  sessions,
  onRefresh,
  onOpenSessionInOpname,
}: AdminSessionsViewProps) {
  const defaultMonth = new Date().toISOString().slice(0, 7);
  const [createOpen, setCreateOpen] = useState(false);
  const [periodMonth, setPeriodMonth] = useState(defaultMonth);
  const [periodLabel, setPeriodLabel] = useState(suggestPeriodLabel(defaultMonth));
  const [opnameDate, setOpnameDate] = useState(getTodayDotDate());
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [busySessionId, setBusySessionId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<OpnameSession | null>(null);

  const handleMonthChange = (val: string) => {
    setPeriodMonth(val);
    setPeriodLabel(suggestPeriodLabel(val));
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!periodMonth || !periodLabel.trim()) {
      setCreateError('Periode bulan dan nama sesi wajib diisi.');
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const created = await api.createSession({
        period_month: periodMonth,
        period_label: periodLabel.trim(),
        opname_date: opnameDate.trim() || getTodayDotDate(),
        notes: notes.trim(),
      });
      await onRefresh();
      setCreateOpen(false);
      setNotes('');
      setFeedback(
        `Sesi "${created.period_label}" berhasil dibuat dan siap diisi operator.`,
      );
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Gagal membuat sesi.');
    } finally {
      setCreating(false);
    }
  };

  const handleExport = async (session: OpnameSession) => {
    setBusySessionId(session.id);
    try {
      const data = await api.getSessionEntries(session.id);
      exportSessionToExcel(data.session, data.entries);
      setFeedback(
        `File Excel untuk sesi "${session.period_label}" berhasil diunduh.`,
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal mengekspor Excel.');
    } finally {
      setBusySessionId(null);
    }
  };

  const handleSyncMaster = async (session: OpnameSession) => {
    setBusySessionId(session.id);
    try {
      const res = await api.syncSessionMaster(session.id);
      await onRefresh();
      setFeedback(
        res.addedCount > 0
          ? `${res.addedCount} baris baru dari master ditambahkan ke sesi "${session.period_label}".`
          : `Semua item master sudah sinkron pada sesi "${session.period_label}".`,
      );
    } finally {
      setBusySessionId(null);
    }
  };

  const handleCloseSession = async (session: OpnameSession) => {
    setBusySessionId(session.id);
    try {
      await api.closeSession(session.id);
      await onRefresh();
      setFeedback(`Sesi "${session.period_label}" dikunci dan masuk ke arsip.`);
    } finally {
      setBusySessionId(null);
    }
  };

  const handleReopenSession = async (session: OpnameSession) => {
    setBusySessionId(session.id);
    try {
      await api.reopenSession(session.id);
      await onRefresh();
      setFeedback(`Sesi "${session.period_label}" dibuka kembali.`);
    } finally {
      setBusySessionId(null);
    }
  };

  const handleDeleteSession = async () => {
    if (!confirmDelete) return;
    setBusySessionId(confirmDelete.id);
    try {
      await api.deleteSession(confirmDelete.id);
      setConfirmDelete(null);
      await onRefresh();
    } finally {
      setBusySessionId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Sesi Opname Bulanan &amp; Arsip Riwayat
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Buka periode opname baru tiap bulan, kunci sesi setelah selesai, dan tarik
            laporan Microsoft Excel (.xlsx) kapan saja.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreateError(null);
            setCreateOpen(true);
          }}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-medium text-white transition hover:bg-blue-800 whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" />
          Buka Sesi Bulan Baru
        </button>
      </div>

      {feedback && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{feedback}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="rounded p-1 hover:bg-emerald-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-slate-900">
            Belum ada sesi opname yang tercatat.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="px-4 py-3">Periode Sesi</th>
                  <th className="px-3 py-3">DATE</th>
                  <th className="px-3 py-3">PREPARED BY</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Baris Terisi</th>
                  <th className="px-3 py-3 text-right">QTY OK</th>
                  <th className="px-3 py-3 text-right">QTY NC</th>
                  <th className="px-3 py-3 text-right">TOTAL</th>
                  <th className="px-4 py-3 text-right">Aksi Admin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessions.map((s) => {
                  const total = s.total_items ?? 0;
                  const counted = s.counted_items ?? 0;
                  const sumOk = s.sum_qty_ok ?? 0;
                  const sumNc = s.sum_qty_nc ?? 0;
                  const sumTotal = s.sum_total_qty ?? 0;
                  const isBusy = busySessionId === s.id;

                  return (
                    <tr key={s.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-slate-900">
                          {s.period_label}
                        </div>
                        {s.notes && (
                          <div className="mt-0.5 text-xs text-slate-500">{s.notes}</div>
                        )}
                      </td>

                      <td className="px-3 py-3.5 font-mono text-xs text-slate-600 whitespace-nowrap">
                        {s.opname_date}
                      </td>

                      <td className="px-3 py-3.5 text-xs whitespace-nowrap">
                        {s.prepared_by ? (
                          <span className="font-semibold text-slate-800">
                            {s.prepared_by}
                          </span>
                        ) : (
                          <span className="text-slate-400">Belum disubmit</span>
                        )}
                      </td>

                      <td className="px-3 py-3.5 whitespace-nowrap">
                        {s.status === 'active' ? (
                          <span className="text-xs font-semibold text-emerald-700">
                            Aktif
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-slate-600">
                            Terkunci (Arsip)
                          </span>
                        )}
                      </td>

                      <td className="px-3 py-3.5 text-right font-mono tabular-nums text-slate-800">
                        {counted}/{total}
                      </td>

                      <td className="px-3 py-3.5 text-right font-mono tabular-nums text-emerald-700">
                        {sumOk}
                      </td>

                      <td className="px-3 py-3.5 text-right font-mono tabular-nums text-red-700">
                        {sumNc}
                      </td>

                      <td className="px-3 py-3.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                        {sumTotal}
                      </td>

                      <td className="px-4 py-3.5 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleExport(s)}
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-700 px-3 text-xs font-medium text-white transition hover:bg-blue-800 disabled:opacity-60 whitespace-nowrap shrink-0"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Export Excel
                          </button>

                          <button
                            type="button"
                            onClick={() => onOpenSessionInOpname(s.id)}
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 whitespace-nowrap shrink-0"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Detail
                          </button>

                          {s.status === 'active' ? (
                            <>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleSyncMaster(s)}
                                title="Tambahkan model/part master baru ke sesi aktif ini"
                                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 whitespace-nowrap shrink-0"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                                Sinkron Master
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleCloseSession(s)}
                                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-800 transition hover:bg-amber-100 whitespace-nowrap shrink-0"
                              >
                                <Lock className="h-3.5 w-3.5" />
                                Kunci
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleReopenSession(s)}
                              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 whitespace-nowrap shrink-0"
                            >
                              <Unlock className="h-3.5 w-3.5" />
                              Buka Kembali
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setConfirmDelete(s)}
                            aria-label={`Hapus sesi ${s.period_label}`}
                            className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 text-red-600 transition hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Session Modal */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                Buka Sesi Opname Bulanan
              </h3>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSession} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Bulan Periode
                  </label>
                  <input
                    type="month"
                    required
                    value={periodMonth}
                    onChange={(e) => handleMonthChange(e.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    DATE (Form)
                  </label>
                  <input
                    type="text"
                    required
                    value={opnameDate}
                    onChange={(e) => setOpnameDate(e.target.value)}
                    placeholder="29.10.26"
                    className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm outline-none focus:border-blue-600"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Nama Periode Sesi
                </label>
                <input
                  type="text"
                  required
                  value={periodLabel}
                  onChange={(e) => setPeriodLabel(e.target.value)}
                  placeholder="Contoh: Desember 2026"
                  className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Catatan Sesi (Opsional)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Misal: Opname akhir bulan line ASSY"
                  className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-blue-600"
                />
              </div>
              <p className="text-xs text-slate-500">
                Seluruh Master Model dan Part aktif akan otomatis disalin ke dalam
                daftar hitung sesi ini.
              </p>

              {createError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                  {createError}
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
                >
                  {creating ? 'Membuat...' : 'Buat & Aktifkan Sesi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Session Confirmation */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
            <h3 className="text-base font-semibold text-slate-900">Hapus Sesi Opname?</h3>
            <p className="mt-2 text-sm text-slate-600">
              Seluruh catatan hasil hitung pada sesi{' '}
              <strong>{confirmDelete.period_label}</strong> akan dihapus permanen.
            </p>
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleDeleteSession}
                className="h-10 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700"
              >
                Ya, Hapus Sesi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
