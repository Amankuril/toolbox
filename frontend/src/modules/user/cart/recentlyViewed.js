import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { safeStorage } from '@/core/lib/storage'
import { storeApi, storeKeys } from '../api'

const KEY = 'tb:recently-viewed'
const MAX = 12

/** Remembers this product as viewed (this browser only, newest first). */
export function useTrackView(productId) {
  useEffect(() => {
    if (!productId) return
    const ids = safeStorage.get(KEY, []).filter((id) => id !== productId)
    safeStorage.set(KEY, [productId, ...ids].slice(0, MAX))
  }, [productId])
}

/** Recently viewed products, excluding the one on screen; fetched fresh so prices and stock are current. */
export function useRecentlyViewed(excludeId) {
  const ids = safeStorage.get(KEY, []).filter((id) => id !== excludeId)
  const key = ids.join(',')
  const { data } = useQuery({
    queryKey: storeKeys.products({ ids: key, recent: true }),
    queryFn: () => storeApi.products({ ids: key, limit: MAX }),
    enabled: ids.length > 0,
    staleTime: 60_000,
  })
  // The API returns them in catalogue order; restore viewing order.
  const byId = new Map((data?.items ?? []).map((p) => [p._id, p]))
  return ids.map((id) => byId.get(id)).filter(Boolean)
}
