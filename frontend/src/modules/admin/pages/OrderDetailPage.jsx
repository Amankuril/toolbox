import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { formatDateTime, formatINR, formatPhone } from '@/core/lib/format'
import { PAYMENT_METHOD_LABEL } from '@/core/lib/constants'
import { AddressBlock, AmountRows, ItemStatusActions, OrderItemRow } from '@/modules/shared/orders'
import { StatusBadge } from '@/ui/Badge'
import { Alert, Card, CardBody, CardHeader, Skeleton } from '@/ui/Card'
import { DescriptionList, PageHeader } from '@/ui/PageHeader'
import { adminApi, adminKeys } from '../api'

export default function OrderDetailPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { data: o, isLoading } = useQuery({ queryKey: adminKeys.order(id), queryFn: () => adminApi.order(id) })

  const updateItem = (itemId) => async (body) => {
    try {
      const updated = await adminApi.updateOrderItem(id, itemId, body)
      qc.setQueryData(adminKeys.order(id), updated)
      qc.invalidateQueries({ queryKey: ['admin', 'orders'] })
      toast.success('Order updated')
    } catch (err) {
      toast.error(errorMessage(err))
      throw err
    }
  }

  if (isLoading || !o) return <Skeleton className="h-96" />

  // Group lines by vendor: each vendor fulfils their own items.
  const groups = Object.values(
    o.items.reduce((acc, item) => {
      const key = item.vendor?._id ?? item.vendor
      ;(acc[key] ??= { vendor: item.vendor, items: [] }).items.push(item)
      return acc
    }, {}),
  )

  return (
    <>
      <PageHeader
        back={{ to: '/admin/orders', label: 'Orders' }}
        title={`Order ${o.orderNumber}`}
        meta={<StatusBadge status={o.status} />}
        description={`Placed ${formatDateTime(o.createdAt)}`}
      />

      {o.status === 'pending_payment' && (
        <Alert tone="warning" title="Awaiting payment" className="mb-6">
          Stock is held until {formatDateTime(o.expiresAt)}. The order is cancelled automatically if payment doesn&apos;t arrive.
          {o.payment.failureReason && ` Last attempt: ${o.payment.failureReason}.`}
        </Alert>
      )}
      {o.cancelReason && o.status === 'cancelled' && (
        <Alert tone="danger" title="Cancelled" className="mb-6">
          {o.cancelReason}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {groups.map((g) => (
            <Card key={g.vendor?._id ?? 'unknown'}>
              <CardHeader title={g.vendor?.store?.name ?? 'Vendor'} description={g.vendor?.phone && `Vendor contact ${formatPhone(g.vendor.phone)}`} />
              <ul className="divide-y divide-slate-100 px-5">
                {g.items.map((item) => (
                  <OrderItemRow
                    key={item._id}
                    item={item}
                    actions={<ItemStatusActions item={item} onUpdate={updateItem(item._id)} disabled={o.status === 'pending_payment'} />}
                  />
                ))}
              </ul>
            </Card>
          ))}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Payment" action={<StatusBadge status={o.payment.status} />} />
            <CardBody className="flex flex-col gap-4">
              <p className="text-sm text-slate-700">{PAYMENT_METHOD_LABEL[o.payment.method]}</p>
              <AmountRows amounts={o.amounts} />
              {o.refunds?.length > 0 && (
                <div className="border-t border-slate-100 pt-3 text-xs text-slate-600">
                  {o.refunds.map((r) => (
                    <p key={r.providerRefundId ?? r.at}>
                      Refund {formatINR(r.amount)} · {r.status} · {formatDateTime(r.at)}
                    </p>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Customer" />
            <CardBody className="flex flex-col gap-4">
              <DescriptionList
                className="sm:grid-cols-1"
                items={[
                  ['Name', o.user?.name],
                  ['Mobile', formatPhone(o.user?.phone)],
                  ['Email', o.user?.email],
                  o.billing && ['GSTIN', o.billing.gstin],
                  o.billing && ['Business', o.billing.businessName],
                ]}
              />
              <div>
                <p className="mb-1 text-xs font-medium tracking-wide text-slate-500 uppercase">Ship to</p>
                <AddressBlock address={o.shippingAddress} />
              </div>
              {o.notes && (
                <div>
                  <p className="mb-1 text-xs font-medium tracking-wide text-slate-500 uppercase">Customer note</p>
                  <p className="text-sm text-slate-700">{o.notes}</p>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
