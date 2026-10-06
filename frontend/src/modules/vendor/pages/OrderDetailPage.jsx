import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { formatDateTime, formatINR } from '@/core/lib/format'
import { AddressBlock, ItemStatusActions, OrderItemRow } from '@/modules/shared/orders'
import { LabelButton, ScanList, ShipmentFacts, ShipmentStatusBadge } from '@/modules/shared/shipments'
import { Badge, StatusBadge } from '@/ui/Badge'
import { Card, CardBody, CardHeader, Skeleton } from '@/ui/Card'
import { PageHeader } from '@/ui/PageHeader'
import { vendorApi, vendorKeys } from '../api'

export default function VendorOrderDetailPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { data: o, isLoading } = useQuery({ queryKey: vendorKeys.order(id), queryFn: () => vendorApi.order(id) })
  const { data: shipments = [] } = useQuery({ queryKey: vendorKeys.shipments(id), queryFn: () => vendorApi.shipments(id) })

  const updateItem = (itemId) => async (body) => {
    try {
      const updated = await vendorApi.updateOrderItem(id, itemId, body)
      qc.setQueryData(vendorKeys.order(id), updated)
      qc.invalidateQueries({ queryKey: ['vendor', 'orders'] })
      qc.invalidateQueries({ queryKey: vendorKeys.dashboard })
      toast.success('Order updated')
    } catch (err) {
      toast.error(errorMessage(err))
      throw err
    }
  }

  if (isLoading || !o) return <Skeleton className="h-96" />

  return (
    <>
      <PageHeader back={{ to: '/vendor/orders', label: 'Orders' }} title={`Order ${o.orderNumber}`} description={`Placed ${formatDateTime(o.createdAt)}`} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Your items" description="Move each item forward as you fulfil it. The customer sees every update." />
          <ul className="divide-y divide-slate-100 px-5">
            {o.items.map((item) => (
              <OrderItemRow key={item._id} item={item} actions={<ItemStatusActions item={item} onUpdate={updateItem(item._id)} />} />
            ))}
          </ul>
        </Card>
        <div className="flex flex-col gap-6">
          {shipments
            .filter((s) => s.status !== 'pending')
            .map((s) => (
              <Card key={s._id}>
                <CardHeader
                  title={s.type === 'return' ? 'Return pickup' : 'Shipment'}
                  description={<span className="font-mono">{s.providerOrderId}</span>}
                  action={<ShipmentStatusBadge status={s.status} />}
                />
                <CardBody className="flex flex-col gap-4">
                  <ShipmentFacts
                    shipment={s}
                    extra={[s.paymentType === 'cod' && s.type === 'forward' && ['Collect on delivery', formatINR(s.codAmount ?? 0)]]}
                  />
                  <ScanList scans={s.tracking.scans} />
                  <div>
                    <LabelButton shipment={s} fetchLabel={vendorApi.shipmentLabel} />
                  </div>
                </CardBody>
              </Card>
            ))}
          <Card>
            <CardHeader title="Ship to" />
            <CardBody>
              <AddressBlock address={o.shippingAddress} />
              {o.billing?.gstin && (
                <p className="mt-3 text-sm text-slate-600">
                  Buyer GSTIN: <span className="font-mono">{o.billing.gstin}</span>
                  {o.billing.businessName && ` (${o.billing.businessName})`}
                </p>
              )}
              {o.notes && <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700">“{o.notes}”</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Payment" action={<StatusBadge status={o.payment.status} />} />
            <CardBody className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Method</span>
                <Badge>{o.payment.method === 'cod' ? 'Cash on delivery' : 'Prepaid online'}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Your items</span>
                <span className="tabular">{formatINR(o.amounts.subtotal)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>Includes GST</span>
                <span className="tabular">{formatINR(o.amounts.tax)}</span>
              </div>
              {o.payment.method === 'cod' && (
                <p className="mt-2 rounded-md bg-amber-50 p-2.5 text-xs text-amber-800">
                  Cash on delivery: the order is marked paid once every item is delivered.
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
