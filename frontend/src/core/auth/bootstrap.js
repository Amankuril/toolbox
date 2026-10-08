import { useEffect } from 'react'
import { refreshSession } from '@/core/api/http'
import { hasSessionHint, sessions, useSession } from './session'

/**
 * Restores a session from the refresh cookie on first use. Guests with no hint skip the network call.
 * @param {'user'|'vendor'|'admin'} audience
 * @param {{ always?: boolean }} opts always=true tries even without a hint (panels).
 */
export function useSessionBootstrap(audience, { always = false } = {}) {
  const status = useSession(audience, (s) => s.status)
  useEffect(() => {
    if (status !== 'idle') return
    const store = sessions[audience].getState()
    if (!always && !hasSessionHint(audience)) {
      store.signOut()
      return
    }
    store.setChecking()
    refreshSession(audience)
  }, [audience, status, always])
  return status
}

/** Only allows internal redirect targets, so ?next= can't send people off-site. */
export function safeNext(next, fallback) {
  // A single leading slash, not followed by another slash or a backslash (browsers read "/\\host" as "//host"), and no control characters.
  // eslint-disable-next-line no-control-regex
  return typeof next === 'string' && /^\/(?![/\\])/.test(next) && !/[\x00-\x1f\\]/.test(next) ? next : fallback
}
