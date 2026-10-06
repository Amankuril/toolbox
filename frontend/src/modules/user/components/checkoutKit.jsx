import { Check, FileText, PackageCheck, ShieldCheck, Store, Truck } from 'lucide-react'
import { Link } from 'react-router'
import { cn } from '@/core/lib/cn'
import { formatINR, formatNumber } from '@/core/lib/format'
import { usePublicSettings } from '@/core/settings/usePublicSettings'
import { dispatchOf } from '../cart/groups'

/* ─────────────── step tracker ─────────────── */

const STEPS = [
  { key: 'cart', label: 'Cart', to: '/cart' },
  { key: 'address', label: 'Address' },
  { key: 'payment', label: 'Payment' },
  { key: 'review', label: 'Place order' },
]

/**
 * Cart → Address → Payment → Place order. `done` lists finished steps; the first unfinished
 * one is "current". Finished steps with a route are links back.
 */
export function CheckoutSteps({ done = [], className }) {
  const current = STEPS.findIndex((s) => !done.includes(s.key))
  return (
    <ol className={cn('flex items-center', className)} aria-label="Checkout progress">
      {STEPS.map((s, i) => {
        const isDone = done.includes(s.key)
        const isCurrent = i === current
        const dot = (
          <span
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-full border-2 text-xs font-bold transition-colors',
              isDone
                ? 'border-primary bg-primary text-primary-fg'
                : isCurrent
                  ? 'border-slate-900 bg-white text-slate-900'
                  : 'border-slate-300 bg-white text-slate-400',
            )}
          >
            {isDone ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
          </span>
        )
        const label = <span className={cn('hidden text-sm font-semibold sm:inline', isDone || isCurrent ? 'text-slate-900' : 'text-slate-500')}>{s.label}</span>
        return (
          <li key={s.key} className="flex items-center" aria-current={isCurrent ? 'step' : undefined}>
            {i > 0 && <span className={cn('mx-2 h-0.5 w-6 sm:mx-3 sm:w-10', i <= current || isDone ? 'bg-primary' : 'bg-slate-200')} aria-hidden />}
            {isDone && s.to ? (
              <Link to={s.to} className="flex items-center gap-2 rounded-md hover:opacity-80">
                {dot}
                {label}
              </Link>
            ) : (
              <span className="flex items-center gap-2">
                {dot}
                {label}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** Page title block shared by cart and checkout. */
export function CheckoutHeader({ eyebrow, title, meta, steps, back }) {
  return (
    <header className="mb-6 flex flex-col gap-5 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {back}
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-1 font-display text-[2rem] leading-none font-extrabold tracking-tight text-slate-900 sm:text-[2.5rem]">{title}</h1>
        {meta && <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">{meta}</p>}
      </div>
      {steps}
    </header>
  )
}

/* ─────────────── free shipping meter ─────────────── */

/** How far the order is from free shipping, as a bar that fills up as items are added. */
export function FreeShippingMeter({ subtotal, className }) {
  const { data: settings } = usePublicSettings()
  const { flatFee = 0, freeAbove = 0 } = settings?.shipping ?? {}
  if (!flatFee || !freeAbove) return null
  const left = Math.max(0, freeAbove - subtotal)
  const pct = Math.min(100, Math.round((subtotal / freeAbove) * 100))
  return (
    <div className={cn('rounded-lg border border-slate-200 bg-white px-5 py-4', className)}>
      <p className="flex items-center gap-2 text-sm">
        <Truck className={cn('size-5 shrink-0', left ? 'text-slate-600' : 'text-primary')} strokeWidth={1.8} />
        {left ? (
          <span className="text-slate-700">
            Add <strong className="price text-slate-900">{formatINR(left, { whole: true })}</strong> more for{' '}
            <strong className="text-slate-900">free shipping</strong>
          </span>
        ) : (
          <span className="font-semibold text-primary">You&apos;ve unlocked free shipping on this order</span>
        )}
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn('h-full rounded-full transition-[width] duration-500 ease-out', left ? 'bg-accent' : 'bg-primary')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/* ─────────────── seller groups ─────────────── */

export function SellerGroupHeader({ seller, lines, index, count }) {
  const dispatch = dispatchOf(lines)
  const units = lines.reduce((n, l) => n + l.quantity, 0)
  const subtotal = lines.filter((l) => !l.issue).reduce((s, l) => s + l.lineTotal, 0)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-700">
          <Store className="size-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900">
            {count > 1 && <span className="code mr-2 text-xs text-slate-500">PARCEL {index + 1}</span>}
            {seller ? (
              <>
                Sold by{' '}
                {seller.slug ? (
                  <Link to={`/store/${seller.slug}`} className="hover:underline">
                    {seller.name}
                  </Link>
                ) : (
                  seller.name
                )}
              </>
            ) : (
              'Your items'
            )}
          </p>
          <p className="flex flex-wrap gap-x-3 text-xs text-slate-600">
            {seller?.city && <span>Ships from {seller.city}</span>}
            {dispatch != null && <span>Dispatch {dispatch === 0 ? 'within 24 h' : `in ${dispatch} day${dispatch === 1 ? '' : 's'}`}</span>}
            <span>
              {formatNumber(units)} {units === 1 ? 'unit' : 'units'}
            </span>
          </p>
        </div>
      </div>
      <p className="price text-base text-slate-900">{formatINR(subtotal)}</p>
    </div>
  )
}

/* ─────────────── trust + mobile bar ─────────────── */

export function TrustRow({ className }) {
  const items = [
    { icon: ShieldCheck, label: 'Secure payments' },
    { icon: FileText, label: 'GST invoice' },
    { icon: PackageCheck, label: 'Tracked delivery' },
  ]
  return (
    <ul className={cn('grid grid-cols-3 gap-2', className)}>
      {items.map(({ icon: Icon, label }) => (
        <li key={label} className="flex flex-col items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-3 text-center">
          <Icon className="size-5 text-primary" strokeWidth={1.7} />
          <span className="text-[11px] leading-tight font-semibold text-slate-700">{label}</span>
        </li>
      ))}
    </ul>
  )
}

/** Phones: total and the next action stay reachable while scrolling a long cart. */
export function MobileCheckoutBar({ label, amount, note, children }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgb(0_0_0/0.06)] backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-xl items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-500">{label}</p>
          <p className="price text-xl leading-tight text-slate-900">{formatINR(amount)}</p>
          {note && <p className="truncate text-[11px] text-slate-500">{note}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}
