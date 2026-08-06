export interface TimedCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  clear(): void;
}

export function createTimedCache<V>(ttlMs: number | (() => number), now: () => number = Date.now): TimedCache<V> {
  const ttl = () => (typeof ttlMs === 'function' ? ttlMs() : ttlMs);
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
      map.set(key, { value, expiresAt: now() + ttl() });
    },
    clear() {
      map.clear();
    }
  };
}
