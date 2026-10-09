/**
 * Vitest setup for the offline layer.
 *
 * The queue, lease store and record cache all live in IndexedDB, which Node
 * does not have. `fake-indexeddb` provides a real in-memory implementation —
 * not a mock — so these tests exercise the same transaction and cursor code
 * paths the browser runs.
 */
import 'fake-indexeddb/auto';

/**
 * Minimal `localStorage` for Node. The session stamps, device identity and
 * `DevContext` all live there, and `apiFetch` consults the offline session on
 * every write — so without this the API layer cannot be tested at all.
 */
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
    writable: true,
  });
}
