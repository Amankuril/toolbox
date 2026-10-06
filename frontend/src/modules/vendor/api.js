import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api, list, one } from '@/core/api/http'
import { sessions, useSession } from '@/core/auth/session'
import { createImportApi } from '@/modules/shared/productImportApi'

const v = api.vendor

/** Query keys for one seller panel, rooted so the vendor panel and the admin's store never share cache. */
export function createSellerKeys(root) {
  return {
    all: root,
    me: [...root, 'me'],
    dashboard: [...root, 'dashboard'],
    categories: [...root, 'categories'],
    products: (p) => [...root, 'products', p],
    product: (id) => [...root, 'product', id],
    orders: (p) => [...root, 'orders', p],
    quotes: (p) => [...root, 'quotes', p],
    quote: (id) => [...root, 'quote', id],
    order: (id) => [...root, 'order', id],
    shipments: (orderId) => [...root, 'shipments', orderId],
  }
}

/**
 * Seller endpoints over any client with get/post/put/patch/delete: the vendor's own API,
 * or the admin API scoped to /store for the platform's own store.
 */
export function createSellerApi(v) {
  return {
    productImports: createImportApi(v),

    me: () => one(v.get('/me')),
    updateProfile: (body) => one(v.patch('/me', body)),
    saveBusiness: (body) => one(v.put('/onboarding/business', body)),
    saveAddress: (body) => one(v.put('/onboarding/address', body)),
    saveBank: (body) => one(v.put('/onboarding/bank', body)),
    saveDocuments: (body) => one(v.put('/onboarding/documents', body)),
    submit: () => one(v.post('/onboarding/submit')),

    dashboard: () => one(v.get('/dashboard')),

    categories: () => one(v.get('/categories')),
    createCategory: (body) => one(v.post('/categories', body)),
    updateCategory: (id, body) => one(v.patch(`/categories/${id}`, body)),
    deleteCategory: (id) => v.delete(`/categories/${id}`),

    products: (params) => list(v.get('/products', { params })),
    product: (id) => one(v.get(`/products/${id}`)),
    createProduct: (body) => one(v.post('/products', body)),
    updateProduct: (id, body) => one(v.patch(`/products/${id}`, body)),
    quickUpdate: (id, body) => one(v.patch(`/products/${id}/stock`, body)),
    setVisibility: (id, visible) => one(v.patch(`/products/${id}/visibility`, { visible })),
    archiveProduct: (id) => v.delete(`/products/${id}`),
    compatibilitySearch: (q) => one(v.get('/products/compatibility-search', { params: { q } })),

    quotes: (params) => list(v.get('/quotes', { params })),
    quote: (id) => one(v.get(`/quotes/${id}`)),
    sendOffer: (id, body) => one(v.post(`/quotes/${id}/offer`, body)),
    declineQuote: (id, body) => one(v.post(`/quotes/${id}/decline`, body)),

    orders: (params) => list(v.get('/orders', { params })),
    order: (id) => one(v.get(`/orders/${id}`)),
    updateOrderItem: (id, itemId, body) => one(v.patch(`/orders/${id}/items/${itemId}`, body)),
    shipments: (orderId) => one(v.get(`/orders/${orderId}/shipments`)),
    shipmentLabel: (id) => v.get(`/shipments/${id}/label`, { responseType: 'blob' }).then((r) => r.data),
  }
}

export const vendorKeys = createSellerKeys(['vendor'])
export const vendorApi = createSellerApi(v)

/**
 * The signed-in vendor, kept fresh from the API and mirrored into the session store
 * so status changes (approval, rejection) show up everywhere.
 */
export function useVendor() {
  const account = useSession('vendor', (s) => s.account)
  const query = useQuery({ queryKey: vendorKeys.me, queryFn: vendorApi.me, initialData: account ?? undefined, staleTime: 30_000 })
  useEffect(() => {
    if (query.data) sessions.vendor.getState().setAccount(query.data)
  }, [query.data])
  return query.data ?? account
}
