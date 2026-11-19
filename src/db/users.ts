import { eq } from 'drizzle-orm';
import { db, isDatabaseConfigured } from './index.ts';
import { users } from './schema.ts';

export interface UserRecord {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  preferredLocale: string;
  createdAt: Date;
  updatedAt: Date;
}

declare global {
  var _memoryUsersByUid: Map<string, UserRecord> | undefined;
  var _memoryUsersNextId: number | undefined;
}

function getMemoryUsersMap(): Map<string, UserRecord> {
  if (!global._memoryUsersByUid) {
    global._memoryUsersByUid = new Map<string, UserRecord>();
  }
  return global._memoryUsersByUid;
}

export async function getOrCreateUser(uid: string, email: string, displayName?: string): Promise<UserRecord> {
  const fallbackName = displayName || email.split('@')[0] || 'Staff';
  if (!isDatabaseConfigured) {
    const map = getMemoryUsersMap();
    const existing = map.get(uid);
    if (existing) {
      if (email && existing.email !== email) {
        existing.email = email;
        existing.updatedAt = new Date();
      }
      return existing;
    }
    const nextId = (global._memoryUsersNextId ?? 1);
    global._memoryUsersNextId = nextId + 1;
    const record: UserRecord = {
      id: nextId,
      uid,
      email,
      displayName: fallbackName,
      preferredLocale: 'si-LK',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    map.set(uid, record);
    return record;
  }

  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        displayName: fallbackName,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (result[0]) {
      return result[0];
    }

    return {
      id: 1,
      uid,
      email,
      displayName: fallbackName,
      preferredLocale: 'si-LK',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  } catch (error) {
    console.error('Database user upsert failed:', error);
    throw new Error('Unable to resolve user identity record.', { cause: error });
  }
}

export function getMemoryUserById(userId: number): UserRecord | undefined {
  for (const user of getMemoryUsersMap().values()) {
    if (user.id === userId) return user;
  }
  return undefined;
}

export function getMemoryUserByEmail(email: string): UserRecord | undefined {
  const norm = email.trim().toLowerCase();
  for (const user of getMemoryUsersMap().values()) {
    if (user.email.toLowerCase() === norm) return user;
  }
  return undefined;
}

export async function updateUserPreferredLocale(
  userId: number,
  preferredLocale: 'si-LK' | 'en-LK'
): Promise<void> {
  if (!isDatabaseConfigured) {
    for (const user of getMemoryUsersMap().values()) {
      if (user.id === userId) {
        user.preferredLocale = preferredLocale;
        user.updatedAt = new Date();
        break;
      }
    }
    return;
  }

  await db
    .update(users)
    .set({ preferredLocale, updatedAt: new Date() })
    .where(eq(users.id, userId));
}
