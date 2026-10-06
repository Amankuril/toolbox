import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api, list, one } from '@/core/api/http'
import { sessions, useSession } from '@/core/auth/session'

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
  imports: (p) => ['vendor', 'imports', p],
  import: (id) => ['vendor', 'import', id],
  importItems: (id, p) => ['vendor', 'import', id, 'items', p],
  importColumns: ['vendor', 'import-columns'],
}

/** Fetches a file through the authenticated client and saves it (keeps the token out of URLs). */
async function download(path, fallbackName) {
  const res = await v.get(path, { responseType: 'blob' })
  const name = /filename="([^"]+)"/.exec(res.headers['content-disposition'] ?? '')?.[1] ?? fallbackName
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const vendorApi = {
  imports: (params) => list(v.get('/product-imports', { params })),
  import: (id) => one(v.get(`/product-imports/${id}`)),
  importItems: (id, params) => list(v.get(`/product-imports/${id}/items`, { params })),
  importColumns: () => one(v.get('/product-imports/columns')),
  uploadImport: (file, mode, onUploadProgress) => {
    const body = new FormData()
    body.append('mode', mode)
    body.append('file', file)
    return one(v.post('/product-imports', body, { onUploadProgress, timeout: 120_000 }))
  },
  startImport: (id) => one(v.post(`/product-imports/${id}/start`)),
  cancelImport: (id) => one(v.post(`/product-imports/${id}/cancel`)),
  downloadTemplate: () => download('/product-imports/template.csv', 'products-template.csv'),
  downloadCategories: () => download('/product-imports/categories.csv', 'categories.csv'),
  downloadImportIssues: (id) => download(`/product-imports/${id}/issues.csv`, 'import-problems.csv'),
  exportProducts: () => download('/product-imports/export.csv', 'products.csv'),

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
