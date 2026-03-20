export function createTtlCache({ ttlMs }) {
  const map = new Map();

  function get(key) {
    const entry = map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      map.delete(key);
      return null;
    }
    return entry.value;
  }

  function set(key, value) {
    map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  return { get, set };
}
