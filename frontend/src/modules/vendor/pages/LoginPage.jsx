import { LayoutDashboard, PackageCheck, ShieldCheck, Truck } from 'lucide-react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { safeNext, useSessionBootstrap } from '@/core/auth/bootstrap'
import { useBranding } from '@/core/settings/usePublicSettings'
import { OtpSignIn } from '@/modules/auth/OtpSignIn'
import { Logo } from '@/ui/Brand'
import { FullPageLoader } from '@/ui/Spinner'

const PERKS = [
  { icon: LayoutDashboard, title: 'One simple dashboard', text: 'Manage products, stock and orders in one place.' },
  { icon: PackageCheck, title: 'Tools, machinery & parts', text: 'List everything you sell, including spares that fit specific machines.' },
  { icon: Truck, title: 'Simple fulfilment', text: 'Confirm, pack and ship each item, with tracking for the buyer.' },
  { icon: ShieldCheck, title: 'Secure payouts', text: 'Bank details are encrypted and only used for settlements.' },
]

const destinationFor = (account, next) => (['onboarding', 'rejected'].includes(account?.status) ? '/vendor/onboarding' : next)

export default function VendorLoginPage() {
  const status = useSessionBootstrap('vendor', { always: true })
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { siteName, supportEmail } = useBranding()
  const next = safeNext(params.get('next'), '/vendor')

  if (status === 'idle' || status === 'checking') return <FullPageLoader />
  if (status === 'authenticated') return <Navigate to={next} replace />

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="hidden flex-col justify-between bg-secondary p-10 text-secondary-fg lg:flex">
        <Logo to="/" inverted suffix="Seller" />
        <div>
          <h1 className="max-w-lg text-4xl leading-tight font-bold">Grow your tools &amp; machinery business with {siteName}.</h1>
          <ul className="mt-10 grid max-w-xl gap-6 sm:grid-cols-2">
            {PERKS.map((p) => (
              <li key={p.title} className="flex gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white/10">
                  <p.icon className="size-5" />
                </span>
                <span>
                  <span className="block font-semibold">{p.title}</span>
                  <span className="mt-0.5 block text-sm text-secondary-fg/70">{p.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-secondary-fg/50">{supportEmail ? `Need help? Write to ${supportEmail}` : '\u00A0'}</p>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo to="/" suffix="Seller" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Sell on {siteName}</h2>
          <p className="mt-1 mb-8 text-sm text-slate-500">Sign in or create your seller account with your mobile number.</p>
          <OtpSignIn
            audience="vendor"
            onAuthenticated={(account) => navigate(destinationFor(account, next), { replace: true })}
            onOnboarding={(state) => navigate('/vendor/register', { state, replace: true })}
          />
          <p className="mt-8 text-center text-sm text-slate-500">
            Looking to buy?{' '}
            <Link to="/" className="font-medium text-primary hover:underline">
              Go to the store
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
