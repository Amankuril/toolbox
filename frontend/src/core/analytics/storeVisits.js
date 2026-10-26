import { useEffect } from 'react'
import { API_URL } from '@/core/config'
import { safeStorage } from '@/core/lib/storage'

const VISITOR_KEY = 'visitor-id'
const SOURCE_KEY = 'visit-source'

/** A random id this browser keeps, so a seller's visitors are counted once a day. Never tied to an account. */
function visitorId() {
  let id = safeStorage.get(VISITOR_KEY)
  if (!id) {
    id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    safeStorage.set(VISITOR_KEY, id)
  }
  return id
}

/** Where this visit came from: kept for the session, since in-app navigation never changes document.referrer. */
function visitSource() {
  try {
    const kept = sessionStorage.getItem(SOURCE_KEY)
    if (kept) return JSON.parse(kept)
    const source = { referrer: document.referrer.startsWith(window.location.origin) ? '' : document.referrer, utm: new URLSearchParams(window.location.search).get('utm_source') ?? '' }
    sessionStorage.setItem(SOURCE_KEY, JSON.stringify(source))
    return source
  } catch {
    return { referrer: '', utm: '' }
  }
}

/** Counts one view of a product or store page for the seller's Store analytics. Fire and forget. */
export function useStoreVisit({ productId, storeSlug }) {
  useEffect(() => {
    if (!productId && !storeSlug) return
    const { referrer, utm } = visitSource()
    const body = JSON.stringify({ productId, storeSlug, visitor: visitorId(), referrer: referrer.slice(0, 500) || undefined, utm: utm.slice(0, 80) || undefined })
    fetch(`${API_URL}/public/track`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'omit' }).catch(() => {})
  }, [productId, storeSlug])
}
