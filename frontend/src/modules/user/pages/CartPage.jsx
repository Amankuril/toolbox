import { AlertTriangle, ArrowRight, FileText, Heart, Layers, Lock, ShoppingCart, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { cn } from '@/core/lib/cn'
import { formatDate, formatINR, formatNumber } from '@/core/lib/format'
import { unitShort } from '@/core/lib/units'
import { useBranding } from '@/core/settings/usePublicSettings'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Card'
import { QuantityStepper } from '@/ui/inputs'
import { useCart } from '../cart/useCart'
import { groupBySeller } from '../cart/groups'
import { CartSummary } from '../components/CartSummary'
import { CouponBox } from '../components/CouponBox'
import { CheckoutHeader, CheckoutSteps, FreeShippingMeter, MobileCheckoutBar, SellerGroupHeader, TrustRow } from '../components/checkoutKit'
import { ProductCard } from '../components/ProductCard'
import { useWishlist, useWishlistProducts } from '../wishlist/useWishlist'

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
      <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-sm bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800">
        <FileText className="size-3.5" /> Quoted price
        {line.pricing.quote?.validUntil && <span className="font-normal text-sky-700">· valid until {formatDate(line.pricing.quote.validUntil)}</span>}
      </p>
    )
  }
  if (line.pricing?.source === 'bulk') {
    return (
      <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-sm bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-ink">
        <Layers className="size-3.5" /> Bulk price for {formatNumber(line.pricing.tier.minQty)}+ · saving {formatINR(line.bulkSavings)}
      </p>
    )
  }
  return null
}

export default function CartPage() {
  const cart = useCart()
  const navigate = useNavigate()
  const { siteName } = useBranding()
  const goCheckout = () => navigate(cart.signedIn ? '/checkout' : '/login?next=/checkout')

  if (cart.isLoading) {
    return (
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-64" />
        </div>
        <Skeleton className="h-80" />
      </div>
    )
  }

  if (!cart.items.length) return <EmptyCart siteName={siteName} />

  const groups = groupBySeller(cart.items, cart.sellers)
  const issues = cart.items.filter((i) => i.issue).length
  const lines = cart.items.length

  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 pb-28 sm:px-6 lg:pb-10">
      <title>{`Your cart | ${siteName}`}</title>
      <CheckoutHeader
        eyebrow="Your cart"
        title="Review your items"
        meta={
          <>
            <span>
              {formatNumber(lines)} {lines === 1 ? 'product' : 'products'} · {formatNumber(cart.count)} {cart.count === 1 ? 'unit' : 'units'}
            </span>
            {groups.length > 1 && <span>Ships in {groups.length} parcels</span>}
            <span>Prices are confirmed at checkout</span>
          </>
        }
        steps={<CheckoutSteps done={[]} />}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <FreeShippingMeter subtotal={cart.summary.subtotal} />

          {issues > 0 && (
            <div role="alert" className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 text-amber-950">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" />
              <div className="text-sm">
                <p className="font-bold">{issues === 1 ? '1 item needs' : `${issues} items need`} your attention</p>
                <p className="mt-0.5">Fix or remove the highlighted {issues === 1 ? 'line' : 'lines'} to continue to checkout.</p>
              </div>
            </div>
          )}

          {groups.map((g, i) => (
            <section key={g.key} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <SellerGroupHeader seller={g.seller} lines={g.lines} index={i} count={groups.length} />
              <ul className="divide-y divide-slate-100">
                {g.lines.map((line) => (
                  <CartLine key={`${line.productId}:${line.variantId ?? ''}`} line={line} cart={cart} />
                ))}
              </ul>
            </section>
          ))}

          <Link to="/search" className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-primary hover:underline">
            Continue shopping <ArrowRight className="size-4" />
          </Link>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-40 lg:self-start">
          <CartSummary summary={cart.summary} coupon={cart.coupon}>
            <CouponBox coupon={cart.coupon} signedIn={cart.signedIn} />
            <Button size="lg" variant="accent" className="mt-5 w-full" disabled={cart.hasIssues || Boolean(cart.coupon?.issue)} onClick={goCheckout}>
              {cart.signedIn ? 'Proceed to checkout' : 'Sign in to check out'} <ArrowRight />
            </Button>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-500">
              <Lock className="size-3.5" /> Stock and prices are re-checked when you place the order
            </p>
          </CartSummary>
          <TrustRow />
        </aside>
      </div>

      <SavedForLater inCart={new Set(cart.items.map((i) => i.productId))} />

      <MobileCheckoutBar
        label={`Total · ${formatNumber(cart.count)} ${cart.count === 1 ? 'unit' : 'units'}`}
        amount={cart.summary.total}
        note={issues ? 'Fix highlighted items first' : cart.coupon?.issue ? 'Remove the coupon that no longer applies' : 'Inclusive of GST'}
      >
        <Button size="lg" variant="accent" disabled={cart.hasIssues || Boolean(cart.coupon?.issue)} onClick={goCheckout}>
          {cart.signedIn ? 'Checkout' : 'Sign in'} <ArrowRight />
        </Button>
      </MobileCheckoutBar>
    </div>
  )
}

function CartLine({ line, cart }) {
  const p = line.product
  const wishlist = useWishlist()
  const [leaving, setLeaving] = useState(false)
  const unit = unitShort(p?.unit)
  const next = line.pricing?.next
  const nextReachable = next && line.quantity + next.unitsNeeded <= line.maxQuantity
  const mrpTotal = line.unitMrp * line.quantity
  const href = p ? `/p/${p.slug}` : '#'

  // Removal fades the row out first, then offers an undo (not for quoted lines: the quote can't be re-attached).
  const remove = async ({ toWishlist = false } = {}) => {
    setLeaving(true)
    if (toWishlist && p && !wishlist.has(p._id)) wishlist.toggle(p, { silent: true })
    try {
      await cart.remove(line.productId, line.variantId)
    } catch {
      setLeaving(false)
      return
    }
    const restore = line.quantityLocked || !p ? undefined : { label: 'Undo', onClick: () => cart.setQty(line.productId, line.quantity, line.variantId) }
    toast(toWishlist ? 'Moved to your wishlist' : 'Removed from cart', { description: p?.name, action: restore })
  }

  return (
    <li
      className={cn(
        'relative grid grid-cols-[84px_minmax(0,1fr)] gap-4 px-5 py-5 transition-[opacity,transform] duration-200 sm:grid-cols-[112px_minmax(0,1fr)_auto]',
        line.issue && 'bg-red-50/40',
        leaving && 'pointer-events-none -translate-x-2 opacity-0',
      )}
    >
      {line.issue && <span className="absolute inset-y-0 left-0 w-1 bg-red-600" aria-hidden />}
      <Link to={href} className="relative aspect-square overflow-hidden rounded-md border border-slate-200 bg-slate-100 p-2">
        <Thumb src={line.variant?.image?.url ?? p?.image?.url} alt={p?.name} className="size-full bg-transparent mix-blend-multiply" />
      </Link>

      <div className="min-w-0">
        {p?.brand && <p className="text-[11px] font-bold tracking-[0.08em] text-slate-500 uppercase">{p.brand}</p>}
        <Link to={href} className="line-clamp-2 leading-snug font-semibold text-slate-900 hover:underline">
          {p?.name ?? 'Unavailable product'}
        </Link>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
          {line.variant && (
            <span className="rounded-sm border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-700">{line.variant.title}</span>
          )}
          {line.sku && <span className="code">SKU {line.sku}</span>}
        </p>
        <p className="tabular mt-1.5 text-sm text-slate-700">
          {formatINR(line.unitPrice)} <span className="text-slate-500">/ {unit}</span>
          {line.unitPrice < line.baseUnitPrice && <span className="ml-2 text-xs text-slate-400 line-through">{formatINR(line.baseUnitPrice)}</span>}
        </p>
        <PricingNote line={line} />
        {line.issue && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-red-700">
            <AlertTriangle className="size-3.5" /> {ISSUE_TEXT[line.issue]}
          </p>
        )}
        {!line.issue && nextReachable && !line.quantityLocked && (
          <button
            type="button"
            onClick={() => cart.setQty(line.productId, line.quantity + next.unitsNeeded, line.variantId)}
            className="mt-2 flex items-center gap-2 rounded-md border border-dashed border-accent bg-accent-soft/60 px-2.5 py-1.5 text-left text-xs text-slate-800 transition-colors hover:bg-accent-soft"
          >
            <Layers className="size-3.5 shrink-0 text-accent-ink" />
            <span>
              Add {formatNumber(next.unitsNeeded)} more to pay{' '}
              <strong>
                {formatINR(next.price)}/{unit}
              </strong>
            </span>
          </button>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1.5">
          <Quantity line={line} cart={cart} />
          <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" aria-hidden />
          <span className="flex items-center">
            {p && (
              <Button variant="ghost" size="sm" className="text-slate-600" onClick={() => remove({ toWishlist: true })}>
                <Heart /> Save for later
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-slate-600 hover:bg-red-50 hover:text-red-700" onClick={() => remove()}>
              <Trash2 /> Remove
            </Button>
          </span>
        </div>
      </div>

      <div className="col-span-2 flex items-baseline justify-between border-t border-dashed border-slate-200 pt-3 sm:col-span-1 sm:flex-col sm:items-end sm:justify-start sm:border-0 sm:pt-0">
        <span className="text-xs text-slate-500 sm:hidden">Line total</span>
        <span className="flex flex-col items-end">
          <span className="price text-[1.5rem] leading-none text-slate-900">{formatINR(line.lineTotal)}</span>
          {mrpTotal > line.lineTotal && (
            <>
              <span className="mt-1 text-xs text-slate-400 line-through">{formatINR(mrpTotal)}</span>
              <span className="mt-0.5 text-xs font-semibold text-primary">Save {formatINR(mrpTotal - line.lineTotal)}</span>
            </>
          )}
        </span>
      </div>
    </li>
  )
}

function Quantity({ line, cart }) {
  const p = line.product
  if (line.quantityLocked) {
    return (
      <span
        className="flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700"
        title="Quantity is fixed by the quote"
      >
        <Lock className="size-3.5" /> Qty {formatNumber(line.quantity)}
      </span>
    )
  }
  if (!p || ['unavailable', 'out_of_stock'].includes(line.issue)) return null
  return (
    <QuantityStepper
      size="sm"
      value={line.quantity}
      min={p.moq}
      max={line.maxQuantity || 9999}
      disabled={cart.isUpdating}
      onChange={(q) => cart.setQty(line.productId, q, line.variantId)}
    />
  )
}

/** Wishlist items not already in the cart: one tap back into the order. */
function SavedForLater({ inCart }) {
  const { rows } = useWishlistProducts()
  const items = rows.filter((r) => r.available && !inCart.has(r.product._id)).slice(0, 5)
  if (!items.length) return null
  return (
    <section className="mt-14">
      <div className="mb-4 flex items-end justify-between gap-3 border-b border-slate-900 pb-3">
        <h2 className="flex items-center gap-2 font-display text-xl font-extrabold tracking-tight text-slate-900">
          <Heart className="size-5" strokeWidth={2} /> Saved for later
        </h2>
        <Link to="/wishlist" className="text-sm font-semibold text-primary hover:underline">
          View wishlist
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((r) => (
          <ProductCard key={r.product._id} product={r.product} />
        ))}
      </div>
    </section>
  )
}

function EmptyCart({ siteName }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <title>{`Your cart | ${siteName}`}</title>
      <div className="flex flex-col items-center rounded-lg border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-slate-100 text-slate-600">
          <ShoppingCart className="size-7" strokeWidth={1.6} />
        </span>
        <h1 className="mt-5 font-display text-2xl font-extrabold tracking-tight text-slate-900">Your cart is empty</h1>
        <p className="mt-1.5 max-w-sm text-sm text-slate-600">Browse tools, machinery and spare parts. Bulk prices kick in automatically as you add more.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild variant="accent" size="lg">
            <Link to="/search">Start shopping</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/search?bulk=true">See bulk deals</Link>
          </Button>
        </div>
      </div>
      <SavedForLater inCart={new Set()} />
    </div>
  )
}
