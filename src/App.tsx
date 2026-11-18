import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ClipboardCheck,
  KeyRound,
  Lock,
  LogOut,
  MapPin,
  Menu,
  Package,
  ShieldCheck,
  X,
} from 'lucide-react';
import { AdminLocationsView } from './components/AdminLocationsView.tsx';
import { AdminMasterView } from './components/AdminMasterView.tsx';
import { AdminSessionsView } from './components/AdminSessionsView.tsx';
import { AdminSettingsView } from './components/AdminSettingsView.tsx';
import { OperatorWorkspace } from './components/OperatorWorkspace.tsx';
import { PinModal } from './components/PinModal.tsx';
import { api, setAdminToken } from './lib/api.ts';
import type {
  InventoryLocation,
  NavView,
  OpnameSession,
  Product,
  UserRole,
} from './types.ts';

export default function App() {
  const [role, setRole] = useState<UserRole>('operator');
  const [activeView, setActiveView] = useState<NavView>('opname');
  const [pendingAdminView, setPendingAdminView] = useState<NavView | null>(null);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);

  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [sessions, setSessions] = useState<OpnameSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [prods, locList, sessList] = await Promise.all([
        api.getProducts(),
        api.getLocations(),
        api.getSessions(),
      ]);
      setProducts(prods);
      setLocations(locList);
      setSessions(sessList);
      setSelectedSessionId((prev) => {
        if (prev && sessList.some((s) => s.id === prev)) return prev;
        const firstActive = sessList.find((s) => s.status === 'active');
        return firstActive?.id ?? sessList[0]?.id ?? null;
      });
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Gagal terhubung ke server database.',
      );
    } finally {
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    api
      .checkAdminSession()
      .then((res) => {
        if (res.isAdmin) {
          setRole('admin');
        } else {
          setAdminToken(null);
        }
      })
      .catch(() => {
        setAdminToken(null);
      });

    void loadAll();
  }, [loadAll]);

  const handleToggleSidebar = () => {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      setDesktopSidebarOpen((prev) => !prev);
    } else {
      setMobileMenuOpen((prev) => !prev);
    }
  };

  const handleNavClick = (view: NavView, requiresAdmin: boolean) => {
    setMobileMenuOpen(false);
    if (requiresAdmin && role !== 'admin') {
      setPendingAdminView(view);
      setPinModalOpen(true);
      return;
    }
    setActiveView(view);
  };

  const handleAdminUnlockSuccess = () => {
    setRole('admin');
    setPinModalOpen(false);
    if (pendingAdminView) {
      setActiveView(pendingAdminView);
      setPendingAdminView(null);
    }
  };

  const handleExitAdmin = async () => {
    await api.logoutAdmin();
    setRole('operator');
    setActiveView('opname');
    setMobileMenuOpen(false);
  };

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  const breadcrumbText = useMemo(() => {
    if (activeView === 'opname') {
      return selectedSession
        ? `Operasional / Stock Opname · ${selectedSession.period_label}`
        : 'Operasional / Stock Opname';
    }
    if (activeView === 'master') return 'Admin / Master Barang & Part';
    if (activeView === 'locations') return 'Admin / Location Inventory';
    if (activeView === 'sessions') return 'Admin / Sesi & Arsip Bulanan';
    return 'Admin / Pengaturan PIN';
  }, [activeView, selectedSession]);

  const navItems: Array<{
    id: NavView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    adminOnly: boolean;
  }> = [
    {
      id: 'opname',
      label: 'Input Stock Opname',
      icon: ClipboardCheck,
      adminOnly: false,
    },
    {
      id: 'master',
      label: 'Master Barang & Part',
      icon: Package,
      adminOnly: true,
    },
    {
      id: 'locations',
      label: 'Location Inventory',
      icon: MapPin,
      adminOnly: true,
    },
    {
      id: 'sessions',
      label: 'Sesi & Arsip Bulanan',
      icon: Archive,
      adminOnly: true,
    },
    {
      id: 'settings',
      label: 'Pengaturan PIN',
      icon: KeyRound,
      adminOnly: true,
    },
  ];

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col bg-slate-900 text-slate-100 transition-all duration-200 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        } ${
          desktopSidebarOpen
            ? 'lg:static lg:translate-x-0'
            : 'lg:fixed lg:-translate-x-full'
        }`}
      >
        <div className="flex min-h-16 items-center justify-between border-b border-slate-800 px-5 py-3">
          <div>
            <div className="font-display text-base font-bold tracking-tight text-white">
              Sinyotama Indonesia
            </div>
            <div className="text-xs text-slate-400">Inventory Sistem</div>
            <div className="mt-0.5 text-[11px] font-medium text-blue-400">
              Versi Vercel
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
            aria-label="Tutup menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            const isLocked = item.adminOnly && role !== 'admin';

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id, item.adminOnly)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-700 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {isLocked && <Lock className="h-3.5 w-3.5 shrink-0 text-slate-500" />}
              </button>
            );
          })}
        </nav>

        {/* Role Footer Panel */}
        <div className="border-t border-slate-800 p-4">
          <div className="rounded-lg bg-slate-800/80 p-3">
            <div className="text-xs text-slate-400">Peran Aktif</div>
            <div className="mt-0.5 flex items-center gap-2 text-sm font-semibold text-white">
              {role === 'admin' ? (
                <>
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span>Admin Inventory</span>
                </>
              ) : (
                <span>Operator Gudang</span>
              )}
            </div>
            {role === 'admin' ? (
              <button
                type="button"
                onClick={handleExitAdmin}
                className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 text-xs font-medium text-slate-200 transition hover:bg-slate-700 whitespace-nowrap"
              >
                <LogOut className="h-3.5 w-3.5" />
                Kembali ke Operator
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setPendingAdminView(null);
                  setPinModalOpen(true);
                }}
                className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-slate-700 px-3 text-xs font-medium text-white transition hover:bg-slate-600 whitespace-nowrap"
              >
                <Lock className="h-3.5 w-3.5" />
                Masuk Mode Admin
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar Contract: Breadcrumb on Left + 1 Primary Action on Right */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={handleToggleSidebar}
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
              aria-label="Buka atau tutup menu navigasi"
              title="Buka / Tutup Sidebar"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-700">
                {breadcrumbText}
              </div>
              <div className="text-[11px] font-medium text-blue-600 lg:hidden">
                Sinyotama Indonesia · Versi Vercel
              </div>
            </div>
          </div>

          <div className="shrink-0">
            {role === 'admin' ? (
              <button
                type="button"
                onClick={handleExitAdmin}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <LogOut className="h-4 w-4" />
                Keluar Admin
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setPendingAdminView(null);
                  setPinModalOpen(true);
                }}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Lock className="h-4 w-4" />
                Mode Admin
              </button>
            )}
          </div>
        </header>

        {/* Main Viewport */}
        <main className="mx-auto w-full max-w-[1340px] flex-1 p-4 sm:p-6 lg:p-8">
          {initialLoading ? (
            <div className="space-y-4">
              <div className="h-36 animate-pulse rounded-xl border border-slate-200 bg-white" />
              <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white" />
            </div>
          ) : loadError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
              <p className="font-semibold">Gagal memuat data inventory</p>
              <p className="mt-1">{loadError}</p>
              <button
                type="button"
                onClick={() => {
                  setInitialLoading(true);
                  void loadAll();
                }}
                className="mt-4 h-10 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700"
              >
                Coba Lagi
              </button>
            </div>
          ) : activeView === 'opname' ? (
            <OperatorWorkspace
              sessions={sessions}
              locations={locations}
              selectedSessionId={selectedSessionId}
              onSelectSession={setSelectedSessionId}
              role={role}
              onOpenAdminSessions={() => setActiveView('sessions')}
              onEntriesUpdated={() => {
                api.getSessions().then(setSessions).catch(() => {});
              }}
            />
          ) : activeView === 'master' && role === 'admin' ? (
            <AdminMasterView products={products} onRefresh={loadAll} />
          ) : activeView === 'locations' && role === 'admin' ? (
            <AdminLocationsView locations={locations} onRefresh={loadAll} />
          ) : activeView === 'sessions' && role === 'admin' ? (
            <AdminSessionsView
              sessions={sessions}
              onRefresh={loadAll}
              onOpenSessionInOpname={(sessionId) => {
                setSelectedSessionId(sessionId);
                setActiveView('opname');
              }}
            />
          ) : activeView === 'settings' && role === 'admin' ? (
            <AdminSettingsView />
          ) : null}
        </main>
      </div>

      <PinModal
        isOpen={pinModalOpen}
        onClose={() => {
          setPinModalOpen(false);
          setPendingAdminView(null);
        }}
        onSuccess={handleAdminUnlockSuccess}
      />
    </div>
  );
}
