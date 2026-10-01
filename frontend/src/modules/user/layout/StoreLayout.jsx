import { useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, LogOut, MapPin, Menu as MenuIcon, Package, ShoppingCart, Store, User, Wrench } from 'lucide-react'
import { useState } from 'react'
import { Link, Outlet, ScrollRestoration, useNavigate } from 'react-router'
import { signOutEverywhere } from '@/core/api/http'
import { useSessionBootstrap } from '@/core/auth/bootstrap'
import { useSession } from '@/core/auth/session'
import { useBranding } from '@/core/settings/usePublicSettings'
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

  if (status !== 'authenticated') {
    return (
      <Link to="/login" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-100">
        <User className="size-5 text-slate-700" />
        <span className="hidden leading-tight sm:block">
          <span className="block text-xs text-slate-500">Hello, sign in</span>
          <span className="block font-semibold text-slate-900">Account</span>
        </span>
      </Link>
    )
  }
  return (
    <Menu
      trigger={
        <button type="button" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100">
          <span className="grid size-8 place-items-center rounded-full bg-primary-soft text-sm font-bold text-primary uppercase">{account?.name?.[0]}</span>
          <span className="hidden leading-tight sm:block">
            <span className="block text-xs text-slate-500">Hello,</span>
            <span className="block max-w-28 truncate font-semibold text-slate-900">{account?.name?.split(' ')[0]}</span>
          </span>
        </button>
      }
      items={[
        { label: 'My orders', icon: Package, onSelect: () => navigate('/account/orders') },
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
  const { count } = useCart()
  return (
    <Link
      to="/cart"
      className="relative flex items-center gap-3 rounded-md px-2 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-100"
      aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}
    >
      <span className="relative">
        <ShoppingCart className="size-6" />
        {count > 0 && (
          <span className="tabular absolute -top-2 -right-2 min-w-5 rounded-full bg-primary px-1 text-center text-[11px] leading-5 font-bold text-primary-fg">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </span>
      <span className="hidden sm:inline">Cart</span>
    </Link>
  )
}

function Footer() {
  const { siteName, tagline, supportEmail, supportPhone } = useBranding()
  const { data: tree = [] } = useCategoryTree()
  const year = new Date().getFullYear()
  return (
    <footer className="mt-16 bg-secondary text-secondary-fg">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div>
          <Logo inverted />
          {tagline && <p className="mt-3 max-w-xs text-sm text-secondary-fg/70">{tagline}</p>}
        </div>
        <div>
          <h3 className="text-sm font-semibold">Shop</h3>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-secondary-fg/70">
            {tree.slice(0, 6).map((c) => (
              <li key={c._id}>
                <Link to={`/c/${c.slug}`} className="hover:text-secondary-fg">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Sell</h3>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-secondary-fg/70">
            <li>
              <Link to="/vendor/login" className="hover:text-secondary-fg">
                Become a seller
              </Link>
            </li>
            <li>
              <Link to="/vendor" className="hover:text-secondary-fg">
                Seller dashboard
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Help</h3>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-secondary-fg/70">
            <li>
              <Link to="/account/orders" className="hover:text-secondary-fg">
                Track your orders
              </Link>
            </li>
            {supportEmail && (
              <li>
                <a href={`mailto:${supportEmail}`} className="hover:text-secondary-fg">
                  {supportEmail}
                </a>
              </li>
            )}
            {supportPhone && (
              <li>
                <a href={`tel:${supportPhone.replace(/\s/g, '')}`} className="hover:text-secondary-fg">
                  {supportPhone}
                </a>
              </li>
            )}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-7xl px-4 py-5 text-xs text-secondary-fg/60 sm:px-6">
          © {year} {siteName}. All rights reserved.
        </p>
      </div>
    </footer>
  )
}

export default function StoreLayout() {
  useSessionBootstrap('user')
  const { siteName } = useBranding()
  const [menuOpen, setMenuOpen] = useState(false)
  const status = useSession('user', (s) => s.status)

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only z-50 rounded bg-white px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <div className="hidden bg-secondary text-secondary-fg sm:block">
        <div className="mx-auto flex h-9 max-w-7xl items-center justify-between gap-4 px-4 text-xs sm:px-6">
          <p className="flex items-center gap-4 text-secondary-fg/80">
            <span className="flex items-center gap-1.5">
              <BadgeCheck className="size-3.5" /> Every seller is reviewed before listing
            </span>
            <span className="hidden items-center gap-1.5 md:flex">
              <Wrench className="size-3.5" /> Spare parts matched to your machine
            </span>
          </p>
          <Link to="/vendor/login" className="flex items-center gap-1.5 font-medium hover:underline">
            <Store className="size-3.5" /> Sell on {siteName}
          </Link>
        </div>
      </div>

      <header className="sticky top-0 z-30 bg-white shadow-xs">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6">
          <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" aria-label="Open categories" onClick={() => setMenuOpen(true)}>
            <MenuIcon />
          </Button>
          <Logo />
          <SearchBox className="hidden flex-1 md:block" />
          <div className="ml-auto flex items-center gap-1 sm:gap-2 md:ml-0">
            <AccountButton />
            <CartButton />
          </div>
        </div>
        <div className="px-4 pb-3 md:hidden">
          <SearchBox />
        </div>
        <CategoryBar />
      </header>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen} title="Shop by category">
        <CategoryAccordion onNavigate={() => setMenuOpen(false)} />
        <div className="flex flex-col gap-1 p-4 text-sm">
          {status === 'authenticated' ? (
            <Link to="/account/orders" onClick={() => setMenuOpen(false)} className="rounded-md px-3 py-2 font-medium hover:bg-slate-50">
              My orders
            </Link>
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
