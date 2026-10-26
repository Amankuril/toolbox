import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock, Lock, MapPin, XCircle } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { formatDateTime, formatINR } from '@/core/lib/format'
import { openRazorpayCheckout } from '@/core/payments/razorpay'
import { useBranding } from '@/core/settings/usePublicSettings'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Card, EmptyState, Skeleton } from '@/ui/Card'
import { storeApi, storeKeys } from '../api'

const CLOSED = {
  paid: { icon: CheckCircle2, tone: 'text-emerald-600', title: 'Payment received', text: 'Thank you! Your order has been placed.' },
  cancelled: { icon: XCircle, tone: 'text-slate-500', title: 'This link was cancelled', text: 'Ask the seller for a new payment link.' },
  expired: { icon: Clock, tone: 'text-amber-600', title: 'This link has expired', text: 'Ask the seller for a new payment link.' },
}

/** An order a seller or the store shared as a link: review it and pay, no account needed. */
export default function PayLinkPage() {
  const { token } = useParams()
  const qc = useQueryClient()
  const { siteName } = useBranding()
  const { data: link, isLoading, error } = useQuery({ queryKey: storeKeys.payLink(token), queryFn: () => storeApi.payLink(token), retry: false })

  const pay = useMutation({
    mutationFn: async () => {
      const { payment } = await storeApi.startPayLink(token)
      const result = await openRazorpayCheckout({
        payment,
        name: siteName,
        description: `Order for ${formatINR(payment.amount)}`,
        color: getComputedStyle(document.documentElement).getPropertyValue('--tb-primary').trim() || undefined,
      })
      if (result.status !== 'paid') {
        if (result.reason) storeApi.payLinkFailed(token, result.reason).catch(() => {})
        return null
      }
      return storeApi.verifyPayLink(token, { providerOrderId: result.providerOrderId, paymentId: result.paymentId, signature: result.signature })
    },
    onSuccess: (updated) => {
      if (updated) qc.setQueryData(storeKeys.payLink(token), updated)
      else toast.info('Payment not completed. You can try again.')
    },
    onError: (err) => {
      // A charge may still be confirming; reload what the server knows instead of inviting a second payment.
      qc.invalidateQueries({ queryKey: storeKeys.payLink(token) })
      toast.error(errorMessage(err))
    },
  })

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-10">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (error || !link) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <EmptyState icon={XCircle} title="Payment link not found" description="Check the link you were sent, or ask the seller for a new one." />
      </div>
    )
  }

  const closed = CLOSED[link.status]
  const a = link.shippingAddress
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
      <title>{`Pay for your order | ${siteName}`}</title>
      <meta name="robots" content="noindex" />
      <p className="eyebrow">{link.sellers.join(', ')}</p>
      <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight text-slate-900">Your order</h1>
      <p className="mt-1 text-slate-600">Hi {link.customerName}, please review your order and pay securely below.</p>

      {closed && (
        <div className="mt-6 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <closed.icon className={`mt-0.5 size-6 shrink-0 ${closed.tone}`} />
          <div>
            <p className="font-semibold text-slate-900">{closed.title}</p>
            <p className="text-sm text-slate-600">
              {closed.text}
              {link.orderNumber && ` Order number ${link.orderNumber}.`}
            </p>
            {link.status === 'paid' && (
              <Link to="/account/orders" className="mt-1 inline-block text-sm font-semibold text-primary underline">
                Sign in with your mobile number to track it
              </Link>
            )}
          </div>
        </div>
      )}

      <Card className="mt-6 divide-y divide-slate-100">
        <ul className="divide-y divide-slate-100">
          {link.items.map((i, k) => (
            <li key={k} className="flex items-center gap-3 p-4">
              <Thumb src={i.image} className="size-14 shrink-0 rounded border border-slate-200" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{i.name}</p>
                {i.variant && <p className="text-xs text-slate-500">{i.variant}</p>}
                <p className="text-xs text-slate-500">
                  {i.quantity} × {formatINR(i.unitPrice)}
                </p>
              </div>
              <span className="tabular font-semibold">{formatINR(i.unitPrice * i.quantity)}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1.5 p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-600">Items</dt>
            <dd className="tabular">{formatINR(link.amounts.subtotal)}</dd>
          </div>
          {link.amounts.discount > 0 && (
            <div className="flex justify-between text-emerald-700">
              <dt>Discount</dt>
              <dd className="tabular">− {formatINR(link.amounts.discount)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-slate-600">Delivery</dt>
            <dd className="tabular">{link.amounts.shipping ? formatINR(link.amounts.shipping) : 'Free'}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
            <dt>Total</dt>
            <dd className="tabular">{formatINR(link.amounts.total)}</dd>
          </div>
          <p className="text-xs text-slate-500">Prices include GST.</p>
        </dl>
        <div className="flex gap-3 p-4 text-sm text-slate-700">
          <MapPin className="mt-0.5 size-4 shrink-0 text-slate-400" />
          <p>
            <span className="font-semibold">{a.name}</span>, {[a.line1, a.line2, a.landmark, a.city, a.state].filter(Boolean).join(', ')} – {a.pincode}
            <span className="block text-slate-500">{a.phone}</span>
          </p>
        </div>
        {link.notes && <p className="p-4 text-sm text-slate-600">Note: {link.notes}</p>}
      </Card>

      {link.status === 'open' && (
        <div className="mt-6 space-y-2">
          <Button size="lg" className="w-full" loading={pay.isPending} onClick={() => pay.mutate()}>
            <Lock /> Pay {formatINR(link.amounts.total)}
          </Button>
          <p className="text-center text-xs text-slate-500">UPI, cards, net banking and EMI via Razorpay. Link valid until {formatDateTime(link.expiresAt)}.</p>
        </div>
      )}
    </div>
  )
}
