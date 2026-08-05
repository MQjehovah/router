import type { Prisma } from '@prisma/client';

export type KeyVerifyResult =
  | {
      valid: true;
      keyId: number;
      userId: number;
      rateLimit: number;
      dailyQuota: number;
      monthlyQuota: number;
      userBalance: Prisma.Decimal;
    }
  | { valid: false; reason: string };

export interface TimedCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  clear(): void;
}

export function createTimedCache<V>(ttlMs: number, now: () => number = Date.now): TimedCache<V> {
  const map = new Map<string, { value: V; expiresAt: number }>();
  return {
    get(key) {
      const entry = map.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        map.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      map.set(key, { value, expiresAt: now() + ttlMs });
    },
    clear() {
      map.clear();
    }
  };
}

export const keyVerifyCache: TimedCache<KeyVerifyResult> = createTimedCache<KeyVerifyResult>(60_000);
