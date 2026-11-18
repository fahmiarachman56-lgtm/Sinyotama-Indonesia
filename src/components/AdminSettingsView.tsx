import React, { useState } from 'react';
import { CheckCircle2, KeyRound } from 'lucide-react';
import { api } from '../lib/api.ts';

export function AdminSettingsView() {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!/^\d{4,8}$/.test(newPin)) {
      setError('PIN baru harus terdiri dari 4 sampai 8 digit angka.');
      return;
    }
    if (newPin !== confirmPin) {
      setError('Konfirmasi PIN baru tidak sama.');
      return;
    }

    setSaving(true);
    try {
      await api.changePin(currentPin, newPin);
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      setSuccess('PIN Admin berhasil diperbarui dan tersimpan di database.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memperbarui PIN.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
          <KeyRound className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Pengaturan PIN Admin
          </h2>
          <p className="text-xs text-slate-500">
            Ubah PIN keamanan untuk akses pengelolaan master barang, sesi, dan export.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-700">
            PIN Admin Saat Ini
          </label>
          <input
            type="password"
            inputMode="numeric"
            required
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm tracking-widest outline-none focus:border-blue-600"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700">
            PIN Admin Baru (4–8 digit angka)
          </label>
          <input
            type="password"
            inputMode="numeric"
            required
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm tracking-widest outline-none focus:border-blue-600"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700">
            Konfirmasi PIN Baru
          </label>
          <input
            type="password"
            inputMode="numeric"
            required
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm tracking-widest outline-none focus:border-blue-600"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <div className="pt-1">
          <button
            type="submit"
            disabled={saving}
            className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-medium text-white transition hover:bg-blue-800 disabled:opacity-60"
          >
            {saving ? 'Menyimpan...' : 'Simpan PIN Baru'}
          </button>
        </div>
      </form>
    </div>
  );
}
