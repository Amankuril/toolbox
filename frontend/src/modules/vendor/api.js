import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api, list, one } from '@/core/api/http'
import { sessions, useSession } from '@/core/auth/session'
import { createImportApi } from '@/modules/shared/productImportApi'

const v = api.vendor

export const vendorKeys = {
  all: ['vendor'],
  me: ['vendor', 'me'],
  dashboard: ['vendor', 'dashboard'],
  categories: ['vendor', 'categories'],
  products: (p) => ['vendor', 'products', p],
  product: (id) => ['vendor', 'product', id],
  orders: (p) => ['vendor', 'orders', p],
  quotes: (p) => ['vendor', 'quotes', p],
  quote: (id) => ['vendor', 'quote', id],
  order: (id) => ['vendor', 'order', id],
  shipments: (orderId) => ['vendor', 'shipments', orderId],
}

export const vendorApi = {
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
