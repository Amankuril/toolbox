import { api, one } from '@/core/api/http'
import { SellerContext } from '@/modules/vendor/seller'
import ProductFormPage from '@/modules/vendor/pages/ProductFormPage'
import { adminApi, adminKeys } from './api'

const a = api.admin
const keys = {
  all: adminKeys.all,
  dashboard: adminKeys.dashboard,
  categories: ['admin', 'catalog-categories'],
  products: adminKeys.products,
  product: adminKeys.product,
}

/**
 * The seller product form, pointed at the admin API: admins edit any seller's (or the house store's) listing
 * with every field a seller has. Saving never sends it for review; the admin is the reviewer.
 * @type {import('@/modules/vendor/seller').Seller & { adminEdit: true }}
 */
const catalogSeller = {
  api: {
    product: adminApi.product,
    updateProduct: adminApi.updateProduct,
    products: adminApi.products,
    categories: () => one(a.get('/categories/for-products')),
    createCategory: adminApi.createCategory,
    updateCategory: adminApi.updateCategory,
    compatibilitySearch: (q) => one(a.get('/products/compatibility-search', { params: { q } })),
  },
  keys,
  base: '/admin',
  audience: 'admin',
  uploadPath: '/media',
  // No review step and no seller account to check.
  isStore: true,
  adminEdit: true,
  useAccount: () => undefined,
  cloneSource: adminApi.product,
}

/** /admin/products/:id/edit */
export default function AdminProductEditPage() {
  return (
    <SellerContext.Provider value={catalogSeller}>
      <ProductFormPage />
    </SellerContext.Provider>
  )
}
