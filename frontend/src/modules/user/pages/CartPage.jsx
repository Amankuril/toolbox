import { AlertTriangle, FileText, Layers, Lock, ShieldCheck, ShoppingCart, Trash2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { formatDate, formatINR, formatNumber } from '@/core/lib/format'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { EmptyState, Skeleton } from '@/ui/Card'
import { QuantityStepper } from '@/ui/inputs'
import { useCart } from '../cart/useCart'
import { CartSummary } from '../components/CartSummary'
import { unitShort } from '@/core/lib/units'

const ISSUE_TEXT = {
  unavailable: 'No longer available. Remove it to continue.',
  out_of_stock: 'Out of stock. Remove it to continue.',
  below_moq: 'Below the minimum order quantity.',
  exceeds_stock: 'Not enough stock for this quantity.',
  quote_expired: 'This quote has expired. Remove it, or request a new quote.',
  quote_in_order: 'This quote is attached to an order awaiting payment.',
}

function PricingNote({ line }) {
  if (line.pricing?.source === 'quote') {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-sky-700">
        <FileText className="size-3.5" /> Quoted price
        {line.pricing.quote?.validUntil && <span className="font-normal text-slate-500">· valid until {formatDate(line.pricing.quote.validUntil)}</span>}
      </p>
    )
  }
  if (line.pricing?.source === 'bulk') {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-accent-ink">
        <Layers className="size-3.5" /> Bulk price for {formatNumber(line.pricing.tier.minQty)}+ · saving {formatINR(line.bulkSavings)}
      </p>
    )
  }
  return null
}

export default function CartPage() {
  const cart = useCart()
  const navigate = useNavigate()

  if (cart.isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (!cart.items.length) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <title>Your cart</title>
        <EmptyState
          icon={ShoppingCart}
          title="Your cart is empty"
          description="Browse tools, machinery and spare parts and add what you need."
          action={
            <Button asChild>
              <Link to="/">Start shopping</Link>
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <title>Your cart</title>
      <h1 className="font-display text-4xl font-bold text-slate-900">Your cart</h1>
      <p className="mt-1 text-sm text-slate-500">
        {formatNumber(cart.count)} unit{cart.count === 1 ? '' : 's'} · prices are confirmed at checkout
      </p>

      {cart.hasIssues && (
        <div className="mt-5 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="size-4 shrink-0" /> Some items need your attention before checkout.
        </div>
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <ul className="border-t border-slate-200">
          {cart.items.map((line) => {
            const p = line.product
            const unit = unitShort(p?.unit)
            const next = line.pricing?.next
            const nextReachable = next && line.quantity + next.unitsNeeded <= line.maxQuantity
            return (
              <li
                key={`${line.productId}:${line.variantId ?? ''}`}
                className="grid grid-cols-[88px_1fr] gap-4 border-b border-slate-200 py-5 sm:grid-cols-[112px_1fr_auto]"
              >
                <Link to={p ? `/p/${p.slug}` : '#'} className="aspect-square overflow-hidden rounded-md bg-slate-100 p-2">
                  <Thumb src={line.variant?.image?.url ?? p?.image?.url} alt={p?.name} className="size-full bg-transparent mix-blend-multiply" />
                </Link>
                <div className="min-w-0">
                  {p?.brand && <p className="text-[11px] font-semibold tracking-[0.08em] text-slate-500 uppercase">{p.brand}</p>}
                  <Link to={p ? `/p/${p.slug}` : '#'} className="line-clamp-2 font-medium text-slate-900 hover:underline">
                    {p?.name ?? 'Unavailable product'}
                  </Link>
                  {line.variant && <p className="mt-0.5 text-sm text-slate-600">{line.variant.title}</p>}
                  <p className="tabular mt-1 text-sm text-slate-600">
                    {formatINR(line.unitPrice)} / {unit}
                    {line.unitPrice < line.baseUnitPrice && <span className="ml-2 text-xs text-slate-400 line-through">{formatINR(line.baseUnitPrice)}</span>}
                  </p>
                  <PricingNote line={line} />
                  {line.issue && <p className="mt-1 text-xs font-semibold text-red-600">{ISSUE_TEXT[line.issue]}</p>}
                  {!line.issue && nextReachable && !line.quantityLocked && (
                    <button
                      type="button"
                      onClick={() => cart.setQty(line.productId, line.quantity + next.unitsNeeded, line.variantId)}
                      className="mt-2 rounded-sm bg-accent-soft px-2 py-1 text-left text-xs text-slate-800 hover:bg-accent/15"
                    >
                      Add {formatNumber(next.unitsNeeded)} more to pay{' '}
                      <strong>
                        {formatINR(next.price)}/{unit}
                      </strong>
                    </button>
                  )}
                  <div className="mt-3 flex items-center gap-4 sm:hidden">
                    <LineControls line={line} cart={cart} />
                  </div>
                </div>
                <div className="hidden flex-col items-end justify-between gap-3 sm:flex">
                  <p className="tabular font-display text-2xl leading-none font-bold text-slate-900">{formatINR(line.lineTotal)}</p>
                  <LineControls line={line} cart={cart} />
                </div>
              </li>
            )
          })}
        </ul>

        <div className="lg:sticky lg:top-40 lg:self-start">
          <CartSummary summary={cart.summary}>
            <Button
              size="lg"
              variant="accent"
              className="mt-5 w-full"
              disabled={cart.hasIssues}
              onClick={() => navigate(cart.signedIn ? '/checkout' : '/login?next=/checkout')}
            >
              {cart.signedIn ? 'Checkout' : 'Sign in to check out'}
            </Button>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-500">
              <ShieldCheck className="size-3.5" /> Stock and prices are re-checked when you place the order
            </p>
          </CartSummary>
        </div>
      </div>
    </div>
  )
}

function LineControls({ line, cart }) {
  const p = line.product
  return (
    <div className="flex items-center gap-3">
      {line.quantityLocked ? (
        <span className="flex items-center gap-1.5 text-sm text-slate-600" title="Quantity is fixed by the quote">
          <Lock className="size-3.5" /> Qty {formatNumber(line.quantity)}
        </span>
      ) : (
        p &&
        !['unavailable', 'out_of_stock'].includes(line.issue) && (
          <QuantityStepper
            size="sm"
            value={line.quantity}
            min={p.moq}
            max={line.maxQuantity || 9999}
            disabled={cart.isUpdating}
            onChange={(q) => cart.setQty(line.productId, q, line.variantId)}
          />
        )
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-slate-400 hover:text-red-600"
        aria-label={`Remove ${p?.name ?? 'item'}`}
        onClick={() => cart.remove(line.productId, line.variantId)}
      >
        <Trash2 />
      </Button>
    </div>
  )
}
