import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheckBig, Clock, X } from 'lucide-react'
import { useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { PAYMENT_METHOD_LABEL } from '@/core/lib/constants'
import { formatDateTime, formatINR } from '@/core/lib/format'
import { useBranding } from '@/core/settings/usePublicSettings'
import { downloadPdf } from '@/modules/shared/download'
import { InvoicesCard } from '@/modules/shared/invoices'
import { AddressBlock, AmountRows, OrderItemRow } from '@/modules/shared/orders'
import { ScanList, ShipmentStatusBadge, ShipmentTimeline } from '@/modules/shared/shipments'
import { StatusBadge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Alert, Card, CardBody, CardHeader, Skeleton } from '@/ui/Card'
import { ReasonDialog } from '@/ui/ReasonDialog'
import { PageHeader } from '@/ui/PageHeader'
import { storeKeys, userApi } from '../../api'
import { payForOrder } from '../../payments'

export default function MyOrderDetailPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const qc = useQueryClient()
  const { siteName } = useBranding()
  const { data: o, isLoading } = useQuery({
    queryKey: storeKeys.order(id),
    queryFn: () => userApi.order(id),
    // Webhooks may confirm a payment moments after the redirect; poll briefly while it's pending.
    refetchInterval: (q) => (q.state.data?.status === 'pending_payment' ? 5000 : false),
  })

  const { data: shipments = [] } = useQuery({
    queryKey: storeKeys.tracking(id),
    queryFn: () => userApi.tracking(id),
    enabled: Boolean(o) && !['pending_payment', 'cancelled'].includes(o?.status),
  })

  const { data: invoices } = useQuery({
    queryKey: storeKeys.invoices(id),
    queryFn: () => userApi.invoices(id),
    enabled: Boolean(o) && o?.status !== 'pending_payment',
  })

  const refresh = (updated) => {
    if (updated) qc.setQueryData(storeKeys.order(id), updated)
    qc.invalidateQueries({ queryKey: ['user', 'orders'] })
  }

  const retry = useMutation({
    mutationFn: () => userApi.retryPayment(id),
    onSuccess: async ({ order, payment }) => {
      const payResult = await payForOrder({ order, payment, siteName })
      if (payResult.status === 'paid') {
        toast.success('Payment received — thank you!')
        refresh(await userApi.order(id))
        qc.invalidateQueries({ queryKey: storeKeys.cart })
      } else if (payResult.status === 'verifying') {
        refresh(await userApi.order(id))
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const cancel = async (itemId, reason) => {
    try {
      refresh(await userApi.cancelItem(id, itemId, reason))
      toast.success('Item cancelled')
    } catch (err) {
      toast.error(errorMessage(err))
      throw err
    }
  }

  if (isLoading || !o) return <Skeleton className="h-96" />
  const justPlaced = params.get('placed') === '1' && o.status !== 'pending_payment'
  const isVerifying = params.get('verifying') === '1' && o.status === 'pending_payment'

  return (
    <>
      <title>{`Order ${o.orderNumber}`}</title>
      <PageHeader
        back={{ to: '/account/orders', label: 'My orders' }}
        title={`Order ${o.orderNumber}`}
        meta={<StatusBadge status={o.status} />}
        description={`Placed ${formatDateTime(o.createdAt)}`}
      />

      {justPlaced && (
        <Alert tone="success" icon={CircleCheckBig} title="Order placed!" className="mb-5">
          {o.payment.method === 'cod'
            ? 'Pay in cash when it arrives. '
            : o.payment.method === 'partial'
              ? `Advance received. Pay ${formatINR(o.amounts.balanceDue ?? 0)} in cash when it arrives. `
              : 'Your payment is confirmed. '}
          We&apos;ll show updates here as sellers ship your items.
        </Alert>
      )}
      {isVerifying && (
        <Alert tone="info" icon={Clock} title="Payment status is being verified" className="mb-5">
          We are confirming your payment with Razorpay. Please do not make another payment yet. This page will update automatically once verified.
        </Alert>
      )}
      {o.status === 'pending_payment' && !isVerifying && (
        <Alert
          tone="warning"
          icon={Clock}
          title="Payment pending"
          className="mb-5"
          action={
            <Button size="sm" loading={retry.isPending} onClick={() => retry.mutate()}>
              Pay now
            </Button>
          }
        >
          Complete payment by {formatDateTime(o.expiresAt)} or the order will be cancelled automatically.
          {o.payment.failureReason && ` Last attempt failed: ${o.payment.failureReason}`}
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Items" />
          <ul className="divide-y divide-slate-100 px-5">
            {o.items.map((item) => (
              <OrderItemRow
                key={item._id}
                item={item}
                actions={
                  ['pending', 'confirmed'].includes(item.status) &&
                  o.status !== 'pending_payment' &&
                  // Booked with a courier: cancelling goes through support.
                  !shipments.some((s) => s.type === 'forward' && s.status !== 'cancelled' && s.items.some((r) => r.itemId === item._id)) && (
                    <ReasonDialog
                      title="Cancel this item?"
                      description={
                        o.payment.method === 'partial' && o.payment.status !== 'pending'
                          ? 'The amount due on delivery goes down first. If your advance now covers more than you owe, the difference is refunded.'
                          : o.payment.method === 'razorpay' && o.payment.status !== 'pending'
                            ? 'The amount for this item is refunded to your original payment method.'
                            : 'You will not be charged for it.'
                      }
                      label="Reason"
                      required={false}
                      confirmLabel="Cancel item"
                      onSubmit={(reason) => cancel(item._id, reason || undefined)}
                      trigger={
                        <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50">
                          <X /> Cancel item
                        </Button>
                      }
                    />
                  )
                }
              />
            ))}
          </ul>
        </Card>

        <div className="flex flex-col gap-5">
          {shipments.map((s, i) => (
            <Card key={s._id}>
              <CardHeader
                title={s.type === 'return' ? 'Return pickup' : shipments.filter((x) => x.type === 'forward').length > 1 ? `Delivery ${i + 1}` : 'Delivery'}
                description={s.courier && [s.courier.name, s.awbNumber && `AWB ${s.awbNumber}`].filter(Boolean).join(' · ')}
                action={<ShipmentStatusBadge status={s.status} />}
              />
              <CardBody className="flex flex-col gap-4">
                {s.tracking.expectedDeliveryDate && s.status !== 'delivered' && (
                  <p className="text-sm text-slate-700">Expected by {s.tracking.expectedDeliveryDate}</p>
                )}
                {s.type === 'forward' && <ShipmentTimeline steps={[{ key: 'confirmed', label: 'Order confirmed', done: true }, ...s.steps]} />}
                <ScanList scans={s.tracking.scans} />
              </CardBody>
            </Card>
          ))}
          <Card>
            <CardHeader title="Payment" action={<StatusBadge status={o.payment.status} />} />
            <CardBody className="flex flex-col gap-4">
              <p className="text-sm text-slate-700">{PAYMENT_METHOD_LABEL[o.payment.method]}</p>
              <AmountRows amounts={o.amounts} coupon={o.coupon} />
            </CardBody>
          </Card>
          <InvoicesCard invoices={invoices} onDownload={(inv) => downloadPdf(() => userApi.invoicePdf(id, inv.vendor), `Invoice-${o.orderNumber}.pdf`)} />
          <Card>
            <CardHeader title="Delivery address" />
            <CardBody>
              <AddressBlock address={o.shippingAddress} />
              {o.billing?.gstin && (
                <p className="mt-3 text-sm text-slate-600">
                  GSTIN <span className="font-mono">{o.billing.gstin}</span>
                  {o.billing.businessName && ` · ${o.billing.businessName}`}
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
