import { Pool } from 'pg';

const g = globalThis as unknown as { __pgPool?: Pool };

function makePool() {
  const url = process.env.DATABASE_URL;
  return new Pool({
    connectionString: url,
    max: 5,
    ssl: url && url.includes('localhost') ? false : { rejectUnauthorized: false },
  });
}

export function pool(): Pool {
  if (!g.__pgPool) g.__pgPool = makePool();
  return g.__pgPool;
}

export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool().query(text, params as any[]);
  return res.rows as T[];
}

export async function one<T = any>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}
