import { create } from 'zustand'
import { AUDIENCES } from '@/core/config'
import { safeStorage } from '@/core/lib/storage'

/**
 * One independent session per audience, so a person can be signed in to the store,
 * the seller panel and the admin panel at the same time.
 *
 * status: idle → checking → authenticated | anonymous
 * The access token lives only in memory; the refresh token is an httpOnly cookie.
 */
const HINT_KEY = (audience) => `tb:session-hint:${audience}`
const timers = {}

function createSessionStore(audience) {
  return create((set) => ({
    status: 'idle',
    account: null,
    accessToken: null,

    signIn({ accessToken, expiresIn, account }) {
      set({ status: 'authenticated', accessToken, account })
      safeStorage.set(HINT_KEY(audience), 1)
      scheduleRefresh(audience, expiresIn)
    },
    setAccount(account) {
      set({ account })
    },
    setChecking() {
      set({ status: 'checking' })
    },
    signOut() {
      clearTimeout(timers[audience])
      safeStorage.remove(HINT_KEY(audience))
      set({ status: 'anonymous', accessToken: null, account: null })
    },
  }))
}

export const sessions = Object.fromEntries(AUDIENCES.map((a) => [a, createSessionStore(a)]))

/** Whether this browser has signed in to `audience` before (avoids a pointless refresh call for guests). */
export const hasSessionHint = (audience) => Boolean(safeStorage.get(HINT_KEY(audience)))

/** Refresh one minute before the access token expires. Set by core/api/http to avoid a cycle. */
let refreshHandler = null
export function setRefreshHandler(fn) {
  refreshHandler = fn
}

function scheduleRefresh(audience, expiresIn) {
  clearTimeout(timers[audience])
  if (!expiresIn || !refreshHandler) return
  const ms = Math.max(10_000, (expiresIn - 60) * 1000)
  timers[audience] = setTimeout(() => refreshHandler(audience), ms)
}

export function useSession(audience, selector = (s) => s) {
  return sessions[audience](selector)
}
