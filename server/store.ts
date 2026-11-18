import { StoreError, type InventoryStore } from './types.ts';

let cachedStorePromise: Promise<InventoryStore> | null = null;

function resolvePostgresConnectionString(): string | undefined {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.SUPABASE_DB_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  ];
  for (const val of candidates) {
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return undefined;
}

export function getStore(): Promise<InventoryStore> {
  if (!cachedStorePromise) {
    cachedStorePromise = (async () => {
      const pgUrl = resolvePostgresConnectionString();
      if (pgUrl) {
        const { PostgresInventoryStore } = await import('./pgStore.ts');
        return new PostgresInventoryStore(pgUrl);
      }

      if (process.env.VERCEL === '1' || process.env.VERCEL === 'true') {
        throw new StoreError(
          500,
          'Database Supabase belum dikonfigurasi. Tambahkan Environment Variable DATABASE_URL (Connection Pooler Supabase) di Vercel Project Settings lalu Redeploy.',
        );
      }

      const { SqliteInventoryStore } = await import('./sqliteStore.ts');
      return new SqliteInventoryStore();
    })().catch((err) => {
      cachedStorePromise = null;
      throw err;
    });
  }
  return cachedStorePromise;
}
