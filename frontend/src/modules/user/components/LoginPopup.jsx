import { useQueryClient } from '@tanstack/react-query'
import { BadgePercent, FileText, PackageCheck, Truck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useSession } from '@/core/auth/session'
import { safeStorage } from '@/core/lib/storage'
import { useBranding, usePublicSettings } from '@/core/settings/usePublicSettings'
import { OtpSignIn } from '@/modules/auth/OtpSignIn'
import { Dialog } from '@/ui/Dialog'
import { mergeGuestCart } from '../cart/useCart'
import { mergeGuestWishlist } from '../wishlist/useWishlist'

const CLOSED_KEY = 'login-popup-closed'
const DAY = 24 * 60 * 60 * 1000
// Pages that already ask for sign-in, or where an interruption costs a sale.
const QUIET_PATHS = /^\/(checkout|pay\/|login|onboarding|account|cart)/

const PERKS = [
  { icon: Truck, text: 'Track every order and shipment' },
  { icon: BadgePercent, text: 'Coupons and offers saved to your account' },
  { icon: FileText, text: 'Bulk quotes and GST invoices' },
  { icon: PackageCheck, text: 'Faster checkout with saved addresses' },
]

/**
 * Sign-in prompt for visitors who aren't signed in, a few seconds after they arrive (admin: Settings →
 * Storefront). Closing it keeps them browsing and hides it for a few days on that browser.
 */
export function LoginPopup() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { siteName } = useBranding()
  const config = usePublicSettings().data?.storefront
  const status = useSession('user', (s) => s.status)
  const [closedAt] = useState(() => safeStorage.get(CLOSED_KEY, 0))
  const [now] = useState(() => Date.now())
  const [due, setDue] = useState(false)
  const [closed, setClosed] = useState(false)

  const eligible =
    Boolean(config?.loginPopupEnabled) &&
    status === 'anonymous' &&
    !QUIET_PATHS.test(pathname) &&
    now - closedAt > (config?.loginPopupRepeatDays ?? 3) * DAY

  useEffect(() => {
    if (!eligible || due) return
    const t = setTimeout(() => setDue(true), (config?.loginPopupDelaySeconds ?? 4) * 1000)
    return () => clearTimeout(t)
  }, [eligible, due, config?.loginPopupDelaySeconds])

  const open = eligible && due && !closed
  const close = () => {
    safeStorage.set(CLOSED_KEY, Date.now())
    setClosed(true)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && close()}
      size="lg"
      title={`Welcome to ${siteName}`}
      description="Sign in or create an account in under a minute. You can also keep browsing as a guest."
    >
      <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <ul className="hidden flex-col gap-3 self-center rounded-md bg-slate-50 p-4 sm:flex">
          {PERKS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-2.5 text-sm text-slate-700">
              <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
              {text}
            </li>
          ))}
        </ul>
        <div>
          <OtpSignIn
            audience="user"
            onAuthenticated={async () => {
              setClosed(true)
              await Promise.all([mergeGuestCart(qc), mergeGuestWishlist(qc)])
            }}
            onOnboarding={(state) => {
              setClosed(true)
              navigate('/onboarding', { state: { ...state, next: pathname } })
            }}
          />
          <button type="button" onClick={close} className="mt-4 w-full text-center text-sm font-medium text-slate-500 hover:text-slate-900 hover:underline">
            Continue as guest
          </button>
        </div>
      </div>
    </Dialog>
  )
}
