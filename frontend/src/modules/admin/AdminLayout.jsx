import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Boxes, FileText, FolderTree, Image, KeyRound, LayoutDashboard, Package, Settings, ShieldCheck, ShoppingBag, Star, Store, Users } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useSession } from '@/core/auth/session'
import { signOutEverywhere } from '@/core/api/http'
import { Logo } from '@/ui/Brand'
import { PanelShell } from '@/ui/PanelShell'
import { useAdminAccess } from './access'
import { adminApi, adminKeys } from './api'

export default function AdminLayout() {
  const { account, isSuper, can } = useAdminAccess()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const sessionId = useSession('admin', (s) => s.account?._id)
  const lastId = useRef(sessionId)
  useEffect(() => {
    if (sessionId && lastId.current && lastId.current !== sessionId) {
      qc.removeQueries({ queryKey: adminKeys.all, predicate: (q) => q.queryKey[1] !== 'me' })
    }
    lastId.current = sessionId
  }, [sessionId, qc])
  // Every page change re-checks access, so new permissions appear on the next click.
  const { pathname } = useLocation()
  useEffect(() => {
    qc.invalidateQueries({ queryKey: adminKeys.me })
  }, [pathname, qc])
  const { data: stats } = useQuery({ queryKey: adminKeys.dashboard, queryFn: adminApi.dashboard, staleTime: 60_000, enabled: can('dashboard') })
  const pending = stats?.pendingApprovals ?? {}
  // Only sections this admin can open; empty groups disappear.
  const allow = (section, item) => (can(section) ? item : null)

  const nav = [
    {
      items: [
        allow('dashboard', { to: '/admin', end: true, label: 'Dashboard', icon: LayoutDashboard }),
        allow('orders', { to: '/admin/orders', label: 'Orders', icon: ShoppingBag }),
        allow('quotes', { to: '/admin/quotes', label: 'Bulk quotes', icon: FileText }),
        allow('reviews', { to: '/admin/reviews', label: 'Reviews', icon: Star }),
      ],
    },
    {
      title: 'Catalogue',
      items: [
        allow('products', { to: '/admin/products', label: 'Products', icon: Package, badge: pending.products }),
        allow('categories', { to: '/admin/categories', label: 'Categories', icon: FolderTree, badge: pending.categories }),
        allow('banners', { to: '/admin/banners', label: 'Banners', icon: Image }),
      ],
    },
    {
      title: 'People',
      items: [
        allow('vendors', { to: '/admin/vendors', label: 'Vendors', icon: Store, badge: pending.vendors }),
        allow('customers', { to: '/admin/customers', label: 'Customers', icon: Users }),
        isSuper && { to: '/admin/admins', label: 'Admins', icon: ShieldCheck },
      ],
    },
    { title: 'System', items: [allow('settings', { to: '/admin/settings', label: 'Settings', icon: Settings })] },
  ]
    .map((g) => ({ ...g, items: g.items.filter(Boolean) }))
    .filter((g) => g.items.length)

  return (
    <PanelShell
      brand={<Logo to="/admin" inverted suffix="Admin" />}
      nav={nav}
      user={{ name: account?.name ?? 'Admin', subtitle: isSuper ? 'Super admin' : account?.fullAccess ? 'Admin · full access' : 'Staff' }}
      menuItems={[
        { label: 'Change password', icon: KeyRound, to: '/admin/account' },
        { label: 'View storefront', icon: Boxes, onSelect: () => window.open('/', '_blank', 'noopener') },
      ]}
      onSignOut={async () => {
        await signOutEverywhere('admin')
        qc.removeQueries({ queryKey: adminKeys.all })
        navigate('/admin/login', { replace: true })
      }}
    />
  )
}
