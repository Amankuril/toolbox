import { useQueryClient } from '@tanstack/react-query'
import { LogOut, MapPin, Package, User } from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { signOutEverywhere } from '@/core/api/http'
import { useSession } from '@/core/auth/session'
import { cn } from '@/core/lib/cn'
import { formatPhone } from '@/core/lib/format'
import { storeKeys } from '../../api'

const NAV = [
  { to: '/account/orders', label: 'Orders', icon: Package },
  { to: '/account/addresses', label: 'Addresses', icon: MapPin },
  { to: '/account/profile', label: 'Profile', icon: User },
]

export default function AccountLayout() {
  const account = useSession('user', (s) => s.account)
  const navigate = useNavigate()
  const qc = useQueryClient()
  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6 md:grid-cols-[220px_1fr]">
      <aside>
        <div className="mb-4 px-1">
          <p className="font-semibold text-slate-900">{account?.name}</p>
          <p className="text-sm text-slate-500">{formatPhone(account?.phone)}</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto md:flex-col" aria-label="Account">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                cn(
                  'flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium',
                  isActive ? 'bg-primary-soft text-primary' : 'text-slate-700 hover:bg-white',
                )
              }
            >
              <n.icon className="size-4" /> {n.label}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={async () => {
              await signOutEverywhere('user')
              qc.removeQueries({ queryKey: storeKeys.user })
              navigate('/')
            }}
            className="flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-white"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </nav>
      </aside>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
