import type {
  InventoryLocation,
  OpnameEntry,
  OpnameSession,
  Product,
  ProductPart,
} from '../types.ts';

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
  checkAdminSession(): Promise<{ isAdmin: boolean }> {
    return request('/api/auth/session');
  },

  async verifyPin(pin: string): Promise<{ token: string; expiresAt: number }> {
    const res = await request<{ token: string; expiresAt: number }>(
      '/api/auth/verify-pin',
      {
        method: 'POST',
        body: JSON.stringify({ pin }),
      },
    );
    setAdminToken(res.token);
    return res;
  },

  async logoutAdmin(): Promise<void> {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } finally {
      setAdminToken(null);
    }
  },

  changePin(currentPin: string, newPin: string): Promise<{ ok: boolean }> {
    return request('/api/auth/change-pin', {
      method: 'POST',
      body: JSON.stringify({ currentPin, newPin }),
    });
  },

  getLocations(): Promise<InventoryLocation[]> {
    return request('/api/locations');
  },

  createLocation(payload: {
    code?: string;
    name: string;
    description?: string;
  }): Promise<InventoryLocation> {
    return request('/api/locations', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateLocation(
    id: number,
    payload: {
      code?: string;
      name?: string;
      description?: string;
    },
  ): Promise<InventoryLocation> {
    return request(`/api/locations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteLocation(id: number): Promise<{ ok: boolean }> {
    return request(`/api/locations/${id}`, { method: 'DELETE' });
  },

  getProducts(): Promise<Product[]> {
    return request('/api/products');
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
    return request('/api/products', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  bulkImportProducts(payload: {
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
    return request('/api/products/bulk-import', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
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
    return request(`/api/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteProduct(id: number): Promise<{ ok: boolean }> {
    return request(`/api/products/${id}`, { method: 'DELETE' });
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
    return request(`/api/products/${productId}/parts`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  bulkAddParts(
    productId: number,
    parts: Array<{
      sn_order?: number;
      sap_code: string;
      parts_name: string;
      section: string;
      use_qty: number | null;
    }>,
  ): Promise<{ added: number }> {
    return request(`/api/products/${productId}/parts/bulk`, {
      method: 'POST',
      body: JSON.stringify({ parts }),
    });
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
    return request(`/api/parts/${partId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deletePart(partId: number): Promise<{ ok: boolean }> {
    return request(`/api/parts/${partId}`, { method: 'DELETE' });
  },

  getSessions(): Promise<OpnameSession[]> {
    return request('/api/sessions');
  },

  createSession(payload: {
    period_month: string;
    period_label: string;
    opname_date?: string;
    notes: string;
  }): Promise<OpnameSession> {
    return request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getSessionEntries(
    sessionId: number,
  ): Promise<{ session: OpnameSession; entries: OpnameEntry[] }> {
    return request(`/api/sessions/${sessionId}/entries`);
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
    return request(`/api/sessions/${sessionId}/entries/${entryId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  submitSession(
    sessionId: number,
    operatorName: string,
    productId?: number,
    location?: string,
    sourceLocation?: string,
  ): Promise<{ session: OpnameSession; entries: OpnameEntry[] }> {
    return request(`/api/sessions/${sessionId}/submit`, {
      method: 'POST',
      body: JSON.stringify({
        operator_name: operatorName,
        product_id: productId,
        location,
        source_location: sourceLocation ?? '',
      }),
    });
  },

  reopenModel(
    sessionId: number,
    productId: number,
    location?: string,
  ): Promise<{ session: OpnameSession; entries: OpnameEntry[] }> {
    return request(`/api/sessions/${sessionId}/reopen-model`, {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, location }),
    });
  },

  syncSessionMaster(sessionId: number): Promise<{ addedCount: number }> {
    return request(`/api/sessions/${sessionId}/sync-master`, {
      method: 'POST',
    });
  },

  closeSession(sessionId: number): Promise<{ ok: boolean; closed_at: string }> {
    return request(`/api/sessions/${sessionId}/close`, { method: 'POST' });
  },

  reopenSession(sessionId: number): Promise<{ ok: boolean }> {
    return request(`/api/sessions/${sessionId}/reopen`, { method: 'POST' });
  },

  deleteSession(sessionId: number): Promise<{ ok: boolean }> {
    return request(`/api/sessions/${sessionId}`, { method: 'DELETE' });
  },
};
