import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'
import { errorMessage } from '@/core/api/errors'
import { useSession } from '@/core/auth/session'
import { safeStorage } from '@/core/lib/storage'
import { storeApi, storeKeys, userApi } from '../api'

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
    (product, { silent = false } = {}) => {
      const add = !set.has(product._id)
      if (signedIn) mutation.mutate({ productId: product._id, add })
      else toggleGuest(product._id)
      if (add && !silent) toast.success('Saved to wishlist', { description: product.name })
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

/** The saved products themselves (account list when signed in, live product cards for a guest's ids). */
export function useWishlistProducts({ enabled = true } = {}) {
  const wishlist = useWishlist()
  const guestIds = wishlist.signedIn ? '' : wishlist.ids.join(',')
  const account = useQuery({ queryKey: storeKeys.wishlist, queryFn: userApi.wishlist, enabled: enabled && wishlist.signedIn })
  const guest = useQuery({
    queryKey: ['public', 'wishlist-products', guestIds],
    queryFn: () => storeApi.products({ ids: guestIds, limit: 60 }),
    enabled: enabled && !wishlist.signedIn && guestIds.length > 0,
    placeholderData: (prev) => prev,
  })
  const rows = wishlist.signedIn
    ? (account.data ?? []).filter((r) => wishlist.has(r.product._id))
    : wishlist.ids
        .map((id) => (guest.data?.items ?? []).find((p) => p._id === id))
        .filter(Boolean)
        .map((product) => ({ product, available: true }))
  const isLoading = wishlist.signedIn ? account.isLoading : guestIds.length > 0 && guest.isLoading
  return { wishlist, rows, isLoading }
}
