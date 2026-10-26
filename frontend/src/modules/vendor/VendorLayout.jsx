import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, ChartColumn, FileText, FolderTree, LayoutDashboard, Package, ShoppingBag, Store, TicketPercent, UserRoundSearch } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router'
import { signOutEverywhere } from '@/core/api/http'
import { formatPhone } from '@/core/lib/format'
import { Logo } from '@/ui/Brand'
import { PanelShell } from '@/ui/PanelShell'
import { useVendor, vendorApi, vendorKeys } from './api'

const buildNav = (newQuotes, abandonedCarts) => [
  {
    items: [
      { to: '/vendor', end: true, label: 'Dashboard', icon: LayoutDashboard },
      { to: '/vendor/analytics', label: 'Store analytics', icon: ChartColumn },
      { to: '/vendor/orders', label: 'Orders', icon: ShoppingBag },
      { to: '/vendor/quotes', label: 'Quote requests', icon: FileText, badge: newQuotes },
    ],
  },
  {
    title: 'Customers',
    items: [
      { to: '/vendor/leads', label: 'Leads', icon: UserRoundSearch, badge: abandonedCarts },
      { to: '/vendor/enquiries', label: 'Enquiries', icon: BellRing },
      { to: '/vendor/coupons', label: 'Coupons', icon: TicketPercent },
    ],
  },
  {
    title: 'Catalogue',
    items: [
      { to: '/vendor/products', label: 'Products', icon: Package },
      { to: '/vendor/categories', label: 'Categories', icon: FolderTree },
    ],
  },
  { title: 'Store', items: [{ to: '/vendor/profile', label: 'Store profile', icon: Store }] },
]

export default function VendorLayout() {
  const vendor = useVendor()
  const { data: quotes } = useQuery({
    queryKey: vendorKeys.quotes({ summary: true }),
    queryFn: () => vendorApi.quotes({ limit: 1 }),
    enabled: vendor?.status === 'approved',
    refetchInterval: 60_000,
  })
  const { data: leadCounts } = useQuery({
    queryKey: vendorKeys.leadCounts,
    queryFn: vendorApi.leadCounts,
    enabled: vendor?.status === 'approved',
    refetchInterval: 60_000,
  })
  const navigate = useNavigate()
  const qc = useQueryClient()
  // The seller panel opens only once an admin approves the store; until then the application page shows its status.
  if (vendor && vendor.status !== 'approved') return <Navigate to="/vendor/onboarding" replace />
  return (
    <PanelShell
      brand={<Logo to="/vendor" inverted suffix="Seller" />}
      nav={buildNav(quotes?.meta?.counts?.requested ?? 0, leadCounts?.abandoned ?? 0)}
      user={{ name: vendor?.store?.name ?? 'Your store', subtitle: formatPhone(vendor?.phone) }}
      menuItems={[{ label: 'Store profile', icon: Store, to: '/vendor/profile' }]}
      onSignOut={async () => {
        await signOutEverywhere('vendor')
        qc.removeQueries({ queryKey: vendorKeys.all })
        navigate('/vendor/login', { replace: true })
      }}
    />
  )
}
