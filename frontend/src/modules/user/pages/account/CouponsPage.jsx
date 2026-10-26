import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, ShoppingCart, TicketPercent } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { cn } from '@/core/lib/cn'
import { formatRelative } from '@/core/lib/format'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { EmptyState, Skeleton } from '@/ui/Card'
import { couponConditions, couponOffer } from '@/modules/vendor/coupons'
import { storeKeys, userApi } from '../../api'

const STATE = { used: 'Used', expired: 'Expired', limit_reached: 'All used up', inactive: 'No longer available', not_started: 'Starts soon' }

/** Coupons sellers and the store have sent to this buyer. */
export default function MyCouponsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: coupons, isLoading } = useQuery({ queryKey: storeKeys.myCoupons, queryFn: userApi.myCoupons })
  // Reading the list marks them seen (the API does that when it answers).
  useEffect(() => {
    if (coupons) qc.setQueryData(storeKeys.unseenCoupons, { count: 0 })
  }, [coupons, qc])

  const apply = useMutation({
    mutationFn: (code) => userApi.applyCoupon(code),
    onSuccess: (cart) => {
      qc.setQueryData(storeKeys.cart, cart)
      toast.success('Coupon applied to your cart')
      navigate('/cart')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const copy = async (code) => {
    try {
      await navigator.clipboard.writeText(code)
      toast.success(`${code} copied`)
    } catch {
      toast.error('Could not copy')
    }
  }

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-bold text-slate-900">My coupons</h1>
      <p className="mb-6 text-sm text-slate-600">Offers sent to you. Apply one to your cart, or enter the code at checkout.</p>
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : !coupons?.length ? (
        <EmptyState
          icon={TicketPercent}
          title="No coupons yet"
          description="When a seller sends you an offer, it shows up here."
          action={
            <Button asChild variant="outline">
              <Link to="/search">Browse products</Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {coupons.map((c) => {
            const usable = c.state === 'live'
            return (
              <li
                key={c._id}
                className={cn('relative flex flex-col gap-3 rounded-lg border-2 border-dashed p-4', usable ? 'border-primary/40 bg-primary/5' : 'border-slate-200 bg-slate-50 opacity-75')}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-xl font-extrabold text-slate-900">{couponOffer(c)}</p>
                    <p className="text-xs text-slate-600">{couponConditions(c)}</p>
                  </div>
                  {c.isNew && usable && <Badge tone="accent">New</Badge>}
                  {!usable && <Badge>{STATE[c.state] ?? c.state}</Badge>}
                </div>
                {c.description && <p className="text-sm text-slate-700">{c.description}</p>}
                <p className="text-xs text-slate-500">
                  {c.seller ? (
                    <>
                      On{' '}
                      <Link to={`/store/${c.seller.slug}`} className="font-semibold text-primary hover:underline">
                        {c.seller.name}
                      </Link>{' '}
                      products
                    </>
                  ) : (
                    'On everything in the store'
                  )}{' '}
                  · sent {formatRelative(c.sentAt)}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => copy(c.code)} className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1 font-mono text-sm font-bold text-slate-900 hover:border-slate-500">
                    {c.code} <Copy className="size-3.5 text-slate-400" />
                  </button>
                  {usable && (
                    <Button size="sm" loading={apply.isPending && apply.variables === c.code} onClick={() => apply.mutate(c.code)}>
                      <ShoppingCart /> Apply to cart
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
