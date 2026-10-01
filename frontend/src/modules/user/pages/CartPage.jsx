import { AlertTriangle, ShieldCheck, ShoppingCart, Trash2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { formatINR } from '@/core/lib/format'
import { Price, Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Card, EmptyState, Skeleton } from '@/ui/Card'
import { QuantityStepper } from '@/ui/inputs'
import { useCart } from '../cart/useCart'
import { CartSummary } from '../components/CartSummary'

const ISSUE_TEXT = {
  unavailable: 'No longer available — remove it to continue.',
  out_of_stock: 'Out of stock — remove it to continue.',
  below_moq: 'Below the minimum order quantity.',
  exceeds_stock: 'Not enough stock for this quantity.',
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
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <title>Your cart</title>
        <Card>
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
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <title>Your cart</title>
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Your cart</h1>

      {cart.hasIssues && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="size-4 shrink-0" /> Some items need your attention before checkout.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card as="ul" className="divide-y divide-slate-100">
          {cart.items.map((line) => {
            const p = line.product
            return (
              <li key={line.productId} className="flex gap-4 p-4 sm:p-5">
                <Link to={p ? `/p/${p.slug}` : '#'} className="shrink-0">
                  <Thumb src={p?.image?.url} alt={p?.name} className="size-20 rounded-lg border border-slate-200 sm:size-24" />
                </Link>
                <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    {p?.brand && <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{p.brand}</p>}
                    <Link to={p ? `/p/${p.slug}` : '#'} className="line-clamp-2 font-medium text-slate-900 hover:text-primary">
                      {p?.name ?? 'Unavailable product'}
                    </Link>
                    {p && <Price price={p.price} mrp={p.mrp} size="sm" className="mt-1" />}
                    {line.issue && <p className="mt-1 text-xs font-medium text-red-600">{ISSUE_TEXT[line.issue]}</p>}
                  </div>
                  <div className="flex items-center gap-3 sm:flex-col sm:items-end">
                    {p && !['unavailable', 'out_of_stock'].includes(line.issue) && (
                      <QuantityStepper
                        size="sm"
                        value={line.quantity}
                        min={p.moq}
                        max={line.maxQuantity || 9999}
                        disabled={cart.isUpdating}
                        onChange={(q) => cart.setQty(line.productId, q)}
                      />
                    )}
                    <p className="tabular font-semibold text-slate-900">{formatINR(line.lineTotal)}</p>
                    <Button variant="ghost" size="xs" className="text-slate-500 hover:text-red-600" onClick={() => cart.remove(line.productId)}>
                      <Trash2 /> Remove
                    </Button>
                  </div>
                </div>
              </li>
            )
          })}
        </Card>

        <div className="lg:sticky lg:top-36 lg:self-start">
          <CartSummary summary={cart.summary}>
            <Button size="lg" className="mt-5 w-full" disabled={cart.hasIssues} onClick={() => navigate(cart.signedIn ? '/checkout' : '/login?next=/checkout')}>
              {cart.signedIn ? 'Proceed to checkout' : 'Sign in to checkout'}
            </Button>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-500">
              <ShieldCheck className="size-3.5" /> Prices and stock are confirmed at checkout
            </p>
          </CartSummary>
        </div>
      </div>
    </div>
  )
}
