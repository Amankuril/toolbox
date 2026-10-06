import { BadgePercent } from 'lucide-react'
import { formatINR } from '@/core/lib/format'

/**
 * Totals for cart and checkout. Savings are split so bulk and quote prices are visible.
 * `before` renders above the totals (e.g. the item list on checkout), `children` below them.
 */
export function CartSummary({ summary, children, before, title = 'Order summary' }) {
  const bulk = summary.bulkSavings ?? 0
  const mrpDiscount = Math.max(0, (summary.savings ?? 0) - bulk)
  const saved = mrpDiscount + bulk

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <h2 className="border-b border-slate-100 px-5 py-4 text-[1.0625rem] font-bold text-slate-900">{title}</h2>
      {before}
      <div className="px-5 py-4">
        <dl className="flex flex-col gap-2.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-600">Items ({summary.itemCount}) at MRP</dt>
            <dd className="tabular text-slate-900">{formatINR(summary.mrpTotal || summary.subtotal)}</dd>
          </div>
          {mrpDiscount > 0 && (
            <div className="flex justify-between">
              <dt className="text-slate-600">Discount</dt>
              <dd className="tabular font-medium text-primary">−{formatINR(mrpDiscount)}</dd>
            </div>
          )}
          {bulk > 0 && (
            <div className="flex justify-between">
              <dt className="text-slate-600">Bulk &amp; quote savings</dt>
              <dd className="tabular font-medium text-primary">−{formatINR(bulk)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-slate-600">Shipping</dt>
            <dd className="tabular">{summary.shipping ? formatINR(summary.shipping) : <span className="font-semibold text-primary">Free</span>}</dd>
          </div>
          <div className="mt-2 flex items-baseline justify-between border-t border-dashed border-slate-300 pt-3">
            <dt>
              <span className="block font-bold text-slate-900">Total</span>
              <span className="text-xs text-slate-500">{summary.tax ? `Includes ${formatINR(summary.tax)} GST` : 'Inclusive of GST'}</span>
            </dt>
            <dd className="price text-[2rem] leading-none text-slate-900">{formatINR(summary.total)}</dd>
          </div>
        </dl>
        {saved > 0 && (
          <p className="mt-4 flex items-center gap-2 rounded-md bg-primary-soft px-3 py-2.5 text-sm font-semibold text-primary">
            <BadgePercent className="size-4 shrink-0" strokeWidth={2} />
            You&apos;re saving {formatINR(saved)} on this order
          </p>
        )}
        {children}
      </div>
    </section>
  )
}
