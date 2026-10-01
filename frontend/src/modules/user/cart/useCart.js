import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'
import { errorMessage } from '@/core/api/errors'
import { useSession } from '@/core/auth/session'
import { priceFor, usableTiers } from '@/core/lib/pricing'
import { safeStorage } from '@/core/lib/storage'
import { usePublicSettings } from '@/core/settings/usePublicSettings'
import { storeApi, storeKeys, userApi } from '../api'

const GUEST_KEY = 'tb:guest-cart'
const MAX_LINES = 50

/** Guest cart: [{ productId, quantity }] in localStorage. Merged into the server cart on sign-in. */
export const useGuestCart = create((set, get) => ({
  lines: safeStorage.get(GUEST_KEY, []),
  setQty(productId, quantity) {
    const lines = get().lines.filter((l) => l.productId !== productId)
    if (quantity > 0) lines.push({ productId, quantity })
    const next = lines.slice(-MAX_LINES)
    safeStorage.set(GUEST_KEY, next)
    set({ lines: next })
  },
  clear() {
    safeStorage.remove(GUEST_KEY)
    set({ lines: [] })
  },
}))

function shippingFee(subtotal, shipping) {
  if (!shipping?.flatFee || subtotal === 0) return 0
  if (shipping.freeAbove > 0 && subtotal >= shipping.freeAbove) return 0
  return shipping.flatFee
}

/** Builds the same shape the API returns for the server cart, for guests. */
function useGuestView(enabled) {
  const lines = useGuestCart((s) => s.lines)
  const { data: settings } = usePublicSettings()
  const ids = lines.map((l) => l.productId).join(',')
  const { data, isLoading } = useQuery({
    queryKey: ['public', 'cart-products', ids],
    queryFn: () => storeApi.products({ ids, limit: 60 }),
    enabled: enabled && lines.length > 0,
    staleTime: 60_000,
  })

  return useMemo(() => {
    const byId = new Map((data?.items ?? []).map((p) => [p._id, p]))
    const items = lines.map(({ productId, quantity }) => {
      const product = byId.get(productId) ?? null
      const issue = !product ? (data ? 'unavailable' : null) : !product.inStock ? 'out_of_stock' : quantity < product.moq ? 'below_moq' : null
      // Guests are priced as individual buyers (business-only tiers don't apply); the server re-prices after sign-in.
      const base = product?.price ?? 0
      const { unitPrice, tier, next } = priceFor(base, usableTiers(product?.bulk), quantity)
      return {
        productId,
        product,
        quantity,
        unitPrice,
        baseUnitPrice: base,
        unitMrp: product?.mrp ?? 0,
        lineTotal: unitPrice * quantity,
        bulkSavings: Math.max(0, (base - unitPrice) * quantity),
        pricing: { source: tier ? 'bulk' : 'base', tier, next },
        maxQuantity: product ? Math.min(product.stock || 9999, product.maxOrderQty ?? 9999) : 9999,
        issue,
      }
    })
    const payable = items.filter((i) => i.product && !i.issue)
    const subtotal = payable.reduce((s, i) => s + i.lineTotal, 0)
    const mrpTotal = payable.reduce((s, i) => s + i.unitMrp * i.quantity, 0)
    const shipping = shippingFee(subtotal, settings?.shipping)
    return {
      items,
      summary: {
        itemCount: payable.reduce((n, i) => n + i.quantity, 0),
        subtotal,
        mrpTotal,
        savings: mrpTotal - subtotal,
        bulkSavings: payable.reduce((sum, i) => sum + i.bulkSavings, 0),
        shipping,
        total: subtotal + shipping,
      },
      hasIssues: items.some((i) => i.issue),
      isLoading: lines.length > 0 && isLoading,
    }
  }, [lines, data, settings?.shipping, isLoading])
}

/**
 * One cart API for the whole storefront: server-backed when signed in, local for guests.
 */
export function useCart() {
  const status = useSession('user', (s) => s.status)
  const signedIn = status === 'authenticated'
  const qc = useQueryClient()
  const guest = useGuestView(!signedIn)
  const setGuestQty = useGuestCart((s) => s.setQty)

  const server = useQuery({ queryKey: storeKeys.cart, queryFn: userApi.cart, enabled: signedIn, staleTime: 15_000 })

  const setServer = useMutation({
    mutationFn: ({ productId, quantity }) => (quantity > 0 ? userApi.setCartItem(productId, quantity) : userApi.removeCartItem(productId)),
    onSuccess: (cart) => qc.setQueryData(storeKeys.cart, cart),
    onError: (err) => toast.error(errorMessage(err)),
  })

  const setQty = useCallback(
    async (productId, quantity) => {
      if (signedIn) return setServer.mutateAsync({ productId, quantity })
      setGuestQty(productId, quantity)
    },
    [signedIn, setServer, setGuestQty],
  )

  const view = signedIn
    ? {
        ...(server.data ?? { items: [], summary: { itemCount: 0, subtotal: 0, total: 0, shipping: 0, savings: 0, mrpTotal: 0 }, hasIssues: false }),
        isLoading: server.isLoading,
      }
    : guest

  return {
    ...view,
    signedIn,
    count: view.items.reduce((n, i) => n + i.quantity, 0),
    quantityOf: (productId) => view.items.find((i) => String(i.productId) === String(productId))?.quantity ?? 0,
    setQty,
    remove: (productId) => setQty(productId, 0),
    isUpdating: setServer.isPending,
  }
}

/** After sign-in: push guest lines to the server cart, then clear them locally. */
export async function mergeGuestCart(queryClient) {
  const { lines, clear } = useGuestCart.getState()
  if (!lines.length) return
  try {
    const cart = await userApi.mergeCart(lines)
    queryClient.setQueryData(storeKeys.cart, cart)
    clear()
  } catch {
    // Non-fatal: the guest cart stays local and can be retried on next sign-in.
  }
}
