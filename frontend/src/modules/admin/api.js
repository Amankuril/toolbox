import { queryClient } from '@/app/queryClient'
import { api, list, one } from '@/core/api/http'
import { createImportApi } from '@/modules/shared/productImportApi'

const a = api.admin

// A "no permission" reply means this admin's access changed: re-read it so the sidebar catches up.
a.interceptors.response.use(undefined, (error) => {
  if (error.response?.data?.error?.code === 'PERMISSION_DENIED') queryClient.invalidateQueries({ queryKey: ['admin', 'me'] })
  return Promise.reject(error)
})

export const adminKeys = {
  all: ['admin'],
  dashboard: ['admin', 'dashboard'],
  me: ['admin', 'me'],
  shippingStatus: ['admin', 'shipping-status'],
  vendors: (p) => ['admin', 'vendors', p],
  vendor: (id) => ['admin', 'vendor', id],
  users: (p) => ['admin', 'users', p],
  user: (id) => ['admin', 'user', id],
  categories: (p) => ['admin', 'categories', p],
  categoryTree: ['admin', 'category-tree'],
  products: (p) => ['admin', 'products', p],
  product: (id) => ['admin', 'product', id],
  orders: (p) => ['admin', 'orders', p],
  quotes: (p) => ['admin', 'quotes', p],
  reviews: (p) => ['admin', 'reviews', p],
  quote: (id) => ['admin', 'quote', id],
  order: (id) => ['admin', 'order', id],
  shipments: (orderId) => ['admin', 'shipments', orderId],
  returnReasons: ['admin', 'return-reasons'],
  warehouses: ['admin', 'warehouses'],
  banners: ['admin', 'banners'],
  settings: ['admin', 'settings'],
  admins: ['admin', 'admins'],
}

export const adminApi = {
  productImports: createImportApi(a),
  me: () => one(a.get('/me')),
  changePassword: (body) => one(a.post('/me/password', body)),
  dashboard: () => one(a.get('/dashboard')),

  vendors: (params) => list(a.get('/vendors', { params })),
  vendor: (id) => one(a.get(`/vendors/${id}`)),
  vendorBank: (id) => one(a.get(`/vendors/${id}/bank-account`)),
  reviewVendor: (id, body) => one(a.post(`/vendors/${id}/review`, body)),
  suspendVendor: (id, body) => one(a.post(`/vendors/${id}/suspend`, body)),
  reinstateVendor: (id) => one(a.post(`/vendors/${id}/reinstate`)),

  users: (params) => list(a.get('/users', { params })),
  user: (id) => one(a.get(`/users/${id}`)),
  setUserStatus: (id, status) => one(a.patch(`/users/${id}/status`, { status })),

  categories: (params) => list(a.get('/categories', { params })),
  categoryTree: () => one(a.get('/categories/tree')),
  createCategory: (body) => one(a.post('/categories', body)),
  updateCategory: (id, body) => one(a.patch(`/categories/${id}`, body)),
  reviewCategory: (id, body) => one(a.post(`/categories/${id}/review`, body)),
  deleteCategory: (id) => a.delete(`/categories/${id}`),

  products: (params) => list(a.get('/products', { params })),
  product: (id) => one(a.get(`/products/${id}`)),
  updateProduct: (id, body) => one(a.patch(`/products/${id}`, body)),
  reviewProduct: (id, body) => one(a.post(`/products/${id}/review`, body)),

  orders: (params) => list(a.get('/orders', { params })),
  order: (id) => one(a.get(`/orders/${id}`)),
  updateOrderItem: (id, itemId, body) => one(a.patch(`/orders/${id}/items/${itemId}`, body)),

  shipments: (orderId) => one(a.get(`/orders/${orderId}/shipments`)),
  createShipments: (orderId) => one(a.post(`/orders/${orderId}/shipments`)),
  pushShipment: (id) => one(a.post(`/shipments/${id}/push`)),
  shipmentRates: (id) => one(a.post(`/shipments/${id}/rates`)),
  assignCourier: (id, body) => one(a.post(`/shipments/${id}/assign`, body)),
  schedulePickup: (id) => one(a.post(`/shipments/${id}/pickup`)),
  setShipmentAwb: (id, awbNumber) => one(a.post(`/shipments/${id}/awb`, { awbNumber })),
  cancelShipment: (id, reason) => one(a.post(`/shipments/${id}/cancel`, { reason })),
  refreshTracking: (id) => one(a.post(`/shipments/${id}/tracking/refresh`)),
  createReturn: (id, body) => one(a.post(`/shipments/${id}/returns`, body)),
  shipmentLabel: (id) => a.get(`/shipments/${id}/label`, { responseType: 'blob' }).then((r) => r.data),
  returnReasons: () => one(a.get('/shipping/return-reasons')),
  warehouses: () => one(a.get('/shipping/warehouses')),
  shippingHealth: () => one(a.get('/shipping/health')),
  shippingStatus: () => one(a.get('/shipping/status')),

  quotes: (params) => list(a.get('/quotes', { params })),
  reviews: (params) => list(a.get('/reviews', { params })),
  moderateReview: (id, body) => one(a.patch(`/reviews/${id}`, body)),
  quote: (id) => one(a.get(`/quotes/${id}`)),

  banners: () => one(a.get('/banners')),
  createBanner: (body) => one(a.post('/banners', body)),
  updateBanner: (id, body) => one(a.patch(`/banners/${id}`, body)),
  deleteBanner: (id) => a.delete(`/banners/${id}`),

  settings: () => one(a.get('/settings')),
  updateSettings: (key, body) => one(a.put(`/settings/${key}`, body)),

  admins: () => one(a.get('/admins')),
  createAdmin: (body) => one(a.post('/admins', body)),
  updateAdmin: (id, body) => one(a.patch(`/admins/${id}`, body)),
}
