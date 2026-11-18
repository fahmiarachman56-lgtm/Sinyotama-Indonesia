import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Terjadi kesalahan pada aplikasi.',
    };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Application ErrorBoundary caught:', error, info);
  }

  private formatDisplayMessage(raw: string): string {
    try {
      const parsed = JSON.parse(raw) as { error?: string; operationType?: string; path?: string };
      if (parsed && typeof parsed.error === 'string') {
        if (parsed.error.toLowerCase().includes('insufficient permissions')) {
          return `Akses Firestore ditolak (${parsed.operationType ?? 'read'} pada ${parsed.path ?? 'data'}). Pastikan akun Google Anda sudah terverifikasi dan memiliki hak akses yang sesuai.`;
        }
        return parsed.error;
      }
    } catch {
      // Not JSON
    }
    return raw;
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
          <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3 text-red-700">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-base font-semibold text-slate-900">
                  Terjadi Gangguan Koneksi / Akses Data
                </h1>
                <p className="text-xs text-slate-500">
                  Sinyotama Indonesia — Inventory Sistem
                </p>
              </div>
            </div>
            <p className="mt-4 rounded-lg border border-red-100 bg-red-50/70 p-3 text-xs leading-relaxed text-red-800 break-words">
              {this.formatDisplayMessage(this.state.message)}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              <RefreshCw className="h-4 w-4" />
              Muat Ulang Aplikasi
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
