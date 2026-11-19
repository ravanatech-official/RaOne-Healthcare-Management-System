import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

const sqlHost = process.env.SQL_HOST?.trim() || '';

export const isDatabaseConfigured = Boolean(
  sqlHost &&
    !sqlHost.includes('PROJECT:REGION:INSTANCE') &&
    process.env.SQL_USER &&
    process.env.SQL_PASSWORD &&
    process.env.SQL_DB_NAME
);

export const createPool = () => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 10,
      connectionTimeoutMillis: 15000,
    });

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

export type Database = ReturnType<typeof drizzle<typeof schema>>;

function createChainableQueryMock(defaultResult: unknown = []): unknown {
  const proxy: unknown = new Proxy(() => proxy, {
    get(_target, prop) {
      if (prop === 'then') {
        return (onFulfilled?: (val: unknown) => unknown, onRejected?: (err: unknown) => unknown) =>
          Promise.resolve(defaultResult).then(onFulfilled, onRejected);
      }
      if (prop === 'catch') {
        return (onRejected?: (err: unknown) => unknown) =>
          Promise.resolve(defaultResult).catch(onRejected);
      }
      if (prop === 'finally') {
        return (onFinally?: () => void) => Promise.resolve(defaultResult).finally(onFinally);
      }
      return () => proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy;
}

function createMockDb(): Database {
  console.warn('[AI Studio] Database not connected — using mock');
  const noOp = {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    create: async (d?: { data?: unknown }) => d?.data ?? {},
    update: async (d?: { data?: unknown }) => d?.data ?? {},
    delete: async () => ({}),
  };

  const mockDb = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'query') {
          return new Proxy({}, { get: () => noOp });
        }
        if (prop === 'transaction') {
          return async (fn: (tx: Database) => Promise<unknown>) => fn(mockDb as Database);
        }
        if (prop === 'execute') {
          return async () => ({ rows: [] });
        }
        if (prop === 'select' || prop === 'insert' || prop === 'update' || prop === 'delete') {
          return () => createChainableQueryMock([]);
        }
        return () => createChainableQueryMock([]);
      },
    }
  );

  return mockDb as Database;
}

let db: Database;
if (!isDatabaseConfigured) {
  db = createMockDb();
} else {
  try {
    const pool = createPool();
    db = drizzle(pool, { schema });
  } catch {
    db = createMockDb();
  }
}

export { db };
