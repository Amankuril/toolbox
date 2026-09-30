import { LogOut, Menu as MenuIcon } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { cn } from '@/core/lib/cn'
import { Button } from './Button'
import { Menu } from './Controls'
import { Sheet } from './Dialog'

/**
 * Sidebar + top bar layout shared by the admin and vendor panels.
 * Sidebar colour follows the module's `secondary` theme colour.
 *
 * @param {{ brand: any, nav: { to: string, label: string, icon: any, end?: boolean, badge?: number }[][], user: { name: string, subtitle?: string },
 *   menuItems?: any[], onSignOut: () => void, banner?: any }} props
 */
export function PanelShell({ brand, nav, user, menuItems = [], onSignOut, banner, children }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  const sidebar = (
    <nav className="flex flex-col gap-6 px-3 py-4" aria-label="Main">
      {nav.map((group, gi) => (
        <div key={gi} className="flex flex-col gap-0.5">
          {group.title && <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-secondary-fg/50 uppercase">{group.title}</p>}
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors [&_svg]:size-[18px]',
                  isActive ? 'bg-primary text-primary-fg shadow-sm' : 'text-secondary-fg/75 hover:bg-white/8 hover:text-secondary-fg',
                )
              }
            >
              <item.icon />
              <span className="flex-1">{item.label}</span>
              {item.badge > 0 && <span className="tabular rounded-full bg-amber-400 px-1.5 text-[11px] font-bold text-amber-950">{item.badge}</span>}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )

  return (
    <div className="min-h-dvh bg-slate-50 lg:grid lg:grid-cols-[256px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col overflow-y-auto bg-secondary lg:flex">
        <div className="flex h-16 shrink-0 items-center px-5">{brand}</div>
        {sidebar}
      </aside>

      <Sheet open={open} onOpenChange={setOpen} title="Menu">
        <div className="min-h-full bg-secondary">{sidebar}</div>
      </Sheet>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
            <MenuIcon />
          </Button>
          <div className="lg:hidden">{brand}</div>
          <div className="flex-1" />
          <Menu
            trigger={
              <button type="button" className="flex items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-slate-100">
                <span className="grid size-9 place-items-center rounded-full bg-primary-soft text-sm font-bold text-primary uppercase">{user.name?.[0] ?? '?'}</span>
                <span className="hidden min-w-0 sm:block">
                  <span className="block truncate text-sm font-semibold text-slate-900">{user.name}</span>
                  {user.subtitle && <span className="block truncate text-xs text-slate-500">{user.subtitle}</span>}
                </span>
              </button>
            }
            items={[
              ...menuItems.map((m) => ({ ...m, onSelect: m.to ? () => navigate(m.to) : m.onSelect })),
              menuItems.length ? 'separator' : null,
              { label: 'Sign out', icon: LogOut, onSelect: onSignOut, danger: true },
            ]}
          />
        </header>
        {banner}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:py-8">{children ?? <Outlet />}</main>
      </div>
    </div>
  )
}
