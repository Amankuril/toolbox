import { formatINR } from '@/core/lib/format'
import { usePublicSettings } from '@/core/settings/usePublicSettings'
import { Card } from '@/ui/Card'

export function CartSummary({ summary, children }) {
  const { data: settings } = usePublicSettings()
  const freeAbove = settings?.shipping?.freeAbove
  const shippingHint = summary.shipping > 0 && freeAbove > summary.subtotal ? `Add ${formatINR(freeAbove - summary.subtotal)} more for free shipping` : null
  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold text-slate-900">Order summary</h2>
      <dl className="mt-4 flex flex-col gap-2.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-600">Items ({summary.itemCount})</dt>
          <dd className="tabular">{formatINR(summary.mrpTotal || summary.subtotal)}</dd>
        </div>
        {summary.savings > 0 && (
          <div className="flex justify-between text-accent">
            <dt>Discount</dt>
            <dd className="tabular">−{formatINR(summary.savings)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-slate-600">Shipping</dt>
          <dd className="tabular">{summary.shipping ? formatINR(summary.shipping) : <span className="font-medium text-accent">Free</span>}</dd>
        </div>
        {shippingHint && <p className="text-xs text-slate-500">{shippingHint}</p>}
        <div className="mt-1 flex justify-between border-t border-slate-100 pt-3 text-base font-bold">
          <dt>Total</dt>
          <dd className="tabular">{formatINR(summary.total)}</dd>
        </div>
        <p className="text-xs text-slate-500">Inclusive of GST</p>
      </dl>
      {children}
    </Card>
  )
}
