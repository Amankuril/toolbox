import { formatINR } from '@/core/lib/format'
import { usePublicSettings } from '@/core/settings/usePublicSettings'

/** Totals for cart and checkout. Savings are split so bulk and quote prices are visible. */
export function CartSummary({ summary, children, title = 'Order summary' }) {
  const { data: settings } = usePublicSettings()
  const freeAbove = settings?.shipping?.freeAbove
  const shippingHint = summary.shipping > 0 && freeAbove > summary.subtotal ? `Add ${formatINR(freeAbove - summary.subtotal)} more for free shipping` : null
  const bulk = summary.bulkSavings ?? 0
  const mrpDiscount = Math.max(0, (summary.savings ?? 0) - bulk)

  return (
    <section className="rounded-md border border-slate-200 bg-white p-5">
      <h2 className="font-display text-xl font-bold text-slate-900">{title}</h2>
      <dl className="mt-4 flex flex-col gap-2.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-600">
            Items ({summary.itemCount}) at MRP
          </dt>
          <dd className="tabular text-slate-900">{formatINR(summary.mrpTotal || summary.subtotal)}</dd>
        </div>
        {mrpDiscount > 0 && (
          <div className="flex justify-between">
            <dt className="text-slate-600">Discount</dt>
            <dd className="tabular font-medium text-accent-ink">−{formatINR(mrpDiscount)}</dd>
          </div>
        )}
        {bulk > 0 && (
          <div className="flex justify-between">
            <dt className="text-slate-600">Bulk & quote savings</dt>
            <dd className="tabular font-medium text-accent-ink">−{formatINR(bulk)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-slate-600">Shipping</dt>
          <dd className="tabular">{summary.shipping ? formatINR(summary.shipping) : <span className="font-medium text-slate-900">Free</span>}</dd>
        </div>
        {shippingHint && <p className="text-xs text-slate-500">{shippingHint}</p>}
        <div className="mt-2 flex items-baseline justify-between border-t border-slate-200 pt-3">
          <dt className="font-semibold text-slate-900">Total</dt>
          <dd className="tabular font-display text-[1.75rem] leading-none font-bold text-slate-900">{formatINR(summary.total)}</dd>
        </div>
        <p className="text-xs text-slate-500">Inclusive of GST</p>
      </dl>
      {children}
    </section>
  )
}
