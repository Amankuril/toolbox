import { Clock, MapPin, MessageSquare } from 'lucide-react'
import { QUOTE_STATUS_LABELS } from '@/core/lib/constants'
import { cn } from '@/core/lib/cn'
import { formatDate, formatDateTime, formatINR, formatNumber } from '@/core/lib/format'
import { unitPlural } from '@/core/lib/units'
import { StatusBadge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'

export function QuoteStatus({ status, className }) {
  return <StatusBadge status={status} labels={QUOTE_STATUS_LABELS} className={className} />
}

/** "₹1,050/pc · ₹52,50,000 for 5,000" with the saving against the listed price. */
export function OfferBreakdown({ quote, className }) {
  const { offer, quantity, product } = quote
  if (!offer) return null
  const total = offer.unitPrice * quantity
  const listTotal = (product.basePrice ?? offer.unitPrice) * quantity
  const saving = listTotal - total
  return (
    <div className={cn('rounded-lg border border-slate-200 bg-slate-50 p-4', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-slate-600">Offer{offer.revision > 0 && ` (revision ${offer.revision})`}</p>
        <p className="text-xs text-slate-500">
          <Clock className="mr-1 inline size-3.5" />
          Valid until {formatDateTime(offer.validUntil)}
        </p>
      </div>
      <p className="mt-1 text-2xl font-semibold text-slate-900">
        {formatINR(offer.unitPrice)}
        <span className="text-sm font-normal text-slate-500"> / {product.unit ?? 'piece'}</span>
      </p>
      <p className="tabular mt-0.5 text-sm text-slate-700">
        {formatINR(total)} for {formatNumber(quantity)} {unitPlural(product.unit, quantity)}
        {saving > 0 && <span className="ml-2 font-medium text-accent-ink">saves {formatINR(saving)} vs listed price</span>}
      </p>
      {offer.note && <p className="mt-3 border-t border-slate-200 pt-3 text-sm text-slate-700">“{offer.note}”</p>}
    </div>
  )
}

/** Request facts shown to every party. */
export function QuoteRequestFacts({ quote }) {
  return (
    <div className="flex gap-4">
      <Thumb src={quote.product.image} alt="" className="size-16 shrink-0 rounded-lg border border-slate-200" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-900">{quote.product.name}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Listed at {formatINR(quote.product.basePrice)} / {quote.product.unit ?? 'piece'}
          {quote.product.sku && ` · SKU ${quote.product.sku}`}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-slate-500">Quantity</dt>
            <dd className="tabular font-semibold text-slate-900">{formatNumber(quote.quantity)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Target price</dt>
            <dd className="tabular text-slate-900">{quote.targetUnitPrice ? `${formatINR(quote.targetUnitPrice)} / ${quote.product.unit ?? 'piece'}` : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Needed by</dt>
            <dd className="text-slate-900">{quote.requiredBy ? formatDate(quote.requiredBy) : 'Flexible'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Deliver to</dt>
            <dd className="text-slate-900">
              <MapPin className="mr-0.5 inline size-3.5 text-slate-400" />
              {quote.pincode}
            </dd>
          </div>
        </dl>
        {quote.note && (
          <p className="mt-3 flex gap-2 rounded-md bg-slate-50 p-2.5 text-sm text-slate-700">
            <MessageSquare className="mt-0.5 size-4 shrink-0 text-slate-400" />
            {quote.note}
          </p>
        )}
      </div>
    </div>
  )
}

const ACTOR = { user: 'Buyer', vendor: 'Seller', admin: 'Admin', system: 'System' }

export function QuoteTimeline({ history }) {
  if (!history?.length) return null
  return (
    <ol className="flex flex-col gap-3 border-l border-slate-200 pl-4">
      {[...history].reverse().map((h, i) => (
        <li key={i} className="relative text-sm">
          <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full bg-slate-300 ring-2 ring-white" />
          <span className="font-medium text-slate-800">{QUOTE_STATUS_LABELS[h.status] ?? h.status}</span>
          <span className="text-slate-500">
            {' '}
            · {ACTOR[h.by?.kind] ?? ''} · {formatDateTime(h.at)}
          </span>
          {h.note && <p className="text-slate-600">{h.note}</p>}
        </li>
      ))}
    </ol>
  )
}
