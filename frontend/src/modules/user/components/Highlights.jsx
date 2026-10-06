import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, Banknote, Layers, Receipt, ShieldCheck, Store, Truck, Users, Package } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { formatINR, formatNumber } from '@/core/lib/format'
import { usePublicSettings } from '@/core/settings/usePublicSettings'
import { storeApi, storeKeys } from '../api'

/**
 * Store promises, built only from what this store actually does (settings), so every line is
 * true: free shipping only if it's configured, COD only if it's on, and so on.
 */
function useServiceHighlights() {
  const { data: settings } = usePublicSettings()
  const pay = settings?.payments ?? {}
  const ship = settings?.shipping ?? {}
  const items = []
  if (ship.flatFee === 0) items.push({ icon: Truck, title: 'Free shipping', text: 'On every order' })
  else if (ship.freeAbove > 0) items.push({ icon: Truck, title: 'Free shipping', text: `On orders above ${formatINR(ship.freeAbove, { whole: true })}` })
  items.push({ icon: BadgeCheck, title: 'Reviewed sellers', text: 'GST and bank details checked' })
  items.push({ icon: Receipt, title: 'GST invoice', text: 'Claim input tax credit' })
  if (pay.razorpayEnabled) items.push({ icon: ShieldCheck, title: 'Secure payments', text: 'UPI, cards & net banking' })
  if (pay.codEnabled)
    items.push({
      icon: Banknote,
      title: 'Cash on delivery',
      text: pay.codMaxOrderValue ? `Up to ${formatINR(pay.codMaxOrderValue, { whole: true })}` : 'Pay when it arrives',
    })
  items.push({ icon: Layers, title: 'Bulk pricing', text: 'Price breaks in your cart' })
  return items.slice(0, 5)
}

/** Home page: one hairline bar of promises under the hero. */
export function ServiceStrip({ className }) {
  const items = useServiceHighlights()
  return (
    <section aria-label="Why buy here" className={cn('mx-auto max-w-7xl px-4 sm:px-6', className)}>
      {/* 1px gaps over a grey ground draw the dividers, whatever the column count. */}
      <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-3 lg:grid-cols-5">
        {items.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex items-center gap-3 bg-white px-4 py-4 sm:px-5">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-soft text-primary">
              <Icon className="size-5" strokeWidth={1.7} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-slate-900">{title}</span>
              <span className="block text-xs text-slate-600">{text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Product page: compact tiles under the buy box. */
export function ServiceTiles({ className }) {
  const items = useServiceHighlights()
  return (
    <ul className={cn('grid grid-cols-3 gap-2 sm:grid-cols-5', className)} aria-label="What you get">
      {items.map(({ icon: Icon, title }) => (
        <li key={title} className="flex flex-col items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-3 text-center">
          <span className="grid size-9 place-items-center rounded-full bg-white text-primary ring-1 ring-slate-200">
            <Icon className="size-[18px]" strokeWidth={1.7} />
          </span>
          <span className="text-[0.72rem] leading-tight font-semibold text-slate-800">{title}</span>
        </li>
      ))}
    </ul>
  )
}

/** Live counts from the store. Each number only appears once it's big enough to mean something. */
export function StatsBand({ siteName, className }) {
  const { data } = useQuery({ queryKey: storeKeys.stats, queryFn: storeApi.stats, staleTime: 10 * 60_000 })
  const stats = [
    data?.customers && { icon: Users, value: data.customers, label: 'Customers' },
    data?.sellers && { icon: Store, value: data.sellers, label: 'Reviewed sellers' },
    data?.products && { icon: Package, value: data.products, label: 'Products' },
  ].filter(Boolean)
  if (!stats.length) return null
  return (
    <section className={cn('mx-auto max-w-7xl px-4 sm:px-6', className)}>
      <div className="flex flex-col items-center gap-5 rounded-md bg-secondary px-6 py-7 text-secondary-fg sm:flex-row sm:justify-between">
        <p className="text-center font-display text-xl font-bold sm:text-left">{siteName}, in numbers</p>
        <ul className="flex flex-wrap justify-center gap-x-10 gap-y-4">
          {stats.map(({ icon: Icon, value, label }) => (
            <li key={label} className="flex items-center gap-3">
              <Icon className="size-6 text-accent" strokeWidth={1.7} />
              <span>
                <span className="price block text-2xl leading-none">{formatNumber(value)}+</span>
                <span className="text-xs text-secondary-fg/70">{label}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
