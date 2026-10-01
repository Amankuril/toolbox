import { Building2, Layers } from 'lucide-react'
import { Link } from 'react-router'
import { cn } from '@/core/lib/cn'
import { formatINR } from '@/core/lib/format'
import { rangeLabel, tierRows } from '@/core/lib/pricing'
import { unitShort } from '@/core/lib/units'

/**
 * Quantity price breaks. The row matching the chosen quantity is highlighted; clicking a
 * row sets the quantity to that tier's minimum.
 */
export function BulkPricingTable({ product, tiers, quantity, onPick, signedIn, isBusiness }) {
  const unit = unitShort(product.inventory.unit)
  const all = product.bulkPricing?.tiers ?? []

  // Business-only tiers the buyer can't use yet: show them, but explain how to unlock.
  if (all.length && !tiers.length) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 p-4">
        <p className="flex items-center gap-2 font-display text-lg font-bold text-slate-900">
          <Building2 className="size-5 text-slate-500" /> Business pricing available
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Buy {all[0].minQty}+ for as little as {formatINR(Math.min(...all.map((t) => t.price)))}/{unit} with a business account.
        </p>
        <Link to={signedIn ? '/account/profile' : `/login?next=${encodeURIComponent(window.location.pathname)}`} className="mt-2 inline-block text-sm font-semibold text-slate-900 underline underline-offset-2">
          {signedIn ? 'Switch to a business account' : 'Sign in with a business account'}
        </Link>
      </div>
    )
  }
  if (!tiers.length) return null

  const rows = tierRows(product.pricing.price, product.inventory.moq, tiers)
  const activeIndex = rows.reduce((idx, r, i) => (quantity >= r.minQty ? i : idx), 0)

  return (
    <div>
      <p className="mb-2 flex items-center gap-2 font-display text-lg font-bold text-slate-900">
        <Layers className="size-5 text-accent-ink" /> Buy more, pay less
        {isBusiness && product.bulkPricing.businessOnly && <span className="text-sm font-medium text-slate-500">· business price</span>}
      </p>
      <div className="overflow-hidden rounded-md border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Quantity
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Price / {unit}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                You save
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const active = i === activeIndex
              return (
                <tr
                  key={row.minQty}
                  onClick={() => onPick(row.minQty)}
                  className={cn('cursor-pointer border-t border-slate-100', active ? 'bg-accent-soft' : 'hover:bg-slate-50')}
                  aria-selected={active}
                >
                  <td className="px-3 py-2.5">
                    <button type="button" className={cn('text-left', active ? 'font-semibold text-slate-900' : 'text-slate-700')} aria-label={`Choose ${row.minQty} ${unit}`}>
                      {rangeLabel(row, unit)}
                    </button>
                  </td>
                  <td className={cn('tabular px-3 py-2.5 text-right', active ? 'font-bold text-slate-900' : 'text-slate-800')}>{formatINR(row.price)}</td>
                  <td className="tabular px-3 py-2.5 text-right font-medium text-accent-ink">{row.savePercent ? `${row.savePercent}%` : <span className="text-slate-300">—</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
