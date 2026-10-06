import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/core/auth/session'
import { adminApi, adminKeys } from './api'

/** Sections and where each lives in the panel (order = fallback landing order). */
export const SECTIONS = [
  { key: 'dashboard', label: 'Dashboard', help: 'Sales and order figures', to: '/admin' },
  { key: 'orders', label: 'Orders & shipping', help: 'Orders, fulfilment, shipments, labels and returns', to: '/admin/orders' },
  { key: 'products', label: 'Products', help: 'Listings, moderation and bulk upload', to: '/admin/products' },
  { key: 'store', label: 'Our store', help: "The platform's own store: its products, orders, shipping and store settings", to: '/admin/store' },
  { key: 'vendors', label: 'Vendors', help: 'Seller applications, approvals and bank details', to: '/admin/vendors' },
  { key: 'customers', label: 'Customers', help: 'Customer accounts and blocking', to: '/admin/customers' },
  { key: 'categories', label: 'Categories', help: 'Category tree and proposals', to: '/admin/categories' },
  { key: 'quotes', label: 'Bulk quotes', help: 'Quote requests between buyers and sellers', to: '/admin/quotes' },
  { key: 'reviews', label: 'Reviews', help: 'Hide or publish product reviews', to: '/admin/reviews' },
  { key: 'banners', label: 'Banners', help: 'Home page banners', to: '/admin/banners' },
  { key: 'media', label: 'Media library', help: 'Browse and delete uploaded files', to: null },
  { key: 'settings', label: 'Settings', help: 'Theme, branding, payments, shipping, storage', to: '/admin/settings' },
]
const RANK = { none: 0, view: 1, manage: 2 }

/**
 * What the signed-in admin may do. Re-read from the server on every page change (AdminLayout),
 * on focus, every 30s and after any "no permission" reply, so a super admin's changes show up without signing out (the server
 * enforces them regardless). The cached copy is keyed by admin id, so signing in as someone
 * else on the same browser can never show the previous admin's access.
 */
export function useAdminAccess() {
  const session = useSession('admin', (s) => s.account)
  const id = session?._id
  const { data: me } = useQuery({
    queryKey: [...adminKeys.me, id],
    queryFn: adminApi.me,
    enabled: Boolean(id),
    staleTime: 10_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    // Picks up a super admin's change even if this admin just sits on one page.
    refetchInterval: 30_000,
  })
  const account = me && me._id === id ? me : session
  const permissions = account?.permissions ?? {}
  const isSuper = account?.adminRole === 'super_admin'
  const can = (section, level = 'view') => isSuper || RANK[permissions[section] ?? (account?.fullAccess ? 'manage' : 'none')] >= RANK[level]
  return { account, isSuper, can, loaded: Boolean(account) }
}

/** Where to land when the dashboard isn't available. */
export function useLanding() {
  const { can } = useAdminAccess()
  return SECTIONS.find((s) => s.to && can(s.key))?.to ?? null
}
