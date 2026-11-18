import type {
  InventoryLocation,
  OpnameEntry,
  OpnameSession,
  Product,
  ProductPart,
} from '../types.ts';
import { browserStore } from './browserStore.ts';
import { isSupabaseConfigured } from './supabase.ts';
import { ensureSupabaseSeeded, supabaseStore } from './supabaseStore.ts';

const TOKEN_STORAGE_KEY = 'joranstock_admin_token';

export function getAdminToken(): string | null {
  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setAdminToken(token: string | null) {
  if (token) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

let backendModePromise: Promise<'supabase' | 'server' | 'browser'> | null = null;

async function getBackendMode(): Promise<'supabase' | 'server' | 'browser'> {
  if (isSupabaseConfigured) {
    return 'supabase';
  }
  if (!backendModePromise) {
    backendModePromise = (async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const data = await res.json().catch(() => null);
          if (data && data.ok === true) {
            return 'server';
          }
        }
      } catch {
        // Static hosting without Supabase env vars
      }
      return 'browser';
    })();
  }
  return backendModePromise;
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('x-admin-token', token);
  }

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message =
      typeof data?.error === 'string'
        ? data.error
        : `Permintaan gagal (${res.status})`;
    throw new Error(message);
  }

  return data as T;
}

export const api = {
  async ensureSeeded(): Promise<void> {
    if (isSupabaseConfigured) {
      await ensureSupabaseSeeded();
    }
  },

  subscribeWorkspace(onUpdate: () => void): () => void {
    if (isSupabaseConfigured) {
      return supabaseStore.subscribeWorkspace(onUpdate);
    }
    return () => {};
  },

  subscribeSessionEntries(sessionId: number, onUpdate: () => void): () => void {
    if (isSupabaseConfigured) {
      return supabaseStore.subscribeSessionEntries(sessionId, onUpdate);
    }
    return () => {};
  },

  async checkAdminSession(): Promise<{ isAdmin: boolean }> {
    const mode = await getBackendMode();
    if (mode === 'supabase') {
      const token = getAdminToken();
      return { isAdmin: Boolean(token && token.startsWith('sb_admin_')) };
    }
    if (mode === 'server') {
      return request('/api/auth/session');
    }
    return { isAdmin: browserStore.checkLocalAdminToken(getAdminToken()) };
  },

  async verifyPin(pin: string): Promise<{ token: string; expiresAt: number }> {
    const mode = await getBackendMode();
    const res =
      mode === 'supabase'
        ? await supabaseStore.verifyPin(pin)
        : mode === 'server'
          ? await request<{ token: string; expiresAt: number }>('/api/auth/verify-pin', {
              method: 'POST',
              body: JSON.stringify({ pin }),
            })
          : await browserStore.verifyPin(pin);
    setAdminToken(res.token);
    return res;
  },

  async logoutAdmin(): Promise<void> {
    try {
      const mode = await getBackendMode();
      if (mode === 'server') {
        await request('/api/auth/logout', { method: 'POST' });
      }
    } finally {
      setAdminToken(null);
    }
  },

  async changePin(currentPin: string, newPin: string): Promise<{ ok: boolean }> {
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.changePin(currentPin, newPin);
    if (mode === 'server') {
      return request('/api/auth/change-pin', {
        method: 'POST',
        body: JSON.stringify({ currentPin, newPin }),
      });
    }
    return browserStore.changePin(currentPin, newPin);
  },

  async getLocations(): Promise<InventoryLocation[]> {
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.getLocations();
    if (mode === 'server') return request('/api/locations');
    return browserStore.getLocations();
  },

  async createLocation(payload: {
    code?: string;
    name: string;
    description?: string;
  }): Promise<InventoryLocation> {
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.createLocation(payload);
    if (mode === 'server') {
      return request('/api/locations', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }
    return browserStore.createLocation(payload);
  },

  async updateLocation(
    id: number,
    payload: {
      code?: string;
      name?: string;
      description?: string;
    },
  ): Promise<InventoryLocation> {
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.updateLocation(id, payload);
    if (mode === 'server') {
      return request(`/api/locations/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    }
    return browserStore.updateLocation(id, payload);
  },

  async deleteLocation(id: number): Promise<{ ok: boolean }> {
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.deleteLocation(id);
    if (mode === 'server') {
      return request(`/api/locations/${id}`, { method: 'DELETE' });
    }
    return browserStore.deleteLocation(id);
  },

  async getProducts(): Promise<Product[]> {
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.getProducts();
    if (mode === 'server') return request('/api/products');
    return browserStore.getProducts();
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
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.createProduct(payload);
    if (mode === 'server') {
      return request('/api/products', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }
    return browserStore.createProduct(payload);
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
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.bulkImportProducts(payload);
    if (mode === 'server') {
      return request('/api/products/bulk-import', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }
    return browserStore.bulkImportProducts(payload);
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
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.updateProduct(id, payload);
    if (mode === 'server') {
      return request(`/api/products/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    }
    return browserStore.updateProduct(id, payload);
  },

  async deleteProduct(id: number): Promise<{ ok: boolean }> {
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.deleteProduct(id);
    if (mode === 'server') {
      return request(`/api/products/${id}`, { method: 'DELETE' });
    }
    return browserStore.deleteProduct(id);
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
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.addPart(productId, payload);
    if (mode === 'server') {
      return request(`/api/products/${productId}/parts`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }
    return browserStore.addPart(productId, payload);
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
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.bulkAddParts(productId, parts);
    if (mode === 'server') {
      return request(`/api/products/${productId}/parts/bulk`, {
        method: 'POST',
        body: JSON.stringify({ parts }),
      });
    }
    return browserStore.bulkAddParts(productId, parts);
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
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.updatePart(partId, payload);
    if (mode === 'server') {
      return request(`/api/parts/${partId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    }
    return browserStore.updatePart(partId, payload);
  },

  async deletePart(partId: number): Promise<{ ok: boolean }> {
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.deletePart(partId);
    if (mode === 'server') {
      return request(`/api/parts/${partId}`, { method: 'DELETE' });
    }
    return browserStore.deletePart(partId);
  },

  async getSessions(): Promise<OpnameSession[]> {
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.getSessions();
    if (mode === 'server') return request('/api/sessions');
    return browserStore.getSessions();
  },

  async createSession(payload: {
    period_month: string;
    period_label: string;
    opname_date?: string;
    notes: string;
  }): Promise<OpnameSession> {
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.createSession(payload);
    if (mode === 'server') {
      return request('/api/sessions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }
    return browserStore.createSession(payload);
  },

  async getSessionEntries(
    sessionId: number,
  ): Promise<{ session: OpnameSession; entries: OpnameEntry[] }> {
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.getSessionEntries(sessionId);
    if (mode === 'server') return request(`/api/sessions/${sessionId}/entries`);
    return browserStore.getSessionEntries(sessionId);
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
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.updateEntry(sessionId, entryId, payload);
    if (mode === 'server') {
      return request(`/api/sessions/${sessionId}/entries/${entryId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    }
    return browserStore.updateEntry(sessionId, entryId, payload);
  },

  async submitSession(
    sessionId: number,
    operatorName: string,
    productId?: number,
    location?: string,
    sourceLocation?: string,
  ): Promise<{ session: OpnameSession; entries: OpnameEntry[] }> {
    const mode = await getBackendMode();
    if (mode === 'supabase') {
      return supabaseStore.submitSession(
        sessionId,
        operatorName,
        productId,
        location,
        sourceLocation,
      );
    }
    if (mode === 'server') {
      return request(`/api/sessions/${sessionId}/submit`, {
        method: 'POST',
        body: JSON.stringify({
          operator_name: operatorName,
          product_id: productId,
          location,
          source_location: sourceLocation ?? '',
        }),
      });
    }
    return browserStore.submitSession(
      sessionId,
      operatorName,
      productId,
      location,
      sourceLocation,
    );
  },

  async reopenModel(
    sessionId: number,
    productId: number,
    location?: string,
  ): Promise<{ session: OpnameSession; entries: OpnameEntry[] }> {
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.reopenModel(sessionId, productId, location);
    if (mode === 'server') {
      return request(`/api/sessions/${sessionId}/reopen-model`, {
        method: 'POST',
        body: JSON.stringify({ product_id: productId, location }),
      });
    }
    return browserStore.reopenModel(sessionId, productId, location);
  },

  async syncSessionMaster(sessionId: number): Promise<{ addedCount: number }> {
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.syncSessionMaster(sessionId);
    if (mode === 'server') {
      return request(`/api/sessions/${sessionId}/sync-master`, {
        method: 'POST',
      });
    }
    return browserStore.syncSessionMaster(sessionId);
  },

  async closeSession(sessionId: number): Promise<{ ok: boolean; closed_at: string }> {
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.closeSession(sessionId);
    if (mode === 'server') {
      return request(`/api/sessions/${sessionId}/close`, { method: 'POST' });
    }
    return browserStore.closeSession(sessionId);
  },

  async reopenSession(sessionId: number): Promise<{ ok: boolean }> {
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.reopenSession(sessionId);
    if (mode === 'server') {
      return request(`/api/sessions/${sessionId}/reopen`, { method: 'POST' });
    }
    return browserStore.reopenSession(sessionId);
  },

  async deleteSession(sessionId: number): Promise<{ ok: boolean }> {
    const mode = await getBackendMode();
    if (mode === 'supabase') return supabaseStore.deleteSession(sessionId);
    if (mode === 'server') {
      return request(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    }
    return browserStore.deleteSession(sessionId);
  },
};
