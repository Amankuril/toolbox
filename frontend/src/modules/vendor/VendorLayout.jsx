import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Clock, FileText, FolderTree, LayoutDashboard, Package, ShoppingBag, Store, TriangleAlert } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { signOutEverywhere } from '@/core/api/http'
import { formatPhone } from '@/core/lib/format'
import { Logo } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { PanelShell } from '@/ui/PanelShell'
import { useVendor, vendorApi, vendorKeys } from './api'

const buildNav = (newQuotes) => [
  {
    items: [
      { to: '/vendor', end: true, label: 'Dashboard', icon: LayoutDashboard },
      { to: '/vendor/orders', label: 'Orders', icon: ShoppingBag },
      { to: '/vendor/quotes', label: 'Quote requests', icon: FileText, badge: newQuotes },
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

/** Status banner shown across the panel until the vendor is approved. */
function StatusBanner({ vendor }) {
  if (!vendor || vendor.status === 'approved') return null
  const content = {
    onboarding: {
      tone: 'bg-primary-soft text-slate-800',
      icon: ArrowRight,
      text: 'Finish setting up your store to start selling.',
      action: 'Continue setup',
    },
    rejected: {
      tone: 'bg-amber-50 text-amber-900',
      icon: TriangleAlert,
      text: vendor.review?.note ? `Changes requested: ${vendor.review.note}` : 'Our team requested changes to your application.',
      action: 'Update details',
    },
    pending_review: {
      tone: 'bg-sky-50 text-sky-900',
      icon: Clock,
      text: "Your application is under review. You can list products as soon as you're approved.",
    },
  }[vendor.status]
  if (!content) return null
  return (
    <div className={`flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 text-sm sm:px-6 ${content.tone}`}>
      <content.icon className="size-4 shrink-0" />
      <p className="min-w-0 flex-1">{content.text}</p>
      {content.action && (
        <Button size="sm" asChild>
          <Link to="/vendor/onboarding">{content.action}</Link>
        </Button>
      )}
    </div>
  )
}

export default function VendorLayout() {
  const vendor = useVendor()
  const { data: quotes } = useQuery({
    queryKey: vendorKeys.quotes({ summary: true }),
    queryFn: () => vendorApi.quotes({ limit: 1 }),
    enabled: vendor?.status === 'approved',
    refetchInterval: 60_000,
  })
  const navigate = useNavigate()
  const qc = useQueryClient()
  return (
    <PanelShell
      brand={<Logo to="/vendor" inverted suffix="Seller" />}
      nav={buildNav(quotes?.meta?.counts?.requested ?? 0)}
      user={{ name: vendor?.store?.name ?? 'Your store', subtitle: formatPhone(vendor?.phone) }}
      menuItems={[{ label: 'Store profile', icon: Store, to: '/vendor/profile' }]}
      banner={<StatusBanner vendor={vendor} />}
      onSignOut={async () => {
        await signOutEverywhere('vendor')
        qc.removeQueries({ queryKey: vendorKeys.all })
        navigate('/vendor/login', { replace: true })
      }}
    />
  )
}
