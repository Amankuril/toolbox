import { useQueryClient } from '@tanstack/react-query'
import { FileText, LogOut, MapPin, Menu as MenuIcon, Package, ShoppingCart, User } from 'lucide-react'
import { useState } from 'react'
import { Link, Outlet, ScrollRestoration, useNavigate } from 'react-router'
import { signOutEverywhere } from '@/core/api/http'
import { useSessionBootstrap } from '@/core/auth/bootstrap'
import { useSession } from '@/core/auth/session'
import { formatINR } from '@/core/lib/format'
import { usePublicSettings } from '@/core/settings/usePublicSettings'
import { Logo } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Menu } from '@/ui/Controls'
import { Sheet } from '@/ui/Dialog'
import { storeKeys } from '../api'
import { useCart } from '../cart/useCart'
import { useCategoryTree } from '../hooks'
import { CategoryAccordion, CategoryBar } from './CategoryNav'
import { SearchBox } from './SearchBox'

function AccountButton() {
  const status = useSession('user', (s) => s.status)
  const account = useSession('user', (s) => s.account)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const label = (
    <span className="hidden leading-tight sm:block">
      <span className="block text-xs text-slate-500">{status === 'authenticated' ? `Hi, ${account?.name?.split(' ')[0] ?? ''}` : 'Sign in'}</span>
      <span className="block text-sm font-semibold text-slate-900">Account</span>
    </span>
  )

  if (status !== 'authenticated') {
    return (
      <Link to="/login" className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-100">
        <User className="size-6 text-slate-800" strokeWidth={1.75} />
        {label}
      </Link>
    )
  }
  return (
    <Menu
      trigger={
        <button type="button" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-100">
          <User className="size-6 text-slate-800" strokeWidth={1.75} />
          {label}
        </button>
      }
      items={[
        { label: 'Orders', icon: Package, onSelect: () => navigate('/account/orders') },
        { label: 'Bulk quotes', icon: FileText, onSelect: () => navigate('/account/quotes') },
        { label: 'Addresses', icon: MapPin, onSelect: () => navigate('/account/addresses') },
        { label: 'Profile', icon: User, onSelect: () => navigate('/account/profile') },
        'separator',
        {
          label: 'Sign out',
          icon: LogOut,
          danger: true,
          onSelect: async () => {
            await signOutEverywhere('user')
            qc.removeQueries({ queryKey: storeKeys.user })
            navigate('/')
          },
        },
      ]}
    />
  )
}

function CartButton() {
  const { count, summary } = useCart()
  return (
    <Link
      to="/cart"
      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-slate-100"
      aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}
    >
      <span className="relative">
        <ShoppingCart className="size-6 text-slate-800" strokeWidth={1.75} />
        {count > 0 && (
          <span className="tabular absolute -top-2 -right-2 min-w-5 rounded-full bg-accent px-1 text-center text-[11px] leading-5 font-bold text-accent-fg ring-2 ring-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </span>
      <span className="hidden leading-tight sm:block">
        <span className="block text-xs text-slate-500">Cart</span>
        <span className="tabular block text-sm font-semibold text-slate-900">{count > 0 ? formatINR(summary.subtotal, { whole: true }) : 'Empty'}</span>
      </span>
    </Link>
  )
}

function Footer() {
  const { data: settings } = usePublicSettings()
  const { siteName, tagline, supportEmail, supportPhone } = settings?.branding ?? { siteName: 'ToolsHubs' }
  const { data: tree = [] } = useCategoryTree()
  const payments = settings?.payments
  const payWith = [payments?.razorpayEnabled && 'UPI, cards & net banking', payments?.codEnabled && 'Cash on delivery'].filter(Boolean)

  const col = 'flex flex-col gap-2.5 text-sm text-secondary-fg/70'
  const head = 'code mb-4 text-xs tracking-[0.12em] text-accent uppercase'
  return (
    <footer className="mt-20 bg-secondary text-secondary-fg">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo inverted />
          {tagline && <p className="mt-4 max-w-xs text-sm leading-relaxed text-secondary-fg/70">{tagline}</p>}
          {(supportPhone || supportEmail) && (
            <div className="mt-6 text-sm">
              <p className="text-secondary-fg/50">Customer support</p>
              {supportPhone && (
                <a href={`tel:${supportPhone.replace(/\s/g, '')}`} className="mt-1 block font-display text-xl font-bold hover:underline">
                  {supportPhone}
                </a>
              )}
              {supportEmail && (
                <a href={`mailto:${supportEmail}`} className="block text-secondary-fg/80 hover:underline">
                  {supportEmail}
                </a>
              )}
            </div>
          )}
        </div>
        <div>
          <h3 className={head}>Departments</h3>
          <ul className={col}>
            {tree.slice(0, 7).map((c) => (
              <li key={c._id}>
                <Link to={`/c/${c.slug}`} className="hover:text-secondary-fg">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className={head}>Buying</h3>
          <ul className={col}>
            <li>
              <Link to="/search?bulk=true" className="hover:text-secondary-fg">
                Bulk deals
              </Link>
            </li>
            <li>
              <Link to="/account/quotes" className="hover:text-secondary-fg">
                Your quotes
              </Link>
            </li>
            <li>
              <Link to="/account/orders" className="hover:text-secondary-fg">
                Track an order
              </Link>
            </li>
            <li>
              <Link to="/account/profile" className="hover:text-secondary-fg">
                Business account
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <h3 className={head}>Selling</h3>
          <ul className={col}>
            <li>
              <Link to="/vendor/login" className="hover:text-secondary-fg">
                Sell on {siteName}
              </Link>
            </li>
            <li>
              <Link to="/vendor" className="hover:text-secondary-fg">
                Seller dashboard
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-secondary-fg/55 sm:px-6">
          <p>
            © {new Date().getFullYear()} {siteName}
          </p>
          {payWith.length > 0 && <p>Pay with {payWith.join(' · ')}</p>}
        </div>
      </div>
    </footer>
  )
}

export default function StoreLayout() {
  useSessionBootstrap('user')
  const { data: settings } = usePublicSettings()
  const siteName = settings?.branding?.siteName ?? 'ToolsHubs'
  const [menuOpen, setMenuOpen] = useState(false)
  const status = useSession('user', (s) => s.status)

  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <a href="#main" className="sr-only z-50 rounded bg-white px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>

      <div className="hidden bg-secondary text-secondary-fg sm:block">
        <div className="mx-auto flex h-8 max-w-7xl items-center justify-between gap-4 px-4 text-xs text-secondary-fg/75 sm:px-6">
          <p>
            <span className="font-semibold text-secondary-fg">Buying for a business?</span> Price breaks on eligible items, and quotes for large orders.
          </p>
          <nav aria-label="Utility" className="flex items-center gap-5">
            <Link to="/account/orders" className="hover:text-secondary-fg hover:underline">
              Track order
            </Link>
            <Link to="/vendor/login" className="font-semibold text-accent hover:underline">
              Sell on {siteName}
            </Link>
          </nav>
        </div>
      </div>

      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2 sm:gap-5 sm:px-6 lg:py-2.5">
          <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" aria-label="Open departments" onClick={() => setMenuOpen(true)}>
            <MenuIcon />
          </Button>
          <Logo />
          <SearchBox className="hidden flex-1 md:block" />
          <div className="ml-auto flex items-center gap-1 sm:gap-3 md:ml-0">
            <AccountButton />
            <CartButton />
          </div>
        </div>
        <div className="px-4 pb-2.5 md:hidden">
          <SearchBox compact />
        </div>
        <CategoryBar />
      </header>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen} title="Departments">
        <CategoryAccordion onNavigate={() => setMenuOpen(false)} />
        <div className="flex flex-col gap-1 p-4 text-sm">
          <Link to="/search?bulk=true" onClick={() => setMenuOpen(false)} className="rounded-md px-3 py-2 font-medium hover:bg-slate-50">
            Bulk deals
          </Link>
          {status === 'authenticated' ? (
            <>
              <Link to="/account/orders" onClick={() => setMenuOpen(false)} className="rounded-md px-3 py-2 font-medium hover:bg-slate-50">
                Your orders
              </Link>
              <Link to="/account/quotes" onClick={() => setMenuOpen(false)} className="rounded-md px-3 py-2 font-medium hover:bg-slate-50">
                Your quotes
              </Link>
            </>
          ) : (
            <Link to="/login" onClick={() => setMenuOpen(false)} className="rounded-md px-3 py-2 font-medium hover:bg-slate-50">
              Sign in
            </Link>
          )}
          <Link to="/vendor/login" onClick={() => setMenuOpen(false)} className="rounded-md px-3 py-2 font-medium text-primary hover:bg-slate-50">
            Sell on {siteName}
          </Link>
        </div>
      </Sheet>

      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <ScrollRestoration />
    </div>
  )
}
