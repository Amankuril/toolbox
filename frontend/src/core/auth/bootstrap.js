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
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : fallback
}
