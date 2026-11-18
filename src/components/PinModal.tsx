import React, { useState } from 'react';
import { Lock, X } from 'lucide-react';
import { api } from '../lib/api.ts';

interface PinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function PinModal({ isOpen, onClose, onSuccess }: PinModalProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) {
      setError('Masukkan PIN Admin.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await api.verifyPin(pin.trim());
      setPin('');
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PIN tidak valid.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-modal-title"
    >
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-800">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="pin-modal-title"
                className="text-base font-semibold text-slate-900"
              >
                Masuk Mode Admin
              </h2>
              <p className="text-xs text-slate-500">
                Diperlukan untuk kelola master, sesi & PIN
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Tutup dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="admin-pin-input"
              className="block text-sm font-medium text-slate-700"
            >
              PIN Admin
            </label>
            <input
              id="admin-pin-input"
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Masukkan 4–8 digit PIN"
              className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 px-3.5 font-mono text-base tracking-widest text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
            />
            <p className="mt-1.5 text-xs text-slate-500">
              PIN standar awal: <span className="font-mono font-medium text-slate-700">1234</span> (dapat diubah di Pengaturan PIN).
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={loading}
              className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-medium text-white transition hover:bg-blue-800 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              {loading ? 'Memverifikasi...' : 'Buka Akses Admin'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
