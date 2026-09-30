/**
 * localStorage that never throws (private mode, blocked storage, quota).
 * Only for per-browser conveniences: cached theme, guest cart, session hints.
 */
export const safeStorage = {
  get(key, fallback = null) {
    try {
      const raw = window.localStorage.getItem(key)
      return raw == null ? fallback : JSON.parse(raw)
    } catch {
      return fallback
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* storage unavailable — non-critical */
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      /* storage unavailable — non-critical */
    }
  },
}
