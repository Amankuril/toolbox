import { api, list, one, publicApi } from '@/core/api/http'

const u = api.user

export const storeKeys = {
  tree: ['public', 'category-tree'],
  category: (slug) => ['public', 'category', slug],
  products: (p) => ['public', 'products', p],
  product: (slug) => ['public', 'product', slug],
  suggest: (q) => ['public', 'suggest', q],
  banners: ['public', 'banners'],
  store: (slug) => ['public', 'store', slug],
  user: ['user'],
  me: ['user', 'me'],
  cart: ['user', 'cart'],
  addresses: ['user', 'addresses'],
  orders: (p) => ['user', 'orders', p],
  order: (id) => ['user', 'order', id],
  tracking: (id) => ['user', 'order', id, 'tracking'],
  quotes: (p) => ['user', 'quotes', p],
  quote: (id) => ['user', 'quote', id],
}

/** Anonymous storefront reads. */
export const storeApi = {
  categoryTree: () => one(publicApi.get('/public/categories/tree')),
  category: (slug) => one(publicApi.get(`/public/categories/${slug}`)),
  products: (params) => list(publicApi.get('/public/products', { params })),
  product: (slug) => one(publicApi.get(`/public/products/${slug}`)),
  suggest: (q) => one(publicApi.get('/public/products/suggest', { params: { q } })),
  banners: () => one(publicApi.get('/public/banners')),
  store: (slug) => one(publicApi.get(`/public/stores/${slug}`)),
}

/** Signed-in customer. */
export const userApi = {
  register: (body) => one(publicApi.post('/auth/user/register', body)),
  me: () => one(u.get('/me')),
  updateMe: (body) => one(u.patch('/me', body)),

  addresses: () => one(u.get('/addresses')),
  addAddress: (body) => one(u.post('/addresses', body)),
  updateAddress: (id, body) => one(u.patch(`/addresses/${id}`, body)),
  removeAddress: (id) => one(u.delete(`/addresses/${id}`)),

  cart: () => one(u.get('/cart')),
  setCartItem: (productId, quantity) => one(u.put(`/cart/items/${productId}`, { quantity })),
  removeCartItem: (productId) => one(u.delete(`/cart/items/${productId}`)),
  mergeCart: (items) => one(u.post('/cart/merge', { items })),

  orders: (params) => list(u.get('/orders', { params })),
  order: (id) => one(u.get(`/orders/${id}`)),
  checkout: (body) => one(u.post('/orders/checkout', body)),
  verifyPayment: (id, body) => one(u.post(`/orders/${id}/payment/verify`, body)),
  retryPayment: (id) => one(u.post(`/orders/${id}/payment/retry`)),
  paymentFailed: (id, reason) => one(u.post(`/orders/${id}/payment/failed`, { reason })),
  tracking: (id) => one(u.get(`/orders/${id}/tracking`)),
  cancelItem: (id, itemId, reason) => one(u.post(`/orders/${id}/items/${itemId}/cancel`, { reason })),

  quotes: (params) => list(u.get('/quotes', { params })),
  quote: (id) => one(u.get(`/quotes/${id}`)),
  requestQuote: (body) => one(u.post('/quotes', body)),
  acceptQuote: (id) => one(u.post(`/quotes/${id}/accept`)),
  rejectQuote: (id, reason) => one(u.post(`/quotes/${id}/reject`, { reason })),
  withdrawQuote: (id) => one(u.post(`/quotes/${id}/withdraw`)),
}
