import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheckBig, Clock, X } from 'lucide-react'
import { useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { PAYMENT_METHOD_LABEL } from '@/core/lib/constants'
import { formatDateTime } from '@/core/lib/format'
import { useBranding } from '@/core/settings/usePublicSettings'
import { AddressBlock, AmountRows, OrderItemRow } from '@/modules/shared/orders'
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

  const refresh = (updated) => {
    if (updated) qc.setQueryData(storeKeys.order(id), updated)
    qc.invalidateQueries({ queryKey: ['user', 'orders'] })
  }

  const retry = useMutation({
    mutationFn: () => userApi.retryPayment(id),
    onSuccess: async ({ order, payment }) => {
      if (await payForOrder({ order, payment, siteName })) {
        toast.success('Payment received — thank you!')
        refresh(await userApi.order(id))
        qc.invalidateQueries({ queryKey: storeKeys.cart })
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
          {o.payment.method === 'cod' ? 'Pay in cash when it arrives. ' : 'Your payment is confirmed. '}We&apos;ll show updates here as sellers ship your items.
        </Alert>
      )}
      {o.status === 'pending_payment' && (
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
                  o.status !== 'pending_payment' && (
                    <ReasonDialog
                      title="Cancel this item?"
                      description={
                        o.payment.method === 'razorpay' && o.payment.status !== 'pending'
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
          <Card>
            <CardHeader title="Payment" action={<StatusBadge status={o.payment.status} />} />
            <CardBody className="flex flex-col gap-4">
              <p className="text-sm text-slate-700">{PAYMENT_METHOD_LABEL[o.payment.method]}</p>
              <AmountRows amounts={o.amounts} />
            </CardBody>
          </Card>
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
