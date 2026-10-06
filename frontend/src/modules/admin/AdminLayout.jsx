import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Boxes,
  FileText,
  FolderTree,
  Image,
  KeyRound,
  LayoutDashboard,
  Package,
  Settings,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Star,
  Store,
  Users,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useSession } from '@/core/auth/session'
import { signOutEverywhere } from '@/core/api/http'
import { cn } from '@/core/lib/cn'
import { Logo } from '@/ui/Brand'
import { PanelShell } from '@/ui/PanelShell'
import { useAdminAccess } from './access'
import { adminApi, adminKeys } from './api'
import { storeSeller } from './store/seller'

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

  const adminNav = [
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

  // Two workspaces in one panel: the marketplace (Admin) and the platform's own store (Store).
  const inStore = pathname === '/admin/store' || pathname.startsWith('/admin/store/')
  const hasStore = can('store')
  const hasAdmin = adminNav.length > 0
  const { data: storeQuotes } = useQuery({
    queryKey: storeSeller.keys.quotes({ summary: true }),
    queryFn: () => storeSeller.api.quotes({ limit: 1 }),
    enabled: hasStore,
    refetchInterval: 60_000,
  })
  // Same menu as the seller panel, so the store has everything a seller has.
  const storeNav = [
    {
      items: [
        { to: '/admin/store', end: true, label: 'Overview', icon: LayoutDashboard },
        { to: '/admin/store/orders', label: 'Orders', icon: ShoppingBag },
        { to: '/admin/store/quotes', label: 'Quote requests', icon: FileText, badge: storeQuotes?.meta?.counts?.requested ?? 0 },
      ],
    },
    {
      title: 'Catalogue',
      items: [
        { to: '/admin/store/products', label: 'Products', icon: Package },
        { to: '/admin/store/categories', label: 'Categories', icon: FolderTree },
      ],
    },
    { title: 'Store', items: [{ to: '/admin/store/settings', label: 'Store settings', icon: SlidersHorizontal }] },
  ]

  // Each tab reopens the page you were last on in it.
  const lastPath = useRef({ admin: null, store: null })
  useEffect(() => {
    lastPath.current[inStore ? 'store' : 'admin'] = pathname
  }, [pathname, inStore])
  const adminLanding = adminNav[0]?.items[0]?.to ?? '/admin'
  const switchTo = (mode) => navigate(lastPath.current[mode] ?? (mode === 'store' ? '/admin/store' : adminLanding))

  const switcher = hasStore && hasAdmin && (
    <div role="tablist" aria-label="Workspace" className="grid grid-cols-2 gap-1 rounded-lg bg-black/25 p-1">
      {[
        { mode: 'admin', label: 'Admin', icon: ShieldCheck, active: !inStore },
        { mode: 'store', label: 'Store', icon: Store, active: inStore },
      ].map((t) => (
        <button
          key={t.mode}
          type="button"
          role="tab"
          aria-selected={t.active}
          onClick={() => !t.active && switchTo(t.mode)}
          className={cn(
            'flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors [&_svg]:size-4',
            t.active ? 'bg-accent text-accent-fg shadow-sm' : 'text-secondary-fg/70 hover:bg-white/8 hover:text-secondary-fg',
          )}
        >
          <t.icon /> {t.label}
        </button>
      ))}
    </div>
  )
  const nav = inStore || !hasAdmin ? (hasStore ? storeNav : []) : adminNav

  return (
    <PanelShell
      brand={<Logo to={inStore ? '/admin/store' : '/admin'} inverted suffix={inStore ? 'Store' : 'Admin'} />}
      switcher={switcher}
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
