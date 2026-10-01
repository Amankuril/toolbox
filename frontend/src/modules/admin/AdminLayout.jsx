import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Boxes, FileText, FolderTree, Image, KeyRound, LayoutDashboard, Package, Settings, ShieldCheck, ShoppingBag, Store, Users } from 'lucide-react'
import { useNavigate } from 'react-router'
import { signOutEverywhere } from '@/core/api/http'
import { useSession } from '@/core/auth/session'
import { titleCase } from '@/core/lib/format'
import { Logo } from '@/ui/Brand'
import { PanelShell } from '@/ui/PanelShell'
import { adminApi, adminKeys } from './api'

export default function AdminLayout() {
  const account = useSession('admin', (s) => s.account)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: stats } = useQuery({ queryKey: adminKeys.dashboard, queryFn: adminApi.dashboard, staleTime: 60_000 })
  const pending = stats?.pendingApprovals ?? {}
  const isSuper = account?.adminRole === 'super_admin'

  const nav = [
    {
      items: [
        { to: '/admin', end: true, label: 'Dashboard', icon: LayoutDashboard },
        { to: '/admin/orders', label: 'Orders', icon: ShoppingBag },
        { to: '/admin/quotes', label: 'Bulk quotes', icon: FileText },
      ],
    },
    {
      title: 'Catalogue',
      items: [
        { to: '/admin/products', label: 'Products', icon: Package, badge: pending.products },
        { to: '/admin/categories', label: 'Categories', icon: FolderTree, badge: pending.categories },
        { to: '/admin/banners', label: 'Banners', icon: Image },
      ],
    },
    {
      title: 'People',
      items: [
        { to: '/admin/vendors', label: 'Vendors', icon: Store, badge: pending.vendors },
        { to: '/admin/customers', label: 'Customers', icon: Users },
        isSuper && { to: '/admin/admins', label: 'Admins', icon: ShieldCheck },
      ].filter(Boolean),
    },
    { title: 'System', items: [{ to: '/admin/settings', label: 'Settings', icon: Settings }] },
  ]

  return (
    <PanelShell
      brand={<Logo to="/admin" inverted suffix="Admin" />}
      nav={nav}
      user={{ name: account?.name ?? 'Admin', subtitle: titleCase(account?.adminRole ?? '') }}
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
