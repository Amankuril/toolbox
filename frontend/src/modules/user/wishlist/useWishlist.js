import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'
import { errorMessage } from '@/core/api/errors'
import { useSession } from '@/core/auth/session'
import { safeStorage } from '@/core/lib/storage'
import { storeKeys, userApi } from '../api'

const GUEST_KEY = 'tb:guest-wishlist'
// Matches the storefront's ids lookup limit, so a guest's whole list can be shown in one request.
const MAX_ITEMS = 60

/** Guest wishlist: product ids (newest first) in localStorage, merged into the account on sign-in. */
export const useGuestWishlist = create((set, get) => ({
  ids: safeStorage.get(GUEST_KEY, []),
  toggle(productId) {
    const has = get().ids.includes(productId)
    const next = has ? get().ids.filter((id) => id !== productId) : [productId, ...get().ids].slice(0, MAX_ITEMS)
    safeStorage.set(GUEST_KEY, next)
    set({ ids: next })
    return !has
  },
  clear() {
    safeStorage.remove(GUEST_KEY)
    set({ ids: [] })
  },
}))

/** Saved-for-later products: server-backed when signed in, local for guests. Same API either way. */
export function useWishlist() {
  const signedIn = useSession('user', (s) => s.status === 'authenticated')
  const qc = useQueryClient()
  const guestIds = useGuestWishlist((s) => s.ids)
  const toggleGuest = useGuestWishlist((s) => s.toggle)
  const server = useQuery({ queryKey: storeKeys.wishlistIds, queryFn: userApi.wishlistIds, enabled: signedIn, staleTime: 60_000 })

  const mutation = useMutation({
    mutationFn: ({ productId, add }) => (add ? userApi.addToWishlist(productId) : userApi.removeFromWishlist(productId)),
    // Hearts flip instantly; the server's answer (or a rollback) settles it.
    onMutate: async ({ productId, add }) => {
      await qc.cancelQueries({ queryKey: storeKeys.wishlistIds })
      const prev = qc.getQueryData(storeKeys.wishlistIds)
      qc.setQueryData(storeKeys.wishlistIds, (ids = []) => (add ? [productId, ...ids.filter((i) => i !== productId)] : ids.filter((i) => i !== productId)))
      return { prev }
    },
    onError: (err, _v, ctx) => {
      qc.setQueryData(storeKeys.wishlistIds, ctx?.prev)
      toast.error(errorMessage(err))
    },
    onSuccess: (ids) => {
      qc.setQueryData(storeKeys.wishlistIds, ids)
      qc.invalidateQueries({ queryKey: storeKeys.wishlist, exact: true })
    },
  })

  const ids = useMemo(() => (signedIn ? (server.data ?? []) : guestIds), [signedIn, server.data, guestIds])
  const set = useMemo(() => new Set(ids), [ids])

  const toggle = useCallback(
    (product) => {
      const add = !set.has(product._id)
      if (signedIn) mutation.mutate({ productId: product._id, add })
      else toggleGuest(product._id)
      if (add) toast.success('Saved to wishlist', { description: product.name })
      return add
    },
    [set, signedIn, mutation, toggleGuest],
  )

  return { ids, count: ids.length, has: (id) => set.has(id), toggle, signedIn }
}

/** After sign-in: fold the guest's saved items into the account, then clear them locally. */
export async function mergeGuestWishlist(queryClient) {
  const { ids, clear } = useGuestWishlist.getState()
  if (!ids.length) return
  try {
    queryClient.setQueryData(storeKeys.wishlistIds, await userApi.mergeWishlist(ids))
    queryClient.invalidateQueries({ queryKey: storeKeys.wishlist, exact: true })
    clear()
  } catch {
    // Non-fatal: the list stays local and is retried on the next sign-in.
  }
}
